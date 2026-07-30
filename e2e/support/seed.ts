// Isolated-workspace seeding for the browser suite.
//
// Every run creates its own user and its own workspace and never touches an
// existing one. Nothing is shared between specs, so a failing test cannot leave
// another test's fixture in a strange state, and nothing here can reach real
// inventory even if pointed at a populated database — a brand-new user is a
// member of exactly one workspace, the one it just made.
//
// The whole seed runs under the signed-up user's own session with the anon key.
// Locations, products, SKUs, lots and units are all created by the same governed
// functions the application calls, so the fixtures are only ever in states the
// real system can actually produce.
//
// Plain fetch against GoTrue and PostgREST rather than @supabase/supabase-js:
// the SDK constructs a realtime client on createClient, which needs a native
// WebSocket and therefore Node 22+, and this seed never subscribes to anything.
// Dropping it removes a dependency, removes the Node-version coupling, and
// leaves the harness doing exactly what it says — signed HTTP calls to the two
// endpoints the application itself uses.

import { e2eEnv } from './env';

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly locations: {
    readonly room: string;
    readonly shelfA: string;
    readonly shelfB: string;
  };
  /** Serialized units, by certificate number. */
  readonly certificates: readonly string[];
  /** Quantity lots: public id and the quantity staged. */
  readonly lots: readonly { readonly publicId: string; readonly quantity: number }[];
}

/** Unique per run, so parallel workers and repeat runs never collide. */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lot public ids are caller-supplied and constrained to
 * `^RV-[A-Z]{1,6}-[0-9]{4,10}$`, so they cannot carry the run suffix. A
 * per-process numeric base keeps them unique within a workspace — and the
 * workspace is itself new every run, so collisions across runs are impossible.
 */
const LOT_ID_BASE = Math.floor(Math.random() * 900000) + 100000;
function lotPublicId(index: number): string {
  return `RV-E2E-${LOT_ID_BASE + index}`;
}

interface Session {
  readonly accessToken: string;
  /** The token's own `sub` claim — definitionally what auth.uid() returns. */
  readonly userId: string;
  readonly role: string;
}

/**
 * Reads the claims out of a JWT without verifying it. The server verifies;
 * this only needs to know which subject the token will authorize as.
 *
 * `created_by` is taken from `sub` rather than from the sign-up response body
 * because the RLS policy on workspaces is `created_by = auth.uid()`, and
 * auth.uid() reads the token. Sourcing it from anywhere else invites exactly
 * the mismatch that shows up as an opaque 42501.
 */
function decodeClaims(token: string): { sub?: string; role?: string } {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      .toString('utf8');
    return JSON.parse(json) as { sub?: string; role?: string };
  } catch {
    return {};
  }
}

async function readError(response: Response, what: string): Promise<never> {
  const body = await response.text().catch(() => '');
  // Name the step and quote the server. A half-built fixture otherwise surfaces
  // as a puzzling failure somewhere unrelated.
  throw new Error(`seed: ${what} failed (${response.status}) — ${body.slice(0, 500)}`);
}

/** Sign up, and fall back to sign-in if the stack is configured to confirm. */
async function signUp(email: string, password: string): Promise<Session> {
  const { supabaseUrl, supabaseAnonKey } = e2eEnv();
  const headers = { apikey: supabaseAnonKey, 'Content-Type': 'application/json' };

  const signUpResponse = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  });
  if (!signUpResponse.ok) await readError(signUpResponse, 'sign-up');
  const signUpBody = await signUpResponse.json() as {
    access_token?: string; user?: { id?: string };
  };

  let accessToken = signUpBody.access_token;

  // Some GoTrue versions return the user rather than a session from /signup
  // even with confirmations disabled, so sign in explicitly when that happens.
  if (!accessToken) {
    const signInResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email, password }),
    });
    if (!signInResponse.ok) {
      await readError(
        signInResponse,
        'sign-in after sign-up returned no session (the local stack needs ' +
        '[auth.email] enable_confirmations = false)'
      );
    }
    accessToken = (await signInResponse.json() as { access_token: string }).access_token;
  }

  const claims = decodeClaims(accessToken);
  if (!claims.sub) {
    throw new Error(
      `seed: the access token carries no sub claim, so auth.uid() would be null ` +
      `and every workspace-scoped policy would refuse. Claims: ${JSON.stringify(claims)}`
    );
  }
  return { accessToken, userId: claims.sub, role: claims.role ?? 'unknown' };
}

function authHeaders(session: Session): Record<string, string> {
  const { supabaseAnonKey } = e2eEnv();
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Calls a governed SECURITY DEFINER function through PostgREST. */
async function rpc(
  session: Session,
  fn: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { supabaseUrl } = e2eEnv();
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: authHeaders(session), body: JSON.stringify(args),
  });
  if (!response.ok) await readError(response, fn);
  const body = await response.json().catch(() => ({}));
  return (body ?? {}) as Record<string, unknown>;
}

export interface SeedOptions {
  /** Serialized units to mint on shelf A. */
  readonly serializedUnits?: number;
  /** Quantity lots to stage on shelf A, with their quantities. */
  readonly lotQuantities?: readonly number[];
}

/**
 * Creates a user, a workspace, a small location tree and enough inventory for a
 * cycle count to be worth running. Returns everything a spec needs to sign in
 * and drive the UI.
 */
export async function seedWorkspace(options: SeedOptions = {}): Promise<SeededWorkspace> {
  const serializedUnits = options.serializedUnits ?? 2;
  const lotQuantities = options.lotQuantities ?? [12, 4];
  const { supabaseUrl } = e2eEnv();

  const suffix = uniqueSuffix();
  const email = `e2e-${suffix}@russellvault.test`;
  const password = `e2e-${suffix}-Aa1!`;
  const session = await signUp(email, password);

  // The workspace. An after-insert trigger records the creator as owner, which
  // is what makes every governed call below authorize.
  const workspaceResponse = await fetch(`${supabaseUrl}/rest/v1/workspaces`, {
    method: 'POST',
    headers: { ...authHeaders(session), Prefer: 'return=representation' },
    body: JSON.stringify({ name: `E2E ${suffix}`, created_by: session.userId }),
  });
  if (!workspaceResponse.ok) {
    // Name the subject the token authorizes as. The policy is
    // `created_by = auth.uid()`, so a refusal here is almost always a
    // disagreement between the two, and printing both settles it in one run.
    await readError(
      workspaceResponse,
      `workspace insert as sub=${session.userId} role=${session.role}`
    );
  }
  const [workspace] = await workspaceResponse.json() as { id: string }[];
  const workspaceId = workspace.id;

  // Complete first-run setup, or every route sits behind the setup gate.
  const setupResponse = await fetch(
    `${supabaseUrl}/rest/v1/workspaces?id=eq.${workspaceId}`,
    {
      method: 'PATCH',
      headers: authHeaders(session),
      body: JSON.stringify({
        sku_prefix: 'RV-E2E-',
        setup_completed_at: new Date().toISOString(),
      }),
    }
  );
  if (!setupResponse.ok) await readError(setupResponse, 'first-run setup');

  const locations = { room: 'E2E-ROOM', shelfA: 'E2E-SHELF-A', shelfB: 'E2E-SHELF-B' };
  await rpc(session, 'register_storage_location', {
    p_workspace_id: workspaceId, p_location_code: locations.room,
    p_parent_code: null, p_display_name: 'E2E Room',
  });
  for (const [code, name] of [[locations.shelfA, 'Shelf A'], [locations.shelfB, 'Shelf B']]) {
    await rpc(session, 'register_storage_location', {
      p_workspace_id: workspaceId, p_location_code: code,
      p_parent_code: locations.room, p_display_name: name,
    });
  }

  const product = await rpc(session, 'register_product', {
    p_workspace_id: workspaceId, p_business_vertical: 'tcg',
    p_display_name: 'E2E Charizard',
    p_product_canonical_key: `tcg|e2e-charizard|${suffix}`,
    p_attrs: { set_name: 'E2E Set', card_number: '4' },
  });

  const slabSku = await rpc(session, 'register_sellable_sku', {
    p_workspace_id: workspaceId, p_product_id: product.id,
    p_attrs: { grading_company: 'PSA', numeric_grade: '10', product_format: 'Graded slab' },
  });
  const sealedSku = await rpc(session, 'register_sellable_sku', {
    p_workspace_id: workspaceId, p_product_id: product.id,
    p_attrs: { product_format: 'Booster Box', condition_or_quality: 'Sealed' },
  });

  // Serialized units on shelf A, each with a scannable certificate.
  const certificates: string[] = [];
  if (serializedUnits > 0) {
    const slabLot = await rpc(session, 'stage_inventory_lot', {
      p_workspace_id: workspaceId, p_public_id: lotPublicId(0),
      p_sku_id: slabSku.id, p_tracking_mode: 'serialized', p_quantity: serializedUnits,
      p_location_code: locations.shelfA, p_record_origin: 'e2e',
      p_mapping_version: '1.0.0', p_fingerprint_inputs: null,
    });
    for (let i = 1; i <= serializedUnits; i += 1) {
      const certificate = `E2E-${suffix}-${i}`.toUpperCase();
      await rpc(session, 'mint_serialized_item', {
        p_workspace_id: workspaceId, p_lot_id: slabLot.id,
        p_grading_company: 'PSA', p_certificate_number: certificate, p_serial_number: null,
      });
      certificates.push(certificate);
    }
  }

  // Quantity lots on shelf A.
  const lots: { publicId: string; quantity: number }[] = [];
  for (const [index, quantity] of lotQuantities.entries()) {
    const publicId = lotPublicId(index + 1);
    await rpc(session, 'stage_inventory_lot', {
      p_workspace_id: workspaceId, p_public_id: publicId,
      p_sku_id: sealedSku.id, p_tracking_mode: 'lot_managed', p_quantity: quantity,
      p_location_code: locations.shelfA, p_record_origin: 'e2e',
      p_mapping_version: '1.0.0', p_fingerprint_inputs: null,
    });
    lots.push({ publicId, quantity });
  }

  // Nothing is torn down. The workspace is unique to this test and append-only
  // evidence is the point of the schema — deleting it would be both refused by
  // the database and dishonest about what the run did.
  return {
    workspaceId, email, password, accessToken: session.accessToken,
    locations, certificates, lots,
  };
}

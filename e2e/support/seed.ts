// Isolated-workspace seeding for the browser suite.
//
// Every run creates its own user and its own workspace and never touches an
// existing one. Nothing is shared between specs, so a failing test cannot leave
// another test's fixture in a strange state, and nothing here can reach real
// inventory even if pointed at a populated database — a brand-new user is a
// member of exactly one workspace, the one it just made.
//
// The whole seed runs through the anon key under the signed-up user's own
// session. Locations, products, SKUs, lots and units are all created by the
// same governed functions the application calls, which means the fixtures are
// only ever in states the real system can actually produce.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { e2eEnv } from './env';

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly email: string;
  readonly password: string;
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

function anonClient(): SupabaseClient {
  const env = e2eEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(fn, args);
  // Fail loudly and name the function. A half-built fixture produces a test
  // failure somewhere unrelated, which is much harder to read than this.
  if (error) throw new Error(`seed: ${fn} failed — ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
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

  const suffix = uniqueSuffix();
  const email = `e2e-${suffix}@russellvault.test`;
  const password = `e2e-${suffix}-Aa1!`;
  const client = anonClient();

  const { data: signUp, error: signUpError } = await client.auth.signUp({ email, password });
  if (signUpError) throw new Error(`seed: sign-up failed — ${signUpError.message}`);
  const userId = signUp.user?.id;
  if (!userId) {
    throw new Error(
      'seed: sign-up returned no user. The local stack needs ' +
      '[auth.email] enable_confirmations = false so a new user has a session immediately.'
    );
  }
  if (!signUp.session) {
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`seed: sign-in failed — ${signInError.message}`);
  }

  // The workspace. An after-insert trigger records the creator as owner, which
  // is what makes every governed call below authorize.
  const { data: workspace, error: workspaceError } = await client
    .from('workspaces')
    .insert({ name: `E2E ${suffix}`, created_by: userId })
    .select('id')
    .single();
  if (workspaceError) throw new Error(`seed: workspace insert failed — ${workspaceError.message}`);
  const workspaceId = (workspace as { id: string }).id;

  // Complete first-run setup, or every route sits behind the setup gate.
  const { error: setupError } = await client
    .from('workspaces')
    .update({ sku_prefix: 'RV-E2E-', setup_completed_at: new Date().toISOString() })
    .eq('id', workspaceId);
  if (setupError) throw new Error(`seed: first-run setup failed — ${setupError.message}`);

  const locations = { room: 'E2E-ROOM', shelfA: 'E2E-SHELF-A', shelfB: 'E2E-SHELF-B' };
  await rpc(client, 'register_storage_location', {
    p_workspace_id: workspaceId, p_location_code: locations.room,
    p_parent_code: null, p_display_name: 'E2E Room',
  });
  for (const [code, name] of [[locations.shelfA, 'Shelf A'], [locations.shelfB, 'Shelf B']]) {
    await rpc(client, 'register_storage_location', {
      p_workspace_id: workspaceId, p_location_code: code,
      p_parent_code: locations.room, p_display_name: name,
    });
  }

  const product = await rpc(client, 'register_product', {
    p_workspace_id: workspaceId, p_business_vertical: 'tcg',
    p_display_name: 'E2E Charizard',
    p_product_canonical_key: `tcg|e2e-charizard|${suffix}`,
    p_attrs: { set_name: 'E2E Set', card_number: '4' },
  });

  const slabSku = await rpc(client, 'register_sellable_sku', {
    p_workspace_id: workspaceId, p_product_id: product.id,
    p_attrs: { grading_company: 'PSA', numeric_grade: '10', product_format: 'Graded slab' },
  });
  const sealedSku = await rpc(client, 'register_sellable_sku', {
    p_workspace_id: workspaceId, p_product_id: product.id,
    p_attrs: { product_format: 'Booster Box', condition_or_quality: 'Sealed' },
  });

  // Serialized units on shelf A, each with a scannable certificate.
  const certificates: string[] = [];
  if (serializedUnits > 0) {
    const slabLot = await rpc(client, 'stage_inventory_lot', {
      p_workspace_id: workspaceId, p_public_id: lotPublicId(0),
      p_sku_id: slabSku.id, p_tracking_mode: 'serialized', p_quantity: serializedUnits,
      p_location_code: locations.shelfA, p_record_origin: 'e2e',
      p_mapping_version: '1.0.0', p_fingerprint_inputs: null,
    });
    for (let i = 1; i <= serializedUnits; i += 1) {
      const certificate = `E2E-${suffix}-${i}`.toUpperCase();
      await rpc(client, 'mint_serialized_item', {
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
    await rpc(client, 'stage_inventory_lot', {
      p_workspace_id: workspaceId, p_public_id: publicId,
      p_sku_id: sealedSku.id, p_tracking_mode: 'lot_managed', p_quantity: quantity,
      p_location_code: locations.shelfA, p_record_origin: 'e2e',
      p_mapping_version: '1.0.0', p_fingerprint_inputs: null,
    });
    lots.push({ publicId, quantity });
  }

  await client.auth.signOut();
  return { workspaceId, email, password, locations, certificates, lots };
}

// The single authentication and authorization boundary for every legacy SQLite
// HTTP route.
//
// Before this guard existed, all eight legacy routers — inventory, purchases,
// cost links, listings, sales, dashboard, checks, lookups — were anonymously
// readable by anyone who could reach the process. The legacy write guard sat in
// front of them, but it only ever asked "is this a write?", never "who is this?".
//
// What this guard establishes, per request:
//   * The surface is configured at all. An unconfigured deployment fails closed
//     with a bounded 503 rather than falling back to anonymous access.
//   * The caller presented a bearer token, and the governed Supabase project
//     itself verified it (auth.getUser). Tokens are never parsed or trusted
//     locally, so a forged or expired one cannot pass.
//   * The caller is a member of THE CONFIGURED legacy workspace. Membership is
//     read from workspace_members through a client running under that same
//     caller JWT, so RLS answers the question — there is no second authorization
//     model here to drift out of sync with the database, and no service-role key
//     anywhere in this path.
//   * For writes: the caller holds owner or operator, AND ALLOW_LEGACY_WRITES is
//     explicitly 'true'. Both are required; neither implies the other.
//
// The workspace is taken ONLY from configuration. A client-supplied workspaceId
// is deliberately ignored rather than honoured — otherwise a member of any other
// workspace could name their own workspace, pass the membership check against
// it, and read the global legacy dataset. That is precisely the hole this guard
// closes, so the caller does not get a say in which workspace is checked.
//
// Errors are bounded codes. No filesystem path, SQL, token, workspace id, or
// provider message is ever returned: a caller who is refused learns that they
// were refused and nothing about the shape of what refused them.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { WorkspaceRole } from '../provenance/auth.js';
import {
  getLegacyAccessConfig,
  resolveLegacyWritesEnabled,
  type EnvLike,
  type LegacyAccessConfig,
} from './accessConfig.js';

/** Roles permitted to READ the quarantined legacy surface. */
export const LEGACY_READ_ROLES: readonly WorkspaceRole[] = ['owner', 'operator', 'viewer'];
/**
 * Roles permitted to WRITE. Matches the governed contract in
 * docs/ai/ENGINEERING_RULES.md §1 — "Owner/operator may mutate where
 * appropriate; viewers remain read-only" — so legacy write authority is never
 * broader than governed write authority.
 */
export const LEGACY_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'operator'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Bounded, non-disclosing refusal codes. */
export const LEGACY_DENIAL = {
  notConfigured: 'legacy_surface_not_configured',
  authRequired: 'legacy_authentication_required',
  authInvalid: 'legacy_authentication_invalid',
  membershipUnverified: 'legacy_membership_unverified',
  forbidden: 'legacy_access_forbidden',
  writeRole: 'legacy_write_role_forbidden',
  writesDisabled: 'legacy_writes_disabled',
} as const;

export type LegacyDenialCode = (typeof LEGACY_DENIAL)[keyof typeof LEGACY_DENIAL];

export interface LegacyCaller {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
}

export interface LegacyAuthedRequest extends Request {
  legacyCaller?: LegacyCaller;
}

export type LegacyClientFactory = (config: LegacyAccessConfig, token: string) => SupabaseClient;

/**
 * The only part of a request this guard reads. Deliberately narrower than
 * Express's Request: `header` there is overloaded to return string[] for
 * 'set-cookie', which this guard never asks for and which would otherwise force
 * every caller and test double to model a return type it cannot produce.
 */
export interface LegacyRequestLike {
  readonly method: string;
  header(name: string): string | undefined;
}

function defaultClientFactory(config: LegacyAccessConfig, token: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function readBearerToken(req: Pick<LegacyRequestLike, 'header'>): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export interface LegacyDecision {
  readonly allowed: boolean;
  readonly status?: number;
  readonly code?: LegacyDenialCode;
  readonly caller?: LegacyCaller;
}

const deny = (status: number, code: LegacyDenialCode): LegacyDecision => ({ allowed: false, status, code });

export interface LegacyGuardDeps {
  readonly env?: EnvLike;
  readonly clientFactory?: LegacyClientFactory;
}

/**
 * The whole decision, as one async function, so tests can drive every branch
 * without an HTTP server. The middleware below is a thin adapter over it.
 */
export async function decideLegacyAccess(
  req: LegacyRequestLike,
  deps: LegacyGuardDeps = {},
): Promise<LegacyDecision> {
  const env = deps.env ?? process.env;
  const clientFactory = deps.clientFactory ?? defaultClientFactory;

  // Preflight carries no data and no credentials; the CORS policy decides
  // whether the origin is allowed at all.
  if (req.method === 'OPTIONS') return { allowed: true };

  const config = getLegacyAccessConfig(env);
  if (!config) return deny(503, LEGACY_DENIAL.notConfigured);

  const token = readBearerToken(req);
  if (!token) return deny(401, LEGACY_DENIAL.authRequired);

  let client: SupabaseClient;
  try {
    client = clientFactory(config, token);
  } catch {
    // A client we cannot even construct is an unconfigured surface, not an
    // authenticated one. Never fall through to allow.
    return deny(503, LEGACY_DENIAL.notConfigured);
  }

  let userId: string;
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return deny(401, LEGACY_DENIAL.authInvalid);
    userId = data.user.id;
  } catch {
    return deny(401, LEGACY_DENIAL.authInvalid);
  }

  // Membership in the CONFIGURED workspace only. Any workspaceId on the request
  // is ignored on purpose — see the header comment.
  let role: WorkspaceRole;
  try {
    const { data: rows, error } = await client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', config.legacyWorkspaceId)
      .eq('user_id', userId)
      .limit(1);
    if (error) return deny(403, LEGACY_DENIAL.membershipUnverified);
    if (!rows || rows.length === 0) {
      // Authenticated, but not a member of the quarantine workspace. The same
      // code is returned whether the workspace is wrong, empty, or nonexistent.
      return deny(403, LEGACY_DENIAL.forbidden);
    }
    role = (rows[0] as { role: WorkspaceRole }).role;
  } catch {
    return deny(403, LEGACY_DENIAL.membershipUnverified);
  }

  if (!LEGACY_READ_ROLES.includes(role)) return deny(403, LEGACY_DENIAL.forbidden);

  const caller: LegacyCaller = { userId, workspaceId: config.legacyWorkspaceId, role };

  if (SAFE_METHODS.has(req.method)) return { allowed: true, caller };

  // Writes need BOTH an authorized role and the explicit flag. Checking the role
  // first means a viewer is told they lack the role rather than learning the
  // deployment's write-flag state.
  if (!LEGACY_WRITE_ROLES.includes(role)) return deny(403, LEGACY_DENIAL.writeRole);
  if (!resolveLegacyWritesEnabled(env)) return deny(403, LEGACY_DENIAL.writesDisabled);

  return { allowed: true, caller };
}

export function createLegacyAccessGuard(deps: LegacyGuardDeps = {}) {
  return function legacyAccessGuard(req: LegacyAuthedRequest, res: Response, next: NextFunction) {
    decideLegacyAccess(req, deps)
      .then((decision) => {
        if (decision.allowed) {
          if (decision.caller) req.legacyCaller = decision.caller;
          next();
          return;
        }
        res.status(decision.status ?? 403).json({ error: decision.code });
      })
      .catch(() => {
        // Never let an unexpected failure fall through to the route.
        res.status(403).json({ error: LEGACY_DENIAL.forbidden });
      });
  };
}

export const legacyAccessGuard = createLegacyAccessGuard();

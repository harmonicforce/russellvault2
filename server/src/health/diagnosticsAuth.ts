// Owner-only authorization for the detailed diagnostics surface.
//
// Diagnostics say more about this deployment than the public probe does, so the
// surface is gated the same way every other governed surface is: the caller
// presents a bearer token, the governed Supabase project verifies it, and the
// caller's role is read from workspace_members under that SAME caller JWT. RLS
// answers the question; there is no service-role key in this path and no second
// authorization model to drift from the database's.
//
// Owner only. Operator and viewer are refused: diagnostics exist for whoever is
// responsible for the deployment, not for everyone who can use it.
//
// The caller must name the workspace explicitly. Unlike the legacy quarantine —
// where the workspace comes from configuration precisely so the caller cannot
// choose it — here naming a workspace grants nothing by itself: the caller still
// has to hold `owner` in whichever workspace they named. There is no global
// "any owner anywhere" check, because that would let an owner of an unrelated
// workspace read this deployment's diagnostics.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { WorkspaceRole } from '../provenance/auth.js';
import { resolveGovernedReadiness, type EnvLike } from './governedReadiness.js';

/** Bounded, non-disclosing refusal codes. */
export const DIAGNOSTICS_DENIAL = {
  notConfigured: 'diagnostics_not_configured',
  authRequired: 'diagnostics_authentication_required',
  authInvalid: 'diagnostics_authentication_invalid',
  workspaceRequired: 'diagnostics_workspace_required',
  forbidden: 'diagnostics_owner_required',
} as const;

export type DiagnosticsDenialCode =
  (typeof DIAGNOSTICS_DENIAL)[keyof typeof DIAGNOSTICS_DENIAL];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiagnosticsRequestLike {
  readonly method: string;
  header(name: string): string | undefined;
  readonly query?: Record<string, unknown>;
}

export interface DiagnosticsDecision {
  readonly allowed: boolean;
  readonly status?: number;
  readonly code?: DiagnosticsDenialCode;
  readonly userId?: string;
  readonly workspaceId?: string;
}

export type DiagnosticsClientFactory = (
  config: { supabaseUrl: string; supabaseAnonKey: string },
  token: string,
) => SupabaseClient;

function defaultClientFactory(
  config: { supabaseUrl: string; supabaseAnonKey: string },
  token: string,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function readBearerToken(req: Pick<DiagnosticsRequestLike, 'header'>): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

const deny = (status: number, code: DiagnosticsDenialCode): DiagnosticsDecision => ({
  allowed: false,
  status,
  code,
});

export interface DiagnosticsGuardDeps {
  readonly env?: EnvLike;
  readonly clientFactory?: DiagnosticsClientFactory;
}

export async function decideDiagnosticsAccess(
  req: DiagnosticsRequestLike,
  deps: DiagnosticsGuardDeps = {},
): Promise<DiagnosticsDecision> {
  const env = deps.env ?? process.env;
  const clientFactory = deps.clientFactory ?? defaultClientFactory;

  // Without governed configuration there is no Auth to verify a token against,
  // so the surface closes rather than falling back to something weaker.
  const readiness = resolveGovernedReadiness(env);
  if (!readiness.governedReady) return deny(503, DIAGNOSTICS_DENIAL.notConfigured);

  const supabaseUrl = (env.SUPABASE_URL ?? '').trim();
  const supabaseAnonKey = (env.SUPABASE_ANON_KEY ?? '').trim();

  const token = readBearerToken(req);
  if (!token) return deny(401, DIAGNOSTICS_DENIAL.authRequired);

  const rawWorkspace = req.query?.workspaceId;
  const workspaceId = typeof rawWorkspace === 'string' && UUID_RE.test(rawWorkspace)
    ? rawWorkspace
    : null;
  if (!workspaceId) return deny(400, DIAGNOSTICS_DENIAL.workspaceRequired);

  let client: SupabaseClient;
  try {
    client = clientFactory({ supabaseUrl, supabaseAnonKey }, token);
  } catch {
    return deny(503, DIAGNOSTICS_DENIAL.notConfigured);
  }

  let userId: string;
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return deny(401, DIAGNOSTICS_DENIAL.authInvalid);
    userId = data.user.id;
  } catch {
    return deny(401, DIAGNOSTICS_DENIAL.authInvalid);
  }

  try {
    const { data: rows, error } = await client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .limit(1);
    if (error) return deny(403, DIAGNOSTICS_DENIAL.forbidden);
    if (!rows || rows.length === 0) return deny(403, DIAGNOSTICS_DENIAL.forbidden);
    const role = (rows[0] as { role: WorkspaceRole }).role;
    // Same code for "not a member" and "not an owner": a refused caller learns
    // that they were refused, not the shape of the membership table.
    if (role !== 'owner') return deny(403, DIAGNOSTICS_DENIAL.forbidden);
  } catch {
    return deny(403, DIAGNOSTICS_DENIAL.forbidden);
  }

  return { allowed: true, userId, workspaceId };
}

export function createDiagnosticsGuard(deps: DiagnosticsGuardDeps = {}) {
  return function diagnosticsGuard(req: Request, res: Response, next: NextFunction) {
    // Express's Request satisfies DiagnosticsRequestLike structurally except for
    // header()'s 'set-cookie' overload, which this guard never calls.
    decideDiagnosticsAccess(req as unknown as DiagnosticsRequestLike, deps)
      .then((decision) => {
        if (decision.allowed) {
          next();
          return;
        }
        res.status(decision.status ?? 403).json({ error: decision.code });
      })
      .catch(() => {
        res.status(403).json({ error: DIAGNOSTICS_DENIAL.forbidden });
      });
  };
}

export const diagnosticsGuard = createDiagnosticsGuard();

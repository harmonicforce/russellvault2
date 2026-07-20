// Per-request authentication and workspace authorization for provenance routes.
//
// The SHADOW_IMPORT flag decides whether these routes EXIST. This module
// decides, on every single request, who the caller is and what they may do.
//
// How it works, and what it deliberately does not do:
//   * The caller must present a bearer token. It is verified by the shadow
//     Supabase project itself (auth.getUser), never parsed or trusted locally,
//     so a forged or expired token cannot pass.
//   * Every request must name a workspace explicitly. There is no implicit
//     "current workspace" that could be guessed wrong.
//   * Membership and role are read from workspace_members through a Supabase
//     client running under THAT SAME CALLER JWT. RLS therefore answers the
//     question: a non-member's query returns no rows because the database says
//     so, not because this file decided so. There is no duplicated
//     authorization model here to drift out of sync with the database.
//   * There is NO service-role key and no privileged server-side database
//     connection anywhere in this path. The server can never see or do more
//     than the calling user can.
//
// Status codes: 401 when we cannot establish WHO the caller is; 403 when we
// know who they are but they lack membership or the required role.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { getProvenanceConfig } from './config.js';

export type WorkspaceRole = 'owner' | 'operator' | 'viewer';

export interface CallerContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  /** Supabase client bound to the caller's JWT. RLS applies to every call. */
  readonly client: SupabaseClient;
}

// Express request augmented with the resolved caller. Set only after
// requireWorkspaceMember has run.
export interface AuthedRequest extends Request {
  caller?: CallerContext;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readBearerToken(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

// A workspace id may arrive in the body (POST) or the query string (GET).
function readWorkspaceId(req: Request): string | null {
  const fromBody =
    typeof (req.body as Record<string, unknown> | undefined)?.workspaceId === 'string'
      ? ((req.body as Record<string, string>).workspaceId)
      : null;
  const fromQuery = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
  const value = fromBody ?? fromQuery;
  if (!value) return null;
  // Shape check only; authorization is still the database's answer.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function defaultClientFactory(token: string): SupabaseClient {
  const config = getProvenanceConfig(process.env);
  if (!config) throw new AuthError('provenance surface is not configured', 404);
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type CallerClientFactory = (token: string) => SupabaseClient;

let clientFactory: CallerClientFactory = defaultClientFactory;

// Test seam. Lets the suite substitute a client that answers as a real project
// would (valid/invalid token, member/non-member, role) without a live Supabase.
// Production always uses defaultClientFactory: nothing else ever calls this.
export function setCallerClientFactoryForTests(factory: CallerClientFactory | null): void {
  clientFactory = factory ?? defaultClientFactory;
}

export function createCallerClient(token: string): SupabaseClient {
  return clientFactory(token);
}

// Resolves the caller and their role in the named workspace, or throws.
export async function resolveCaller(req: Request): Promise<CallerContext> {
  const token = readBearerToken(req);
  if (!token) {
    throw new AuthError('authentication required', 401);
  }

  const workspaceId = readWorkspaceId(req);
  if (!workspaceId) {
    throw new AuthError('an explicit workspaceId is required', 400);
  }

  const client = createCallerClient(token);

  // The shadow project verifies the token. A forged or expired one fails here.
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    throw new AuthError('invalid or expired authentication', 401);
  }

  // Membership is answered by the database under the caller's own JWT: RLS on
  // workspace_members returns a row only if this user really is a member.
  const { data: rows, error: memberError } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userData.user.id)
    .limit(1);

  if (memberError) {
    throw new AuthError('membership could not be verified', 403);
  }
  if (!rows || rows.length === 0) {
    // Authenticated, but not a member of this workspace.
    throw new AuthError('not a member of this workspace', 403);
  }

  const role = (rows[0] as { role: WorkspaceRole }).role;
  return { userId: userData.user.id, workspaceId, role, client };
}

// Middleware factory: require membership, optionally with a minimum role set.
// Omitting allowedRoles means "any member", i.e. read access including viewers.
export function requireWorkspaceMember(allowedRoles?: readonly WorkspaceRole[]) {
  return function middleware(req: AuthedRequest, res: Response, next: NextFunction) {
    resolveCaller(req)
      .then((caller) => {
        if (allowedRoles && !allowedRoles.includes(caller.role)) {
          res.status(403).json({
            error: `this action requires one of: ${allowedRoles.join(', ')}`,
            role: caller.role,
          });
          return;
        }
        req.caller = caller;
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof AuthError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        next(err);
      });
  };
}

/** Members of any role — viewers included. Read-only surfaces. */
export const requireMember = requireWorkspaceMember();

/** Preview, commit, and review work. Viewers are refused with 403. */
export const requireOperator = requireWorkspaceMember(['owner', 'operator']);

/** Explicitly owner-only actions. */
export const requireOwner = requireWorkspaceMember(['owner']);

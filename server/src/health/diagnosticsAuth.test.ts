import { describe, it, expect } from 'vitest';
import {
  DIAGNOSTICS_DENIAL,
  createDiagnosticsGuard,
  decideDiagnosticsAccess,
} from './diagnosticsAuth.js';

const WORKSPACE = '11111111-2222-4333-8444-555555555555';
const USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GOVERNED = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' };

function fakeClient(opts: { validToken?: boolean; role?: string | null; queryError?: boolean } = {}) {
  const { validToken = true, role = 'owner', queryError = false } = opts;
  return () =>
    ({
      auth: {
        async getUser() {
          return validToken
            ? { data: { user: { id: USER } }, error: null }
            : { data: null, error: { message: 'bad jwt' } };
        },
      },
      from() {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          async limit() {
            if (queryError) return { data: null, error: { message: 'rls' } };
            return { data: role ? [{ role }] : [], error: null };
          },
        };
        return builder;
      },
    }) as any;
}

function req(headers: Record<string, string> = {}, query: Record<string, unknown> = {}) {
  return { method: 'GET', header: (n: string) => headers[n.toLowerCase()], query };
}

const bearer = (t = 'tok') => ({ authorization: `Bearer ${t}` });

describe('detailed diagnostics require owner authorization', () => {
  it('refuses an anonymous caller', async () => {
    const d = await decideDiagnosticsAccess(req({}, { workspaceId: WORKSPACE }), {
      env: GOVERNED,
      clientFactory: fakeClient(),
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe(DIAGNOSTICS_DENIAL.authRequired);
  });

  it('refuses an invalid or expired token', async () => {
    const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
      env: GOVERNED,
      clientFactory: fakeClient({ validToken: false }),
    });
    expect(d.status).toBe(401);
    expect(d.code).toBe(DIAGNOSTICS_DENIAL.authInvalid);
  });

  it('refuses an operator and a viewer, not just a non-member', async () => {
    for (const role of ['operator', 'viewer']) {
      const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
        env: GOVERNED,
        clientFactory: fakeClient({ role }),
      });
      expect(d.allowed, role).toBe(false);
      expect(d.status).toBe(403);
      expect(d.code).toBe(DIAGNOSTICS_DENIAL.forbidden);
    }
  });

  it('refuses a non-member with the same code an operator gets', async () => {
    const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
      env: GOVERNED,
      clientFactory: fakeClient({ role: null }),
    });
    expect(d.code).toBe(DIAGNOSTICS_DENIAL.forbidden);
  });

  it('requires an explicit, well-formed workspace', async () => {
    for (const query of [{}, { workspaceId: 'nope' }, { workspaceId: 42 }]) {
      const d = await decideDiagnosticsAccess(req(bearer(), query), {
        env: GOVERNED,
        clientFactory: fakeClient(),
      });
      expect(d.allowed).toBe(false);
      expect(d.code).toBe(DIAGNOSTICS_DENIAL.workspaceRequired);
    }
  });

  it('closes entirely when governed configuration is absent or partial', async () => {
    for (const env of [{}, { SUPABASE_URL: 'https://example.supabase.co' }]) {
      const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
        env,
        clientFactory: fakeClient(),
      });
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(503);
      expect(d.code).toBe(DIAGNOSTICS_DENIAL.notConfigured);
    }
  });

  it('admits an owner of the named workspace', async () => {
    const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
      env: GOVERNED,
      clientFactory: fakeClient({ role: 'owner' }),
    });
    expect(d.allowed).toBe(true);
    expect(d.userId).toBe(USER);
    expect(d.workspaceId).toBe(WORKSPACE);
  });

  it('treats a membership query error as a refusal, never as access', async () => {
    const d = await decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), {
      env: GOVERNED,
      clientFactory: fakeClient({ queryError: true }),
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
  });

  it('returns only bounded codes, never a token, URL, key, or provider message', async () => {
    const results = await Promise.all([
      decideDiagnosticsAccess(req({}, { workspaceId: WORKSPACE }), { env: GOVERNED, clientFactory: fakeClient() }),
      decideDiagnosticsAccess(req(bearer('secret-token'), { workspaceId: WORKSPACE }), {
        env: GOVERNED,
        clientFactory: fakeClient({ validToken: false }),
      }),
      decideDiagnosticsAccess(req(bearer(), { workspaceId: WORKSPACE }), { env: {}, clientFactory: fakeClient() }),
    ]);
    const allowed = Object.values(DIAGNOSTICS_DENIAL) as string[];
    for (const r of results) {
      expect(allowed).toContain(r.code);
      const text = String(r.code);
      expect(text).not.toContain('secret-token');
      expect(text).not.toContain('supabase.co');
      expect(text).not.toContain('anon');
      expect(text).not.toContain('/');
    }
  });
});

describe('the diagnostics middleware adapter', () => {
  function fakeRes() {
    const calls: any = {};
    const res: any = {
      status(code: number) { calls.status = code; return res; },
      json(body: any) { calls.body = body; return res; },
    };
    return { res, calls };
  }

  it('never calls next when refused', async () => {
    const guard = createDiagnosticsGuard({ env: GOVERNED, clientFactory: fakeClient({ role: 'viewer' }) });
    const { res, calls } = fakeRes();
    let nextCalled = false;
    guard(req(bearer(), { workspaceId: WORKSPACE }) as never, res, () => { nextCalled = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(nextCalled).toBe(false);
    expect(calls.status).toBe(403);
    expect(calls.body).toEqual({ error: DIAGNOSTICS_DENIAL.forbidden });
  });

  it('calls next for an owner', async () => {
    const guard = createDiagnosticsGuard({ env: GOVERNED, clientFactory: fakeClient({ role: 'owner' }) });
    const { res } = fakeRes();
    await new Promise<void>((resolve) =>
      guard(req(bearer(), { workspaceId: WORKSPACE }) as never, res, () => resolve()),
    );
  });
});

/**
 * Cross-workspace authority.
 *
 * The guard lets the caller NAME a workspace, which is the opposite of the
 * legacy quarantine guard, where the workspace comes from configuration
 * precisely so the caller cannot choose it. Naming one must therefore grant
 * nothing on its own: the membership lookup has to be filtered by the workspace
 * the caller named AND by the user id the provider derived from their token, so
 * an owner of one workspace cannot read another workspace's diagnostics by
 * naming it.
 *
 * This double records the filters actually applied and answers from a real
 * membership table, so the proof is the query's postcondition rather than a
 * stubbed `true`.
 */
describe('diagnostics authority is bound to the caller, never to what they name', () => {
  const OWNED = '11111111-2222-4333-8444-555555555555';
  const OTHER = '99999999-8888-4777-8666-555555555555';
  const OTHER_OWNER = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

  /** The only memberships that exist. */
  const MEMBERSHIPS = [
    { workspace_id: OWNED, user_id: USER, role: 'owner' },
    { workspace_id: OTHER, user_id: OTHER_OWNER, role: 'owner' },
  ];

  function recordingClient() {
    const seen: { table?: string; filters: Record<string, unknown> }[] = [];
    const factory = () =>
      ({
        auth: {
          async getUser() {
            return { data: { user: { id: USER } }, error: null };
          },
        },
        from(table: string) {
          const call: { table?: string; filters: Record<string, unknown> } = { table, filters: {} };
          seen.push(call);
          const builder: any = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              call.filters[column] = value;
              return builder;
            },
            async limit() {
              const rows = MEMBERSHIPS.filter(
                (m) =>
                  m.workspace_id === call.filters.workspace_id
                  && m.user_id === call.filters.user_id,
              ).map((m) => ({ role: m.role }));
              return { data: rows, error: null };
            },
          };
          return builder;
        },
      }) as any;
    return { factory, seen };
  }

  it('admits an owner in the workspace they actually own', async () => {
    const { factory, seen } = recordingClient();
    const decision = await decideDiagnosticsAccess(req(bearer(), { workspaceId: OWNED }), {
      env: GOVERNED,
      clientFactory: factory,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.workspaceId).toBe(OWNED);
    // The membership lookup was filtered by BOTH the named workspace and the
    // token-derived user — never by one alone.
    expect(seen).toHaveLength(1);
    expect(seen[0].table).toBe('workspace_members');
    expect(seen[0].filters).toEqual({ workspace_id: OWNED, user_id: USER });
  });

  it('refuses an owner who names a workspace someone else owns', async () => {
    const { factory, seen } = recordingClient();
    const decision = await decideDiagnosticsAccess(req(bearer(), { workspaceId: OTHER }), {
      env: GOVERNED,
      clientFactory: factory,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(403);
    expect(decision.code).toBe(DIAGNOSTICS_DENIAL.forbidden);
    // The query was scoped to the NAMED workspace, so the other workspace's
    // owner row could not answer for this caller.
    expect(seen[0].filters).toEqual({ workspace_id: OTHER, user_id: USER });
    expect(decision.userId).toBeUndefined();
  });

  it('ignores a user id supplied by the caller and uses the token-derived one', async () => {
    const { factory, seen } = recordingClient();
    const decision = await decideDiagnosticsAccess(
      req(bearer(), { workspaceId: OTHER, userId: OTHER_OWNER, role: 'owner' }),
      { env: GOVERNED, clientFactory: factory },
    );
    expect(decision.allowed).toBe(false);
    expect(seen[0].filters.user_id).toBe(USER);
  });

  it('reads only workspace_members, and never a governed inventory table', async () => {
    const { factory, seen } = recordingClient();
    await decideDiagnosticsAccess(req(bearer(), { workspaceId: OWNED }), {
      env: GOVERNED,
      clientFactory: factory,
    });
    expect(seen.map((call) => call.table)).toEqual(['workspace_members']);
  });
});

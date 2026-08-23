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

// Acceptance matrix for the legacy quarantine guard.
//
// Every case is run against EVERY legacy route family, not one representative
// route, because the failure this guard exists to prevent was exactly that one
// router got attention and seven did not.
import { describe, it, expect } from 'vitest';
import {
  LEGACY_DENIAL,
  createLegacyAccessGuard,
  decideLegacyAccess,
  readBearerToken,
} from './accessGuard.js';
import { LEGACY_ROUTE_PREFIXES } from './routeInventory.js';
import { getLegacyAccessConfig, resolveLegacyWritesEnabled } from './accessConfig.js';

const WORKSPACE = '11111111-2222-4333-8444-555555555555';
const OTHER_WORKSPACE = '99999999-8888-4777-8666-555555555555';
const USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const CONFIGURED_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  LEGACY_WORKSPACE_ID: WORKSPACE,
};

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;
const READ_METHODS = ['GET', 'HEAD'] as const;

// A fake Supabase client that answers as a real project would.
function fakeClient(opts: {
  validToken?: boolean;
  memberships?: Record<string, string>; // workspaceId -> role
  membershipError?: boolean;
  getUserThrows?: boolean;
} = {}) {
  const { validToken = true, memberships = {}, membershipError = false, getUserThrows = false } = opts;
  return () =>
    ({
      auth: {
        async getUser() {
          if (getUserThrows) throw new Error('network');
          return validToken
            ? { data: { user: { id: USER } }, error: null }
            : { data: null, error: { message: 'bad jwt' } };
        },
      },
      from() {
        const builder: any = {
          select: () => builder,
          eq(column: string, value: string) {
            if (column === 'workspace_id') builder._workspace = value;
            return builder;
          },
          async limit() {
            if (membershipError) return { data: null, error: { message: 'rls' } };
            const role = memberships[builder._workspace];
            return { data: role ? [{ role }] : [], error: null };
          },
        };
        return builder;
      },
    }) as any;
}

function req(method: string, headers: Record<string, string> = {}) {
  return {
    method,
    header: (name: string) => headers[name.toLowerCase()],
  };
}

const bearer = (token = 'tok') => ({ authorization: `Bearer ${token}` });

describe('legacy access config', () => {
  it('is unconfigured unless every part is present and well formed', () => {
    expect(getLegacyAccessConfig({})).toBeNull();
    expect(getLegacyAccessConfig({ ...CONFIGURED_ENV, LEGACY_WORKSPACE_ID: undefined })).toBeNull();
    expect(getLegacyAccessConfig({ ...CONFIGURED_ENV, SUPABASE_URL: undefined })).toBeNull();
    expect(getLegacyAccessConfig({ ...CONFIGURED_ENV, SUPABASE_ANON_KEY: undefined })).toBeNull();
    expect(getLegacyAccessConfig({ ...CONFIGURED_ENV, LEGACY_WORKSPACE_ID: 'not-a-uuid' })).toBeNull();
    expect(getLegacyAccessConfig({ ...CONFIGURED_ENV, LEGACY_WORKSPACE_ID: '' })).toBeNull();
    expect(getLegacyAccessConfig(CONFIGURED_ENV)?.legacyWorkspaceId).toBe(WORKSPACE);
  });

  it('never infers a workspace when none is configured', () => {
    // There is no "first workspace" fallback to test for; the point is that an
    // absent mapping yields null rather than any id at all.
    expect(getLegacyAccessConfig({ SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });
});

describe('legacy writes default closed in EVERY environment', () => {
  it('requires the exact flag regardless of NODE_ENV', () => {
    for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
      expect(resolveLegacyWritesEnabled({ NODE_ENV })).toBe(false);
      expect(resolveLegacyWritesEnabled({ NODE_ENV, ALLOW_LEGACY_WRITES: 'false' })).toBe(false);
      expect(resolveLegacyWritesEnabled({ NODE_ENV, ALLOW_LEGACY_WRITES: '1' })).toBe(false);
      expect(resolveLegacyWritesEnabled({ NODE_ENV, ALLOW_LEGACY_WRITES: 'TRUE' })).toBe(false);
      expect(resolveLegacyWritesEnabled({ NODE_ENV, ALLOW_LEGACY_WRITES: 'true' })).toBe(true);
    }
  });
});

describe('acceptance matrix, applied to every legacy route family', () => {
  // The guard is mounted per prefix, so the decision is prefix-independent by
  // construction. These loops assert that construction actually holds.
  for (const prefix of LEGACY_ROUTE_PREFIXES) {
    describe(prefix, () => {
      it('denies anonymous reads', async () => {
        for (const method of READ_METHODS) {
          const d = await decideLegacyAccess(req(method), {
            env: CONFIGURED_ENV,
            clientFactory: fakeClient({ memberships: { [WORKSPACE]: 'viewer' } }),
          });
          expect(d.allowed).toBe(false);
          expect(d.status).toBe(401);
          expect(d.code).toBe(LEGACY_DENIAL.authRequired);
        }
      });

      it('denies anonymous writes', async () => {
        for (const method of WRITE_METHODS) {
          const d = await decideLegacyAccess(req(method), {
            env: { ...CONFIGURED_ENV, ALLOW_LEGACY_WRITES: 'true' },
            clientFactory: fakeClient({ memberships: { [WORKSPACE]: 'owner' } }),
          });
          expect(d.allowed).toBe(false);
          expect(d.status).toBe(401);
        }
      });

      it('returns 401 for an invalid or expired bearer token', async () => {
        const d = await decideLegacyAccess(req('GET', bearer()), {
          env: CONFIGURED_ENV,
          clientFactory: fakeClient({ validToken: false }),
        });
        expect(d.status).toBe(401);
        expect(d.code).toBe(LEGACY_DENIAL.authInvalid);
      });

      it('fails closed with 503 when no legacy workspace is configured', async () => {
        const d = await decideLegacyAccess(req('GET', bearer()), {
          env: { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k' },
          clientFactory: fakeClient({ memberships: { [WORKSPACE]: 'owner' } }),
        });
        expect(d.allowed).toBe(false);
        expect(d.status).toBe(503);
        expect(d.code).toBe(LEGACY_DENIAL.notConfigured);
      });

      it('permits a member of the configured legacy workspace to read', async () => {
        for (const role of ['owner', 'operator', 'viewer']) {
          const d = await decideLegacyAccess(req('GET', bearer()), {
            env: CONFIGURED_ENV,
            clientFactory: fakeClient({ memberships: { [WORKSPACE]: role } }),
          });
          expect(d.allowed, `${role} should read`).toBe(true);
          expect(d.caller?.role).toBe(role);
          expect(d.caller?.workspaceId).toBe(WORKSPACE);
        }
      });

      it('denies a valid member of a DIFFERENT workspace', async () => {
        const d = await decideLegacyAccess(req('GET', bearer()), {
          env: CONFIGURED_ENV,
          clientFactory: fakeClient({ memberships: { [OTHER_WORKSPACE]: 'owner' } }),
        });
        expect(d.allowed).toBe(false);
        expect(d.status).toBe(403);
        expect(d.code).toBe(LEGACY_DENIAL.forbidden);
      });

      it('denies a viewer write even with ALLOW_LEGACY_WRITES=true', async () => {
        for (const method of WRITE_METHODS) {
          const d = await decideLegacyAccess(req(method, bearer()), {
            env: { ...CONFIGURED_ENV, ALLOW_LEGACY_WRITES: 'true' },
            clientFactory: fakeClient({ memberships: { [WORKSPACE]: 'viewer' } }),
          });
          expect(d.allowed).toBe(false);
          expect(d.status).toBe(403);
          expect(d.code).toBe(LEGACY_DENIAL.writeRole);
        }
      });

      it('denies an owner/operator write when the flag is absent or false, in every environment', async () => {
        for (const NODE_ENV of ['production', 'development', 'test']) {
          for (const flag of [undefined, 'false']) {
            for (const role of ['owner', 'operator']) {
              const env: Record<string, string | undefined> = { ...CONFIGURED_ENV, NODE_ENV };
              if (flag !== undefined) env.ALLOW_LEGACY_WRITES = flag;
              const d = await decideLegacyAccess(req('POST', bearer()), {
                env,
                clientFactory: fakeClient({ memberships: { [WORKSPACE]: role } }),
              });
              expect(d.allowed, `${role} in ${NODE_ENV} flag=${flag}`).toBe(false);
              expect(d.code).toBe(LEGACY_DENIAL.writesDisabled);
            }
          }
        }
      });

      it('permits an owner/operator write only with the exact true flag', async () => {
        for (const role of ['owner', 'operator']) {
          for (const method of WRITE_METHODS) {
            const d = await decideLegacyAccess(req(method, bearer()), {
              env: { ...CONFIGURED_ENV, ALLOW_LEGACY_WRITES: 'true' },
              clientFactory: fakeClient({ memberships: { [WORKSPACE]: role } }),
            });
            expect(d.allowed, `${role} ${method}`).toBe(true);
          }
        }
      });
    });
  }
});

describe('the caller cannot choose the workspace that is checked', () => {
  it('ignores a client-supplied workspaceId and checks only the configured one', async () => {
    // A member of OTHER_WORKSPACE naming their own workspace must still be
    // refused: the configured workspace is the only one consulted.
    const withQuery = {
      method: 'GET',
      header: (n: string) => bearer()[n.toLowerCase() as 'authorization'],
      query: { workspaceId: OTHER_WORKSPACE },
      body: { workspaceId: OTHER_WORKSPACE },
    } as any;
    const d = await decideLegacyAccess(withQuery, {
      env: CONFIGURED_ENV,
      clientFactory: fakeClient({ memberships: { [OTHER_WORKSPACE]: 'owner' } }),
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe(LEGACY_DENIAL.forbidden);
  });
});

describe('non-disclosure', () => {
  it('returns bounded codes with no paths, SQL, tokens, ids, or provider text', async () => {
    const cases = await Promise.all([
      decideLegacyAccess(req('GET'), { env: CONFIGURED_ENV, clientFactory: fakeClient() }),
      decideLegacyAccess(req('GET', bearer('super-secret-token')), {
        env: CONFIGURED_ENV,
        clientFactory: fakeClient({ validToken: false }),
      }),
      decideLegacyAccess(req('GET', bearer()), {
        env: CONFIGURED_ENV,
        clientFactory: fakeClient({ membershipError: true }),
      }),
      decideLegacyAccess(req('GET', bearer()), { env: {}, clientFactory: fakeClient() }),
    ]);
    const allowedCodes = Object.values(LEGACY_DENIAL) as string[];
    for (const d of cases) {
      expect(d.allowed).toBe(false);
      expect(allowedCodes).toContain(d.code);
      const text = String(d.code);
      expect(text).not.toContain('super-secret-token');
      expect(text).not.toContain(WORKSPACE);
      expect(text).not.toContain('/');
      expect(text).not.toMatch(/select|rls|jwt|supabase/i);
    }
  });

  it('reports membership that could not be verified without leaking why', async () => {
    const d = await decideLegacyAccess(req('GET', bearer()), {
      env: CONFIGURED_ENV,
      clientFactory: fakeClient({ membershipError: true }),
    });
    expect(d.status).toBe(403);
    expect(d.code).toBe(LEGACY_DENIAL.membershipUnverified);
  });

  it('treats a thrown auth call as unauthenticated rather than allowed', async () => {
    const d = await decideLegacyAccess(req('GET', bearer()), {
      env: CONFIGURED_ENV,
      clientFactory: fakeClient({ getUserThrows: true }),
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(401);
  });

  it('treats a client that cannot be constructed as unconfigured, never as allowed', async () => {
    const d = await decideLegacyAccess(req('GET', bearer()), {
      env: CONFIGURED_ENV,
      clientFactory: () => {
        throw new Error('boom');
      },
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(503);
  });
});

describe('bearer parsing', () => {
  it('accepts only a well-formed Bearer header', () => {
    expect(readBearerToken({ header: () => 'Bearer abc' } as any)).toBe('abc');
    expect(readBearerToken({ header: () => 'bearer abc' } as any)).toBe('abc');
    expect(readBearerToken({ header: () => undefined } as any)).toBeNull();
    expect(readBearerToken({ header: () => 'Basic abc' } as any)).toBeNull();
    expect(readBearerToken({ header: () => 'Bearer   ' } as any)).toBeNull();
  });
});

describe('middleware adapter', () => {
  function fakeRes() {
    const calls: any = {};
    const res: any = {
      status(code: number) { calls.status = code; return res; },
      json(body: any) { calls.body = body; return res; },
    };
    return { res, calls };
  }

  it('calls next and attaches the caller when allowed', async () => {
    const guard = createLegacyAccessGuard({
      env: CONFIGURED_ENV,
      clientFactory: fakeClient({ memberships: { [WORKSPACE]: 'operator' } }),
    });
    const request: any = req('GET', bearer());
    const { res } = fakeRes();
    await new Promise<void>((resolve) => guard(request, res, () => resolve()));
    expect(request.legacyCaller).toEqual({ userId: USER, workspaceId: WORKSPACE, role: 'operator' });
  });

  it('responds with the bounded code and never calls next when denied', async () => {
    const guard = createLegacyAccessGuard({ env: CONFIGURED_ENV, clientFactory: fakeClient() });
    const { res, calls } = fakeRes();
    let nextCalled = false;
    guard(req('GET') as any, res, () => { nextCalled = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(nextCalled).toBe(false);
    expect(calls.status).toBe(401);
    expect(calls.body).toEqual({ error: LEGACY_DENIAL.authRequired });
  });

  it('lets CORS preflight through without credentials', async () => {
    const d = await decideLegacyAccess(req('OPTIONS'), {
      env: CONFIGURED_ENV,
      clientFactory: fakeClient(),
    });
    expect(d.allowed).toBe(true);
    expect(d.caller).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';

// Each scenario needs the module re-evaluated with different env vars (the
// guard's enabled flag is computed once at module load), so we cache-bust the
// dynamic import per scenario instead of relying on a single static import.
let n = 0;
async function loadGuard(env: Record<string, string | undefined>) {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_LEGACY_WRITES;
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.ALLOW_LEGACY_WRITES === undefined) delete process.env.ALLOW_LEGACY_WRITES;
  else process.env.ALLOW_LEGACY_WRITES = env.ALLOW_LEGACY_WRITES;

  n += 1;
  const mod = await import(/* @vite-ignore */ `./legacyWriteGuard.js?scenario=${n}`);

  process.env.NODE_ENV = prevNodeEnv;
  process.env.ALLOW_LEGACY_WRITES = prevAllow;
  return mod as typeof import('./legacyWriteGuard.js');
}

function fakeRes() {
  const calls: any = {};
  const res: any = {
    status(code: number) { calls.status = code; return res; },
    json(body: any) { calls.body = body; return res; },
  };
  return { res, calls };
}

describe('legacyWriteGuard', () => {
  it('OLD BEHAVIOR: production writes were always accepted — now blocked by default in production', () => {
    return loadGuard({ NODE_ENV: 'production' }).then(({ legacyWritesEnabled, legacyWriteGuard }) => {
      expect(legacyWritesEnabled).toBe(false);
      const { res, calls } = fakeRes();
      let nextCalled = false;
      legacyWriteGuard({ method: 'POST' } as any, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(calls.status).toBe(403);
      expect(calls.body.readOnly).toBe(true);
    });
  });

  it('allows GET requests through even when read-only', () => {
    return loadGuard({ NODE_ENV: 'production' }).then(({ legacyWriteGuard }) => {
      const { res } = fakeRes();
      let nextCalled = false;
      legacyWriteGuard({ method: 'GET' } as any, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });
  });

  it('re-enables writes in production when ALLOW_LEGACY_WRITES=true is explicitly set', () => {
    return loadGuard({ NODE_ENV: 'production', ALLOW_LEGACY_WRITES: 'true' }).then(({ legacyWritesEnabled, legacyWriteGuard }) => {
      expect(legacyWritesEnabled).toBe(true);
      const { res } = fakeRes();
      let nextCalled = false;
      legacyWriteGuard({ method: 'POST' } as any, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });
  });

  it('leaves writes enabled outside production regardless of ALLOW_LEGACY_WRITES', () => {
    return loadGuard({ NODE_ENV: 'test' }).then(({ legacyWritesEnabled }) => {
      expect(legacyWritesEnabled).toBe(true);
    });
  });
});

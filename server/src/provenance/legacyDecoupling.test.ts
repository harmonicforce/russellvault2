// Phase 3 — the provenance surface is decoupled from the legacy SQLite write
// guard, without weakening that guard.
//
// The guard blocks direct writes to the legacy SQLite database in production
// unless an operator sets ALLOW_LEGACY_WRITES=true. Provenance routes never
// touch SQLite, so requiring that flag would force an operator to re-enable
// legacy writes merely to review an import — the exact coupling the guard
// exists to prevent.
//
// These tests pin both halves of the contract simultaneously, in a simulated
// PRODUCTION environment with ALLOW_LEGACY_WRITES unset:
//   * a legacy SQLite mutation is still refused;
//   * a provenance route is still reachable (and still enforces its own,
//     stricter authentication).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

// legacyWritesEnabled is resolved at module load, so the environment must be
// set before the guard is imported.
process.env.NODE_ENV = 'production';
delete process.env.ALLOW_LEGACY_WRITES;

const { legacyWriteGuard, legacyWritesEnabled } = await import('../legacyWriteGuard.js');
const { default: provenanceRouter } = await import('../routes/provenance.js');
const { setCallerClientFactoryForTests } = await import('./auth.js');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  // The SAME middleware order as server/src/index.ts: provenance is mounted
  // ahead of the legacy guard, and the guard still covers everything else.
  app.use('/api/provenance', provenanceRouter);
  app.use('/api', legacyWriteGuard);
  app.post('/api/inventory', (_req, res) => res.json({ wrote: true }));
  app.get('/api/inventory', (_req, res) => res.json({ read: true }));

  // A caller whose token is valid but who belongs to no workspace: enough to
  // show the request reached the router's own authorization, not the guard.
  setCallerClientFactoryForTests(
    () =>
      ({
        auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
        from: () => {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          Object.assign(q, {
            select: chain,
            eq: chain,
            in: chain,
            order: chain,
            range: chain,
            limit: async () => ({ data: [], error: null, count: 0 }),
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve(r({ data: [], error: null, count: 0 })),
          });
          return q;
        },
        rpc: async () => ({ data: null, error: null }),
      }) as never
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  setCallerClientFactoryForTests(null);
  delete process.env.SHADOW_IMPORT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
});

function enableProvenance() {
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
}

describe('the legacy write guard is unchanged', () => {
  it('is disabled in production without the explicit opt-in', () => {
    expect(legacyWritesEnabled).toBe(false);
  });

  it('still refuses a legacy SQLite mutation', async () => {
    const res = await fetch(`${base}/api/inventory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.readOnly).toBe(true);
    expect(json.error).toMatch(/read-only in production/i);
  });

  it('still allows legacy reads', async () => {
    const res = await fetch(`${base}/api/inventory`);
    expect(res.status).toBe(200);
    expect((await res.json()).read).toBe(true);
  });
});

describe('provenance routes do not require ALLOW_LEGACY_WRITES', () => {
  it('remains 404 while its own shadow flags are absent', async () => {
    const res = await fetch(`${base}/api/provenance/fixtures?workspaceId=` +
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    // 404 from the availability gate — NOT 403 from the legacy write guard.
    expect(res.status).toBe(404);
    expect((await res.json()).readOnly).toBeUndefined();
  });

  it('a provenance planning POST is not blocked by the legacy guard', async () => {
    enableProvenance();
    const res = await fetch(`${base}/api/provenance/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filename: 'checks.json',
      }),
    });

    // 401 proves the request reached the provenance router's own
    // authentication. The legacy guard would have returned 403 + readOnly.
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.readOnly).toBeUndefined();
    expect(json.error).not.toMatch(/read-only in production/i);
  });

  it('a provenance commit POST is not blocked by the legacy guard either', async () => {
    enableProvenance();
    const res = await fetch(`${base}/api/provenance/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filename: 'checks.json',
        sourceSystemId: '55555555-5555-5555-5555-555555555555',
        idempotencyKey: 'commit-key-0001',
      }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).readOnly).toBeUndefined();
  });

  it('an authenticated provenance request still enforces membership', async () => {
    enableProvenance();
    const res = await fetch(`${base}/api/provenance/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer any-token',
      },
      body: JSON.stringify({
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filename: 'checks.json',
      }),
    });
    // Authenticated, but a member of nothing: 403 from provenance's own model.
    expect(res.status).toBe(403);
    expect((await res.json()).readOnly).toBeUndefined();
  });

  it('provenance activity does not flip the legacy write switch', async () => {
    enableProvenance();
    await fetch(`${base}/api/provenance/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filename: 'checks.json',
      }),
    });

    expect(legacyWritesEnabled).toBe(false);
    const res = await fetch(`${base}/api/inventory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

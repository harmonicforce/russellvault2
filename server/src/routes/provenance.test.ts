// Phase 3 provenance route tests.
//
// Covers the two independent gates:
//   * AVAILABILITY — every route 404s unless the shadow flags are configured;
//   * AUTHORIZATION — with the surface enabled, every route still requires a
//     valid bearer token (401), workspace membership (403), and the right role
//     (403), and succeeds only for the appropriate member.
//
// A fake Supabase client stands in for the shadow project so these can run
// without Docker. It answers exactly as a real project would: it rejects
// unknown tokens, and workspace_members returns rows only for real members —
// which is how RLS behaves.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';

const { default: provenanceRouter } = await import('./provenance.js');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// token -> identity. Anything not listed here is an invalid token.
const TOKENS: Record<string, { userId: string; memberships: Record<string, string> }> = {
  'owner-token': { userId: 'u-owner', memberships: { [WS_A]: 'owner' } },
  'operator-token': { userId: 'u-operator', memberships: { [WS_A]: 'operator' } },
  'viewer-token': { userId: 'u-viewer', memberships: { [WS_A]: 'viewer' } },
  // Authenticated, but a member of no workspace we test against.
  'stranger-token': { userId: 'u-stranger', memberships: {} },
  // A member of a DIFFERENT workspace only.
  'other-ws-token': { userId: 'u-other', memberships: { [WS_B]: 'owner' } },
};

interface FakeQuery {
  select: (...args: unknown[]) => FakeQuery;
  eq: (col: string, val: string) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  range: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => Promise<{ data: unknown[]; error: null; count: number }>;
  then: (
    resolve: (v: { data: unknown[]; error: null; count: number }) => unknown
  ) => Promise<unknown>;
}

function makeFakeClient(token: string) {
  const identity = TOKENS[token];

  return {
    auth: {
      getUser: async () =>
        identity
          ? { data: { user: { id: identity.userId } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from(table: string) {
      const filters: Record<string, string> = {};
      const result = () => {
        if (table === 'workspace_members') {
          // Mirrors RLS: a row comes back only for a genuine membership.
          const role = identity?.memberships[filters.workspace_id];
          return { data: role ? [{ role }] : [], error: null, count: role ? 1 : 0 };
        }
        return { data: [], error: null, count: 0 };
      };
      const q: FakeQuery = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        in: () => q,
        order: () => q,
        range: () => q,
        limit: async () => result(),
        then: (resolve) => Promise.resolve(resolve(result())),
      };
      return q;
    },
    rpc: async () => ({ data: 'rpc-ok', error: null }),
  };
}

function startServer(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/provenance', provenanceRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let server: Server;
let base: string;

beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  base = started.base;
  setCallerClientFactoryForTests((token) => makeFakeClient(token) as never);
});

afterAll(() => {
  server?.close();
  setCallerClientFactoryForTests(null);
});

function enable() {
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
}
function disable() {
  delete process.env.SHADOW_IMPORT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// Representative routes across all three permission tiers.
const MEMBER_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['GET', `/api/provenance/fixtures?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/provenance/jobs?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/provenance/crosswalks?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/provenance/audit-events?workspaceId=${WS_A}`, undefined],
];

const OPERATOR_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['POST', '/api/provenance/preview', { workspaceId: WS_A, filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/records', { workspaceId: WS_A, filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/issues', { workspaceId: WS_A, filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/crosswalks', { workspaceId: WS_A, filename: 'checks.json' }],
  ['POST', '/api/provenance/crosswalks/11111111-1111-1111-1111-111111111111/confirm',
    { workspaceId: WS_A }],
  ['POST', '/api/provenance/issues/11111111-1111-1111-1111-111111111111/resolve',
    { workspaceId: WS_A, status: 'resolved' }],
];

describe('availability gate: unconfigured means unavailable', () => {
  beforeEach(() => disable());

  for (const [method, path, body] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 404 with the flags absent`, async () => {
      const res = await call(method, path, { token: 'owner-token', body });
      expect(res.status).toBe(404);
    });
  }

  it('stays unavailable when only SHADOW_IMPORT is set (no shadow project)', async () => {
    process.env.SHADOW_IMPORT = 'repository-fixtures';
    const res = await call('GET', `/api/provenance/fixtures?workspaceId=${WS_A}`, {
      token: 'owner-token',
    });
    expect(res.status).toBe(404);
    disable();
  });

  it('does not advertise that the surface exists', async () => {
    const res = await call('GET', `/api/provenance/fixtures?workspaceId=${WS_A}`);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('401: missing or invalid authentication', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  for (const [method, path, body] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 401 without a token`, async () => {
      const res = await call(method, path, { body });
      expect(res.status).toBe(401);
    });
  }

  it('rejects an invalid token', async () => {
    const res = await call('GET', `/api/provenance/jobs?workspaceId=${WS_A}`, {
      token: 'not-a-real-token',
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid or expired/i);
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await fetch(`${base}/api/provenance/jobs?workspaceId=${WS_A}`, {
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('serves no fixture metadata to an unauthenticated caller', async () => {
    const res = await call('GET', `/api/provenance/fixtures?workspaceId=${WS_A}`);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toMatch(/whatnot_purchases/);
  });

  it('serves no raw payloads to an unauthenticated caller', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json' },
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toMatch(/acquisition_line_id/);
  });
});

describe('403: authenticated but not a member, or wrong role', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('refuses an authenticated non-member', async () => {
    const res = await call('GET', `/api/provenance/jobs?workspaceId=${WS_A}`, {
      token: 'stranger-token',
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not a member/i);
  });

  it('refuses a member of a DIFFERENT workspace', async () => {
    const res = await call('GET', `/api/provenance/jobs?workspaceId=${WS_A}`, {
      token: 'other-ws-token',
    });
    expect(res.status).toBe(403);
  });

  it('serves no fixture metadata to a non-member', async () => {
    const res = await call('GET', `/api/provenance/fixtures?workspaceId=${WS_A}`, {
      token: 'stranger-token',
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/whatnot_purchases/);
  });

  it('serves no raw payloads to a non-member', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      token: 'stranger-token',
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json' },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/acquisition_line_id/);
  });

  it('refuses a VIEWER on every operator route', async () => {
    for (const [method, path, body] of OPERATOR_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token', body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses a viewer attempting a commit', async () => {
    const res = await call('POST', '/api/provenance/commit', {
      token: 'viewer-token',
      body: {
        workspaceId: WS_A,
        filename: 'checks.json',
        sourceSystemId: '55555555-5555-5555-5555-555555555555',
        idempotencyKey: 'viewer-key-0001',
      },
    });
    expect(res.status).toBe(403);
  });

  it('refuses an OPERATOR on the owner-only registry route', async () => {
    const res = await call('POST', '/api/provenance/source-systems', {
      token: 'operator-token',
      body: { workspaceId: WS_A, publicId: 'X', instanceLabel: 'x' },
    });
    expect(res.status).toBe(403);
  });

  it('requires an explicit workspaceId', async () => {
    const res = await call('GET', '/api/provenance/jobs', { token: 'owner-token' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/workspaceId/i);
  });

  it('rejects a malformed workspaceId rather than guessing', async () => {
    const res = await call('GET', '/api/provenance/jobs?workspaceId=not-a-uuid', {
      token: 'owner-token',
    });
    expect(res.status).toBe(400);
  });
});

describe('success for the appropriate workspace member', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('a viewer may read stored import-review information', async () => {
    for (const [method, path] of MEMBER_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token' });
      expect(res.status, path).toBe(200);
    }
  });

  it('an operator may preview a fixture', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sourceRowCount).toBe(2149);
    expect(json.fileSha256).toBe(
      '71c55d607191c8f0a4e3d6858ef6bbe1217880602ba96f92757e9dabca8367cd'
    );
    expect(json.committed).toBe(false);
    expect(json.authoritative).toBe(false);
  });

  it('an owner may preview and read too', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      token: 'owner-token',
      body: { workspaceId: WS_A, filename: 'checks.json' },
    });
    expect(res.status).toBe(200);
  });

  it('an operator may perform a review action', async () => {
    const res = await call(
      'POST',
      '/api/provenance/crosswalks/11111111-1111-1111-1111-111111111111/confirm',
      { token: 'operator-token', body: { workspaceId: WS_A } }
    );
    expect(res.status).toBe(200);
  });

  it('paginates raw records rather than dumping thousands', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json', limit: 5 },
    });
    const json = await res.json();
    expect(json.total).toBe(2149);
    expect(json.records).toHaveLength(5);
  });

  it('caps an oversized page request', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json', limit: 100000 },
    });
    expect((await res.json()).records.length).toBeLessThanOrEqual(200);
  });

  it('returns crosswalk candidates that are all in candidate state', async () => {
    const res = await call('POST', '/api/provenance/preview/crosswalks', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'whatnot_purchases.json' },
    });
    const json = await res.json();
    expect(json.total).toBeGreaterThan(0);
    for (const c of json.crosswalks) expect(c.reviewState).toBe('candidate');
  });

  it('refuses a commit without an idempotency key', async () => {
    const res = await call('POST', '/api/provenance/commit', {
      token: 'operator-token',
      body: {
        workspaceId: WS_A,
        filename: 'checks.json',
        sourceSystemId: '55555555-5555-5555-5555-555555555555',
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/idempotency key/i);
  });

  it('refuses a commit without a source system', async () => {
    const res = await call('POST', '/api/provenance/commit', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'checks.json', idempotencyKey: 'k-000000001' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sourceSystemId/i);
  });

  it('refuses an unknown fixture', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: 'secrets.json' },
    });
    expect(res.status).toBe(404);
  });

  it('refuses path traversal without leaking a filesystem path', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      token: 'operator-token',
      body: { workspaceId: WS_A, filename: '../../../etc/passwd' },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).not.toMatch(/\/home|\/etc|seed/);
  });

  it('offers no endpoint that creates a canonical acquisition or inventory record', async () => {
    for (const path of [
      '/api/provenance/acquisitions',
      '/api/provenance/inventory',
      '/api/provenance/listings',
    ]) {
      const res = await call('POST', path, {
        token: 'owner-token',
        body: { workspaceId: WS_A },
      });
      expect(res.status).toBe(404);
    }
  });
});

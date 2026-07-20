// Phase 4 acquisition route tests.
//
// Covers the two independent gates, reused unchanged from Phase 3:
//   * AVAILABILITY — every route 404s unless the shadow flags are configured;
//   * AUTHORIZATION — with the surface enabled, every route still requires a
//     valid bearer token (401), workspace membership (403), and the right role
//     (403), and succeeds only for the appropriate member.
//
// A fake Supabase client stands in for the shadow project so these run without
// Docker: it rejects unknown tokens, workspace_members returns rows only for
// real members (as RLS does), and it serves a tiny committed source-record set
// so the preview path exercises the real adapter.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';

const { default: acquisitionRouter } = await import('./acquisition.js');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SRC_JOB = '55555555-5555-5555-5555-555555555555';
const CHANNEL = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const TOKENS: Record<string, { userId: string; memberships: Record<string, string> }> = {
  'owner-token': { userId: 'u-owner', memberships: { [WS_A]: 'owner' } },
  'operator-token': { userId: 'u-operator', memberships: { [WS_A]: 'operator' } },
  'viewer-token': { userId: 'u-viewer', memberships: { [WS_A]: 'viewer' } },
  'stranger-token': { userId: 'u-stranger', memberships: {} },
  'other-ws-token': { userId: 'u-other', memberships: { [WS_B]: 'owner' } },
};

// A minimal committed source set the preview path can map.
const SOURCE_ROWS = [
  {
    id: 'sr-1',
    source_row_index: 0,
    parse_status: 'parsed',
    raw_payload: {
      acquisition_line_id: 'WN-A-000001',
      order_id: 'o1',
      seller: 'alpha',
      quantity_purchased: 1,
      total_paid: 10,
      order_status: 'completed',
    },
  },
  {
    id: 'sr-2',
    source_row_index: 1,
    parse_status: 'parsed',
    raw_payload: {
      acquisition_line_id: 'WN-A-000002',
      order_id: 'o2',
      seller: 'beta',
      quantity_purchased: 2,
      total_paid: 0,
      order_status: 'completed',
    },
  },
];

function makeFakeClient(token: string) {
  const identity = TOKENS[token];

  function rowsFor(table: string, filters: Record<string, string>): unknown[] {
    if (table === 'workspace_members') {
      const role = identity?.memberships[filters.workspace_id];
      return role ? [{ role }] : [];
    }
    if (table === 'source_records') return SOURCE_ROWS;
    // Deterministic readbacks so the commit driver can resolve its references
    // for the two-row source set (orders o1/o2 -> lots -> lines).
    if (table === 'acquisition_orders') {
      return [
        { id: 'ord-o1', source_order_reference: 'o1' },
        { id: 'ord-o2', source_order_reference: 'o2' },
      ];
    }
    if (table === 'acquisition_lots') {
      return [
        { id: 'lot-o1', sequence_no: 1, acquisition_orders: { source_order_reference: 'o1' } },
        { id: 'lot-o2', sequence_no: 1, acquisition_orders: { source_order_reference: 'o2' } },
      ];
    }
    if (table === 'acquisition_line_items') {
      return [
        { id: 'line-1', public_id: 'WN-A-000001' },
        { id: 'line-2', public_id: 'WN-A-000002' },
      ];
    }
    return [];
  }

  return {
    auth: {
      getUser: async () =>
        identity
          ? { data: { user: { id: identity.userId } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from(table: string) {
      const filters: Record<string, string> = {};
      const result = () => ({ data: rowsFor(table, filters), error: null, count: 0 });
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        in: () => q,
        order: () => q,
        range: async () => result(),
        limit: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result())),
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'register_channel') {
        return { data: { id: CHANNEL, public_id: 'RV-CH-TEST01', resumed: false }, error: null };
      }
      if (fn === 'begin_acquisition_import_job') {
        return { data: { id: 'ajob-1', status: 'preview', resumed: false }, error: null };
      }
      if (fn === 'finalize_acquisition_import_job') {
        return {
          data: {
            id: 'ajob-1',
            status: 'committed',
            orders: args.p_expected_orders,
            lots: args.p_expected_lots,
            line_items: args.p_expected_line_items,
            cost_components: args.p_expected_cost_components,
            unresolved_supplier_candidates: args.p_expected_unresolved_supplier_candidates,
            unresolved_cost_components: args.p_expected_unresolved_cost_components,
          },
          error: null,
        };
      }
      return { data: { inserted: 0 }, error: null };
    },
  };
}

function startServer(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/acquisition', acquisitionRouter);
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

const MEMBER_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['GET', `/api/acquisition/jobs?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/orders?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/suppliers?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/supplier-candidates?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/cost-allocations?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/audit-events?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/acquisition/channels?workspaceId=${WS_A}`, undefined],
];

const OPERATOR_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['POST', '/api/acquisition/preview', { workspaceId: WS_A, sourceImportJobId: SRC_JOB }],
  [
    'POST',
    '/api/acquisition/commit',
    { workspaceId: WS_A, sourceImportJobId: SRC_JOB, channelId: CHANNEL, idempotencyKey: 'k-000000001' },
  ],
  [
    'POST',
    '/api/acquisition/cost-components/11111111-1111-1111-1111-111111111111/allocations',
    { workspaceId: WS_A, method: 'equal_split', allocations: [] },
  ],
  [
    'POST',
    '/api/acquisition/lot-lines/11111111-1111-1111-1111-111111111111/supersede',
    { workspaceId: WS_A, newLotId: '22222222-2222-2222-2222-222222222222' },
  ],
];

const OWNER_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['POST', '/api/acquisition/channels', { workspaceId: WS_A, name: 'Whatnot', kind: 'marketplace' }],
];

describe('availability gate: unconfigured means unavailable', () => {
  beforeEach(() => disable());

  for (const [method, path, body] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES, ...OWNER_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 404 with the flags absent`, async () => {
      const res = await call(method, path, { token: 'owner-token', body });
      expect(res.status).toBe(404);
    });
  }

  it('does not advertise that the surface exists', async () => {
    const res = await call('GET', `/api/acquisition/orders?workspaceId=${WS_A}`);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('401: missing or invalid authentication', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  for (const [method, path, body] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES, ...OWNER_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 401 without a token`, async () => {
      const res = await call(method, path, { body });
      expect(res.status).toBe(401);
    });
  }

  it('serves no acquisition data to an unauthenticated caller', async () => {
    const res = await call('GET', `/api/acquisition/orders?workspaceId=${WS_A}`);
    expect(res.status).toBe(401);
  });
});

describe('403: authenticated but not a member, or wrong role', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('refuses an authenticated non-member on reads', async () => {
    const res = await call('GET', `/api/acquisition/orders?workspaceId=${WS_A}`, {
      token: 'stranger-token',
    });
    expect(res.status).toBe(403);
  });

  it('refuses a member of a DIFFERENT workspace', async () => {
    const res = await call('GET', `/api/acquisition/orders?workspaceId=${WS_A}`, {
      token: 'other-ws-token',
    });
    expect(res.status).toBe(403);
  });

  it('refuses a VIEWER on every operator route', async () => {
    for (const [method, path, body] of OPERATOR_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token', body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses an OPERATOR on the owner-only channel registry', async () => {
    for (const [method, path, body] of OWNER_ROUTES) {
      const res = await call(method, path, { token: 'operator-token', body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('requires an explicit workspaceId', async () => {
    const res = await call('GET', '/api/acquisition/orders', { token: 'owner-token' });
    expect(res.status).toBe(400);
  });
});

describe('success for the appropriate workspace member', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('a viewer may read every staging surface', async () => {
    for (const [method, path] of MEMBER_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token' });
      expect(res.status, path).toBe(200);
      const json = await res.json();
      expect(json.staging).toBe(true);
    }
  });

  it('an operator may preview a committed source job into the acquisition plan', async () => {
    const res = await call('POST', '/api/acquisition/preview', {
      token: 'operator-token',
      body: { workspaceId: WS_A, sourceImportJobId: SRC_JOB },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.committed).toBe(false);
    expect(json.authoritative).toBe(false);
    expect(json.orders).toBe(2);
    expect(json.lineItems).toBe(2);
    // One of the two lines reported total_paid 0 -> an 'unknown' cost, not zero.
    expect(json.knownComponents).toBe(1);
    expect(json.unknownComponents).toBe(1);
  });

  it('an owner may register a channel', async () => {
    const res = await call('POST', '/api/acquisition/channels', {
      token: 'owner-token',
      body: { workspaceId: WS_A, name: 'Whatnot', kind: 'marketplace' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).channel.public_id).toBe('RV-CH-TEST01');
  });

  it('an operator commit reaches the driver and returns a staging outcome', async () => {
    const res = await call('POST', '/api/acquisition/commit', {
      token: 'operator-token',
      body: {
        workspaceId: WS_A,
        sourceImportJobId: SRC_JOB,
        channelId: CHANNEL,
        idempotencyKey: 'commit-key-0001',
      },
    });
    // The fake resolves every RPC, so the driver runs to a committed outcome.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.staging).toBe(true);
    expect(json.authoritative).toBe(false);
  });

  it('offers no endpoint that creates inventory, listing, or sale records', async () => {
    for (const path of [
      '/api/acquisition/inventory',
      '/api/acquisition/listings',
      '/api/acquisition/sales',
    ]) {
      const res = await call('POST', path, {
        token: 'owner-token',
        body: { workspaceId: WS_A },
      });
      expect(res.status).toBe(404);
    }
  });
});

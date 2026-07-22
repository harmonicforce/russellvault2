// Phase 5 inventory-identity route tests.
//
// Covers the two gates (availability 404 when the shadow flags are absent;
// authorization 401/403), the read-only list/detail surfaces, exact public-id
// and exact scan-SKU lookup, workspace scoping, and FAIL-CLOSED behaviour when a
// query errors. A fake Supabase client stands in for the shadow project so these
// run without Docker.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';

const { default: identityRouter } = await import('./inventoryIdentity.js');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const TOKENS: Record<string, { userId: string; memberships: Record<string, string> }> = {
  'operator-token': { userId: 'u-operator', memberships: { [WS_A]: 'operator' } },
  'viewer-token': { userId: 'u-viewer', memberships: { [WS_A]: 'viewer' } },
  'stranger-token': { userId: 'u-stranger', memberships: {} },
  'other-ws-token': { userId: 'u-other', memberships: { [WS_B]: 'owner' } },
};

let FAIL_TABLE: string | null = null;
let CHILD_COUNT = 0;

function makeFakeClient(token: string) {
  const identity = TOKENS[token];
  function rowsFor(table: string, filters: Record<string, string>): unknown[] {
    if (table === 'workspace_members') {
      const role = identity?.memberships[filters.workspace_id];
      return role ? [{ role }] : [];
    }
    if (filters.workspace_id && filters.workspace_id !== WS_A) return [];
    if (table === 'product_catalog') {
      if (filters.public_id && filters.public_id !== 'RV-PROD-AAA111') return [];
      if (filters.id && filters.id !== 'prod-1') return [];
      return [{ id: 'prod-1', public_id: 'RV-PROD-AAA111', business_vertical: 'tcg', display_name: 'Card', product_canonical_key: 'tcg|card|||' }];
    }
    if (table === 'sellable_skus') {
      if (filters.public_id && filters.public_id !== 'RV-SKU-AAA111') return [];
      if (filters.id && filters.id !== 'sku-1') return [];
      return [{ id: 'sku-1', public_id: 'RV-SKU-AAA111', product_id: 'prod-1', fingerprint: 'f' }];
    }
    if (table === 'inventory_lots') {
      // lot-1: lot-managed qty 3; lot-ser: serialized qty 2.
      const lots: Record<string, unknown> = {
        'lot-1': { id: 'lot-1', public_id: 'RV-C-000001', sku_id: 'sku-1', tracking_mode: 'lot_managed', quantity: 3, location_id: 'loc-1' },
        'lot-ser': { id: 'lot-ser', public_id: 'RV-C-000002', sku_id: 'sku-1', tracking_mode: 'serialized', quantity: 2, location_id: 'loc-1' },
      };
      if (filters.id) return lots[filters.id] ? [lots[filters.id]] : [];
      if (filters.public_id && filters.public_id !== 'RV-C-000001') return [];
      return [lots['lot-1']];
    }
    if (table === 'inventory_items') {
      if (filters.lot_id !== undefined) return Array.from({ length: CHILD_COUNT }, (_, i) => ({ id: `it-${i}` }));
      if (filters.scan_sku && filters.scan_sku !== 'RV-7K3F9Q2') return [];
      if (filters.public_id && filters.public_id !== 'RV-ITEM-AAA111') return [];
      if (filters.id && filters.id !== 'item-1') return [];
      return [{ id: 'item-1', public_id: 'RV-ITEM-AAA111', scan_sku: 'RV-7K3F9Q2', lot_id: 'lot-ser', sku_id: 'sku-1' }];
    }
    if (table === 'storage_locations') {
      if (filters.public_id && filters.public_id !== 'RV-LOC-AAA111') return [];
      if (filters.id && filters.id !== 'loc-1') return [];
      return [{ id: 'loc-1', public_id: 'RV-LOC-AAA111', location_code: 'A' }];
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
      const result = () =>
        FAIL_TABLE === table
          ? { data: null, error: { message: 'boom' }, count: null }
          : { data: rowsFor(table, filters), error: null, count: rowsFor(table, filters).length };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        order: () => q,
        range: async () => result(),
        limit: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result())),
      };
      return q;
    },
  };
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  setCallerClientFactoryForTests((token: string) => makeFakeClient(token) as never);
  const app = express();
  app.use(express.json());
  app.use('/api/inventory-identity', identityRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  setCallerClientFactoryForTests(null);
});

beforeEach(() => {
  FAIL_TABLE = null;
  CHILD_COUNT = 0;
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
});

function req(path: string, token?: string, workspaceId: string | null = WS_A) {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const sep = path.includes('?') ? '&' : '?';
  const url = workspaceId ? `${baseUrl}${path}${sep}workspaceId=${workspaceId}` : `${baseUrl}${path}`;
  return fetch(url, { headers });
}

describe('availability gate', () => {
  it('404s every route when the shadow flags are absent', async () => {
    delete process.env.SHADOW_IMPORT;
    const res = await req('/api/inventory-identity/lots', 'operator-token');
    expect(res.status).toBe(404);
  });
});

describe('authorization', () => {
  it('401s without a bearer token', async () => {
    const res = await req('/api/inventory-identity/lots', undefined);
    expect(res.status).toBe(401);
  });
  it('403s a non-member', async () => {
    const res = await req('/api/inventory-identity/lots', 'stranger-token');
    expect(res.status).toBe(403);
  });
  it('lets a viewer read (read-only surface)', async () => {
    const res = await req('/api/inventory-identity/lots', 'viewer-token');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authoritative).toBe(false);
    expect(body.rows.length).toBe(1);
  });
});

describe('read surfaces', () => {
  it('lists lots and returns one lot detail', async () => {
    const list = await (await req('/api/inventory-identity/lots', 'operator-token')).json();
    expect(list.rows[0].public_id).toBe('RV-C-000001');
    const detail = await (await req('/api/inventory-identity/lots/lot-1', 'operator-token')).json();
    expect(detail.record.public_id).toBe('RV-C-000001');
  });

  it('resolves an exact public id to its kind', async () => {
    const res = await req('/api/inventory-identity/lookup/public-id/RV-PROD-AAA111', 'operator-token');
    const body = await res.json();
    expect(body.kind).toBe('product');
    expect(body.record.public_id).toBe('RV-PROD-AAA111');
  });

  it('404s an unknown public id', async () => {
    const res = await req('/api/inventory-identity/lookup/public-id/RV-PROD-NOPE', 'operator-token');
    expect(res.status).toBe(404);
  });

  it('resolves an exact unit scan SKU to one serialized item', async () => {
    const res = await req('/api/inventory-identity/lookup/scan/RV-7K3F9Q2', 'operator-token');
    const body = await res.json();
    expect(body.kind).toBe('item');
    expect(body.record.scan_sku).toBe('RV-7K3F9Q2');
  });

  it('404s an unknown scan SKU (explicit not-found, never empty-as-authoritative)', async () => {
    const res = await req('/api/inventory-identity/lookup/scan/RV-NONE00', 'operator-token');
    expect(res.status).toBe(404);
  });

  it('does not leak another workspace’s rows', async () => {
    const res = await req('/api/inventory-identity/lots', 'other-ws-token', WS_B);
    // other-ws member is not a member of WS_A; requesting WS_B returns its own
    // (empty) set — never workspace A's lots.
    const body = await res.json();
    expect(body.rows.length).toBe(0);
  });
});

describe('fail-closed', () => {
  it('returns an error status when a query errors, not an empty list', async () => {
    FAIL_TABLE = 'inventory_lots';
    const res = await req('/api/inventory-identity/lots', 'operator-token');
    expect(res.status).toBe(400);
  });
});

describe('joined lot/item identity detail', () => {
  it('returns the complete Product → SKU → Lot → Location join for a lot-managed lot', async () => {
    const res = await req('/api/inventory-identity/lots/lot-1/detail', 'operator-token');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.product.public_id).toBe('RV-PROD-AAA111');
    expect(body.sku.public_id).toBe('RV-SKU-AAA111');
    expect(body.lot.public_id).toBe('RV-C-000001');
    expect(body.location.public_id).toBe('RV-LOC-AAA111');
    // A lot-managed lot has no serialized capacity.
    expect(body.capacity).toBeNull();
    expect(body.atCapacity).toBe(false);
  });

  it('reports a partially serialized lot as below capacity', async () => {
    CHILD_COUNT = 1;
    const res = await req('/api/inventory-identity/lots/lot-ser/detail', 'operator-token');
    const body = await res.json();
    expect(body.capacity).toBe(2);
    expect(body.serializedChildCount).toBe(1);
    expect(body.atCapacity).toBe(false);
  });

  it('reports a full serialized lot as at capacity', async () => {
    CHILD_COUNT = 2;
    const res = await req('/api/inventory-identity/lots/lot-ser/detail', 'operator-token');
    const body = await res.json();
    expect(body.serializedChildCount).toBe(2);
    expect(body.atCapacity).toBe(true);
  });

  it('404s a missing lot', async () => {
    const res = await req('/api/inventory-identity/lots/nope/detail', 'operator-token');
    expect(res.status).toBe(404);
  });

  it('fails closed when a subordinate join query errors', async () => {
    FAIL_TABLE = 'sellable_skus';
    const res = await req('/api/inventory-identity/lots/lot-1/detail', 'operator-token');
    expect(res.status).toBe(400);
  });

  it('returns the complete Product → SKU → Lot → Item → Location join for an item', async () => {
    const res = await req('/api/inventory-identity/items/item-1/detail', 'operator-token');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.product.public_id).toBe('RV-PROD-AAA111');
    expect(body.sku.public_id).toBe('RV-SKU-AAA111');
    expect(body.lot.public_id).toBe('RV-C-000002');
    expect(body.item.scan_sku).toBe('RV-7K3F9Q2');
    expect(body.location.public_id).toBe('RV-LOC-AAA111');
  });

  it('404s a missing item', async () => {
    const res = await req('/api/inventory-identity/items/nope/detail', 'operator-token');
    expect(res.status).toBe(404);
  });
});

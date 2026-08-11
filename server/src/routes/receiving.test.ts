// S2.3 Batch 1 receiving route tests.
//
// These prove the things a reviewer cannot verify by reading:
//   * the two gates (availability, then authentication/authorization);
//   * that a viewer is refused every mutation;
//   * that each route calls the S2.2 function it claims to, with the argument
//     names that function actually declares — a typo in `p_expected_quantity`
//     would silently disable the compare-and-set, and the database would
//     happily accept the write;
//   * that every bounded governed refusal keeps its meaning instead of
//     collapsing into a 500;
//   * that NO internal UUID reaches the browser, asserted over whole response
//     bodies rather than field by field.
//
// A fake Supabase client stands in for the shadow project, exactly as the
// acquisition route tests do, so these run without Docker.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';
import { containsInternalId } from '../receiving/contract.js';

const { default: receivingRouter } = await import('./receiving.js');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const TOKENS: Record<string, { userId: string; memberships: Record<string, string> }> = {
  'owner-token': { userId: 'u-owner', memberships: { [WS_A]: 'owner' } },
  'operator-token': { userId: 'u-operator', memberships: { [WS_A]: 'operator' } },
  'viewer-token': { userId: 'u-viewer', memberships: { [WS_A]: 'viewer' } },
  'stranger-token': { userId: 'u-stranger', memberships: {} },
  'other-ws-token': { userId: 'u-other', memberships: { [WS_B]: 'owner' } },
};

// Internal ids are real UUIDs on purpose: the no-leak assertion is only
// meaningful if a leak would actually be detectable.
const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const LINE_A = '22222222-2222-2222-2222-222222222222';
const LINE_B = '33333333-3333-3333-3333-333333333333';
const RECEIPT_OPEN = '44444444-4444-4444-4444-444444444444';
const RECEIPT_CANCELLED = '55555555-5555-5555-5555-555555555555';
const SHIPMENT_ID = '66666666-6666-6666-6666-666666666666';

const LINE_ROWS = [
  {
    acquisition_line_item_id: LINE_A, acquisition_line_public_id: 'RV-AL-AAA111',
    source_system_public_id: 'RV-SS-WHATNOT', quantity: 3, description: 'Card lot A',
    full_title: 'Vintage card lot A', delivered_item_title: 'Card lot A', seller_normalized: 'alpha',
    exclusion_state: 'included', acquisition_order_id: ORDER_ID,
    acquisition_order_public_id: 'RV-ACQ-AAA111', source_order_reference: 'WN-ORDER-1',
    order_status: 'completed', occurred_at: '2026-08-01T00:00:00.000Z',
  },
  {
    acquisition_line_item_id: LINE_B, acquisition_line_public_id: 'RV-AL-BBB222',
    source_system_public_id: 'RV-SS-WHATNOT', quantity: 2, description: 'Card lot B',
    full_title: null, delivered_item_title: null, seller_normalized: 'alpha',
    exclusion_state: 'included', acquisition_order_id: ORDER_ID,
    acquisition_order_public_id: 'RV-ACQ-AAA111', source_order_reference: 'WN-ORDER-1',
    order_status: 'completed', occurred_at: '2026-08-01T00:00:00.000Z',
  },
  // No active placement, so it belongs to no order and cannot be received.
  {
    acquisition_line_item_id: '77777777-7777-7777-7777-777777777777',
    acquisition_line_public_id: 'RV-AL-ORPHAN', source_system_public_id: 'RV-SS-WHATNOT',
    quantity: 9, description: 'Unplaced', full_title: null, delivered_item_title: null,
    seller_normalized: 'alpha', exclusion_state: 'included', acquisition_order_id: null,
    acquisition_order_public_id: null, source_order_reference: null,
    order_status: null, occurred_at: null,
  },
];

const RECEIPT_ROWS = [
  {
    id: RECEIPT_OPEN, public_id: 'RV-ARCPT-AAA111', acquisition_order_id: ORDER_ID,
    acquisition_shipment_id: SHIPMENT_ID, status: 'open',
    received_at: '2026-08-05T10:00:00.000Z', note: 'Box 1 of 2',
    created_at: '2026-08-05T09:00:00.000Z',
  },
  {
    id: RECEIPT_CANCELLED, public_id: 'RV-ARCPT-BBB222', acquisition_order_id: ORDER_ID,
    acquisition_shipment_id: null, status: 'cancelled',
    received_at: '2026-08-04T10:00:00.000Z', note: null,
    created_at: '2026-08-04T09:00:00.000Z',
  },
];

const RECEIPT_LINE_ROWS = [
  {
    id: '88888888-8888-8888-8888-888888888888', public_id: 'RV-ARL-AAA111',
    acquisition_receipt_id: RECEIPT_OPEN, acquisition_line_item_id: LINE_A,
    quantity_received: 5, note: null,
  },
  // Belongs to the CANCELLED session: preserved as history, never counted live.
  {
    id: '99999999-9999-9999-9999-999999999999', public_id: 'RV-ARL-BBB222',
    acquisition_receipt_id: RECEIPT_CANCELLED, acquisition_line_item_id: LINE_B,
    quantity_received: 2, note: null,
  },
];

const LOT_ID = 'aaaa1111-1111-1111-1111-111111111111';
const ITEM_ID = 'bbbb2222-2222-2222-2222-222222222222';

const LINK_ROWS = [
  {
    id: 'cccc3333-3333-3333-3333-333333333333', public_id: 'RV-ARIL-AAA111',
    acquisition_receipt_line_id: '88888888-8888-8888-8888-888888888888',
    inventory_lot_id: LOT_ID, inventory_item_id: null, quantity_linked: 2,
  },
];

const LOT_ROWS = [
  {
    lot_id: LOT_ID, lot_public_id: 'RV-ILOT-AAA111', tracking_mode: 'lot_managed',
    quantity: 12, lot_state: 'active', product_display_name: 'Bulk commons box',
    sku_public_id: 'RV-SKU-AAA111', condition_or_quality: 'played',
    location_display_name: 'Shelf A1',
  },
  // Serialized lots must never be offered as lot-managed subjects.
  {
    lot_id: 'dddd4444-4444-4444-4444-444444444444', lot_public_id: 'RV-ILOT-BBB222',
    tracking_mode: 'serialized', quantity: 1, lot_state: 'active',
    product_display_name: 'Graded parent', sku_public_id: 'RV-SKU-BBB222',
    condition_or_quality: null, location_display_name: null,
  },
];

const ITEM_ROWS = [
  {
    item_id: ITEM_ID, item_public_id: 'RV-IITM-AAA111', lot_public_id: 'RV-ILOT-BBB222',
    tracking_mode: 'serialized', item_state: 'active', scan_sku: 'SCAN-1',
    serial_number: 'SER-1', grading_company: 'PSA', certificate_number: '12345678',
    product_display_name: 'Graded slab', sku_public_id: 'RV-SKU-BBB222',
    condition_or_quality: 'mint', location_display_name: 'Vault',
  },
];

const DISCREPANCY_ROWS = [
  {
    public_id: 'RV-ADISC-AAA111', acquisition_order_id: ORDER_ID,
    acquisition_receipt_id: RECEIPT_OPEN,
    acquisition_receipt_line_id: '88888888-8888-8888-8888-888888888888',
    acquisition_line_item_id: LINE_A, kind: 'over_shipped', status: 'open',
    quantity_expected: 3, quantity_observed: 5, detail: 'Two extra units in the box',
    resolution_note: null, resolved_at: null, created_at: '2026-08-06T10:00:00.000Z',
  },
];

const SHIPMENT_ROWS = [
  {
    id: SHIPMENT_ID, public_id: 'RV-ASHP-AAA111', acquisition_order_id: ORDER_ID,
    carrier: 'UPS', tracking_number: '1Z999', status: 'delivered',
    expected_at: '2026-08-03T00:00:00.000Z', received_at: '2026-08-04T00:00:00.000Z',
  },
];

/** Set by a test to make the next rpc call fail with a governed refusal. */
let rpcFailure: string | null = null;
/** Every rpc call the router made, for exact-argument assertions. */
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function makeFakeClient(token: string) {
  const identity = TOKENS[token];

  function rowsFor(table: string, filters: Record<string, string>): unknown[] {
    if (table === 'workspace_members') {
      const role = identity?.memberships[filters.workspace_id];
      return role ? [{ role }] : [];
    }
    // RLS: a caller only ever sees their own workspace's rows.
    if (filters.workspace_id !== WS_A) return [];
    if (table === 'acquisition_line_overview') {
      return filters.acquisition_order_id
        ? LINE_ROWS.filter((row) => row.acquisition_order_id === filters.acquisition_order_id)
        : LINE_ROWS;
    }
    if (table === 'acquisition_receipts') {
      let rows = RECEIPT_ROWS;
      if (filters.public_id) rows = rows.filter((row) => row.public_id === filters.public_id);
      if (filters.acquisition_order_id) {
        rows = rows.filter((row) => row.acquisition_order_id === filters.acquisition_order_id);
      }
      return rows;
    }
    if (table === 'acquisition_receipt_lines') return RECEIPT_LINE_ROWS;
    if (table === 'acquisition_shipments') return SHIPMENT_ROWS;
    if (table === 'acquisition_receipt_line_inventory_links') return LINK_ROWS;
    if (table === 'acquisition_discrepancies') return DISCREPANCY_ROWS;
    if (table === 'inventory_lot_overview') {
      return filters.tracking_mode
        ? LOT_ROWS.filter((row) => row.tracking_mode === filters.tracking_mode)
        : LOT_ROWS;
    }
    if (table === 'inventory_item_overview') {
      return filters.tracking_mode
        ? ITEM_ROWS.filter((row) => row.tracking_mode === filters.tracking_mode)
        : ITEM_ROWS;
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
        eq: (col: string, val: string) => { filters[col] = val; return q; },
        in: () => q,
        or: () => q,
        order: () => q,
        range: async () => result(),
        limit: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result())),
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcFailure) return { data: null, error: { message: rpcFailure } };
      if (fn === 'open_acquisition_receipt') {
        return { data: { receiptPublicId: 'RV-ARCPT-NEW001', status: 'open', replayed: false }, error: null };
      }
      if (fn === 'record_acquisition_receipt_line') {
        return { data: { receiptLinePublicId: 'RV-ARL-NEW001', quantityReceived: args.p_quantity, replayed: false }, error: null };
      }
      if (fn === 'correct_acquisition_receipt_line') {
        return { data: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: args.p_desired_quantity, replayed: false }, error: null };
      }
      if (fn === 'cancel_acquisition_receipt') {
        return { data: { receiptPublicId: 'RV-ARCPT-AAA111', status: 'cancelled', replayed: false }, error: null };
      }
      if (fn === 'submit_acquisition_receipt') {
        return { data: { receiptPublicId: 'RV-ARCPT-AAA111', status: 'submitted', replayed: false }, error: null };
      }
      if (fn === 'link_acquisition_receipt_inventory') {
        return { data: { inventoryLinkPublicId: 'RV-ARIL-NEW001', replayed: false }, error: null };
      }
      if (fn === 'unlink_acquisition_receipt_inventory') {
        return { data: { inventoryLinkPublicId: 'RV-ARIL-AAA111', unlinked: true, replayed: false }, error: null };
      }
      if (fn === 'reconcile_acquisition_receipt') {
        return { data: { receiptPublicId: 'RV-ARCPT-AAA111', status: 'reconciled', replayed: false }, error: null };
      }
      if (fn === 'raise_acquisition_discrepancy') {
        return { data: { discrepancyPublicId: 'RV-ADISC-NEW001', status: 'open' }, error: null };
      }
      if (fn === 'transition_acquisition_discrepancy') {
        return { data: { discrepancyPublicId: 'RV-ADISC-AAA111', status: args.p_target, replayed: false }, error: null };
      }
      return { data: null, error: { message: 'unexpected rpc' } };
    },
  };
}

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  setCallerClientFactoryForTests((token: string) => makeFakeClient(token) as never);

  const app = express();
  app.use(express.json());
  app.use('/api/receiving', receivingRouter);
  // Loopback only. A test server is never bound to a routable address.
  baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
});

afterAll(async () => {
  setCallerClientFactoryForTests(null);
  delete process.env.SHADOW_IMPORT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { rpcFailure = null; rpcCalls = []; });

async function get(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function post(path: string, token: string | undefined, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe('availability gate', () => {
  it('404s the whole surface when the governed deployment is not configured', async () => {
    const saved = process.env.SHADOW_IMPORT;
    delete process.env.SHADOW_IMPORT;
    try {
      expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'owner-token')).status).toBe(404);
    } finally {
      process.env.SHADOW_IMPORT = saved;
    }
  });
});

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`)).status).toBe(401);
  });

  it('refuses a non-member', async () => {
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'stranger-token')).status).toBe(403);
  });

  it('refuses a member of a DIFFERENT workspace asking about this one', async () => {
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'other-ws-token')).status).toBe(403);
  });

  it('lets a viewer read the queue', async () => {
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'viewer-token')).status).toBe(200);
  });

  // The database asserts owner|operator inside every S2.2 function too. This
  // gate is the fast refusal; it is not the only one.
  it.each([
    ['open a receipt', `/api/receiving/orders/RV-ACQ-AAA111/receipts`],
    ['record a line', `/api/receiving/receipts/RV-ARCPT-AAA111/lines`],
    ['correct a line', `/api/receiving/receipt-lines/RV-ARL-AAA111/correct`],
    ['cancel a receipt', `/api/receiving/receipts/RV-ARCPT-AAA111/cancel`],
    ['submit a receipt', `/api/receiving/receipts/RV-ARCPT-AAA111/submit`],
  ])('refuses a viewer trying to %s', async (_label, path) => {
    const { status } = await post(path, 'viewer-token', { workspaceId: WS_A });
    expect(status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('the receiving queue', () => {
  it('groups acquisition lines into orders with expected and observed kept apart', async () => {
    const { status, body } = await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'owner-token');
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0];
    expect(row.orderPublicId).toBe('RV-ACQ-AAA111');
    expect(row.sourceOrderReference).toBe('WN-ORDER-1');
    // EXPECTED is acquisition evidence: 3 + 2.
    expect(row.expectedQuantityTotal).toBe(5);
    // OBSERVED counts the open session's 5 but NOT the cancelled session's 2.
    expect(row.observedQuantityTotal).toBe(5);
    expect(row.workflowState).toBe('receiving_in_progress');
    expect(row.openReceiptPublicId).toBe('RV-ARCPT-AAA111');
  });

  it('omits an acquisition line that belongs to no order', async () => {
    const { body } = await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'owner-token');
    expect(JSON.stringify(body)).not.toContain('RV-AL-ORPHAN');
  });

  it('presents a shipment as a reference, never as receipt truth', async () => {
    const { body } = await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'owner-token');
    const shipment = body.rows[0].shipments[0];
    expect(shipment.publicId).toBe('RV-ASHP-AAA111');
    // The carrier says delivered. That is transport state and is named as the
    // CARRIER's, so no consumer can mistake it for a receipt's received_at.
    expect(shipment.status).toBe('delivered');
    expect(shipment.carrierReceivedAt).toBe('2026-08-04T00:00:00.000Z');
    expect(shipment).not.toHaveProperty('receivedAt');
  });

  it('reports the caller role so the UI derives capability from the server', async () => {
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'viewer-token')).body.role).toBe('viewer');
    expect((await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'operator-token')).body.role).toBe('operator');
  });

  it('leaks no internal identifier', async () => {
    const { body } = await get(`/api/receiving/queue?workspaceId=${WS_A}`, 'owner-token');
    expect(containsInternalId(body)).toBe(false);
  });
});

describe('receipt detail', () => {
  it('returns every receivable line of the order, not only the recorded ones', async () => {
    const { status, body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    expect(status).toBe(200);
    expect(body.lines.map((line: { acquisitionLinePublicId: string }) => line.acquisitionLinePublicId))
      .toEqual(['RV-AL-AAA111', 'RV-AL-BBB222']);
    // The line with nothing recorded is present with a null observation, which
    // is what lets the operator see what they have not yet counted.
    expect(body.lines[1].observed).toBeNull();
  });

  it('shows an overage as observed truth rather than clamping it to expected', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    const line = body.lines[0];
    expect(line.expectedQuantity).toBe(3);
    expect(line.observed.quantityReceived).toBe(5);
    expect(line.cumulativeReceivedQuantity).toBe(5);
  });

  it('excludes a cancelled session from cumulative observed quantity', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    // RV-AL-BBB222 was received on the CANCELLED receipt only.
    expect(body.lines[1].cumulativeReceivedQuantity).toBe(0);
  });

  it('carries the source-qualified addressing the governed function requires', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    expect(body.lines[0].sourceSystemPublicId).toBe('RV-SS-WHATNOT');
  });

  it('404s an unknown receipt without disclosing whether it exists elsewhere', async () => {
    const { status, body } = await get(
      `/api/receiving/receipts/RV-ARCPT-NOPE?workspaceId=${WS_A}`, 'owner-token');
    expect(status).toBe(404);
    expect(body.error).toBe('receipt_not_found');
  });

  it('leaks no internal identifier', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    expect(containsInternalId(body)).toBe(false);
  });
});

describe('mutations call the governed S2.2 functions', () => {
  it('opens a receipt with the declared argument names', async () => {
    const { status } = await post(`/api/receiving/orders/RV-ACQ-AAA111/receipts`, 'operator-token', {
      workspaceId: WS_A, shipmentPublicId: 'RV-ASHP-AAA111',
      receivedAt: '2026-08-05T10:00:00.000Z', note: 'Box 1', idempotencyKey: 'open-key-0001',
    });
    expect(status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      fn: 'open_acquisition_receipt',
      args: {
        p_workspace_id: WS_A,
        p_acquisition_order_public_id: 'RV-ACQ-AAA111',
        p_shipment_public_id: 'RV-ASHP-AAA111',
        p_received_at: '2026-08-05T10:00:00.000Z',
        p_note: 'Box 1',
        p_idempotency_key: 'open-key-0001',
      },
    });
  });

  it('allows the no-shipment path the receipt contract permits', async () => {
    await post(`/api/receiving/orders/RV-ACQ-AAA111/receipts`, 'operator-token', {
      workspaceId: WS_A, receivedAt: '2026-08-05T10:00:00.000Z', idempotencyKey: 'open-key-0002',
    });
    expect(rpcCalls[0].args.p_shipment_public_id).toBeNull();
  });

  // received_at is settable ONLY at open time, and submit refuses a receipt
  // without one. A receipt opened without it could never be filed.
  it('refuses to open a receipt with no received_at', async () => {
    const { status } = await post(`/api/receiving/orders/RV-ACQ-AAA111/receipts`, 'operator-token', {
      workspaceId: WS_A, idempotencyKey: 'open-key-0003',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('records a line with source-qualified addressing', async () => {
    await post(`/api/receiving/receipts/RV-ARCPT-AAA111/lines`, 'operator-token', {
      workspaceId: WS_A, sourceSystemPublicId: 'RV-SS-WHATNOT',
      acquisitionLinePublicId: 'RV-AL-AAA111', quantityReceived: 4,
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'record_acquisition_receipt_line',
      args: {
        p_workspace_id: WS_A,
        p_receipt_public_id: 'RV-ARCPT-AAA111',
        p_source_system_public_id: 'RV-SS-WHATNOT',
        p_acquisition_line_public_id: 'RV-AL-AAA111',
        p_quantity: 4,
        p_note: null,
      },
    });
  });

  it('transmits an overage rather than refusing it locally', async () => {
    // Expected is 3; the operator physically counted 11. That is evidence.
    const { status } = await post(`/api/receiving/receipts/RV-ARCPT-AAA111/lines`, 'operator-token', {
      workspaceId: WS_A, sourceSystemPublicId: 'RV-SS-WHATNOT',
      acquisitionLinePublicId: 'RV-AL-AAA111', quantityReceived: 11,
    });
    expect(status).toBe(200);
    expect(rpcCalls[0].args.p_quantity).toBe(11);
  });

  it('rejects a non-positive or non-integer quantity before calling the database', async () => {
    for (const quantityReceived of [0, -1, 1.5, '3', null]) {
      rpcCalls = [];
      const { status } = await post(`/api/receiving/receipts/RV-ARCPT-AAA111/lines`, 'operator-token', {
        workspaceId: WS_A, sourceSystemPublicId: 'RV-SS-WHATNOT',
        acquisitionLinePublicId: 'RV-AL-AAA111', quantityReceived,
      });
      expect(status).toBe(400);
      expect(rpcCalls).toHaveLength(0);
    }
  });

  it('sends the compare-and-set value the correction contract requires', async () => {
    await post(`/api/receiving/receipt-lines/RV-ARL-AAA111/correct`, 'operator-token', {
      workspaceId: WS_A, expectedQuantity: 5, desiredQuantity: 4, reason: 'Recount after unpacking',
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'correct_acquisition_receipt_line',
      args: {
        p_workspace_id: WS_A,
        p_receipt_line_public_id: 'RV-ARL-AAA111',
        p_expected_quantity: 5,
        p_desired_quantity: 4,
        p_reason: 'Recount after unpacking',
      },
    });
  });

  it('refuses a correction with no reason', async () => {
    const { status } = await post(`/api/receiving/receipt-lines/RV-ARL-AAA111/correct`, 'operator-token', {
      workspaceId: WS_A, expectedQuantity: 5, desiredQuantity: 4, reason: '   ',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a cancellation with no reason', async () => {
    const { status } = await post(`/api/receiving/receipts/RV-ARCPT-AAA111/cancel`, 'operator-token', {
      workspaceId: WS_A, reason: '',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('cancels with a reason', async () => {
    await post(`/api/receiving/receipts/RV-ARCPT-AAA111/cancel`, 'operator-token', {
      workspaceId: WS_A, reason: 'Wrong box opened',
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'cancel_acquisition_receipt',
      args: {
        p_workspace_id: WS_A,
        p_receipt_public_id: 'RV-ARCPT-AAA111',
        p_reason: 'Wrong box opened',
      },
    });
  });

  it('submits', async () => {
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/submit`, 'operator-token', { workspaceId: WS_A });
    expect(status).toBe(200);
    expect(body.status).toBe('submitted');
    expect(rpcCalls[0]).toEqual({
      fn: 'submit_acquisition_receipt',
      args: { p_workspace_id: WS_A, p_receipt_public_id: 'RV-ARCPT-AAA111' },
    });
  });

  // Batch 1 exposes NONE of the inventory-linking or discrepancy surface.
  it('never calls a Batch 2 governed function', async () => {
    await post(`/api/receiving/receipts/RV-ARCPT-AAA111/submit`, 'operator-token', { workspaceId: WS_A });
    await post(`/api/receiving/receipts/RV-ARCPT-AAA111/cancel`, 'operator-token', {
      workspaceId: WS_A, reason: 'x',
    });
    const called = rpcCalls.map((call) => call.fn);
    for (const forbidden of [
      'link_acquisition_receipt_inventory', 'unlink_acquisition_receipt_inventory',
      'reconcile_acquisition_receipt', 'raise_acquisition_discrepancy',
      'transition_acquisition_discrepancy',
    ]) {
      expect(called).not.toContain(forbidden);
    }
  });
});

describe('the bounded governed refusal vocabulary survives transport', () => {
  it.each([
    ['receipt_not_open', 409],
    ['receipt_terminal', 409],
    ['receipt_line_conflict', 409],
    ['idempotency_conflict', 409],
    ['acquisition_line_not_in_receipt_order', 409],
    ['acquisition_line_excluded', 409],
    ['acquisition_integrity_error', 409],
    ['receipt_not_found', 404],
    ['receipt_line_not_found', 404],
    ['acquisition_not_found', 404],
    ['invalid_request', 400],
    ['unauthorized_workspace', 403],
  ])('maps %s to %i rather than a generic failure', async (code, expected) => {
    rpcFailure = `some prefix ${code} some suffix`;
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/submit`, 'operator-token', { workspaceId: WS_A });
    expect(status).toBe(expected);
    expect(body.error).toBe(code);
  });

  it('turns a missing S2.2 migration into a configuration answer, not a 500', async () => {
    rpcFailure = 'Could not find the function public.submit_acquisition_receipt(p_workspace_id) in the schema cache';
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/submit`, 'operator-token', { workspaceId: WS_A });
    expect(status).toBe(503);
    expect(body.error).toBe('receiving_contract_missing');
  });

  it('never hands the browser the database sentence', async () => {
    rpcFailure = 'connection to server at "10.0.0.4", port 5432 failed: FATAL password authentication failed';
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/submit`, 'operator-token', { workspaceId: WS_A });
    expect(status).toBe(502);
    expect(body.error).toBe('dependency_failed');
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.4|5432|password/);
  });
});

// ===========================================================================
// S2.3 Batch 2 — inventory provenance, discrepancies, owner reconciliation.
// ===========================================================================

describe('receipt detail carries provenance and discrepancy evidence', () => {
  it('attaches links to the receipt line they attribute, with recognisable subject identity', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    const line = body.lines.find((l: { acquisitionLinePublicId: string }) => l.acquisitionLinePublicId === 'RV-AL-AAA111');
    expect(line.links).toHaveLength(1);
    expect(line.links[0]).toMatchObject({
      inventoryLinkPublicId: 'RV-ARIL-AAA111',
      receiptLinePublicId: 'RV-ARL-AAA111',
      quantityLinked: 2,
      subjectKind: 'lot',
      inventoryLotPublicId: 'RV-ILOT-AAA111',
      inventoryItemPublicId: null,
      // Recognition, not merely an identifier.
      productDisplayName: 'Bulk commons box',
      locationDisplayName: 'Shelf A1',
    });
  });

  it('states observed, linked and unlinked as three separate numbers', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    const line = body.lines.find((l: { acquisitionLinePublicId: string }) => l.acquisitionLinePublicId === 'RV-AL-AAA111');
    expect(line.observed.quantityReceived).toBe(5);
    expect(line.linkedQuantity).toBe(2);
    expect(line.unlinkedQuantity).toBe(3);
  });

  it('returns discrepancies addressed only by public identity', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    expect(body.discrepancies).toHaveLength(1);
    expect(body.discrepancies[0]).toMatchObject({
      discrepancyPublicId: 'RV-ADISC-AAA111',
      kind: 'over_shipped',
      status: 'open',
      receiptPublicId: 'RV-ARCPT-AAA111',
      receiptLinePublicId: 'RV-ARL-AAA111',
      acquisitionLinePublicId: 'RV-AL-AAA111',
      quantityExpected: 3,
      quantityObserved: 5,
    });
    // No actor field at all: created_by/resolved_by are auth.users UUIDs and
    // this system has no governed public representation of a person.
    expect(body.discrepancies[0]).not.toHaveProperty('createdBy');
    expect(body.discrepancies[0]).not.toHaveProperty('resolvedBy');
  });

  it('names reconciliation blockers instead of a single readiness badge', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    const readiness = body.reconciliation;
    expect(readiness.linesFullyLinked).toBe(false);
    expect(readiness.linesNeedingLinks).toEqual([
      { acquisitionLinePublicId: 'RV-AL-AAA111', observed: 5, linked: 2 },
    ]);
    // The over_shipped discrepancy already exists for this line, so the overage
    // requirement is satisfied and must NOT be reported as a blocker.
    expect(readiness.overageLinesMissingEvidence).toEqual([]);
    expect(readiness.openDiscrepancyCount).toBe(1);
    expect(readiness).not.toHaveProperty('ready');
  });

  it('leaks no internal identifier once links and discrepancies are attached', async () => {
    const { body } = await get(
      `/api/receiving/receipts/RV-ARCPT-AAA111?workspaceId=${WS_A}`, 'owner-token');
    expect(containsInternalId(body)).toBe(false);
  });
});

describe('inventory subject search', () => {
  it('offers lot-managed lots and serialized items with the database tracking mode', async () => {
    const { status, body } = await get(
      `/api/receiving/inventory-subjects?workspaceId=${WS_A}`, 'operator-token');
    expect(status).toBe(200);
    const kinds = body.subjects.map((s: { subjectKind: string }) => s.subjectKind);
    expect(kinds).toContain('lot');
    expect(kinds).toContain('item');
    const lot = body.subjects.find((s: { subjectKind: string }) => s.subjectKind === 'lot');
    expect(lot.trackingMode).toBe('lot_managed');
    expect(lot.publicId).toBe('RV-ILOT-AAA111');
    const item = body.subjects.find((s: { subjectKind: string }) => s.subjectKind === 'item');
    expect(item.trackingMode).toBe('serialized');
    expect(item.parentLotPublicId).toBe('RV-ILOT-BBB222');
  });

  it('never offers a serialized lot as a lot-managed subject', async () => {
    const { body } = await get(
      `/api/receiving/inventory-subjects?workspaceId=${WS_A}`, 'operator-token');
    const lots = body.subjects.filter((s: { subjectKind: string }) => s.subjectKind === 'lot');
    expect(lots.map((l: { publicId: string }) => l.publicId)).not.toContain('RV-ILOT-BBB222');
  });

  it('refuses an unknown mode rather than silently searching everything', async () => {
    expect((await get(
      `/api/receiving/inventory-subjects?mode=whatever&workspaceId=${WS_A}`, 'operator-token')).status).toBe(400);
  });

  it('leaks no internal identifier', async () => {
    const { body } = await get(
      `/api/receiving/inventory-subjects?workspaceId=${WS_A}`, 'operator-token');
    expect(containsInternalId(body)).toBe(false);
  });
});

describe('inventory linking transport', () => {
  it('forwards a lot-managed link with the exact public id and quantity', async () => {
    await post(`/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', {
      workspaceId: WS_A, inventoryLotPublicId: 'RV-ILOT-AAA111', quantity: 3,
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'link_acquisition_receipt_inventory',
      args: {
        p_workspace_id: WS_A,
        p_receipt_line_public_id: 'RV-ARL-AAA111',
        p_inventory_lot_public_id: 'RV-ILOT-AAA111',
        p_inventory_item_public_id: null,
        p_quantity: 3,
      },
    });
  });

  // A serialized item is exactly one unit; the transport must not be able to
  // weaken that by passing a different number through.
  it('sends quantity 1 for a serialized item and refuses anything else', async () => {
    await post(`/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', {
      workspaceId: WS_A, inventoryItemPublicId: 'RV-IITM-AAA111',
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_inventory_item_public_id: 'RV-IITM-AAA111',
      p_inventory_lot_public_id: null,
      p_quantity: 1,
    });

    rpcCalls = [];
    const { status } = await post(`/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', {
      workspaceId: WS_A, inventoryItemPublicId: 'RV-IITM-AAA111', quantity: 3,
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a request naming both or neither subject before calling the database', async () => {
    for (const body of [
      { inventoryLotPublicId: 'RV-ILOT-AAA111', inventoryItemPublicId: 'RV-IITM-AAA111' },
      {},
    ]) {
      rpcCalls = [];
      const { status } = await post(
        `/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', { workspaceId: WS_A, ...body });
      expect(status).toBe(400);
      expect(rpcCalls).toHaveLength(0);
    }
  });

  // Conservation is the database's, held under a row lock. A TypeScript
  // pre-check would be a second opinion computed from a stale read.
  it('transmits a quantity larger than the remaining unlinked amount and lets the database refuse', async () => {
    rpcFailure = 'inventory_link_over_capacity';
    const { status, body } = await post(
      `/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', {
        workspaceId: WS_A, inventoryLotPublicId: 'RV-ILOT-AAA111', quantity: 999,
      });
    expect(rpcCalls[0].args.p_quantity).toBe(999);
    expect(status).toBe(409);
    expect(body.error).toBe('inventory_link_over_capacity');
  });

  it('forwards the exact unlink reason', async () => {
    await post(`/api/receiving/inventory-links/RV-ARIL-AAA111/unlink`, 'operator-token', {
      workspaceId: WS_A, reason: 'Attributed to the wrong lot',
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'unlink_acquisition_receipt_inventory',
      args: {
        p_workspace_id: WS_A,
        p_inventory_link_public_id: 'RV-ARIL-AAA111',
        p_reason: 'Attributed to the wrong lot',
      },
    });
  });

  it('refuses an unlink with no reason', async () => {
    const { status } = await post(`/api/receiving/inventory-links/RV-ARIL-AAA111/unlink`, 'operator-token', {
      workspaceId: WS_A, reason: '  ',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('owner reconciliation is owner-only at both gates', () => {
  it('lets an owner reconcile, with no reason argument', async () => {
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/reconcile`, 'owner-token', { workspaceId: WS_A });
    expect(status).toBe(200);
    expect(body.status).toBe('reconciled');
    expect(rpcCalls[0]).toEqual({
      fn: 'reconcile_acquisition_receipt',
      args: { p_workspace_id: WS_A, p_receipt_public_id: 'RV-ARCPT-AAA111' },
    });
  });

  it('refuses an operator BEFORE any database call', async () => {
    const { status } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/reconcile`, 'operator-token', { workspaceId: WS_A });
    expect(status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a viewer', async () => {
    expect((await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/reconcile`, 'viewer-token', { workspaceId: WS_A })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('discrepancy transport', () => {
  it('forwards the closed kind and the nullable scopes', async () => {
    await post(`/api/receiving/orders/RV-ACQ-AAA111/discrepancies`, 'operator-token', {
      workspaceId: WS_A, receiptPublicId: 'RV-ARCPT-AAA111', receiptLinePublicId: 'RV-ARL-AAA111',
      kind: 'over_shipped', quantityExpected: 3, quantityObserved: 5,
      detail: 'Two extra units in the box',
    });
    expect(rpcCalls[0]).toEqual({
      fn: 'raise_acquisition_discrepancy',
      args: {
        p_workspace_id: WS_A,
        p_order_public_id: 'RV-ACQ-AAA111',
        p_receipt_public_id: 'RV-ARCPT-AAA111',
        p_receipt_line_public_id: 'RV-ARL-AAA111',
        p_kind: 'over_shipped',
        p_quantity_expected: 3,
        p_quantity_observed: 5,
        p_detail: 'Two extra units in the box',
      },
    });
  });

  // Nothing arrived, so there is no receipt. Manufacturing one to report the
  // absence would be recording an arrival that did not happen.
  it('records never_arrived against the order with no receipt at all', async () => {
    await post(`/api/receiving/orders/RV-ACQ-AAA111/discrepancies`, 'operator-token', {
      workspaceId: WS_A, kind: 'never_arrived', detail: 'Tracking shows delivered, nothing at the door',
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_kind: 'never_arrived',
      p_receipt_public_id: null,
      p_receipt_line_public_id: null,
      p_quantity_expected: null,
      p_quantity_observed: null,
    });
  });

  it('refuses a kind outside the governed vocabulary before the database sees it', async () => {
    for (const kind of ['shrinkage', 'OVER_SHIPPED', '', null, 42]) {
      rpcCalls = [];
      const { status } = await post(`/api/receiving/orders/RV-ACQ-AAA111/discrepancies`, 'operator-token', {
        workspaceId: WS_A, kind, detail: 'x',
      });
      expect(status).toBe(400);
      expect(rpcCalls).toHaveLength(0);
    }
  });

  it('requires a detail', async () => {
    const { status } = await post(`/api/receiving/orders/RV-ACQ-AAA111/discrepancies`, 'operator-token', {
      workspaceId: WS_A, kind: 'damaged', detail: '   ',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  // The governed function persists no monetary fields, so the transport offers
  // none. Accepting money here would collect it and throw it away.
  it('accepts no monetary evidence for price_mismatch', async () => {
    await post(`/api/receiving/orders/RV-ACQ-AAA111/discrepancies`, 'operator-token', {
      workspaceId: WS_A, kind: 'price_mismatch', detail: 'Charged more than the listing',
      expectedValueMinor: 1000, actualValueMinor: 1500, currency: 'USD',
    });
    const args = rpcCalls[0].args;
    expect(Object.keys(args).sort()).toEqual([
      'p_detail', 'p_kind', 'p_order_public_id', 'p_quantity_expected',
      'p_quantity_observed', 'p_receipt_line_public_id', 'p_receipt_public_id', 'p_workspace_id',
    ]);
  });

  it('lets an operator claim', async () => {
    const { status } = await post(
      `/api/receiving/discrepancies/RV-ADISC-AAA111/transition`, 'operator-token', {
        workspaceId: WS_A, target: 'claimed',
      });
    expect(status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      fn: 'transition_acquisition_discrepancy',
      args: {
        p_workspace_id: WS_A,
        p_discrepancy_public_id: 'RV-ADISC-AAA111',
        p_target: 'claimed',
        p_resolution_note: null,
      },
    });
  });

  it.each(['resolved', 'written_off'] as const)('refuses an operator %s BEFORE any database call', async (target) => {
    const { status } = await post(
      `/api/receiving/discrepancies/RV-ADISC-AAA111/transition`, 'operator-token', {
        workspaceId: WS_A, target, resolutionNote: 'Supplier credited the difference',
      });
    expect(status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it.each(['resolved', 'written_off'] as const)('lets an owner %s with a required note', async (target) => {
    await post(`/api/receiving/discrepancies/RV-ADISC-AAA111/transition`, 'owner-token', {
      workspaceId: WS_A, target, resolutionNote: 'Supplier credited the difference',
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_target: target,
      p_resolution_note: 'Supplier credited the difference',
    });
  });

  it.each(['resolved', 'written_off'] as const)('refuses %s with no note', async (target) => {
    const { status } = await post(`/api/receiving/discrepancies/RV-ADISC-AAA111/transition`, 'owner-token', {
      workspaceId: WS_A, target, resolutionNote: '',
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a transition back to open', async () => {
    const { status } = await post(`/api/receiving/discrepancies/RV-ADISC-AAA111/transition`, 'owner-token', {
      workspaceId: WS_A, target: 'open',
    });
    expect(status).toBe(409);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('Batch 2 authorization', () => {
  it.each([
    ['link inventory', '/api/receiving/receipt-lines/RV-ARL-AAA111/links'],
    ['unlink inventory', '/api/receiving/inventory-links/RV-ARIL-AAA111/unlink'],
    ['raise a discrepancy', '/api/receiving/orders/RV-ACQ-AAA111/discrepancies'],
    ['transition a discrepancy', '/api/receiving/discrepancies/RV-ADISC-AAA111/transition'],
    ['reconcile', '/api/receiving/receipts/RV-ARCPT-AAA111/reconcile'],
  ])('refuses a viewer trying to %s', async (_label, path) => {
    const { status } = await post(path, 'viewer-token', { workspaceId: WS_A });
    expect(status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a member of a different workspace', async () => {
    expect((await get(
      `/api/receiving/inventory-subjects?workspaceId=${WS_A}`, 'other-ws-token')).status).toBe(403);
  });
});

describe('Batch 2 governed refusals keep their meaning', () => {
  it.each([
    ['inventory_link_over_capacity', 409],
    ['inventory_link_incomplete', 409],
    ['inventory_link_not_found', 404],
    ['inventory_subject_not_found', 404],
    ['discrepancy_not_found', 404],
    ['discrepancy_evidence_immutable', 409],
    ['invalid_transition', 409],
    ['receipt_not_submitted', 409],
  ])('maps %s to %i', async (code, expected) => {
    rpcFailure = `prefix ${code} suffix`;
    const { status, body } = await post(
      `/api/receiving/receipts/RV-ARCPT-AAA111/reconcile`, 'owner-token', { workspaceId: WS_A });
    expect(status).toBe(expected);
    expect(body.error).toBe(code);
  });

  it('never exposes a constraint or table name from a Batch 2 failure', async () => {
    rpcFailure =
      'duplicate key value violates unique constraint "acquisition_receipt_line_inventory_links_inventory_item_id_key"';
    const { status, body } = await post(
      `/api/receiving/receipt-lines/RV-ARL-AAA111/links`, 'operator-token', {
        workspaceId: WS_A, inventoryItemPublicId: 'RV-IITM-AAA111',
      });
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toMatch(/constraint|unique|acquisition_receipt_line_inventory_links/i);
  });
});

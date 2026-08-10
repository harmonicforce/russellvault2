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

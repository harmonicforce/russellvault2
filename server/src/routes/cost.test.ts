// S2.5 Batch 1 cost allocation route tests.
//
// These prove the things a reviewer cannot verify by reading:
//   * the two gates (availability, then authentication/authorization);
//   * that a viewer is refused every mutation;
//   * that the browser can NEVER supply an internal UUID — a request carrying
//     one is refused, and a governed public identity is resolved server-side
//     under the caller's own JWT before any UUID reaches the database;
//   * that each route calls the governed function it claims to, with the
//     argument names that function actually declares — a typo in
//     `p_expected_total_minor` would silently disable the count contract;
//   * that money crosses the wire as exact decimal strings, never as floats;
//   * that a non-conserving proposal is refused BEFORE it becomes durable,
//     because the governed contract cannot undo one;
//   * that every governed refusal keeps its meaning instead of collapsing
//     into a 500;
//   * that NO internal UUID reaches the browser, asserted over whole response
//     bodies rather than field by field.
//
// A fake Supabase client stands in for the shadow project, exactly as the
// receiving route tests do, so these run without Docker.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';
import { containsInternalId } from '../cost/contract.js';

const { default: costRouter } = await import('./cost.js');

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
const LOT_ONE = '22222222-2222-2222-2222-222222222222';
const LOT_TWO = '2222bbbb-2222-2222-2222-222222222222';
const LINE_A = '33333333-3333-3333-3333-333333333333';
const LINE_B = '44444444-4444-4444-4444-444444444444';
const LINE_OUTSIDE = '55555555-5555-5555-5555-555555555555';

const SHARED_ORDER_COMPONENT = '66666666-6666-6666-6666-666666666666';
const LOT_COMPONENT = '77777777-7777-7777-7777-777777777777';
const DIRECT_COMPONENT = '88888888-8888-8888-8888-888888888888';
const UNKNOWN_COMPONENT = '99999999-9999-9999-9999-999999999999';
const PROPOSED_COMPONENT = 'aaaa1111-1111-1111-1111-111111111111';

const COMPONENT_ROWS = [
  {
    id: SHARED_ORDER_COMPONENT, public_id: 'RV-ACOST-SHIP01', component_type: 'shipping',
    amount_state: 'known', amount_minor: 1000, currency: 'USD', attribution_state: 'unresolved',
    evidence_note: null, line_item_id: null, lot_id: null, order_id: ORDER_ID,
    reversed_at: null, reverses_id: null, created_at: '2026-08-10T10:00:00.000Z',
  },
  {
    id: LOT_COMPONENT, public_id: 'RV-ACOST-LOTFEE', component_type: 'fee',
    amount_state: 'known', amount_minor: 300, currency: 'USD', attribution_state: 'unresolved',
    evidence_note: null, line_item_id: null, lot_id: LOT_ONE, order_id: null,
    reversed_at: null, reverses_id: null, created_at: '2026-08-10T09:00:00.000Z',
  },
  {
    id: DIRECT_COMPONENT, public_id: 'RV-ACOST-PRICEA', component_type: 'item_price',
    amount_state: 'known', amount_minor: 900, currency: 'USD', attribution_state: 'direct',
    evidence_note: null, line_item_id: LINE_A, lot_id: null, order_id: null,
    reversed_at: null, reverses_id: null, created_at: '2026-08-10T08:00:00.000Z',
  },
  {
    id: UNKNOWN_COMPONENT, public_id: 'RV-ACOST-TAXUNK', component_type: 'tax',
    amount_state: 'unknown', amount_minor: null, currency: 'USD', attribution_state: 'unresolved',
    evidence_note: 'Source never reported tax', line_item_id: null, lot_id: null, order_id: ORDER_ID,
    reversed_at: null, reverses_id: null, created_at: '2026-08-10T07:00:00.000Z',
  },
  {
    id: PROPOSED_COMPONENT, public_id: 'RV-ACOST-PROPOS', component_type: 'shipping',
    amount_state: 'known', amount_minor: 1000, currency: 'USD', attribution_state: 'unresolved',
    evidence_note: null, line_item_id: null, lot_id: null, order_id: ORDER_ID,
    reversed_at: null, reverses_id: null, created_at: '2026-08-10T06:00:00.000Z',
  },
];

const ALLOCATION_ROWS = [
  {
    id: 'bbbb2222-2222-2222-2222-222222222222', public_id: 'RV-ACALLOC-AAA111',
    cost_component_id: PROPOSED_COMPONENT, line_item_id: LINE_A, amount_minor: 600,
    method: 'manual_quantity', state: 'candidate', reviewed_at: null, reversed_at: null,
    created_at: '2026-08-10T11:00:00.000Z',
  },
  {
    id: 'cccc3333-3333-3333-3333-333333333333', public_id: 'RV-ACALLOC-BBB222',
    cost_component_id: PROPOSED_COMPONENT, line_item_id: LINE_B, amount_minor: 400,
    method: 'manual_quantity', state: 'candidate', reviewed_at: null, reversed_at: null,
    created_at: '2026-08-10T11:00:00.000Z',
  },
];

const LOT_ROWS = [
  { id: LOT_ONE, public_id: 'RV-ALOT-AAA111', order_id: ORDER_ID },
  { id: LOT_TWO, public_id: 'RV-ALOT-BBB222', order_id: ORDER_ID },
];

const LOT_LINE_ROWS = [
  { lot_id: LOT_ONE, line_item_id: LINE_A, state: 'active' },
  { lot_id: LOT_TWO, line_item_id: LINE_B, state: 'active' },
];

const ORDER_ROWS = [{
  id: ORDER_ID, public_id: 'RV-ACQ-AAA111', source_order_reference: 'WN-ORDER-1',
  order_status: 'completed', occurred_at: '2026-08-01T00:00:00.000Z',
}];

const LINE_ROWS = [
  {
    acquisition_line_item_id: LINE_A, acquisition_line_public_id: 'RV-AL-AAA111',
    source_system_public_id: 'RV-SS-WHATNOT', quantity: 3, description: 'Card lot A',
    full_title: 'Vintage card lot A', delivered_item_title: 'Card lot A',
    exclusion_state: 'included', acquisition_order_id: ORDER_ID,
    acquisition_order_public_id: 'RV-ACQ-AAA111',
  },
  {
    acquisition_line_item_id: LINE_B, acquisition_line_public_id: 'RV-AL-BBB222',
    source_system_public_id: 'RV-SS-WHATNOT', quantity: 1, description: null,
    full_title: null, delivered_item_title: null, exclusion_state: 'included',
    acquisition_order_id: ORDER_ID, acquisition_order_public_id: 'RV-ACQ-AAA111',
  },
  // A line on a DIFFERENT order. It shares a source system, and its public id
  // is the shape a caller could plausibly guess.
  {
    acquisition_line_item_id: LINE_OUTSIDE, acquisition_line_public_id: 'RV-AL-OUTSID',
    source_system_public_id: 'RV-SS-WHATNOT', quantity: 5, description: 'Elsewhere',
    full_title: null, delivered_item_title: null, exclusion_state: 'included',
    acquisition_order_id: 'dddd4444-4444-4444-4444-444444444444',
    acquisition_order_public_id: 'RV-ACQ-OTHER1',
  },
];

/** Set by a test to make the next rpc call fail with a governed refusal. */
let rpcFailure: string | null = null;
/** Every rpc call the router made, for exact-argument assertions. */
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function makeFakeClient(token: string) {
  const identity = TOKENS[token];

  function rowsFor(
    table: string,
    filters: Record<string, string>,
    inFilters: Record<string, readonly string[]>,
  ): unknown[] {
    if (table === 'workspace_members') {
      const role = identity?.memberships[filters.workspace_id];
      return role ? [{ role }] : [];
    }
    // RLS: a caller only ever sees their own workspace's rows.
    if (filters.workspace_id !== WS_A) return [];

    const narrow = <T extends Record<string, unknown>>(rows: readonly T[]): T[] =>
      rows.filter((row) => {
        for (const [column, value] of Object.entries(filters)) {
          if (column === 'workspace_id') continue;
          if (String(row[column] ?? '') !== value) return false;
        }
        for (const [column, values] of Object.entries(inFilters)) {
          if (!values.includes(String(row[column] ?? ''))) return false;
        }
        return true;
      });

    if (table === 'acquisition_cost_components') return narrow(COMPONENT_ROWS);
    if (table === 'acquisition_cost_allocations') return narrow(ALLOCATION_ROWS);
    if (table === 'acquisition_lots') return narrow(LOT_ROWS);
    if (table === 'acquisition_lot_lines') return narrow(LOT_LINE_ROWS);
    if (table === 'acquisition_orders') return narrow(ORDER_ROWS);
    if (table === 'acquisition_line_overview') return narrow(LINE_ROWS);
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
      const inFilters: Record<string, readonly string[]> = {};
      const result = () => ({ data: rowsFor(table, filters, inFilters), error: null, count: 0 });
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => { filters[col] = val; return q; },
        in: (col: string, vals: readonly string[]) => { inFilters[col] = vals; return q; },
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
      if (fn === 'propose_cost_allocation') {
        return { data: { proposed: (args.p_allocations as unknown[]).length }, error: null };
      }
      if (fn === 'confirm_cost_allocation') {
        return { data: { confirmed: 2, total_minor: 1000 }, error: null };
      }
      if (fn === 'reverse_cost_allocation') {
        return { data: { reversed: 2 }, error: null };
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
  app.use('/api/cost', costRouter);
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

const ws = (path: string) => `${path}${path.includes('?') ? '&' : '?'}workspaceId=${WS_A}`;
const component = (publicId: string) => `/api/cost/components/${publicId}`;

// --- gates -------------------------------------------------------------------

describe('availability gate', () => {
  it('404s the whole surface when the governed deployment is not configured', async () => {
    const saved = process.env.SHADOW_IMPORT;
    delete process.env.SHADOW_IMPORT;
    try {
      expect((await get(ws('/api/cost/queue'), 'owner-token')).status).toBe(404);
    } finally {
      process.env.SHADOW_IMPORT = saved;
    }
  });
});

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await get(ws('/api/cost/queue'))).status).toBe(401);
  });

  it('refuses a non-member', async () => {
    expect((await get(ws('/api/cost/queue'), 'stranger-token')).status).toBe(403);
  });

  it('refuses a member of a DIFFERENT workspace asking about this one', async () => {
    expect((await get(ws('/api/cost/queue'), 'other-ws-token')).status).toBe(403);
  });

  it('lets a viewer read', async () => {
    expect((await get(ws('/api/cost/queue'), 'viewer-token')).status).toBe(200);
    expect((await get(ws(component('RV-ACOST-SHIP01')), 'viewer-token')).status).toBe(200);
  });

  it.each([
    ['preview', `${component('RV-ACOST-SHIP01')}/allocation-preview`, { method: 'manual_equal' }],
    ['propose', `${component('RV-ACOST-SHIP01')}/allocations`, {
      method: 'manual_equal',
      allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' }],
    }],
    ['confirm', `${component('RV-ACOST-PROPOS')}/allocations/confirm`, { expectedTotalMinor: '1000' }],
    ['reverse', `${component('RV-ACOST-PROPOS')}/allocations/reverse`, { reason: 'Wrong split' }],
  ])('refuses a viewer the %s mutation', async (_label, path, body) => {
    const response = await post(ws(path), 'viewer-token', { ...(body as object), workspaceId: WS_A });
    expect(response.status).toBe(403);
    // Refused before any governed call happened.
    expect(rpcCalls).toHaveLength(0);
  });
});

// --- the queue ---------------------------------------------------------------

describe('the cost queue', () => {
  it('states its coverage, its completeness and the caller role', async () => {
    const { status, body } = await get(ws('/api/cost/queue'), 'owner-token');
    expect(status).toBe(200);
    expect(body.coverage).toBe('governed_native_committed');
    expect(body.historicalLegacyImported).toBe(false);
    expect(body.complete).toBe(true);
    expect(body.role).toBe('owner');
  });

  it('never leaks an internal identifier', async () => {
    const { body } = await get(ws('/api/cost/queue'), 'owner-token');
    expect(containsInternalId(body)).toBe(false);
  });

  it('reports every component, with where each one stands', async () => {
    const { body } = await get(ws('/api/cost/queue'), 'owner-token');
    const byId = Object.fromEntries(
      body.rows.map((row: { componentPublicId: string }) => [row.componentPublicId, row]));
    expect(byId['RV-ACOST-SHIP01'].workflowState).toBe('awaiting_proposal');
    expect(byId['RV-ACOST-PRICEA'].workflowState).toBe('directly_attributed');
    expect(byId['RV-ACOST-TAXUNK'].workflowState).toBe('amount_not_known');
    expect(byId['RV-ACOST-PROPOS'].workflowState).toBe('proposed_awaiting_confirmation');
  });

  // THE TRUTH RULE, AT THE TRANSPORT BOUNDARY. An unknown cost is not free.
  it('sends NO figure at all for a component whose amount was never reported', async () => {
    const { body } = await get(ws('/api/cost/queue'), 'owner-token');
    const unknown = body.rows.find(
      (row: { componentPublicId: string }) => row.componentPublicId === 'RV-ACOST-TAXUNK');
    expect(unknown.amount).toEqual({ state: 'unknown', currency: 'USD' });
    expect(JSON.stringify(unknown.amount)).not.toMatch(/0/);
  });

  it('carries every amount as a decimal string, never as a JSON number', async () => {
    const { body } = await get(ws('/api/cost/queue'), 'owner-token');
    expect(JSON.stringify(body)).not.toMatch(/"minor":\s*[0-9]/);
    const shipping = body.rows.find(
      (row: { componentPublicId: string }) => row.componentPublicId === 'RV-ACOST-SHIP01');
    expect(shipping.amount).toEqual({ state: 'known', minor: '1000', currency: 'USD' });
  });

  it('offers the closed method vocabulary with a description for each', async () => {
    const { body } = await get(ws('/api/cost/queue'), 'owner-token');
    expect(body.methods.map((entry: { method: string }) => entry.method))
      .toEqual(['manual_equal', 'manual_quantity', 'manual_value', 'manual_custom']);
    for (const entry of body.methods) expect(entry.description).toMatch(/\S/);
  });
});

// --- one component -----------------------------------------------------------

describe('one component', () => {
  it('404s a component the caller cannot read, without saying whether it exists', async () => {
    const { status, body } = await get(ws(component('RV-ACOST-NOSUCH')), 'owner-token');
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'cost_component_not_found' });
  });

  it('shows an ORDER-scoped component the lines from every lot under the order', async () => {
    const { body } = await get(ws(component('RV-ACOST-SHIP01')), 'owner-token');
    expect(body.component.scopeLines.map((line: { acquisitionLinePublicId: string }) =>
      line.acquisitionLinePublicId)).toEqual(['RV-AL-AAA111', 'RV-AL-BBB222']);
    expect(containsInternalId(body)).toBe(false);
  });

  it('shows a LOT-scoped component only that lot’s lines', async () => {
    const { body } = await get(ws(component('RV-ACOST-LOTFEE')), 'owner-token');
    expect(body.component.scopeLines.map((line: { acquisitionLinePublicId: string }) =>
      line.acquisitionLinePublicId)).toEqual(['RV-AL-AAA111']);
    expect(body.component.lotPublicId).toBe('RV-ALOT-AAA111');
  });

  it('carries a line’s already-known direct cost, and distinguishes none from zero', async () => {
    const { body } = await get(ws(component('RV-ACOST-SHIP01')), 'owner-token');
    const lines = body.component.scopeLines as { acquisitionLinePublicId: string; knownDirectCostMinor: string | null }[];
    expect(lines.find((l) => l.acquisitionLinePublicId === 'RV-AL-AAA111')?.knownDirectCostMinor).toBe('900');
    // Line B has no direct cost component at all. That is not a zero.
    expect(lines.find((l) => l.acquisitionLinePublicId === 'RV-AL-BBB222')?.knownDirectCostMinor).toBeNull();
  });

  it('states candidate conservation exactly, in strings', async () => {
    const { body } = await get(ws(component('RV-ACOST-PROPOS')), 'owner-token');
    expect(body.component.candidateTotalMinor).toBe('1000');
    expect(body.component.conservationDeltaMinor).toBe('0');
    expect(body.component.allocations.map((row: { allocationPublicId: string }) =>
      row.allocationPublicId)).toEqual(['RV-ACALLOC-AAA111', 'RV-ACALLOC-BBB222']);
  });

  it('names allocation targets by governed public identity, never by UUID', async () => {
    const { body } = await get(ws(component('RV-ACOST-PROPOS')), 'owner-token');
    expect(body.component.allocations[0].acquisitionLinePublicId).toBe('RV-AL-AAA111');
    expect(body.component.allocations[0].sourceSystemPublicId).toBe('RV-SS-WHATNOT');
    expect(containsInternalId(body)).toBe(false);
  });
});

// --- preview -----------------------------------------------------------------

describe('the preview computes what the owner will confirm, and writes nothing', () => {
  it('returns an exact, conserving split without calling any governed function', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocation-preview`), 'owner-token',
      { workspaceId: WS_A, method: 'manual_quantity' });
    expect(status).toBe(200);
    // Quantities are 3 and 1, so 1000 splits 750 / 250 exactly.
    expect(body.shares.map((share: { amountMinor: string }) => share.amountMinor))
      .toEqual(['750', '250']);
    expect(body.totalMinor).toBe('1000');
    expect(body.wrote).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it('conserves an awkward total to the minor unit', async () => {
    const { body } = await post(
      ws(`${component('RV-ACOST-LOTFEE')}/allocation-preview`), 'owner-token',
      { workspaceId: WS_A, method: 'manual_equal' });
    const sum = body.shares.reduce(
      (total: bigint, share: { amountMinor: string }) => total + BigInt(share.amountMinor), 0n);
    expect(sum).toBe(300n);
  });

  it('refuses to preview a split of an amount that was never reported', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-TAXUNK')}/allocation-preview`), 'owner-token',
      { workspaceId: WS_A, method: 'manual_equal' });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'amount_not_known' });
  });

  // THE ANTI-FABRICATION CASE, END TO END.
  it('refuses a value split when no line in scope has a known direct cost', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocation-preview`), 'owner-token',
      {
        workspaceId: WS_A,
        method: 'manual_value',
        // Only line B, which has no direct cost component at all.
        lines: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222' }],
      });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'no_value_basis' });
  });

  it('honours an explicit line selection', async () => {
    const { body } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocation-preview`), 'owner-token',
      {
        workspaceId: WS_A,
        method: 'manual_equal',
        lines: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111' }],
      });
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0].amountMinor).toBe('1000');
  });

  // A line the browser names that is not in scope is REFUSED, not dropped.
  // Silently ignoring it would split across a set the owner did not choose.
  it('refuses a selection naming a line outside the governed scope', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocation-preview`), 'owner-token',
      {
        workspaceId: WS_A,
        method: 'manual_equal',
        lines: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-OUTSID' }],
      });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'line_outside_component_scope' });
  });

  it('refuses an invented method', async () => {
    const { status } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocation-preview`), 'owner-token',
      { workspaceId: WS_A, method: 'split_however_i_like' });
    expect(status).toBe(400);
  });
});

// --- propose -----------------------------------------------------------------

describe('proposing a split', () => {
  const propose = (over: Record<string, unknown> = {}) => post(
    ws(`${component('RV-ACOST-SHIP01')}/allocations`), 'owner-token',
    {
      workspaceId: WS_A,
      method: 'manual_quantity',
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750' },
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '250' },
      ],
      ...over,
    });

  it('calls the governed function with the arguments it declares', async () => {
    const { status, body } = await propose();
    expect(status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('propose_cost_allocation');
    expect(Object.keys(rpcCalls[0].args).sort())
      .toEqual(['p_allocations', 'p_cost_component_id', 'p_method']);
    expect(rpcCalls[0].args.p_method).toBe('manual_quantity');
    expect(body.proposed).toBe(2);
  });

  // The browser sent public identities; the server resolved them.
  it('resolves source-qualified public identity to line UUIDs server-side', async () => {
    await propose();
    expect(rpcCalls[0].args.p_cost_component_id).toBe(SHARED_ORDER_COMPONENT);
    expect(rpcCalls[0].args.p_allocations).toEqual([
      { line_item_id: LINE_A, amount_minor: '750' },
      { line_item_id: LINE_B, amount_minor: '250' },
    ]);
  });

  // Every amount reaches the database as a string, so nothing passes through a
  // float on the way.
  it('sends amounts as decimal strings', async () => {
    await propose();
    for (const entry of rpcCalls[0].args.p_allocations as { amount_minor: unknown }[]) {
      expect(typeof entry.amount_minor).toBe('string');
    }
  });

  it('tells the client there is no safe resend', async () => {
    const { body } = await propose();
    expect(body.replayable).toBe(false);
  });

  // THE DEAD-END GUARD. A non-conserving proposal can never be confirmed, never
  // be reversed, and never be replaced, so it must never be written.
  it('refuses a proposal that does not conserve the component total', async () => {
    const { status, body } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750' },
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '100' },
      ],
    });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'proposal_would_not_conserve' });
    // And nothing durable happened.
    expect(rpcCalls).toHaveLength(0);
  });

  // The guard quotes the database's tolerance and never tightens it: a set the
  // database would accept must not be refused here.
  it('accepts a proposal off by exactly one minor unit, as the database does', async () => {
    const { status } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750' },
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '251' },
      ],
    });
    expect(status).toBe(200);
  });

  // THE NO-RAW-UUID RULE, PROVED AT THE DOOR.
  it('refuses a request that supplies a line UUID instead of a public identity', async () => {
    const { status } = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ lineItemId: LINE_A, amountMinor: '1000' }],
      });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a component named by UUID rather than by RV-ACOST public identity', async () => {
    const { status } = await post(
      ws(`/api/cost/components/${SHARED_ORDER_COMPONENT}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' }],
      });
    expect(status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a target outside the component’s governed scope', async () => {
    const { status, body } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-OUTSID', amountMinor: '1000' },
      ],
    });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'line_outside_component_scope' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a target whose source system does not match its line', async () => {
    const { status, body } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-EBAY', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' },
      ],
    });
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'acquisition_line_not_found' });
  });

  it('refuses the same line twice in one proposal', async () => {
    const { status } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '500' },
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '500' },
      ],
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['a fractional amount', '750.5'],
    ['an exponent', '7.5e2'],
    ['a formatted amount', '1,000'],
    ['an empty amount', ''],
    ['a float', 750.5],
  ])('refuses %s', async (_label, amountMinor) => {
    const { status } = await propose({
      allocations: [
        { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor },
      ],
    });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses an empty proposal', async () => {
    expect((await propose({ allocations: [] })).status).toBe(400);
  });

  it('refuses to propose against an amount that was never reported', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-TAXUNK')}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '0' }],
      });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'amount_not_known' });
    expect(rpcCalls).toHaveLength(0);
  });
});

// --- confirm -----------------------------------------------------------------

describe('confirming a proposal', () => {
  it('sends the total the owner was shown, as the count contract requires', async () => {
    const { status, body } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/confirm`), 'owner-token',
      { workspaceId: WS_A, expectedTotalMinor: '1000' });
    expect(status).toBe(200);
    expect(rpcCalls[0].fn).toBe('confirm_cost_allocation');
    expect(Object.keys(rpcCalls[0].args).sort())
      .toEqual(['p_cost_component_id', 'p_expected_total_minor']);
    expect(rpcCalls[0].args.p_expected_total_minor).toBe('1000');
    expect(body.confirmed).toBe(2);
  });

  it('refuses to confirm without an expected total', async () => {
    const { status } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/confirm`), 'owner-token',
      { workspaceId: WS_A });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('passes a stale-total refusal through with its meaning intact', async () => {
    rpcFailure = 'expected allocation total 900 but candidates sum to 1000';
    const { status, body } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/confirm`), 'owner-token',
      { workspaceId: WS_A, expectedTotalMinor: '900' });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'expected_total_mismatch' });
  });

  it('passes a conservation refusal through with its meaning intact', async () => {
    rpcFailure = 'candidate allocations sum to 1000 but the component amount is 1200';
    const { status, body } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/confirm`), 'owner-token',
      { workspaceId: WS_A, expectedTotalMinor: '1000' });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'allocation_does_not_conserve' });
  });
});

// --- reverse -----------------------------------------------------------------

describe('reversing a confirmed allocation', () => {
  it('requires a reason, and records it', async () => {
    const { status } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/reverse`), 'owner-token',
      { workspaceId: WS_A, reason: 'Shipping was billed to the wrong order' });
    expect(status).toBe(200);
    expect(rpcCalls[0].fn).toBe('reverse_cost_allocation');
    expect(rpcCalls[0].args.p_reason).toBe('Shipping was billed to the wrong order');
  });

  it('refuses a reversal with no account of why', async () => {
    const { status } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/reverse`), 'owner-token',
      { workspaceId: WS_A });
    expect(status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('passes "nothing to reverse" through as a refusal, not a silent success', async () => {
    rpcFailure = 'cost component has no confirmed allocation to reverse';
    const { status, body } = await post(
      ws(`${component('RV-ACOST-PROPOS')}/allocations/reverse`), 'owner-token',
      { workspaceId: WS_A, reason: 'Wrong split' });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'nothing_to_reverse' });
  });
});

// --- what this surface deliberately does NOT expose ---------------------------

describe('the surface stops where the slice stops', () => {
  // `reverse_cost_component` exists and is grantable. Exposing a governed
  // function merely because it exists is how a surface grows powers nobody
  // asked for; correcting a component's own facts is not part of this slice.
  it('never calls reverse_cost_component', async () => {
    await post(ws(`${component('RV-ACOST-PROPOS')}/allocations/reverse`), 'owner-token',
      { workspaceId: WS_A, reason: 'Wrong split' });
    expect(rpcCalls.map((call) => call.fn)).not.toContain('reverse_cost_component');
  });

  it('has no route that would reach it', async () => {
    for (const path of [
      `${component('RV-ACOST-PROPOS')}/reverse`,
      `${component('RV-ACOST-PROPOS')}/correct`,
      `${component('RV-ACOST-PROPOS')}/amount`,
    ]) {
      expect((await post(ws(path), 'owner-token', { workspaceId: WS_A })).status).toBe(404);
    }
  });
});

// --- governed refusals keep their meaning end to end -------------------------

describe('governed refusals arrive as themselves, not as a 500', () => {
  it.each([
    ['cost component already has pending candidate allocations', 409, 'proposal_already_pending'],
    ['cost component already has a confirmed allocation; reverse it first', 409, 'allocation_already_confirmed'],
    ['a directly-attributed cost component cannot be allocated', 409, 'component_directly_attributed'],
    ['cost component not found or not authorized', 404, 'cost_component_not_found'],
  ])('%s', async (message, status, code) => {
    rpcFailure = message;
    const response = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' }],
      });
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: code });
  });

  it('reports a missing migration as a configuration answer', async () => {
    rpcFailure = 'Could not find the function public.propose_cost_allocation in the schema cache';
    const response = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' }],
      });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'cost_contract_missing' });
  });

  it('never returns the database’s own sentence', async () => {
    rpcFailure = 'permission denied for relation acquisition_cost_components_secret';
    const response = await post(
      ws(`${component('RV-ACOST-SHIP01')}/allocations`), 'owner-token',
      {
        workspaceId: WS_A, method: 'manual_equal',
        allocations: [{ sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '1000' }],
      });
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toMatch(/permission denied|_secret/);
  });
});

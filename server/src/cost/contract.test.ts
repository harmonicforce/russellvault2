// The governed cost allocation contract, tested as pure logic.
//
// WHAT THESE PROVE THAT READING CANNOT
//
//   * the split arithmetic conserves EXACTLY — every minor unit is accounted
//     for, including the awkward ones, and including negative totals;
//   * the same inputs always produce the same split, so two previews of one
//     thing agree;
//   * a strategy with no basis REFUSES instead of quietly falling back to an
//     even split wearing a "proportional to value" label;
//   * no amount is ever a float where it is authoritative;
//   * every refusal phrase this transport matches on is present VERBATIM in the
//     governed migration, so a reworded message fails here rather than
//     degrading silently into a generic 502.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOCATION_METHODS,
  ALLOCATION_METHOD_DESCRIPTION,
  COST_REFUSALS,
  amountOf,
  buildComponentDetail,
  buildCostQueue,
  classifyCostError,
  computeSplit,
  conserves,
  containsInternalId,
  isAllocationMethod,
  knownDirectCostByLine,
  largestRemainder,
  parseMinor,
  proposalAllowed,
  scopeLineIdsOf,
  splittableTotal,
  workflowStateOf,
  type AcquisitionLineRow,
  type AcquisitionLotLineRow,
  type AcquisitionLotRow,
  type AcquisitionOrderRow,
  type CostAllocationRow,
  type CostComponentRow,
  type ScopeLine,
} from './contract.js';

/**
 * Concatenate adjacent SQL string literals the way Postgres does.
 *
 * `'first part '\n  'second part'` is ONE literal to the parser, so the message
 * a caller actually receives has no break in it. Matching against raw source
 * would fail on exactly the longest, most specific messages — the ones most
 * worth pinning.
 */
function joinWrappedLiterals(sql: string): string {
  return sql.replace(/'[ \t]*\r?\n[ \t]*'/g, '');
}

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const LOT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_LOT_ID = '2222bbbb-2222-2222-2222-222222222222';
const LINE_A = '33333333-3333-3333-3333-333333333333';
const LINE_B = '44444444-4444-4444-4444-444444444444';
const LINE_C = '55555555-5555-5555-5555-555555555555';
const COMPONENT_ID = '66666666-6666-6666-6666-666666666666';

function component(over: Partial<CostComponentRow> = {}): CostComponentRow {
  return {
    id: COMPONENT_ID,
    public_id: 'RV-ACOST-AAA111',
    component_type: 'shipping',
    amount_state: 'known',
    amount_minor: 1000,
    currency: 'USD',
    attribution_state: 'unresolved',
    evidence_note: null,
    line_item_id: null,
    lot_id: null,
    order_id: ORDER_ID,
    reversed_at: null,
    reverses_id: null,
    created_at: '2026-08-10T10:00:00.000Z',
    ...over,
  };
}

function scopeLine(over: Partial<ScopeLine> = {}): ScopeLine {
  return {
    sourceSystemPublicId: 'RV-SS-WHATNOT',
    acquisitionLinePublicId: 'RV-AL-A',
    title: 'A card',
    quantity: 1,
    exclusionState: 'included',
    lotPublicId: 'RV-ALOT-AAA111',
    knownDirectCostMinor: null,
    ...over,
  };
}

// --- money -------------------------------------------------------------------

describe('amounts are exact, and absent amounts are never zero', () => {
  it('carries a known amount as a decimal string of minor units', () => {
    expect(amountOf(component({ amount_minor: 12345 })))
      .toEqual({ state: 'known', minor: '12345', currency: 'USD' });
  });

  // THE LOAD-BEARING TRUTH RULE. An unknown cost is not a free one.
  it('reports an unknown amount with NO figure at all', () => {
    const amount = amountOf(component({ amount_state: 'unknown', amount_minor: null }));
    expect(amount).toEqual({ state: 'unknown', currency: 'USD' });
    expect(JSON.stringify(amount)).not.toMatch(/"minor"/);
    expect(splittableTotal(amount)).toBeNull();
  });

  it('reports a documented free amount as a real, evidenced zero', () => {
    expect(amountOf(component({ amount_state: 'documented_free', amount_minor: 0 })))
      .toEqual({ state: 'documented_free', minor: '0', currency: 'USD' });
  });

  // A documented zero is a FACT, but it is not a total anyone can split.
  it('refuses to treat a documented free zero as a splittable total', () => {
    expect(splittableTotal(amountOf(component({ amount_state: 'documented_free', amount_minor: 0 }))))
      .toBeNull();
  });

  // Rather than rounding a figure and passing it off as the real one.
  it('admits when a stored figure cannot be carried exactly', () => {
    const amount = amountOf(component({ amount_minor: Number.MAX_SAFE_INTEGER + 2 }));
    expect(amount.state).toBe('unrepresentable');
    expect(JSON.stringify(amount)).not.toMatch(/[0-9]{10}/);
  });
});

describe('parsing a caller-supplied minor amount', () => {
  it.each([
    ['0', 0n], ['1', 1n], ['-250', -250n], ['999999999999999999999', 999999999999999999999n],
  ])('accepts the canonical integer string %s', (input, expected) => {
    expect(parseMinor(input)).toBe(expected);
  });

  it.each(['', ' ', '1.0', '1.5', '+1', '01', '1e3', '1,000', 'ten', '1 000', null, undefined, {}, true])(
    'refuses %p', (input) => { expect(parseMinor(input)).toBeNull(); },
  );

  // A float that is already an exact integer is fine; one that is not is a
  // quantity the ledger does not have.
  it('accepts an exact integer number but never a fractional one', () => {
    expect(parseMinor(42)).toBe(42n);
    expect(parseMinor(42.5)).toBeNull();
    expect(parseMinor(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });
});

// --- the split arithmetic ----------------------------------------------------

describe('largest-remainder distribution conserves exactly', () => {
  // The classic case independent rounding gets wrong: 1000 / 3.
  it('accounts for every minor unit when the split does not divide evenly', () => {
    const shares = largestRemainder(1000n, [1n, 1n, 1n]);
    expect(shares).toEqual([334n, 333n, 333n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  it('conserves across a large, lopsided weighting', () => {
    const weights = [7n, 11n, 13n, 1n, 1n];
    const shares = largestRemainder(100_003n, weights);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100_003n);
  });

  // A discount is a real component and its effect is negative. The remainder
  // must still land on the largest fractional parts, not wherever truncation
  // toward zero happens to put it.
  it('conserves a negative total', () => {
    const shares = largestRemainder(-1000n, [1n, 1n, 1n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(-1000n);
    expect(shares).toEqual([-334n, -333n, -333n]);
  });

  it('gives nothing to a zero weight and everything to the rest', () => {
    const shares = largestRemainder(100n, [0n, 1n, 1n]);
    expect(shares[0]).toBe(0n);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it('returns all zeroes rather than dividing by zero when nothing has weight', () => {
    expect(largestRemainder(100n, [0n, 0n])).toEqual([0n, 0n]);
  });

  // Determinism. A split that varies between two previews of the same thing is
  // not a split anyone can review.
  it('produces the same split every time for the same inputs', () => {
    const once = largestRemainder(1_000_001n, [3n, 3n, 3n, 3n, 3n, 3n, 3n]);
    for (let i = 0; i < 25; i += 1) {
      expect(largestRemainder(1_000_001n, [3n, 3n, 3n, 3n, 3n, 3n, 3n])).toEqual(once);
    }
  });

  // Exhaustive over a range wide enough to catch an off-by-one in the leftover
  // loop, which is exactly the bug that would create a permanently stuck
  // proposal.
  it('conserves for every total from -300 to 300 across several weightings', () => {
    for (const weights of [[1n, 1n, 1n], [1n, 2n, 3n], [5n, 1n], [7n], [1n, 1n, 1n, 1n, 1n, 1n, 1n]]) {
      for (let total = -300; total <= 300; total += 1) {
        const shares = largestRemainder(BigInt(total), weights);
        expect(shares.reduce((a, b) => a + b, 0n)).toBe(BigInt(total));
        expect(shares).toHaveLength(weights.length);
      }
    }
  });
});

describe('the split strategies', () => {
  const lines = [
    scopeLine({ acquisitionLinePublicId: 'RV-AL-A', quantity: 1, knownDirectCostMinor: '900' }),
    scopeLine({ acquisitionLinePublicId: 'RV-AL-B', quantity: 2, knownDirectCostMinor: '100' }),
    scopeLine({ acquisitionLinePublicId: 'RV-AL-C', quantity: 7, knownDirectCostMinor: null }),
  ];

  it('splits evenly, remainder first', () => {
    const outcome = computeSplit({ method: 'manual_equal', total: 1000n, lines });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shares.map((s) => s.amountMinor)).toEqual(['334', '333', '333']);
  });

  it('splits in proportion to acquired quantity', () => {
    const outcome = computeSplit({ method: 'manual_quantity', total: 1000n, lines });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 1 : 2 : 7 of 1000 → 100 : 200 : 700, exactly.
    expect(outcome.shares.map((s) => s.amountMinor)).toEqual(['100', '200', '700']);
    expect(outcome.shares.map((s) => s.weight)).toEqual(['1', '2', '7']);
  });

  it('splits in proportion to already-known direct cost, giving nothing to a line with none', () => {
    const outcome = computeSplit({ method: 'manual_value', total: 1000n, lines });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shares.map((s) => s.amountMinor)).toEqual(['900', '100', '0']);
  });

  // THE ANTI-FABRICATION CASE.
  //
  // No line has a known direct cost, so there is no value basis. Falling back
  // to an even split would produce figures that LOOK derived from value and are
  // not — a fabricated basis wearing a truthful label, recorded permanently as
  // `manual_value`.
  it('refuses a value split when no line has a known direct cost', () => {
    const outcome = computeSplit({
      method: 'manual_value',
      total: 1000n,
      lines: lines.map((line) => ({ ...line, knownDirectCostMinor: null })),
    });
    expect(outcome).toEqual({ ok: false, code: 'no_value_basis' });
  });

  it('refuses a quantity split when every line has zero quantity', () => {
    const outcome = computeSplit({
      method: 'manual_quantity', total: 1000n,
      lines: lines.map((line) => ({ ...line, quantity: 0 })),
    });
    expect(outcome).toEqual({ ok: false, code: 'no_weight_basis' });
  });

  it('refuses to compute a hand-entered split, because there is nothing to compute', () => {
    expect(computeSplit({ method: 'manual_custom', total: 1000n, lines }))
      .toEqual({ ok: false, code: 'method_not_computable' });
  });

  it('refuses when the governed scope is empty', () => {
    expect(computeSplit({ method: 'manual_equal', total: 1000n, lines: [] }))
      .toEqual({ ok: false, code: 'no_lines_in_scope' });
  });

  // Whatever the strategy, the result adds up. This is the property that keeps
  // an operator out of the permanently-stuck state.
  it('always produces a set that conserves the total', () => {
    for (const method of ['manual_equal', 'manual_quantity', 'manual_value'] as const) {
      for (const total of [1n, 7n, 99n, 100n, 1000n, 123457n, -1000n]) {
        const outcome = computeSplit({ method, total, lines });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) continue;
        const sum = outcome.shares.reduce<bigint>((a, s) => a + BigInt(s.amountMinor), 0n);
        expect(sum).toBe(total);
        expect(conserves(total, outcome.shares.map((s) => BigInt(s.amountMinor)))).toBe(true);
      }
    }
  });

  it('emits amounts as strings, never as numbers', () => {
    const outcome = computeSplit({ method: 'manual_equal', total: 1000n, lines });
    if (!outcome.ok) throw new Error('expected a split');
    expect(JSON.stringify(outcome)).not.toMatch(/"amountMinor":\s*[0-9]/);
  });

  it('offers a description for every method it offers', () => {
    for (const method of ALLOCATION_METHODS) {
      expect(ALLOCATION_METHOD_DESCRIPTION[method]).toMatch(/\S/);
      expect(isAllocationMethod(method)).toBe(true);
    }
    expect(isAllocationMethod('whatever_i_like')).toBe(false);
  });
});

describe('the conservation guard quotes the database tolerance, never tightens it', () => {
  it('accepts a set that is off by exactly one minor unit', () => {
    expect(conserves(1000n, [500n, 501n])).toBe(true);
    expect(conserves(1000n, [500n, 499n])).toBe(true);
  });

  it('refuses a set that is off by two', () => {
    expect(conserves(1000n, [500n, 502n])).toBe(false);
    expect(conserves(1000n, [500n, 498n])).toBe(false);
  });
});

// --- the workflow fold -------------------------------------------------------

describe('the allocation workflow state is a fold over governed facts', () => {
  it.each([
    ['direct attribution', component({ attribution_state: 'direct', line_item_id: LINE_A, order_id: null }), 0, 'directly_attributed'],
    ['a shared component with no proposal', component(), 0, 'awaiting_proposal'],
    ['a shared component with candidates', component(), 2, 'proposed_awaiting_confirmation'],
    ['a confirmed allocation', component({ attribution_state: 'allocated' }), 0, 'allocated'],
    ['an unknown amount', component({ amount_state: 'unknown', amount_minor: null }), 0, 'amount_not_known'],
    ['a documented free amount', component({ amount_state: 'documented_free', amount_minor: 0 }), 0, 'amount_not_known'],
    ['a reversed component', component({ reversed_at: '2026-08-10T12:00:00.000Z' }), 0, 'component_reversed'],
  ])('reads %s as %s', (_label, row, candidates, expected) => {
    expect(workflowStateOf(row as CostComponentRow, candidates as number)).toBe(expected);
  });

  it('permits a proposal only when the component is genuinely awaiting one', () => {
    expect(proposalAllowed('awaiting_proposal')).toBe(true);
    for (const state of [
      'directly_attributed', 'proposed_awaiting_confirmation', 'allocated',
      'amount_not_known', 'component_reversed',
    ] as const) {
      expect(proposalAllowed(state)).toBe(false);
    }
  });
});

// --- scope -------------------------------------------------------------------

const LOTS: AcquisitionLotRow[] = [
  { id: LOT_ID, public_id: 'RV-ALOT-AAA111', order_id: ORDER_ID },
  { id: OTHER_LOT_ID, public_id: 'RV-ALOT-BBB222', order_id: ORDER_ID },
];

const LOT_LINES: AcquisitionLotLineRow[] = [
  { lot_id: LOT_ID, line_item_id: LINE_A, state: 'active' },
  { lot_id: OTHER_LOT_ID, line_item_id: LINE_B, state: 'active' },
  // Superseded placements are history and are not in anybody's scope.
  { lot_id: LOT_ID, line_item_id: LINE_C, state: 'superseded' },
];

describe('the governed allocation scope mirrors what the database will accept', () => {
  it('scopes a LOT component to that lot only', () => {
    const scope = scopeLineIdsOf(component({ lot_id: LOT_ID, order_id: null }), LOTS, LOT_LINES);
    expect([...scope.keys()]).toEqual([LINE_A]);
    expect(scope.get(LINE_A)).toBe('RV-ALOT-AAA111');
  });

  it('scopes an ORDER component to every lot under the order', () => {
    const scope = scopeLineIdsOf(component(), LOTS, LOT_LINES);
    expect(new Set(scope.keys())).toEqual(new Set([LINE_A, LINE_B]));
  });

  it('excludes a superseded placement', () => {
    const scope = scopeLineIdsOf(component(), LOTS, LOT_LINES);
    expect(scope.has(LINE_C)).toBe(false);
  });

  it('gives a DIRECT component an empty scope, because it has nothing to split across', () => {
    const scope = scopeLineIdsOf(
      component({ line_item_id: LINE_A, lot_id: null, order_id: null }), LOTS, LOT_LINES);
    expect(scope.size).toBe(0);
  });
});

describe('known direct cost per line', () => {
  it('sums only known, non-reversed, directly-attributed components', () => {
    const totals = knownDirectCostByLine([
      component({ id: 'c1', line_item_id: LINE_A, order_id: null, attribution_state: 'direct', amount_minor: 700 }),
      component({ id: 'c2', line_item_id: LINE_A, order_id: null, attribution_state: 'direct', amount_minor: 300 }),
      // Reversed: history, not a live cost.
      component({ id: 'c3', line_item_id: LINE_A, order_id: null, amount_minor: 5000, reversed_at: '2026-08-10T00:00:00.000Z' }),
      // Unknown: contributes nothing, and is NOT zero.
      component({ id: 'c4', line_item_id: LINE_B, order_id: null, amount_state: 'unknown', amount_minor: null }),
      // Order-scoped: not a direct cost of any line.
      component({ id: 'c5' }),
    ]);
    expect(totals.get(LINE_A)).toBe(1000n);
    // The distinction the whole surface rests on: no entry, not an entry of 0.
    expect(totals.has(LINE_B)).toBe(false);
  });
});

// --- assembly ----------------------------------------------------------------

const ORDERS: AcquisitionOrderRow[] = [{
  id: ORDER_ID, public_id: 'RV-ACQ-AAA111', source_order_reference: 'WN-ORDER-1',
  order_status: 'completed', occurred_at: '2026-08-01T00:00:00.000Z',
}];

const LINES: AcquisitionLineRow[] = [
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
    full_title: null, delivered_item_title: null,
    exclusion_state: 'included', acquisition_order_id: ORDER_ID,
    acquisition_order_public_id: 'RV-ACQ-AAA111',
  },
];

const ALLOCATIONS: CostAllocationRow[] = [
  {
    id: '77777777-7777-7777-7777-777777777777', public_id: 'RV-ACALLOC-AAA111',
    cost_component_id: COMPONENT_ID, line_item_id: LINE_A, amount_minor: 600,
    method: 'manual_quantity', state: 'candidate', reviewed_at: null, reversed_at: null,
    created_at: '2026-08-10T11:00:00.000Z',
  },
  {
    id: '88888888-8888-8888-8888-888888888888', public_id: 'RV-ACALLOC-BBB222',
    cost_component_id: COMPONENT_ID, line_item_id: LINE_B, amount_minor: 400,
    method: 'manual_quantity', state: 'candidate', reviewed_at: null, reversed_at: null,
    created_at: '2026-08-10T11:00:00.000Z',
  },
];

describe('assembly', () => {
  it('never emits an internal identifier', () => {
    const detail = buildComponentDetail({
      component: component(), allocations: ALLOCATIONS, lots: LOTS, lotLines: LOT_LINES,
      orders: ORDERS, lines: LINES, scopeComponents: [component()],
    });
    expect(containsInternalId(detail)).toBe(false);
    expect(containsInternalId(buildCostQueue({
      components: [component()], allocations: ALLOCATIONS, lots: LOTS, orders: ORDERS, lines: LINES,
    }))).toBe(false);
  });

  it('states candidate conservation in exact integer arithmetic', () => {
    const detail = buildComponentDetail({
      component: component(), allocations: ALLOCATIONS, lots: LOTS, lotLines: LOT_LINES,
      orders: ORDERS, lines: LINES, scopeComponents: [component()],
    });
    expect(detail.candidateTotalMinor).toBe('1000');
    expect(detail.conservationDeltaMinor).toBe('0');
    expect(detail.workflowState).toBe('proposed_awaiting_confirmation');
    expect(detail.candidateCount).toBe(2);
  });

  it('reports a non-conserving proposal with its exact signed difference', () => {
    const detail = buildComponentDetail({
      component: component({ amount_minor: 1200 }), allocations: ALLOCATIONS, lots: LOTS,
      lotLines: LOT_LINES, orders: ORDERS, lines: LINES, scopeComponents: [component()],
    });
    expect(detail.conservationDeltaMinor).toBe('-200');
  });

  // A total missing one of its terms is not a total.
  it('withholds the candidate total when a candidate amount cannot be carried exactly', () => {
    const detail = buildComponentDetail({
      component: component(),
      allocations: [{ ...ALLOCATIONS[0], amount_minor: Number.MAX_SAFE_INTEGER + 2 }],
      lots: LOTS, lotLines: LOT_LINES, orders: ORDERS, lines: LINES, scopeComponents: [component()],
    });
    expect(detail.candidateTotalMinor).toBe('');
    expect(detail.conservationDeltaMinor).toBeNull();
  });

  it('has no conservation delta at all when there is no amount to conserve against', () => {
    const detail = buildComponentDetail({
      component: component({ amount_state: 'unknown', amount_minor: null }),
      allocations: [], lots: LOTS, lotLines: LOT_LINES, orders: ORDERS, lines: LINES,
      scopeComponents: [],
    });
    expect(detail.conservationDeltaMinor).toBeNull();
    expect(detail.workflowState).toBe('amount_not_known');
  });

  it('resolves the order for a lot-scoped component through its lot', () => {
    const detail = buildComponentDetail({
      component: component({ lot_id: LOT_ID, order_id: null }), allocations: [], lots: LOTS,
      lotLines: LOT_LINES, orders: ORDERS, lines: LINES, scopeComponents: [],
    });
    expect(detail.orderPublicId).toBe('RV-ACQ-AAA111');
    expect(detail.lotPublicId).toBe('RV-ALOT-AAA111');
    expect(detail.scopeKind).toBe('lot');
  });

  it('orders the queue totally and stably', () => {
    const rows = buildCostQueue({
      components: [
        component({ id: 'a', public_id: 'RV-ACOST-BBB222', created_at: '2026-08-10T10:00:00.000Z' }),
        component({ id: 'b', public_id: 'RV-ACOST-AAA111', created_at: '2026-08-10T10:00:00.000Z' }),
        component({ id: 'c', public_id: 'RV-ACOST-CCC333', created_at: '2026-08-11T10:00:00.000Z' }),
      ],
      allocations: [], lots: LOTS, orders: ORDERS, lines: LINES,
    });
    expect(rows.map((row) => row.componentPublicId))
      .toEqual(['RV-ACOST-CCC333', 'RV-ACOST-AAA111', 'RV-ACOST-BBB222']);
  });
});

// --- the refusal vocabulary --------------------------------------------------

describe('governed refusals keep their meaning', () => {
  it.each([
    ['cost component not found or not authorized', 'cost_component_not_found', 404],
    ['a directly-attributed cost component cannot be allocated', 'component_directly_attributed', 409],
    ['cost component already has a confirmed allocation; reverse it first', 'allocation_already_confirmed', 409],
    ['cost component has been reversed and cannot be allocated', 'component_reversed', 409],
    ['cost component already has pending candidate allocations', 'proposal_already_pending', 409],
    ['cost component has no candidate allocations to confirm', 'no_candidates_to_confirm', 409],
    ['cost component has no confirmed allocation to reverse', 'nothing_to_reverse', 409],
    ['expected allocation total 900 but candidates sum to 1000', 'expected_total_mismatch', 409],
    ['candidate allocations sum to 1000 but the component amount is 1200', 'allocation_does_not_conserve', 409],
    ['2 allocation line(s) reference a line item outside this cost component\'s scope', 'line_outside_component_scope', 409],
    ['batch contains line item x more than once; each line item may appear at most once per allocation proposal', 'duplicate_line_in_proposal', 409],
    ['method must be a lowercase identifier', 'invalid_request', 400],
    ['batch of 3000 exceeds the maximum of 2000 rows', 'batch_too_large', 400],
    ['authentication required', 'unauthorized_workspace', 403],
  ])('classifies %s', (message, code, status) => {
    expect(classifyCostError({ message })).toEqual({ code, status });
  });

  it('reports a missing migration as a configuration answer, not a request failure', () => {
    expect(classifyCostError({ message: 'Could not find the function public.propose_cost_allocation' }))
      .toEqual({ code: 'cost_contract_missing', status: 503 });
  });

  // Never the database's own sentence.
  it('does not leak an unrecognised database message', () => {
    const failure = classifyCostError({ message: 'relation "secret_table" does not exist' });
    expect(failure).toEqual({ code: 'dependency_failed', status: 502 });
    expect(JSON.stringify(failure)).not.toMatch(/secret_table/);
  });

  /**
   * THE ANTI-DRIFT TEST.
   *
   * Every phrase this transport matches on must actually be in the governed
   * migration. If a future migration rewords one, this fails here rather than
   * the refusal silently degrading into a generic 502 — which is the failure
   * that matters, because "this component already has a pending proposal" and
   * "the database is unreachable" need completely different actions.
   *
   * `authentication required` is excluded because it is raised by
   * `app.require_uid` in a different migration, and is asserted separately.
   *
   * The migration text is normalised first: plpgsql wraps a long message across
   * source lines as adjacent string literals, which Postgres concatenates
   * before it raises. The RUNTIME message is therefore contiguous even though
   * the source is not, so the source is joined the same way before matching.
   */
  it('matches only phrases that are present verbatim in the governed migration', () => {
    const migration = joinWrappedLiterals(readFileSync(
      fileURLToPath(new URL(
        '../../../supabase/migrations/20260720000400_acquisition_functions.sql', import.meta.url)),
      'utf8'));
    const elsewhere = new Set(['authentication required', 'exceeds the maximum of']);
    for (const refusal of COST_REFUSALS) {
      if (elsewhere.has(refusal.phrase)) continue;
      expect(migration, `phrase not found in migration: ${refusal.phrase}`)
        .toContain(refusal.phrase);
    }
  });

  it('finds the two externally-raised phrases in their own migrations', () => {
    const provenance = readFileSync(
      fileURLToPath(new URL(
        '../../../supabase/migrations/20260719000900_provenance_functions.sql', import.meta.url)),
      'utf8');
    const workflow = readFileSync(
      fileURLToPath(new URL(
        '../../../supabase/migrations/20260719001000_provenance_import_workflow.sql', import.meta.url)),
      'utf8');
    expect(provenance).toContain('authentication required');
    expect(workflow).toContain('exceeds the maximum of');
  });
});

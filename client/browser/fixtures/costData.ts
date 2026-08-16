// Recorded governed cost allocation contract shapes for the browser gate.
//
// These mirror what `/api/cost/queue`, `/api/cost/components/:id` and the three
// mutation routes actually return, field for field. That precision is not
// pedantry: a fixture that does not match the server tests the fixture, and a
// plausible-but-wrong payload makes the page crash in a way that looks exactly
// like an application defect.
//
// The world here is STATEFUL on purpose. Proposing, confirming and reversing
// mutate it, so the browser suite proves the real workflow — press, governed
// refresh, changed page — rather than proving that a static payload renders.
//
// IT ALSO ENFORCES THE GOVERNED REFUSALS, not just the happy path. Proposing
// while candidates exist is refused with `proposal_already_pending`; confirming
// against a stale total is refused with `expected_total_mismatch`; reversing
// something that is not allocated is refused with `nothing_to_reverse`. A
// fixture that always says yes would let the browser gate pass over a UI that
// cannot handle a no.
//
// EVERY AMOUNT IS A DECIMAL STRING OF MINOR UNITS, exactly as the transport
// carries them. Nothing in this file is a floating point amount.

export const COST_SOURCE_SYSTEM = 'RV-SRC-WHATNOT';
export const COST_ORDER = 'RV-ACQ-000001';
export const COST_LOT = 'RV-ALOT-000001';

/** The shared, unresolved shipping charge the whole spec works against. */
export const SHIPPING_COMPONENT = 'RV-ACOST-SHIP01';
/** A cost the source never priced. It must never render as zero. */
export const UNKNOWN_COMPONENT = 'RV-ACOST-TAX001';
/** A cost that belongs wholly to one line. Nothing to split. */
export const DIRECT_COMPONENT = 'RV-ACOST-PRC001';

export interface BrowserAmount {
  state: 'known' | 'documented_free' | 'unknown' | 'unrepresentable';
  minor?: string;
  currency: string;
}

export interface BrowserScopeLine {
  sourceSystemPublicId: string;
  acquisitionLinePublicId: string;
  title: string | null;
  quantity: number;
  exclusionState: 'included' | 'excluded';
  lotPublicId: string;
  knownDirectCostMinor: string | null;
}

export interface BrowserAllocation {
  allocationPublicId: string;
  sourceSystemPublicId: string | null;
  acquisitionLinePublicId: string | null;
  amountMinor: string;
  method: string;
  /** `withdrawn` arrived with S2.4.1. Terminal, and history-preserving. */
  state: 'candidate' | 'confirmed' | 'reversed' | 'withdrawn';
  reviewedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
}

const BASIS_METHODS = [
  {
    method: 'fifo',
    description:
      'First-in, first-out layering. An ACCOUNTING CONVENTION for ordering cost layers within a '
      + 'lot — it does not assert which physical unit arrived first, and it is not evidence of item '
      + 'movement.',
  },
  {
    method: 'source_observed_specific',
    description: 'The source reported a cost for this specific unit, and that reported figure was used directly.',
  },
  {
    method: 'deterministic_equal_attribution',
    description:
      'The line’s cost was attributed equally across its units by a deterministic rule, because the '
      + 'source did not report a per-unit figure. It is a stated convention, not an observation.',
  },
  {
    method: 'unresolved',
    description:
      'The governed recompute could not establish a cost for this unit. There is no figure, and a '
      + 'figure must not be inferred for it.',
  },
];

const METHODS = [
  {
    method: 'manual_equal',
    description:
      'Split evenly across the selected lines. Every line receives the same share, and any '
      + 'indivisible remainder is given out one minor unit at a time.',
  },
  {
    method: 'manual_quantity',
    description:
      'Split in proportion to each line’s acquired quantity, as recorded on the acquisition line.',
  },
  {
    method: 'manual_value',
    description:
      'Split in proportion to each line’s already-known direct cost. Lines with no known direct '
      + 'cost receive nothing, and the split is refused entirely if no line has one.',
  },
  {
    method: 'manual_custom',
    description:
      'Each amount was entered by hand. Nothing was computed; the figures are exactly what was typed.',
  },
];

/**
 * The lines the shipping charge is spread over.
 *
 * Line A has a known direct cost and line B has NONE. That asymmetry is
 * deliberate: it is what makes a value-weighted split meaningful, and it is
 * what a screen has to render as "None recorded" rather than as `0.00`.
 */
function baseScopeLines(): BrowserScopeLine[] {
  return [
    {
      sourceSystemPublicId: COST_SOURCE_SYSTEM,
      acquisitionLinePublicId: 'RV-AL-000001',
      title: 'Vintage card lot, mixed condition',
      quantity: 3,
      exclusionState: 'included',
      lotPublicId: COST_LOT,
      knownDirectCostMinor: '9000',
    },
    {
      sourceSystemPublicId: COST_SOURCE_SYSTEM,
      acquisitionLinePublicId: 'RV-AL-000002',
      title: 'Sealed booster box',
      quantity: 1,
      exclusionState: 'included',
      lotPublicId: COST_LOT,
      knownDirectCostMinor: null,
    },
  ];
}

/** Exact integer largest-remainder distribution, matching the server. */
function largestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  const weightSum = weights.reduce<bigint>((sum, weight) => sum + weight, 0n);
  if (weightSum <= 0n) return weights.map(() => 0n);
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const floors = weights.map((weight) => (magnitude * weight) / weightSum);
  let leftover = magnitude - floors.reduce<bigint>((sum, share) => sum + share, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (magnitude * weight) % weightSum }))
    .sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : (b.remainder > a.remainder ? 1 : -1)));
  const shares = [...floors];
  for (const entry of order) {
    if (leftover <= 0n) break;
    shares[entry.index] += 1n;
    leftover -= 1n;
  }
  return negative ? shares.map((share) => -share) : shares;
}

export class CostWorld {
  /** The shipping component's amount, in minor units. */
  readonly totalMinor = '1000';
  readonly currency = 'USD';
  scopeLines: BrowserScopeLine[] = baseScopeLines();
  allocations: BrowserAllocation[] = [];
  attribution: 'unresolved' | 'allocated' = 'unresolved';
  private nextAllocationId = 0;

  reset(): void {
    this.scopeLines = baseScopeLines();
    this.allocations = [];
    this.attribution = 'unresolved';
    this.nextAllocationId = 0;
  }

  private candidates(): BrowserAllocation[] {
    return this.allocations.filter((row) => row.state === 'candidate');
  }

  private candidateTotal(): bigint {
    return this.candidates().reduce<bigint>((sum, row) => sum + BigInt(row.amountMinor), 0n);
  }

  workflowState(): string {
    if (this.attribution === 'allocated') return 'allocated';
    return this.candidates().length > 0 ? 'proposed_awaiting_confirmation' : 'awaiting_proposal';
  }

  /** The split the server would compute, without writing anything. */
  preview(method: string, lines: readonly { acquisitionLinePublicId: string }[] | undefined) {
    const chosen = lines
      ? this.scopeLines.filter((line) =>
        lines.some((entry) => entry.acquisitionLinePublicId === line.acquisitionLinePublicId))
      : this.scopeLines;
    if (chosen.length === 0) return { error: 'no_lines_in_scope' as const };
    if (method === 'manual_custom') return { error: 'method_not_computable' as const };

    const weights = chosen.map((line) => {
      if (method === 'manual_equal') return 1n;
      if (method === 'manual_quantity') return BigInt(line.quantity);
      return line.knownDirectCostMinor === null ? 0n : BigInt(line.knownDirectCostMinor);
    });
    if (weights.every((weight) => weight <= 0n)) {
      return { error: method === 'manual_value' ? ('no_value_basis' as const) : ('no_weight_basis' as const) };
    }

    const shares = largestRemainder(BigInt(this.totalMinor), weights);
    return {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      method,
      description: METHODS.find((entry) => entry.method === method)?.description ?? '',
      componentPublicId: SHIPPING_COMPONENT,
      totalMinor: this.totalMinor,
      currency: this.currency,
      shares: chosen.map((line, index) => ({
        sourceSystemPublicId: line.sourceSystemPublicId,
        acquisitionLinePublicId: line.acquisitionLinePublicId,
        amountMinor: shares[index].toString(),
        weight: weights[index].toString(),
      })),
      wrote: false,
    };
  }

  /**
   * Propose, with the governed refusals the real function raises.
   *
   * There is deliberately no way to withdraw what this writes, exactly as in
   * the database. A spec that wanted to undo a proposal would have to reset the
   * world, which is the point.
   */
  propose(method: string, allocations: readonly { acquisitionLinePublicId: string; sourceSystemPublicId: string; amountMinor: string }[]) {
    if (this.attribution === 'allocated') return { error: 'allocation_already_confirmed' as const };
    if (this.candidates().length > 0) return { error: 'proposal_already_pending' as const };
    for (const entry of allocations) {
      if (!this.scopeLines.some((line) =>
        line.acquisitionLinePublicId === entry.acquisitionLinePublicId
        && line.sourceSystemPublicId === entry.sourceSystemPublicId)) {
        return { error: 'line_outside_component_scope' as const };
      }
    }
    for (const entry of allocations) {
      this.nextAllocationId += 1;
      this.allocations.push({
        allocationPublicId: `RV-ACALLOC-${String(this.nextAllocationId).padStart(6, '0')}`,
        sourceSystemPublicId: entry.sourceSystemPublicId,
        acquisitionLinePublicId: entry.acquisitionLinePublicId,
        amountMinor: entry.amountMinor,
        method,
        state: 'candidate',
        reviewedAt: null,
        reversedAt: null,
        createdAt: '2026-08-10T11:00:00.000Z',
      });
    }
    return {
      componentPublicId: SHIPPING_COMPONENT,
      method,
      proposed: allocations.length,
      totalMinor: allocations
        .reduce<bigint>((sum, entry) => sum + BigInt(entry.amountMinor), 0n).toString(),
      replayable: false,
    };
  }

  /** Confirm, enforcing the count contract and conservation as the database does. */
  confirm(expectedTotalMinor: string) {
    const candidates = this.candidates();
    if (candidates.length === 0) return { error: 'no_candidates_to_confirm' as const };
    const sum = this.candidateTotal();
    const expected = BigInt(expectedTotalMinor);
    const off = (value: bigint) => (value < 0n ? -value : value);
    if (off(sum - expected) > 1n) return { error: 'expected_total_mismatch' as const };
    if (off(sum - BigInt(this.totalMinor)) > 1n) return { error: 'allocation_does_not_conserve' as const };
    for (const row of candidates) {
      row.state = 'confirmed';
      row.reviewedAt = '2026-08-10T12:00:00.000Z';
    }
    this.attribution = 'allocated';
    return {
      componentPublicId: SHIPPING_COMPONENT,
      confirmed: candidates.length,
      totalMinor: sum.toString(),
      replayable: false,
    };
  }

  /**
   * Withdraw, with the governed refusals the real function raises.
   *
   * Rows are RETAINED in the TERMINAL `withdrawn` state, exactly as
   * `withdraw_cost_allocation` retains them. Nothing here deletes anything, so
   * a spec asserting the rows survive is asserting the real semantics.
   */
  withdraw(reason: string) {
    if (!reason || reason.trim() === '') return { error: 'invalid_request' as const };
    const candidates = this.candidates();
    if (candidates.length === 0) return { error: 'nothing_to_withdraw' as const };
    for (const row of candidates) row.state = 'withdrawn';
    return { componentPublicId: SHIPPING_COMPONENT, withdrawn: candidates.length, replayable: false };
  }

  /** Reverse. Rows are RETAINED, exactly as the governed function retains them. */
  reverse() {
    if (this.attribution !== 'allocated') return { error: 'nothing_to_reverse' as const };
    const confirmed = this.allocations.filter((row) => row.state === 'confirmed');
    for (const row of confirmed) {
      row.state = 'reversed';
      row.reversedAt = '2026-08-10T13:00:00.000Z';
    }
    this.attribution = 'unresolved';
    return { componentPublicId: SHIPPING_COMPONENT, reversed: confirmed.length, replayable: false };
  }

  private shippingSummary() {
    return {
      componentPublicId: SHIPPING_COMPONENT,
      componentType: 'shipping',
      amount: { state: 'known', minor: this.totalMinor, currency: this.currency },
      attributionState: this.attribution,
      workflowState: this.workflowState(),
      scopeKind: 'order',
      orderPublicId: COST_ORDER,
      lotPublicId: null,
      directLinePublicId: null,
      evidenceNote: null,
      candidateCount: this.candidates().length,
      confirmedCount: this.allocations.filter((row) => row.state === 'confirmed').length,
      createdAt: '2026-08-10T10:00:00.000Z',
      isReversed: false,
    };
  }

  /** The other components, which never change. */
  private staticSummaries() {
    return [
      {
        componentPublicId: UNKNOWN_COMPONENT,
        componentType: 'tax',
        // NO `minor` field at all. The union has none for an unknown amount,
        // which is the type system enforcing that a screen cannot render one.
        amount: { state: 'unknown', currency: this.currency },
        attributionState: 'unresolved',
        workflowState: 'amount_not_known',
        scopeKind: 'order',
        orderPublicId: COST_ORDER,
        lotPublicId: null,
        directLinePublicId: null,
        evidenceNote: 'The source never reported a tax amount for this order.',
        candidateCount: 0,
        confirmedCount: 0,
        createdAt: '2026-08-10T09:00:00.000Z',
        isReversed: false,
      },
      {
        componentPublicId: DIRECT_COMPONENT,
        componentType: 'item_price',
        amount: { state: 'known', minor: '9000', currency: this.currency },
        attributionState: 'direct',
        workflowState: 'directly_attributed',
        scopeKind: 'line_item',
        orderPublicId: COST_ORDER,
        lotPublicId: null,
        directLinePublicId: 'RV-AL-000001',
        evidenceNote: null,
        candidateCount: 0,
        confirmedCount: 0,
        createdAt: '2026-08-10T08:00:00.000Z',
        isReversed: false,
      },
    ];
  }

  /**
   * The derived S2.4 basis for the two in-scope lines.
   *
   * Line A resolves in USD. Line B carries BOTH a resolved EUR unit and an
   * `unresolved` USD one — the case that proves currencies are never combined
   * and that an unresolved unit contributes no figure rather than a zero.
   */
  basisImpact(derived: boolean) {
    if (!derived) return { derived: false, lines: [] };
    return {
      derived: true,
      lines: [
        {
          sourceSystemPublicId: COST_SOURCE_SYSTEM,
          acquisitionLinePublicId: 'RV-AL-000001',
          title: 'Vintage card lot, mixed condition',
          subjects: [{ subjectKind: 'item', publicId: 'RV-IITM-000001' }],
          currencies: [{
            currency: 'USD', knownTotalMinor: '6600', resolvedUnitCount: 2,
            unresolvedUnitCount: 0, methods: ['fifo'],
          }],
          unresolved: null,
          algorithmVersion: '1.1.0',
          derivedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          sourceSystemPublicId: COST_SOURCE_SYSTEM,
          acquisitionLinePublicId: 'RV-AL-000002',
          title: 'Sealed booster box',
          subjects: [{ subjectKind: 'lot', publicId: 'RV-ILOT-000002' }],
          currencies: [
            {
              currency: 'EUR', knownTotalMinor: '500', resolvedUnitCount: 1,
              unresolvedUnitCount: 0, methods: ['deterministic_equal_attribution'],
            },
            {
              currency: 'USD', knownTotalMinor: null, resolvedUnitCount: 0,
              unresolvedUnitCount: 1, methods: ['unresolved'],
            },
          ],
          unresolved: {
            expectedQuantity: 1, reconciledQuantity: 2, pendingExpectedQuantity: 0,
            overageQuantity: 1, hasUnresolvedCostEvidence: true,
          },
          algorithmVersion: '1.1.0',
          derivedAt: '2026-08-15T10:00:00.000Z',
        },
      ],
    };
  }

  queue(role: 'owner' | 'operator' | 'viewer', complete: boolean) {
    return {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      complete,
      role,
      methods: METHODS,
      rows: [this.shippingSummary(), ...this.staticSummaries()],
    };
  }

  component(
    role: 'owner' | 'operator' | 'viewer',
    componentPublicId: string,
    basisDerived = true,
  ) {
    if (componentPublicId === SHIPPING_COMPONENT) {
      const candidateTotal = this.candidateTotal();
      return {
        coverage: 'governed_native_committed',
        historicalLegacyImported: false,
        role,
        methods: METHODS,
        basisMethods: BASIS_METHODS,
        basisImpact: this.basisImpact(basisDerived),
        component: {
          ...this.shippingSummary(),
          order: {
            publicId: COST_ORDER,
            sourceOrderReference: 'WN-ORDER-000001',
            orderStatus: 'completed',
            occurredAt: '2026-08-01T00:00:00.000Z',
          },
          scopeLines: this.scopeLines,
          allocations: this.allocations,
          candidateTotalMinor: candidateTotal.toString(),
          conservationDeltaMinor: (candidateTotal - BigInt(this.totalMinor)).toString(),
        },
      };
    }

    const summary = this.staticSummaries().find(
      (row) => row.componentPublicId === componentPublicId);
    if (!summary) return null;
    return {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      role,
      methods: METHODS,
      basisMethods: BASIS_METHODS,
      basisImpact: { derived: false, lines: [] },
      component: {
        ...summary,
        order: {
          publicId: COST_ORDER,
          sourceOrderReference: 'WN-ORDER-000001',
          orderStatus: 'completed',
          occurredAt: '2026-08-01T00:00:00.000Z',
        },
        scopeLines: summary.scopeKind === 'order' ? this.scopeLines : [],
        allocations: [],
        candidateTotalMinor: '0',
        // An unknown amount has NOTHING to conserve against, so there is no
        // delta. Sending `0` would be a fabricated agreement.
        conservationDeltaMinor: summary.amount.state === 'known' ? '-9000' : null,
      },
    };
  }
}

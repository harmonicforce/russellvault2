// S2.5 Batch 1 — the governed cost allocation contract.
//
// WHAT THIS MODULE IS
//
// Pure assembly and pure arithmetic. The governed cost machinery already
// exists: `propose_cost_allocation`, `confirm_cost_allocation` and
// `reverse_cost_allocation` are SECURITY DEFINER functions that own every
// allocation RULE, and this slice adds no SQL, no migration and no function.
// What is missing is an APPLICATION: the cost tables are readable, but nothing
// assembles them into a surface an owner can act on, and nothing computes a
// split the owner can see before it becomes durable.
//
// THE THREE FACTS, KEPT APART
//
//   COMPONENT AMOUNT   acquisition_cost_components.amount_minor — source
//                      evidence. Never recomputed, never adjusted to make a
//                      split come out even.
//   PROPOSED SPLIT     acquisition_cost_allocations rows in state 'candidate'.
//                      Durable, reviewable, and NOT yet a cost basis.
//   CONFIRMED BASIS    the same rows in state 'confirmed'. Only `confirm_cost_
//                      allocation` may create these, and only after the
//                      database has independently verified conservation.
//
// NOTHING HERE INVENTS AN AMOUNT. The split strategies below are deterministic
// arithmetic over figures the database returned: a component total, and per-line
// weights that are themselves governed facts (acquisition quantity, or already
// known direct cost). A strategy whose weights are all zero REFUSES rather than
// falling back to an even split, because an even split presented as
// "proportional to value" would be a fabricated basis wearing a truthful label.
//
// ALL MONEY IS INTEGER MINOR UNITS, CARRIED AS DECIMAL STRINGS. Every sum,
// share and remainder below is computed in `bigint`. No amount is ever a
// JavaScript floating point number at any point where it is authoritative, and
// no amount crosses the wire as one.
//
// NO INTERNAL UUID LEAVES THIS MODULE. Internal ids arrive as join keys, which
// is what they are for. Every assembled payload is built from governed public
// identities only, and `containsInternalId` exists so a test can prove that
// over whole responses rather than field by field.

// --- governed vocabularies, verbatim from the enums --------------------------

/** `public.cost_component_type`. */
export type CostComponentType = 'item_price' | 'shipping' | 'tax' | 'fee' | 'discount' | 'other';

export const COST_COMPONENT_TYPES: readonly CostComponentType[] = [
  'item_price', 'shipping', 'tax', 'fee', 'discount', 'other',
];

/** `public.cost_amount_state`. */
export type CostAmountState = 'known' | 'documented_free' | 'unknown';

/** `public.cost_attribution_state`. */
export type CostAttributionState = 'direct' | 'allocated' | 'unresolved';

/** `public.cost_allocation_state`. */
export type CostAllocationState = 'candidate' | 'confirmed' | 'reversed';

/**
 * The allocation methods this application offers.
 *
 * The database accepts any `^[a-z][a-z0-9_]{1,63}$` label and stores it
 * verbatim; it does not define a vocabulary. That freedom is a hazard, not a
 * feature: a method label is the durable record of HOW a cost basis was
 * decided, and a free-text label means the record can say anything, including
 * something no code ever implemented.
 *
 * So the application defines a CLOSED set, each member of which names a
 * strategy that exists in this file and produced the amounts that were sent.
 * The transport refuses anything outside it.
 */
export type AllocationMethod = 'manual_equal' | 'manual_quantity' | 'manual_value' | 'manual_custom';

export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  'manual_equal', 'manual_quantity', 'manual_value', 'manual_custom',
];

export function isAllocationMethod(value: unknown): value is AllocationMethod {
  return typeof value === 'string' && (ALLOCATION_METHODS as readonly string[]).includes(value);
}

/**
 * What each method claims about the split it produced.
 *
 * These sentences travel to the browser so the owner reads the SAME description
 * the server used when it computed, rather than a caption written separately
 * that can drift away from the arithmetic.
 */
export const ALLOCATION_METHOD_DESCRIPTION: Readonly<Record<AllocationMethod, string>> = {
  manual_equal:
    'Split evenly across the selected lines. Every line receives the same share, and any '
    + 'indivisible remainder is given out one minor unit at a time.',
  manual_quantity:
    'Split in proportion to each line’s acquired quantity, as recorded on the acquisition line.',
  manual_value:
    'Split in proportion to each line’s already-known direct cost. Lines with no known direct '
    + 'cost receive nothing, and the split is refused entirely if no line has one.',
  manual_custom:
    'Each amount was entered by hand. Nothing was computed; the figures are exactly what was typed.',
};

/**
 * The methods this server COMPUTES. `manual_custom` is absent because there is
 * nothing to compute — the operator supplied every figure themselves.
 */
export const COMPUTED_METHODS: readonly AllocationMethod[] = [
  'manual_equal', 'manual_quantity', 'manual_value',
];

// --- raw governed row shapes -------------------------------------------------
// These mirror the columns the route selects. They carry internal ids because
// those are the join keys; nothing below copies one into an output payload.

export interface CostComponentRow {
  readonly id: string;
  readonly public_id: string;
  readonly component_type: CostComponentType;
  readonly amount_state: CostAmountState;
  /**
   * `bigint` in the database, which PostgREST serialises as a JSON number. See
   * `amountOf` for how a value outside the exactly-representable range is
   * reported — it is never rounded and passed off as the real figure.
   */
  readonly amount_minor: number | null;
  readonly currency: string;
  readonly attribution_state: CostAttributionState;
  readonly evidence_note: string | null;
  /** Exactly one of these three is non-null; the schema enforces it. */
  readonly line_item_id: string | null;
  readonly lot_id: string | null;
  readonly order_id: string | null;
  readonly reversed_at: string | null;
  readonly reverses_id: string | null;
  readonly created_at: string;
}

export interface CostAllocationRow {
  readonly id: string;
  readonly public_id: string;
  readonly cost_component_id: string;
  readonly line_item_id: string;
  readonly amount_minor: number;
  readonly method: string;
  readonly state: CostAllocationState;
  readonly reviewed_at: string | null;
  readonly reversed_at: string | null;
  readonly created_at: string;
}

export interface AcquisitionLotRow {
  readonly id: string;
  readonly public_id: string;
  readonly order_id: string;
}

export interface AcquisitionLotLineRow {
  readonly lot_id: string;
  readonly line_item_id: string;
  readonly state: 'active' | 'superseded';
}

export interface AcquisitionOrderRow {
  readonly id: string;
  readonly public_id: string;
  readonly source_order_reference: string | null;
  readonly order_status: string | null;
  readonly occurred_at: string | null;
}

export interface AcquisitionLineRow {
  readonly acquisition_line_item_id: string;
  readonly acquisition_line_public_id: string;
  readonly source_system_public_id: string;
  readonly quantity: number;
  readonly description: string | null;
  readonly full_title: string | null;
  readonly delivered_item_title: string | null;
  readonly exclusion_state: 'included' | 'excluded';
  readonly acquisition_order_id: string | null;
  readonly acquisition_order_public_id: string | null;
}

// --- money -------------------------------------------------------------------

/**
 * A governed amount, as it crosses the wire.
 *
 * `known` and `documented_free` carry an exact decimal string of minor units.
 * `unknown` carries no figure at all, because the source never reported one and
 * printing `0` for it would be a fabricated cost.
 *
 * `unrepresentable` is not a governed state — the database has no such value.
 * It is this transport admitting that the figure the database holds is a
 * `bigint` outside the range JSON numbers preserve exactly, so it cannot be
 * carried without possibly changing it. Reporting the rounded number instead
 * would be the one thing this whole codebase exists not to do.
 */
export type Amount =
  | { readonly state: 'known'; readonly minor: string; readonly currency: string }
  | { readonly state: 'documented_free'; readonly minor: '0'; readonly currency: string }
  | { readonly state: 'unknown'; readonly currency: string }
  | { readonly state: 'unrepresentable'; readonly currency: string };

/** Is this a figure JSON carried without changing it? */
function exactlyRepresentable(value: number): boolean {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

export function amountOf(row: {
  readonly amount_state: CostAmountState;
  readonly amount_minor: number | null;
  readonly currency: string;
}): Amount {
  const currency = row.currency;
  if (row.amount_state === 'unknown' || row.amount_minor === null) {
    return { state: 'unknown', currency };
  }
  if (!exactlyRepresentable(row.amount_minor)) return { state: 'unrepresentable', currency };
  if (row.amount_state === 'documented_free') return { state: 'documented_free', minor: '0', currency };
  return { state: 'known', minor: String(row.amount_minor), currency };
}

/** The exact minor-unit total, or null when there is no figure to split. */
export function splittableTotal(amount: Amount): bigint | null {
  return amount.state === 'known' ? BigInt(amount.minor) : null;
}

/**
 * Parse a caller-supplied minor-unit amount.
 *
 * Accepts a canonical decimal integer string ONLY. No decimal point, no
 * exponent, no thousands separator, no leading `+`, no leading zeros, no
 * whitespace inside. A number is accepted only when it is already an exact
 * integer, because `12.5` minor units is not a quantity the ledger has.
 */
export function parseMinor(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return exactlyRepresentable(value) ? BigInt(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?(0|[1-9][0-9]{0,30})$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

// --- the allocation workflow fold --------------------------------------------

/**
 * Where a cost component stands in the allocation workflow.
 *
 * Every value is a fold over facts the database returned. There is deliberately
 * no "needs attention" or "overdue" state: nothing in the governed contract
 * establishes when a cost SHOULD have been allocated, and inventing a deadline
 * would be an opinion rendered in the same typeface as a fact.
 */
export type AllocationWorkflowState =
  /** Attribution is `direct`: the component belongs wholly to one line item. */
  | 'directly_attributed'
  /** Shared, unresolved, and no candidate rows exist. A proposal may be made. */
  | 'awaiting_proposal'
  /** Shared, unresolved, and candidate rows exist. Confirmation is the next step. */
  | 'proposed_awaiting_confirmation'
  /** A confirmed, conserving split exists. This is a cost basis. */
  | 'allocated'
  /** The amount is not `known`, so there is no total to split. */
  | 'amount_not_known'
  /** The component itself was reversed and superseded. */
  | 'component_reversed';

export function workflowStateOf(
  component: CostComponentRow,
  candidateCount: number,
): AllocationWorkflowState {
  // Order matters, and it matches the order the governed functions check in.
  // `reversed` is tested before `direct` because a reversed direct component is
  // history either way, and history is the more important thing to say.
  if (component.reversed_at !== null) return 'component_reversed';
  if (component.attribution_state === 'allocated') return 'allocated';
  if (component.attribution_state === 'direct') return 'directly_attributed';
  if (component.amount_state !== 'known' || component.amount_minor === null) return 'amount_not_known';
  return candidateCount > 0 ? 'proposed_awaiting_confirmation' : 'awaiting_proposal';
}

/**
 * May a proposal be made right now, as far as the facts we hold can tell?
 *
 * This is a fast, honest pre-answer, NOT the decision. `propose_cost_allocation`
 * re-proves all of it while holding a row lock, and its answer is the one that
 * counts.
 */
export function proposalAllowed(state: AllocationWorkflowState): boolean {
  return state === 'awaiting_proposal';
}

export function confirmationAllowed(state: AllocationWorkflowState): boolean {
  return state === 'proposed_awaiting_confirmation';
}

export function reversalAllowed(state: AllocationWorkflowState): boolean {
  return state === 'allocated';
}

// --- assembled payloads ------------------------------------------------------

/** A line item inside a component's governed allocation scope. */
export interface ScopeLine {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly title: string | null;
  readonly quantity: number;
  readonly exclusionState: 'included' | 'excluded';
  readonly lotPublicId: string;
  /**
   * The sum of this line's KNOWN, non-reversed, directly-attributed cost
   * components. Null when the line has none — which is not zero, and is why
   * `manual_value` refuses rather than treating it as one.
   */
  readonly knownDirectCostMinor: string | null;
}

export interface AllocationRecord {
  readonly allocationPublicId: string;
  readonly sourceSystemPublicId: string | null;
  readonly acquisitionLinePublicId: string | null;
  readonly amountMinor: string;
  readonly method: string;
  readonly state: CostAllocationState;
  readonly reviewedAt: string | null;
  readonly reversedAt: string | null;
  readonly createdAt: string;
}

export interface CostComponentSummary {
  readonly componentPublicId: string;
  readonly componentType: CostComponentType;
  readonly amount: Amount;
  readonly attributionState: CostAttributionState;
  readonly workflowState: AllocationWorkflowState;
  /** `line_item`, `lot` or `order` — which of the three scopes the schema set. */
  readonly scopeKind: 'line_item' | 'lot' | 'order';
  readonly orderPublicId: string | null;
  readonly lotPublicId: string | null;
  readonly directLinePublicId: string | null;
  readonly evidenceNote: string | null;
  readonly candidateCount: number;
  readonly confirmedCount: number;
  readonly createdAt: string;
  readonly isReversed: boolean;
}

export interface CostComponentDetail extends CostComponentSummary {
  readonly order: {
    readonly publicId: string;
    readonly sourceOrderReference: string | null;
    readonly orderStatus: string | null;
    readonly occurredAt: string | null;
  } | null;
  readonly scopeLines: readonly ScopeLine[];
  readonly allocations: readonly AllocationRecord[];
  /**
   * The exact sum of the CANDIDATE rows, and the component total they must
   * conserve. Both are strings, and the comparison the owner is shown is made
   * in `bigint` — never by subtracting two floats and looking at the sign.
   */
  readonly candidateTotalMinor: string;
  readonly conservationDeltaMinor: string | null;
}

// --- assembly ----------------------------------------------------------------

function titleOf(line: AcquisitionLineRow): string | null {
  return line.delivered_item_title ?? line.full_title ?? line.description ?? null;
}

function scopeKindOf(row: CostComponentRow): 'line_item' | 'lot' | 'order' {
  if (row.line_item_id !== null) return 'line_item';
  if (row.lot_id !== null) return 'lot';
  return 'order';
}

/**
 * The acquisition order a component hangs from, whichever of its three mutually
 * exclusive scopes the schema populated.
 *
 * An order-scoped component names its order directly. A lot-scoped one reaches
 * it through the lot. A line-scoped (direct) one reaches it through the line's
 * active placement. Any of those can come back null — a line with no active
 * placement genuinely belongs to no order — and null is returned rather than
 * guessed at.
 */
function orderIdOf(
  component: CostComponentRow,
  orderIdByLotId: ReadonlyMap<string, string>,
  lineById: ReadonlyMap<string, AcquisitionLineRow>,
): string | null {
  if (component.order_id !== null) return component.order_id;
  if (component.lot_id !== null) return orderIdByLotId.get(component.lot_id) ?? null;
  if (component.line_item_id !== null) {
    return lineById.get(component.line_item_id)?.acquisition_order_id ?? null;
  }
  return null;
}

/**
 * The line items inside one component's governed scope.
 *
 * This mirrors, exactly, the `exists` clause `propose_cost_allocation` uses:
 * an ACTIVE `acquisition_lot_lines` placement whose lot is either the
 * component's own lot, or any lot under the component's order. It is computed
 * here so the owner can be shown what they are splitting across BEFORE they
 * propose; the database re-proves it on the call, and disagreement is the
 * database's to win.
 */
export function scopeLineIdsOf(
  component: CostComponentRow,
  lots: readonly AcquisitionLotRow[],
  lotLines: readonly AcquisitionLotLineRow[],
): ReadonlyMap<string, string> {
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const inScope = new Map<string, string>();
  for (const placement of lotLines) {
    if (placement.state !== 'active') continue;
    const lot = lotById.get(placement.lot_id);
    if (!lot) continue;
    const matches =
      component.lot_id !== null
        ? lot.id === component.lot_id
        : component.order_id !== null && lot.order_id === component.order_id;
    if (matches) inScope.set(placement.line_item_id, lot.public_id);
  }
  return inScope;
}

/**
 * The known, non-reversed DIRECT cost already recorded against each line item.
 *
 * Only `known` amounts are counted. A `documented_free` zero is a real fact but
 * contributes nothing to a value weighting, and an `unknown` amount contributes
 * nothing because it IS nothing so far as this arithmetic can honestly say.
 * A line that ends with no contributing component gets `null`, not `0`.
 */
export function knownDirectCostByLine(
  components: readonly CostComponentRow[],
): ReadonlyMap<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const component of components) {
    if (component.line_item_id === null) continue;
    if (component.reversed_at !== null) continue;
    if (component.amount_state !== 'known' || component.amount_minor === null) continue;
    if (!exactlyRepresentable(component.amount_minor)) continue;
    const previous = totals.get(component.line_item_id) ?? 0n;
    totals.set(component.line_item_id, previous + BigInt(component.amount_minor));
  }
  return totals;
}

function summarise(
  component: CostComponentRow,
  allocations: readonly CostAllocationRow[],
  lotPublicIdById: ReadonlyMap<string, string>,
  orderPublicIdById: ReadonlyMap<string, string>,
  linePublicIdById: ReadonlyMap<string, AcquisitionLineRow>,
  orderIdByLotId: ReadonlyMap<string, string>,
): CostComponentSummary {
  const mine = allocations.filter((row) => row.cost_component_id === component.id);
  const candidateCount = mine.filter((row) => row.state === 'candidate').length;
  const confirmedCount = mine.filter((row) => row.state === 'confirmed').length;

  const orderId = orderIdOf(component, orderIdByLotId, linePublicIdById);

  return {
    componentPublicId: component.public_id,
    componentType: component.component_type,
    amount: amountOf(component),
    attributionState: component.attribution_state,
    workflowState: workflowStateOf(component, candidateCount),
    scopeKind: scopeKindOf(component),
    orderPublicId: orderId ? orderPublicIdById.get(orderId) ?? null : null,
    lotPublicId: component.lot_id ? lotPublicIdById.get(component.lot_id) ?? null : null,
    directLinePublicId: component.line_item_id
      ? linePublicIdById.get(component.line_item_id)?.acquisition_line_public_id ?? null
      : null,
    evidenceNote: component.evidence_note,
    candidateCount,
    confirmedCount,
    createdAt: component.created_at,
    isReversed: component.reversed_at !== null,
  };
}

export function buildCostQueue(input: {
  readonly components: readonly CostComponentRow[];
  readonly allocations: readonly CostAllocationRow[];
  readonly lots: readonly AcquisitionLotRow[];
  readonly orders: readonly AcquisitionOrderRow[];
  readonly lines: readonly AcquisitionLineRow[];
}): readonly CostComponentSummary[] {
  const lotPublicIdById = new Map(input.lots.map((lot) => [lot.id, lot.public_id]));
  const orderIdByLotId = new Map(input.lots.map((lot) => [lot.id, lot.order_id]));
  const orderPublicIdById = new Map(input.orders.map((order) => [order.id, order.public_id]));
  const lineById = new Map(input.lines.map((line) => [line.acquisition_line_item_id, line]));

  return input.components
    .map((component) => summarise(
      component, input.allocations, lotPublicIdById, orderPublicIdById, lineById, orderIdByLotId))
    // Newest first, then by public id so the order is total and stable. A list
    // whose order changes between reads makes "the third row" meaningless.
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.componentPublicId.localeCompare(b.componentPublicId));
}

export function buildComponentDetail(input: {
  readonly component: CostComponentRow;
  readonly allocations: readonly CostAllocationRow[];
  readonly lots: readonly AcquisitionLotRow[];
  readonly lotLines: readonly AcquisitionLotLineRow[];
  readonly orders: readonly AcquisitionOrderRow[];
  readonly lines: readonly AcquisitionLineRow[];
  /** Every component in the same order, used for the value weighting only. */
  readonly scopeComponents: readonly CostComponentRow[];
}): CostComponentDetail {
  const lotPublicIdById = new Map(input.lots.map((lot) => [lot.id, lot.public_id]));
  const orderIdByLotId = new Map(input.lots.map((lot) => [lot.id, lot.order_id]));
  const orderPublicIdById = new Map(input.orders.map((order) => [order.id, order.public_id]));
  const lineById = new Map(input.lines.map((line) => [line.acquisition_line_item_id, line]));

  const summary = summarise(
    input.component, input.allocations, lotPublicIdById, orderPublicIdById, lineById, orderIdByLotId);

  const scope = scopeLineIdsOf(input.component, input.lots, input.lotLines);
  const directCost = knownDirectCostByLine(input.scopeComponents);

  const scopeLines: ScopeLine[] = [...scope.entries()]
    .flatMap(([lineItemId, lotPublicId]) => {
      const line = lineById.get(lineItemId);
      if (!line) return [];
      const direct = directCost.get(lineItemId);
      return [{
        sourceSystemPublicId: line.source_system_public_id,
        acquisitionLinePublicId: line.acquisition_line_public_id,
        title: titleOf(line),
        quantity: line.quantity,
        exclusionState: line.exclusion_state,
        lotPublicId,
        knownDirectCostMinor: direct === undefined ? null : String(direct),
      }];
    })
    .sort((a, b) => a.acquisitionLinePublicId.localeCompare(b.acquisitionLinePublicId));

  const mine = input.allocations.filter((row) => row.cost_component_id === input.component.id);
  const allocations: AllocationRecord[] = mine
    .map((row) => {
      const line = lineById.get(row.line_item_id);
      return {
        allocationPublicId: row.public_id,
        sourceSystemPublicId: line?.source_system_public_id ?? null,
        acquisitionLinePublicId: line?.acquisition_line_public_id ?? null,
        amountMinor: exactlyRepresentable(row.amount_minor) ? String(row.amount_minor) : '',
        method: row.method,
        state: row.state,
        reviewedAt: row.reviewed_at,
        reversedAt: row.reversed_at,
        createdAt: row.created_at,
      };
    })
    .sort((a, b) =>
      a.state.localeCompare(b.state)
      || (a.acquisitionLinePublicId ?? '').localeCompare(b.acquisitionLinePublicId ?? '')
      || a.allocationPublicId.localeCompare(b.allocationPublicId));

  // Candidate conservation, in exact integer arithmetic. An allocation whose
  // amount could not be carried exactly is EXCLUDED from the sum and the delta
  // is reported as unknown, because a total missing one of its terms is not a
  // total.
  const candidates = mine.filter((row) => row.state === 'candidate');
  const anyUnrepresentable = candidates.some((row) => !exactlyRepresentable(row.amount_minor));
  const candidateTotal = candidates.reduce<bigint>(
    (sum, row) => (exactlyRepresentable(row.amount_minor) ? sum + BigInt(row.amount_minor) : sum), 0n);
  const total = splittableTotal(summary.amount);

  return {
    ...summary,
    order: (() => {
      const orderId = orderIdOf(input.component, orderIdByLotId, lineById);
      const order = input.orders.find((row) => row.id === orderId);
      return order
        ? {
            publicId: order.public_id,
            sourceOrderReference: order.source_order_reference,
            orderStatus: order.order_status,
            occurredAt: order.occurred_at,
          }
        : null;
    })(),
    scopeLines,
    allocations,
    candidateTotalMinor: anyUnrepresentable ? '' : String(candidateTotal),
    conservationDeltaMinor:
      total === null || anyUnrepresentable ? null : String(candidateTotal - total),
  };
}

// --- the split strategies ----------------------------------------------------

export interface SplitShare {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly amountMinor: string;
  /** The governed weight this share was derived from, shown alongside it. */
  readonly weight: string;
}

export type SplitOutcome =
  | { readonly ok: true; readonly shares: readonly SplitShare[]; readonly totalMinor: string }
  | { readonly ok: false; readonly code: string };

/**
 * Distribute `total` across `weights` by the largest-remainder method.
 *
 * Every minor unit is accounted for: the floor shares are handed out first, and
 * the leftover units go one each to the largest fractional remainders. That is
 * the whole reason this is not `Math.round(total * weight / sum)` — rounding
 * each share independently produces a set that does not add up, and a split
 * that does not add up is refused by `confirm_cost_allocation` and then cannot
 * be withdrawn.
 *
 * Ties are broken by the caller's order, which is itself sorted by public id,
 * so the same inputs always produce the same split. A split that varies between
 * two previews of the same thing is not a split anyone can review.
 *
 * A NEGATIVE total is distributed by the same rule. A discount component is a
 * real governed cost component and its amount is genuinely negative in effect;
 * the arithmetic below works on the magnitude and restores the sign, so the
 * remainder still lands on the largest fractional parts rather than wherever
 * truncation-toward-zero happens to put it.
 */
export function largestRemainder(total: bigint, weights: readonly bigint[]): readonly bigint[] {
  const weightSum = weights.reduce<bigint>((sum, weight) => sum + weight, 0n);
  if (weightSum <= 0n) return weights.map(() => 0n);

  const negative = total < 0n;
  const magnitude = negative ? -total : total;

  const floors = weights.map((weight) => (magnitude * weight) / weightSum);
  const distributed = floors.reduce<bigint>((sum, share) => sum + share, 0n);
  let leftover = magnitude - distributed;

  // Remainders, as exact integers: (magnitude * weight) mod weightSum. Compared
  // as bigints, never as fractions, so no rounding decides who gets a unit.
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

/**
 * Compute a split the owner can look at before anything durable happens.
 *
 * This writes nothing and calls nothing. It is the answer to "what would this
 * method actually do", and the amounts it returns are the amounts that get
 * proposed — the browser sends back exactly these figures rather than
 * recomputing them, so the owner confirms what they were shown.
 */
export function computeSplit(input: {
  readonly method: AllocationMethod;
  readonly total: bigint;
  readonly lines: readonly ScopeLine[];
}): SplitOutcome {
  const { method, total, lines } = input;

  if (method === 'manual_custom') return { ok: false, code: 'method_not_computable' };
  if (lines.length === 0) return { ok: false, code: 'no_lines_in_scope' };

  const weights: bigint[] = lines.map((line) => {
    if (method === 'manual_equal') return 1n;
    if (method === 'manual_quantity') return BigInt(Math.max(0, Math.trunc(line.quantity)));
    // manual_value — a line with no known direct cost weighs nothing. That is
    // not the same as weighing zero by choice: it is the honest consequence of
    // having no value fact for it, and it is why the all-zero case refuses.
    return line.knownDirectCostMinor === null ? 0n : BigInt(line.knownDirectCostMinor);
  });

  if (weights.every((weight) => weight <= 0n)) {
    return { ok: false, code: method === 'manual_value' ? 'no_value_basis' : 'no_weight_basis' };
  }

  const shares = largestRemainder(total, weights);
  return {
    ok: true,
    totalMinor: String(total),
    shares: lines.map((line, index) => ({
      sourceSystemPublicId: line.sourceSystemPublicId,
      acquisitionLinePublicId: line.acquisitionLinePublicId,
      amountMinor: String(shares[index]),
      weight: String(weights[index]),
    })),
  };
}

/**
 * Does a proposed set of amounts conserve the component total exactly?
 *
 * WHY THE TRANSPORT CHECKS THIS AT ALL, HAVING JUST SAID IT NEVER DUPLICATES A
 * GOVERNED RULE.
 *
 * Because the governed contract has a DEAD END, and this is the only place it
 * can be closed without new SQL.
 *
 * `propose_cost_allocation` performs no conservation check — it will happily
 * write candidate rows that sum to the wrong figure. `confirm_cost_allocation`
 * then refuses them. `reverse_cost_allocation` requires `attribution_state =
 * 'allocated'`, which a merely-proposed component is not. And there is no
 * governed function anywhere that deletes or supersedes a CANDIDATE row.
 *
 * So a proposal that does not conserve leaves the component permanently stuck:
 * it can never be confirmed, never be reversed, and never be proposed again,
 * because propose itself refuses while candidates exist. Nothing in the
 * application can rescue it.
 *
 * This is therefore not a second opinion about a rule the database already
 * enforces. It is a guard against writing a durable, irreversible mistake
 * through a door the database leaves open. The database still decides at
 * confirm, exactly as before; this only stops the operator from walking into a
 * state where confirm can never succeed.
 *
 * The tolerance is the SAME one minor unit `confirm_cost_allocation` allows,
 * quoted here rather than tightened, so this guard can never refuse something
 * the database would have accepted.
 */
export const CONSERVATION_TOLERANCE_MINOR = 1n;

export function conserves(total: bigint, shares: readonly bigint[]): boolean {
  const sum = shares.reduce<bigint>((running, share) => running + share, 0n);
  const delta = sum - total;
  return (delta < 0n ? -delta : delta) <= CONSERVATION_TOLERANCE_MINOR;
}

// --- the bounded governed refusal vocabulary ---------------------------------

/**
 * Every refusal the governed cost functions can raise, and the HTTP status that
 * preserves its meaning.
 *
 * THIS TABLE IS SHAPED DIFFERENTLY FROM THE RECEIVING ONE, AND HAS TO BE.
 *
 * The S2.2 receiving functions raise bounded machine codes (`receipt_not_open`),
 * so classifying them is a substring match on a code. The S1 cost functions
 * predate that convention and raise ENGLISH SENTENCES (`'cost component already
 * has pending candidate allocations'`). Fixing that would mean editing the
 * governed functions, which this batch must not do.
 *
 * So the mapping below is from a distinctive PHRASE to an application code.
 * The phrases are quoted from the migration verbatim and are asserted against
 * it by test. If a future migration rewords one, the test fails rather than the
 * refusal silently degrading into a generic 502 — which is the failure mode
 * that matters, because "this component already has a pending proposal" and
 * "the database is unreachable" require completely different actions.
 */
export interface CostRefusal {
  readonly code: string;
  readonly status: number;
  /** The phrase from the governed function that identifies this refusal. */
  readonly phrase: string;
}

export const COST_REFUSALS: readonly CostRefusal[] = [
  { code: 'cost_component_not_found', status: 404, phrase: 'cost component not found or not authorized' },
  { code: 'component_directly_attributed', status: 409, phrase: 'a directly-attributed cost component cannot be allocated' },
  { code: 'allocation_already_confirmed', status: 409, phrase: 'already has a confirmed allocation' },
  { code: 'component_reversed', status: 409, phrase: 'has been reversed and cannot be allocated' },
  { code: 'amount_not_known', status: 409, phrase: 'cannot be allocated; resolve its amount' },
  { code: 'amount_not_known', status: 409, phrase: 'cannot be confirmed as allocated' },
  { code: 'proposal_already_pending', status: 409, phrase: 'already has pending candidate allocations' },
  { code: 'duplicate_line_in_proposal', status: 409, phrase: 'more than once' },
  { code: 'line_outside_component_scope', status: 409, phrase: 'outside this cost' },
  { code: 'no_candidates_to_confirm', status: 409, phrase: 'no candidate allocations to confirm' },
  { code: 'expected_total_mismatch', status: 409, phrase: 'but candidates sum to' },
  { code: 'allocation_does_not_conserve', status: 409, phrase: 'but the component amount is' },
  { code: 'nothing_to_reverse', status: 409, phrase: 'no confirmed allocation to reverse' },
  { code: 'invalid_request', status: 400, phrase: 'method must be a lowercase identifier' },
  { code: 'invalid_request', status: 400, phrase: 'at least one allocation line is required' },
  { code: 'invalid_request', status: 400, phrase: 'an expected total is required' },
  { code: 'batch_too_large', status: 400, phrase: 'exceeds the maximum of' },
  { code: 'unauthorized_workspace', status: 403, phrase: 'authentication required' },
  { code: 'acquisition_job_not_committed', status: 409, phrase: 'requires a COMMITTED acquisition import job' },
];

/**
 * Refusals raised by this transport itself, before or instead of an RPC.
 *
 * Kept separate from `COST_REFUSALS` because these have no governed phrase to
 * quote — nothing in the database says them.
 */
export const COST_TRANSPORT_STATUS: Readonly<Record<string, number>> = {
  invalid_request: 400,
  unauthorized_workspace: 403,
  cost_component_not_found: 404,
  acquisition_line_not_found: 404,
  ambiguous_acquisition_line: 409,
  line_outside_component_scope: 409,
  proposal_would_not_conserve: 409,
  method_not_computable: 400,
  no_lines_in_scope: 409,
  no_value_basis: 409,
  no_weight_basis: 409,
  amount_not_known: 409,
  dependency_failed: 502,
  cost_contract_missing: 503,
};

export interface CostFailure {
  readonly code: string;
  readonly status: number;
}

/**
 * Classify a PostgREST/plpgsql error into the bounded application vocabulary.
 *
 * Longest phrase first, so a short phrase cannot claim a longer one's message.
 */
export function classifyCostError(error: unknown): CostFailure {
  const message = String((error as { message?: string } | null)?.message ?? '');
  const ordered = [...COST_REFUSALS].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const refusal of ordered) {
    if (message.includes(refusal.phrase)) return { code: refusal.code, status: refusal.status };
  }
  // A deployment missing the acquisition cost migration is a CONFIGURATION
  // answer, not a failure of this request, and the next step is different.
  if (/function .* does not exist|schema cache|could not find the function/i.test(message)) {
    return { code: 'cost_contract_missing', status: 503 };
  }
  // Never the database's own sentence. The original is logged server-side.
  return { code: 'dependency_failed', status: 502 };
}

/**
 * Does this payload contain something shaped like an internal identifier?
 *
 * Used by the route tests to prove the no-UUID rule over whole responses rather
 * than field by field, so a field added later is covered without anyone
 * remembering to extend an allow-list.
 */
export function containsInternalId(payload: unknown): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(payload) ?? '');
}

// S2.5 Batch 1 — governed cost allocation transport.
//
// WHAT THIS ROUTER IS
//
// Transport, and one guard. The governed cost functions — `propose_cost_
// allocation`, `confirm_cost_allocation`, `reverse_cost_allocation` — already
// own every allocation RULE, and each mutation below is a thin call into one of
// them with the arguments it declares. No allocation rule is reimplemented in
// TypeScript, because a rule that exists in two places eventually disagrees
// with itself and the copy in the weaker position silently wins.
//
// The single exception is documented at length on `conserves` in the contract:
// the governed contract has a dead end where a non-conserving proposal can
// never be confirmed, never be reversed, and never be replaced. That guard
// prevents an irreversible write; it decides nothing the database also decides.
//
// AUTHORIZATION, unchanged from the rest of the governed API:
//   * availability — the whole router 404s unless the governed surface is
//     configured, so a deployment without it does not advertise that it exists;
//   * authentication — a caller bearer token, verified by Supabase itself;
//   * authorization — every read and every write runs through a Supabase client
//     bound to THAT caller's JWT. RLS and the governed functions are the single
//     authorization model. The server holds no service-role key, so it can
//     never do more than the calling user can.
//
// `requireOperator` guards every mutation, mirroring the `array['owner',
// 'operator']` join inside each governed cost function. The gate here is a
// fast, honest refusal; the database's is the one that counts, and it still
// runs. A viewer is refused twice and can bypass neither.
//
// NO BROWSER-SUPPLIED UUID IS EVER TRUSTED, OR EVEN ACCEPTED.
//
// The governed cost functions take internal UUIDs — `p_cost_component_id`, and
// `line_item_id` inside the allocation batch. Those must never be the browser's
// to supply: a UUID from a client is an unauthenticated claim about which row to
// write, and the whole no-raw-UUID rule exists because such a claim looks
// identical to a legitimate one.
//
// So this router accepts governed public identity only:
//   * a component as `RV-ACOST-…`;
//   * an allocation target as the SOURCE-QUALIFIED pair
//     (sourceSystemPublicId, acquisitionLinePublicId) — qualified because the
//     line public id alone is a source-specific label and is only unique WITHIN
//     its source system.
//
// Resolution happens here, under the caller's own JWT, and proves three things
// before a UUID is ever used: the row is in the named workspace, the caller can
// actually read it, and the target is inside the component's governed scope.
// A UUID that survives all three is one the database would have accepted anyway.

import { Router } from 'express';
import { requireMember, requireOperator, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  ALLOCATION_METHOD_DESCRIPTION,
  ALLOCATION_METHODS,
  BASIS_METHOD_DESCRIPTION,
  buildBasisImpact,
  buildComponentDetail,
  buildCostQueue,
  classifyCostError,
  computeSplit,
  conserves,
  isAllocationMethod,
  knownDirectCostByLine,
  parseMinor,
  readRecomputeResult,
  scopeLineIdsOf,
  splittableTotal,
  amountOf,
  type AcquisitionLineRow,
  type AcquisitionLotLineRow,
  type AcquisitionLotRow,
  type AcquisitionOrderRow,
  type AllocationMethod,
  type CostAllocationRow,
  type BasisRecomputeOutcome,
  type CostComponentRow,
  type InventoryCostBasisRow,
  type ScopeLine,
  type UnresolvedBasisRow,
} from '../cost/contract.js';

const router = Router();

router.use((_req, res, next) => {
  if (!isProvenanceEnabled(process.env)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
});

/**
 * The read ceiling for one assembly.
 *
 * Assembly happens in this process, so the read has to be bounded. When a bound
 * is reached the response says so with `complete: false` and the UI renders the
 * S1.6 `partial` state — a truthful "this is some of it" rather than a silent
 * short list that reads exactly like a complete one.
 */
const MAX_ASSEMBLY_ROWS = 2000;

/** The batch ceiling `app.assert_batch_size` enforces for a proposal. */
const MAX_ALLOCATION_LINES = 2000;

class CostError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

function caller(req: AuthedRequest) {
  if (!req.caller) throw new CostError('dependency_failed', 500);
  return req.caller;
}

function asyncRoute(
  handler: (req: AuthedRequest, res: import('express').Response) => Promise<void>,
) {
  return (
    req: AuthedRequest,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => { handler(req, res).catch(next); };
}

/** A governed public identity arriving as a path parameter. Shape only. */
function publicId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
    throw new CostError('invalid_request', 400);
  }
  return value.trim();
}

function requiredText(value: unknown, min = 1, max = 500): string {
  if (typeof value !== 'string') throw new CostError('invalid_request', 400);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new CostError('invalid_request', 400);
  return trimmed;
}

function fail(error: unknown): never {
  const { code, status } = classifyCostError(error);
  throw new CostError(code, status);
}

// --- governed reads ----------------------------------------------------------

type Supa = ReturnType<typeof caller>['client'];

const COMPONENT_COLUMNS =
  'id,public_id,component_type,amount_state,amount_minor,currency,attribution_state,' +
  'evidence_note,line_item_id,lot_id,order_id,reversed_at,reverses_id,created_at';

const ALLOCATION_COLUMNS =
  'id,public_id,cost_component_id,line_item_id,amount_minor,method,state,' +
  'reviewed_at,reversed_at,created_at';

const LINE_COLUMNS =
  'acquisition_line_item_id,acquisition_line_public_id,source_system_public_id,quantity,' +
  'description,full_title,delivered_item_title,exclusion_state,acquisition_order_id,' +
  'acquisition_order_public_id';

async function readRows<T>(
  build: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await build();
  if (error) fail(error);
  return (data ?? []) as T[];
}

async function readComponents(client: Supa, workspaceId: string, orderIds?: readonly string[]) {
  return readRows<CostComponentRow>(() => {
    const query = client
      .from('acquisition_cost_components')
      .select(COMPONENT_COLUMNS)
      .eq('workspace_id', workspaceId);
    return (orderIds ? query.in('order_id', orderIds) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

async function readAllocations(client: Supa, workspaceId: string, componentIds?: readonly string[]) {
  if (componentIds && componentIds.length === 0) return [];
  return readRows<CostAllocationRow>(() => {
    const query = client
      .from('acquisition_cost_allocations')
      .select(ALLOCATION_COLUMNS)
      .eq('workspace_id', workspaceId);
    return (componentIds ? query.in('cost_component_id', componentIds) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

async function readLots(client: Supa, workspaceId: string) {
  return readRows<AcquisitionLotRow>(() =>
    client.from('acquisition_lots').select('id,public_id,order_id')
      .eq('workspace_id', workspaceId).limit(MAX_ASSEMBLY_ROWS));
}

async function readLotLines(client: Supa, workspaceId: string, lotIds?: readonly string[]) {
  if (lotIds && lotIds.length === 0) return [];
  return readRows<AcquisitionLotLineRow>(() => {
    const query = client
      .from('acquisition_lot_lines')
      .select('lot_id,line_item_id,state')
      .eq('workspace_id', workspaceId)
      .eq('state', 'active');
    return (lotIds ? query.in('lot_id', lotIds) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

/**
 * Read specific acquisition lines by public id, across the whole workspace.
 *
 * Used only by the proposal resolver, which needs to tell "you cannot see this
 * line" apart from "this line is not in this component's scope". Both halves of
 * the source-qualified identity are matched by the caller; this only narrows
 * the read.
 */
async function readLinesByPublicId(
  client: Supa, workspaceId: string, publicIds: readonly string[],
) {
  if (publicIds.length === 0) return [];
  return readRows<AcquisitionLineRow>(() =>
    client
      .from('acquisition_line_overview')
      .select(LINE_COLUMNS)
      .eq('workspace_id', workspaceId)
      .in('acquisition_line_public_id', publicIds)
      .limit(MAX_ASSEMBLY_ROWS));
}

/**
 * The derived inventory cost basis for specific acquisition lines.
 *
 * Columns are listed EXPLICITLY rather than taken as `*`. The governed view is
 * `select b.*, …`, so `*` would pull `id`, `workspace_id`, `recompute_id`,
 * `inventory_lot_id`, `inventory_item_id`,
 * `acquisition_receipt_line_inventory_link_id` and `superseded_by_recompute_id`
 * — seven internal identifiers, straight into a payload.
 * `acquisition_line_item_id` is the one internal id read here, and it is a join
 * key the assembly never copies out.
 */
async function readBasisRows(client: Supa, workspaceId: string, lineItemIds: readonly string[]) {
  if (lineItemIds.length === 0) return [];
  return readRows<InventoryCostBasisRow>(() =>
    client
      .from('inventory_cost_basis_current')
      .select(
        'public_id,subject_kind,inventory_lot_public_id,inventory_item_public_id,'
        + 'acquisition_line_item_id,layer_seq,source_unit_ordinal,total_cost_minor,currency,'
        + 'basis_method,state,algorithm_version,derived_at')
      .eq('workspace_id', workspaceId)
      .in('acquisition_line_item_id', lineItemIds)
      .limit(MAX_ASSEMBLY_ROWS));
}

/** Why the governed view says a line's basis is not fully established. */
async function readUnresolvedBasis(
  client: Supa, workspaceId: string, lineItemIds: readonly string[],
) {
  if (lineItemIds.length === 0) return [];
  return readRows<UnresolvedBasisRow>(() =>
    client
      .from('unresolved_inventory_cost_basis')
      .select(
        'acquisition_line_item_id,acquisition_line_public_id,expected_quantity,'
        + 'reconciled_quantity,pending_expected_quantity,overage_quantity,'
        + 'has_unresolved_cost_evidence')
      .eq('workspace_id', workspaceId)
      .in('acquisition_line_item_id', lineItemIds)
      .limit(MAX_ASSEMBLY_ROWS));
}

async function readOrders(client: Supa, workspaceId: string) {
  return readRows<AcquisitionOrderRow>(() =>
    client.from('acquisition_orders')
      .select('id,public_id,source_order_reference,order_status,occurred_at')
      .eq('workspace_id', workspaceId).limit(MAX_ASSEMBLY_ROWS));
}

async function readLines(client: Supa, workspaceId: string, orderId?: string | null) {
  return readRows<AcquisitionLineRow>(() => {
    const query = client
      .from('acquisition_line_overview')
      .select(LINE_COLUMNS)
      .eq('workspace_id', workspaceId);
    return (orderId ? query.eq('acquisition_order_id', orderId) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

// --- A. the cost allocation queue --------------------------------------------

/**
 * Every governed cost component in the workspace, with where it stands.
 *
 * Not filtered to "needs allocation". A directly-attributed component and an
 * already-allocated one are both part of the answer to "what is the cost
 * picture", and hiding them would make the surface look like a to-do list that
 * happens to be short rather than a record that happens to be complete. The
 * workflow state is on every row, so the UI can filter without the server
 * having decided what is worth seeing.
 */
router.get('/queue', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client, role } = caller(req);
  const [components, lots, orders, lines] = await Promise.all([
    readComponents(client, workspaceId),
    readLots(client, workspaceId),
    readOrders(client, workspaceId),
    readLines(client, workspaceId),
  ]);
  const allocations = await readAllocations(
    client, workspaceId, components.map((component) => component.id));

  // Truthful completeness. If any read hit its ceiling the answer is a subset,
  // and saying so is the difference between "every cost is attributed" and "we
  // stopped looking".
  const complete =
    components.length < MAX_ASSEMBLY_ROWS
    && allocations.length < MAX_ASSEMBLY_ROWS
    && lots.length < MAX_ASSEMBLY_ROWS
    && orders.length < MAX_ASSEMBLY_ROWS
    && lines.length < MAX_ASSEMBLY_ROWS;

  res.json({
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    complete,
    role,
    methods: ALLOCATION_METHODS.map((method) => ({
      method, description: ALLOCATION_METHOD_DESCRIPTION[method],
    })),
    rows: buildCostQueue({ components, allocations, lots, orders, lines }),
  });
}));

// --- public identity resolution ----------------------------------------------

/**
 * Resolve `RV-ACOST-…` to the row, under the caller's own JWT.
 *
 * No row is indistinguishable from a foreign workspace, deliberately: RLS
 * already returned nothing, and saying "exists but not yours" would be a
 * disclosure this surface has no reason to make.
 */
async function resolveComponent(
  client: Supa, workspaceId: string, componentPublicId: string,
): Promise<CostComponentRow> {
  const found = await readRows<CostComponentRow>(() =>
    client
      .from('acquisition_cost_components')
      .select(COMPONENT_COLUMNS)
      .eq('workspace_id', workspaceId)
      .eq('public_id', componentPublicId)
      .limit(1));
  const component = found[0];
  if (!component) throw new CostError('cost_component_not_found', 404);
  return component;
}

interface ComponentContext {
  readonly component: CostComponentRow;
  readonly lots: readonly AcquisitionLotRow[];
  readonly lotLines: readonly AcquisitionLotLineRow[];
  readonly orders: readonly AcquisitionOrderRow[];
  readonly lines: readonly AcquisitionLineRow[];
  readonly allocations: readonly CostAllocationRow[];
  readonly scopeComponents: readonly CostComponentRow[];
  /** line_item_id → lot public id, for every line inside the governed scope. */
  readonly scope: ReadonlyMap<string, string>;
}

/**
 * Everything one component's surface needs, read once.
 *
 * The scope is computed from the SAME `acquisition_lot_lines` / `acquisition_
 * lots` join `propose_cost_allocation` uses, so what the owner is shown to be
 * splitting across is what the database will accept. The database re-proves it
 * on the call and its answer wins.
 */
async function loadComponentContext(
  client: Supa, workspaceId: string, componentPublicId: string,
): Promise<ComponentContext> {
  const component = await resolveComponent(client, workspaceId, componentPublicId);

  const [lots, orders] = await Promise.all([
    readLots(client, workspaceId),
    readOrders(client, workspaceId),
  ]);

  // The order this component hangs from, whichever of the three scopes it uses.
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const orderIdFromLot = component.lot_id ? lotById.get(component.lot_id)?.order_id ?? null : null;
  const orderId = component.order_id ?? orderIdFromLot;

  // A line-item-scoped (direct) component has no lot of its own; its order is
  // found through the line, so the lines are read unfiltered in that one case.
  const lines = await readLines(client, workspaceId, orderId);
  const resolvedOrderId = orderId
    ?? (component.line_item_id
      ? lines.find((line) => line.acquisition_line_item_id === component.line_item_id)
        ?.acquisition_order_id ?? null
      : null);

  const orderLotIds = lots.filter((lot) => lot.order_id === resolvedOrderId).map((lot) => lot.id);
  const lotLines = await readLotLines(client, workspaceId, orderLotIds);

  const scopeComponents = resolvedOrderId === null
    ? [component]
    : await readComponentsForOrder(client, workspaceId, resolvedOrderId, orderLotIds, lines);

  const allocations = await readAllocations(
    client, workspaceId,
    [...new Set([component.id, ...scopeComponents.map((row) => row.id)])]);

  return {
    component,
    lots,
    lotLines,
    orders,
    lines,
    allocations,
    scopeComponents,
    scope: scopeLineIdsOf(component, lots, lotLines),
  };
}

/**
 * Every cost component attached anywhere under one order.
 *
 * Needed only for the `manual_value` weighting, which asks each line what
 * direct cost is already known for it. The three scopes are read separately
 * because the schema stores exactly one of them per row and a single filter
 * cannot express "any of these three".
 */
async function readComponentsForOrder(
  client: Supa,
  workspaceId: string,
  orderId: string,
  lotIds: readonly string[],
  lines: readonly AcquisitionLineRow[],
): Promise<readonly CostComponentRow[]> {
  const lineIds = lines.map((line) => line.acquisition_line_item_id);
  const [byOrder, byLot, byLine] = await Promise.all([
    readRows<CostComponentRow>(() =>
      client.from('acquisition_cost_components').select(COMPONENT_COLUMNS)
        .eq('workspace_id', workspaceId).eq('order_id', orderId).limit(MAX_ASSEMBLY_ROWS)),
    lotIds.length === 0 ? Promise.resolve([]) : readRows<CostComponentRow>(() =>
      client.from('acquisition_cost_components').select(COMPONENT_COLUMNS)
        .eq('workspace_id', workspaceId).in('lot_id', lotIds).limit(MAX_ASSEMBLY_ROWS)),
    lineIds.length === 0 ? Promise.resolve([]) : readRows<CostComponentRow>(() =>
      client.from('acquisition_cost_components').select(COMPONENT_COLUMNS)
        .eq('workspace_id', workspaceId).in('line_item_id', lineIds).limit(MAX_ASSEMBLY_ROWS)),
  ]);
  const seen = new Map<string, CostComponentRow>();
  for (const row of [...byOrder, ...byLot, ...byLine]) seen.set(row.id, row);
  return [...seen.values()];
}

/** The scope lines, in the shape the split strategies and the UI both take. */
function scopeLinesOf(context: ComponentContext): readonly ScopeLine[] {
  const direct = knownDirectCostByLine(context.scopeComponents);
  const lineById = new Map(context.lines.map((line) => [line.acquisition_line_item_id, line]));
  return [...context.scope.entries()]
    .flatMap(([lineItemId, lotPublicId]) => {
      const line = lineById.get(lineItemId);
      if (!line) return [];
      const known = direct.get(lineItemId);
      return [{
        sourceSystemPublicId: line.source_system_public_id,
        acquisitionLinePublicId: line.acquisition_line_public_id,
        title: line.delivered_item_title ?? line.full_title ?? line.description ?? null,
        quantity: line.quantity,
        exclusionState: line.exclusion_state,
        lotPublicId,
        knownDirectCostMinor: known === undefined ? null : String(known),
      }];
    })
    .sort((a, b) => a.acquisitionLinePublicId.localeCompare(b.acquisitionLinePublicId));
}

// --- B. one component's workspace --------------------------------------------

router.get('/components/:componentPublicId', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client, role } = caller(req);
  const context = await loadComponentContext(
    client, workspaceId, publicId(req.params.componentPublicId));

  const scopeLines = scopeLinesOf(context);

  /*
   * The DERIVED basis for the lines this component touches.
   *
   * Read in the same request as the evidence, and rendered in a separate,
   * clearly-labelled region beside it — never merged into it. Allocation
   * evidence is what an owner DECIDED; the basis is what the governed S2.4
   * recompute CONCLUDED under a versioned algorithm. Showing them as one thing
   * would let a proposal look like a cost.
   *
   * This is component-scoped visibility only. It is deliberately not a
   * workspace-wide unresolved-cost queue; that is S2.6 and is not built here.
   */
  const scopeLineItemIds = [...context.scope.keys()];
  const [basisRows, unresolvedRows] = await Promise.all([
    readBasisRows(client, workspaceId, scopeLineItemIds),
    readUnresolvedBasis(client, workspaceId, scopeLineItemIds),
  ]);

  res.json({
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    role,
    methods: ALLOCATION_METHODS.map((method) => ({
      method, description: ALLOCATION_METHOD_DESCRIPTION[method],
    })),
    // The method vocabulary travels with the data so the screen describes the
    // derivation in the algorithm's own terms rather than in a caption written
    // separately and free to drift.
    basisMethods: Object.entries(BASIS_METHOD_DESCRIPTION).map(([method, description]) => ({
      method, description,
    })),
    component: buildComponentDetail({
      component: context.component,
      allocations: context.allocations,
      lots: context.lots,
      lotLines: context.lotLines,
      orders: context.orders,
      lines: context.lines,
      scopeComponents: context.scopeComponents,
    }),
    basisImpact: buildBasisImpact({
      scopeLines, lines: context.lines, basisRows, unresolvedRows,
    }),
  });
}));

// --- C. preview: arithmetic the owner sees before anything durable happens ----

/**
 * Compute what a method would propose, WITHOUT writing anything.
 *
 * This exists because of two constraints that would otherwise conflict. The
 * governed function computes nothing — every per-line amount must be supplied
 * by the caller. And the browser must not fabricate basis values. So the
 * arithmetic happens here, in exact integer minor units, and the result is
 * shown to the owner before a single durable row is written.
 *
 * The figures this returns are the figures the propose call takes. The browser
 * sends them back verbatim rather than recomputing, so the owner confirms
 * exactly what they were shown rather than something derived again from the
 * same inputs by a second implementation.
 *
 * It is a POST because it carries a method and an optional line selection, not
 * because it changes anything. Nothing here writes.
 */
router.post('/components/:componentPublicId/allocation-preview', requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const context = await loadComponentContext(
      client, workspaceId, publicId(req.params.componentPublicId));

    const method = req.body?.method;
    if (!isAllocationMethod(method)) throw new CostError('invalid_request', 400);

    const amount = amountOf(context.component);
    const total = splittableTotal(amount);
    if (total === null) throw new CostError('amount_not_known', 409);

    const all = scopeLinesOf(context);
    const selected = selectLines(all, req.body?.lines);

    const outcome = computeSplit({ method: method as AllocationMethod, total, lines: selected });
    if (!outcome.ok) throw new CostError(outcome.code, COST_PREVIEW_STATUS[outcome.code] ?? 409);

    res.json({
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      method,
      description: ALLOCATION_METHOD_DESCRIPTION[method as AllocationMethod],
      componentPublicId: context.component.public_id,
      totalMinor: outcome.totalMinor,
      currency: amount.currency,
      shares: outcome.shares,
      // Stated, not implied. The owner is told this changed nothing, because a
      // screen full of exact figures otherwise looks like a thing that happened.
      wrote: false,
    });
  }));

const COST_PREVIEW_STATUS: Readonly<Record<string, number>> = {
  method_not_computable: 400,
  no_lines_in_scope: 409,
  no_value_basis: 409,
  no_weight_basis: 409,
};

/**
 * Narrow the scope to an explicit selection, when one was made.
 *
 * A selection may only ever REMOVE lines the governed scope already contains.
 * A line the browser names that is not in scope is refused here rather than
 * quietly dropped, because silently ignoring part of a request produces a split
 * across a set the owner did not choose and cannot see they did not choose.
 */
function selectLines(
  all: readonly ScopeLine[],
  requested: unknown,
): readonly ScopeLine[] {
  if (requested == null) return all;
  if (!Array.isArray(requested)) throw new CostError('invalid_request', 400);
  if (requested.length === 0) throw new CostError('invalid_request', 400);
  if (requested.length > MAX_ALLOCATION_LINES) throw new CostError('invalid_request', 400);

  const byKey = new Map(all.map((line) => [lineKey(line.sourceSystemPublicId, line.acquisitionLinePublicId), line]));
  const chosen: ScopeLine[] = [];
  const seen = new Set<string>();
  for (const entry of requested) {
    const key = lineKey(
      requiredText((entry as Record<string, unknown>)?.sourceSystemPublicId, 1, 200),
      requiredText((entry as Record<string, unknown>)?.acquisitionLinePublicId, 1, 200),
    );
    if (seen.has(key)) throw new CostError('invalid_request', 400);
    seen.add(key);
    const line = byKey.get(key);
    if (!line) throw new CostError('line_outside_component_scope', 409);
    chosen.push(line);
  }
  return chosen.sort((a, b) => a.acquisitionLinePublicId.localeCompare(b.acquisitionLinePublicId));
}

function lineKey(sourceSystemPublicId: string, acquisitionLinePublicId: string): string {
  return `${sourceSystemPublicId} ${acquisitionLinePublicId}`;
}

// --- mutations ---------------------------------------------------------------

async function rpc(client: Supa, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) fail(error);
  if (!data) throw new CostError('dependency_failed', 502);
  return data as Record<string, unknown>;
}

/**
 * Refresh the derived inventory cost basis, as a SEPARATE governed operation.
 *
 * THE ONE RULE THIS FUNCTION EXISTS TO ENFORCE: A FAILED RECOMPUTE MUST NEVER
 * BE REPORTED AS A FAILED ALLOCATION.
 *
 * By the time this runs, `confirm`/`reverse`/`withdraw` has already committed —
 * the database returned a result. The basis is DERIVED from that commit and
 * lives in different tables behind a different function, so it can fail on its
 * own: a transient error, a role the caller has for allocation but not for
 * recompute, a deployment without the S2.4 migration.
 *
 * If that failure were allowed to propagate, the owner would be told the
 * allocation failed, would try again, and would be refused — because the first
 * attempt DID work. They would end up certain nothing had happened while the
 * cost basis had in fact changed. That is the worst available outcome, so this
 * function never throws.
 *
 * Retrying is safe and the response says so: S2.4 short-circuits on an
 * unchanged content hash, holds an advisory lock across the whole publish, and
 * is deterministic for identical inputs.
 */
async function refreshBasis(client: Supa, workspaceId: string): Promise<BasisRecomputeOutcome> {
  try {
    const data = await rpc(client, 'recompute_inventory_cost_basis', {
      p_workspace_id: workspaceId,
    });
    return readRecomputeResult(data);
  } catch (error) {
    const { code } = error instanceof CostError
      ? { code: error.code }
      : classifyCostError(error);
    // `retryable: true` is a fact about the governed function, not optimism:
    // recompute is idempotent, so a retry can only re-establish truth.
    return { status: 'failed', code, retryable: true };
  }
}

/**
 * Propose a split.
 *
 * THE MOST DANGEROUS CALL ON THIS SURFACE, and the comments say why rather than
 * leaving a reader to discover it.
 *
 * `propose_cost_allocation` has NO idempotency key and returns NO `replayed`
 * flag. It writes durable candidate rows. And nothing in the governed contract
 * can delete a candidate row: propose refuses while candidates exist, confirm
 * refuses unless they conserve, and reverse requires a CONFIRMED allocation.
 *
 * Two consequences, both handled here rather than left to the operator:
 *
 *   1. A non-conserving proposal is PERMANENT and unusable. The transport
 *      refuses it before the call — see `conserves` in the contract for why
 *      that is a dead-end guard rather than a duplicated rule.
 *
 *   2. A LOST RESPONSE cannot be retried blindly. The request may have
 *      committed. The database will refuse a second attempt with
 *      `proposal_already_pending`, which protects the data but does NOT tell
 *      the operator whether the pending proposal is theirs or a colleague's.
 *      The client therefore verifies against an authoritative re-read before it
 *      is allowed to act again, exactly as it does for a discrepancy.
 */
router.post('/components/:componentPublicId/allocations', requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const context = await loadComponentContext(
      client, workspaceId, publicId(req.params.componentPublicId));

    const method = req.body?.method;
    if (!isAllocationMethod(method)) throw new CostError('invalid_request', 400);

    const entries = req.body?.allocations;
    if (!Array.isArray(entries) || entries.length === 0) throw new CostError('invalid_request', 400);
    if (entries.length > MAX_ALLOCATION_LINES) throw new CostError('invalid_request', 400);

    const amount = amountOf(context.component);
    const total = splittableTotal(amount);
    if (total === null) throw new CostError('amount_not_known', 409);

    // Read every named target once, across the WHOLE workspace rather than
    // only the component's order.
    //
    // Reading them narrowly would collapse two different answers into one: a
    // line the caller cannot see at all, and a line they can see that simply
    // belongs somewhere else. Those need different words — one is "check the
    // identifier", the other is "that line is not part of this cost" — so the
    // read is deliberately wide enough to tell them apart, and RLS still
    // decides what comes back.
    const targets = entries.map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        sourceSystemPublicId: requiredText(record?.sourceSystemPublicId, 1, 200),
        acquisitionLinePublicId: requiredText(record?.acquisitionLinePublicId, 1, 200),
        amountMinor: record?.amountMinor,
      };
    });

    const candidates = await readLinesByPublicId(
      client, workspaceId, [...new Set(targets.map((target) => target.acquisitionLinePublicId))]);

    const seen = new Set<string>();
    const resolved: { lineItemId: string; amount: bigint }[] = [];
    for (const target of targets) {
      const key = lineKey(target.sourceSystemPublicId, target.acquisitionLinePublicId);
      if (seen.has(key)) throw new CostError('invalid_request', 400);
      seen.add(key);

      // A line public id is a SOURCE-SPECIFIC label, unique only within its
      // source system, so both halves are matched. More than one match means
      // the identity does not identify anything, and guessing would attach a
      // cost to whichever row happened to sort first.
      const matches = candidates.filter((line) =>
        line.source_system_public_id === target.sourceSystemPublicId
        && line.acquisition_line_public_id === target.acquisitionLinePublicId);
      if (matches.length === 0) throw new CostError('acquisition_line_not_found', 404);
      if (matches.length > 1) throw new CostError('ambiguous_acquisition_line', 409);

      const line = matches[0];
      if (!context.scope.has(line.acquisition_line_item_id)) {
        throw new CostError('line_outside_component_scope', 409);
      }

      const parsed = parseMinor(target.amountMinor);
      if (parsed === null) throw new CostError('invalid_request', 400);
      resolved.push({ lineItemId: line.acquisition_line_item_id, amount: parsed });
    }

    // The dead-end guard. Quotes the database's own one-minor-unit tolerance so
    // it can never refuse something confirm would have accepted.
    if (!conserves(total, resolved.map((entry) => entry.amount))) {
      throw new CostError('proposal_would_not_conserve', 409);
    }

    const result = await rpc(client, 'propose_cost_allocation', {
      p_cost_component_id: context.component.id,
      p_method: method,
      // Amounts are sent as decimal STRINGS. The governed function reads them
      // with `(r->>'amount_minor')::bigint`, so a string is cast exactly; a
      // JSON number would already have passed through a float before it got
      // here, and this is the one representation that cannot lose a unit.
      p_allocations: resolved.map((entry) => ({
        line_item_id: entry.lineItemId,
        amount_minor: entry.amount.toString(),
      })),
    });

    res.json({
      componentPublicId: context.component.public_id,
      method,
      proposed: Number(result.proposed ?? 0),
      totalMinor: resolved.reduce<bigint>((sum, entry) => sum + entry.amount, 0n).toString(),
      // Stated so the client never has to infer it from an absence: this
      // governed function has no replay, so there is no such thing as a safe
      // resend.
      replayable: false,
    });
  }));

/**
 * Confirm the pending proposal.
 *
 * `p_expected_total_minor` is a COUNT CONTRACT, not a convenience: the caller
 * states the total it believes the candidates sum to, and the database refuses
 * if the candidates say otherwise. The figure sent here is the one the owner
 * was shown, so a proposal that changed underneath them — a colleague's, or
 * their own from another tab — is refused rather than confirmed silently.
 *
 * The client must therefore send the total it DISPLAYED. This route does not
 * recompute it from the candidates, because recomputing it would make the
 * contract check itself and always pass.
 */
router.post('/components/:componentPublicId/allocations/confirm', requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const component = await resolveComponent(
      client, workspaceId, publicId(req.params.componentPublicId));

    const expected = parseMinor(req.body?.expectedTotalMinor);
    if (expected === null) throw new CostError('invalid_request', 400);

    const result = await rpc(client, 'confirm_cost_allocation', {
      p_cost_component_id: component.id,
      p_expected_total_minor: expected.toString(),
    });

    // The allocation is COMMITTED at this point. Everything after it is a
    // separate governed operation whose failure cannot retract that.
    const basisRecompute = await refreshBasis(client, workspaceId);

    res.json({
      componentPublicId: component.public_id,
      confirmed: Number(result.confirmed ?? 0),
      totalMinor: String(result.total_minor ?? ''),
      // Confirming twice is not a replay: the second call finds no candidates
      // and is refused with `no_candidates_to_confirm`. Saying so lets the
      // client tell "already done" apart from "did not happen".
      replayable: false,
      basisRecompute,
    });
  }));

/**
 * Reverse a CONFIRMED allocation.
 *
 * This retracts a cost basis. It deletes nothing: the reversed rows stay,
 * timestamped, with their review attribution intact, and the component returns
 * to `unresolved` so a corrected proposal can be made. The reason is recorded
 * as governed audit history.
 *
 * `reverse_cost_component` — which supersedes the component's own FACTS by
 * writing a successor row — is deliberately NOT exposed here. It exists, and
 * exposing a governed function merely because it exists is how a surface grows
 * powers nobody asked for. Correcting a component's amount is not part of this
 * slice.
 */
router.post('/components/:componentPublicId/allocations/reverse', requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const component = await resolveComponent(
      client, workspaceId, publicId(req.params.componentPublicId));

    // The governed function takes a nullable reason, but this surface requires
    // one. A cost basis retracted with no account of why is not evidence, and
    // the audit row is the only place that account can ever live.
    const reason = requiredText(req.body?.reason, 1, 500);

    const result = await rpc(client, 'reverse_cost_allocation', {
      p_cost_component_id: component.id,
      p_reason: reason,
    });

    const basisRecompute = await refreshBasis(client, workspaceId);

    res.json({
      componentPublicId: component.public_id,
      reversed: Number(result.reversed ?? 0),
      // Reversing twice is refused with `nothing_to_reverse`: the component is
      // no longer `allocated`. Not a replay, and not a silent success.
      replayable: false,
      basisRecompute,
    });
  }));

/**
 * Withdraw the pending proposal.
 *
 * THE CAPABILITY BATCH 1 SAID DID NOT EXIST, AND WAS RIGHT ABOUT AT THE TIME.
 *
 * Before S2.4.1 nothing could remove a candidate row, so a proposal that did
 * not conserve stranded its component permanently. `withdraw_cost_allocation`
 * closes that: every candidate moves to the TERMINAL `withdrawn` state.
 *
 * IT IS NOT A DELETE. The rows stay, with their original amounts and method,
 * and `app.enforce_cost_allocation_transition` refuses to move them anywhere
 * afterwards. The reason becomes governed audit history. This surface therefore
 * requires a reason — the governed function does too, refusing a blank one —
 * and never describes the operation as removal.
 *
 * NO IDEMPOTENCY KEY, and no `replayed` flag. A lost response cannot be
 * retried blindly: the request may have committed, and the client must verify
 * against an authoritative re-read before it acts again.
 */
router.post('/components/:componentPublicId/allocations/withdraw', requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const component = await resolveComponent(
      client, workspaceId, publicId(req.params.componentPublicId));

    const reason = requiredText(req.body?.reason, 1, 500);

    const result = await rpc(client, 'withdraw_cost_allocation', {
      p_cost_component_id: component.id,
      p_reason: reason,
    });

    // Withdrawal changes the allocation states the S2.4 content hash covers, so
    // the derived basis is refreshed here too — as its own operation.
    const basisRecompute = await refreshBasis(client, workspaceId);

    res.json({
      componentPublicId: component.public_id,
      withdrawn: Number(result.withdrawn ?? 0),
      replayable: false,
      basisRecompute,
    });
  }));

router.use((
  err: unknown,
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) => {
  if (err instanceof CostError) {
    res.status(err.status).json({ error: err.code });
    return;
  }
  next(err);
});

export default router;

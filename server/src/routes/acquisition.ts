// Phase 4 acquisition API — restricted, authenticated, workspace-scoped, and
// read-focused. STAGING / NON-AUTHORITATIVE: nothing here is the deployed
// system of record; the legacy SQLite application remains authoritative.
//
// AVAILABILITY vs AUTHORIZATION — separate and both enforced, reusing the Phase
// 3 gates unchanged:
//   * Availability: every route 404s unless SHADOW_IMPORT=repository-fixtures
//     AND the shadow Supabase URL/anon key are configured. With the flags
//     absent — the deployed default — this router is inert.
//   * Authorization: EVERY route additionally requires a valid caller bearer
//     token and an explicit workspaceId, resolved through the shadow Supabase
//     client running under that same caller JWT (provenance/auth.ts).
//
// Permissions:
//   requireMember   — viewers included: every read/review surface.
//   requireOperator — owner/operator: governed preview, commit, and cost review.
//   requireOwner    — owner only: channel registration.
//
// The server holds NO service-role key. Stored acquisition data is read and
// written exclusively through the caller's JWT, so RLS and the governed
// SECURITY DEFINER functions are the single authorization model.

import { Router } from 'express';
import {
  requireMember,
  requireOperator,
  requireOwner,
  type AuthedRequest,
} from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  buildAcquisitionPlan,
  summarizeAcquisitionPlan,
  AcquisitionMappingError,
} from '../acquisition/adapter.js';
import { readCommittedSourceRows, SourceReadError } from '../acquisition/sourceReader.js';
import {
  commitAcquisitionPlan,
  abandonAcquisitionJob,
  AcquisitionCommitError,
} from '../acquisition/commitDriver.js';

const router = Router();

// Availability gate. 404 (not 403) so a disabled deployment does not advertise
// that the surface exists at all. Reuses the Phase 3 flag unchanged.
router.use((_req, res, next) => {
  if (!isProvenanceEnabled(process.env)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
});

const MAX_PAGE = 200;

class AcquisitionReadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const SORTS = new Set(['occurred_at', 'created_at', 'seller', 'title', 'quantity', 'classification']);
const ORDERS = new Set(['asc', 'desc']);
const STATES = new Set(['classified', 'needs_review', 'unclassified']);
const METHODS = new Set(['rule', 'owner_override', 'seller_specialization', 'explicit_evidence', 'system_fallback']);
const INSTRUMENTS = new Set(['card','bank','balance','credit','cash','other']);
const SHIPMENT_STATES = new Set(['expected','in_transit','delivered','lost','cancelled']);

function bodyText(value: unknown, code = 'invalid_request', min = 1, max = 500): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new AcquisitionReadError(code, 400);
  return value.trim();
}
function optionalBodyText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  return bodyText(value, 'invalid_request', 1, max);
}
function isoDate(value: unknown, required = false): string | null {
  if (value == null || value === '') { if (required) throw new AcquisitionReadError('invalid_request',400); return null; }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new AcquisitionReadError('invalid_request',400);
  return new Date(value).toISOString();
}
function publicId(value: unknown): string { return bodyText(value,'invalid_request',1,200); }
function rpcError(error: unknown): AcquisitionReadError {
  const message=String((error as {message?:string})?.message??'');
  for (const code of ['invalid_amount','invalid_currency','invalid_instrument','invalid_transition','stale_status','idempotency_conflict','already_reversed','unauthorized_workspace','acquisition_not_found','payment_not_found','shipment_not_found']) if(message.includes(code)) return new AcquisitionReadError(code,code==='stale_status'?409:code.endsWith('_not_found')?404:code==='unauthorized_workspace'?403:400);
  if (/function .* does not exist|schema cache/i.test(message)) return new AcquisitionReadError('acquisition_detail_contract_missing',503);
  return new AcquisitionReadError('dependency_failed',502);
}

function optionalQuery(value: unknown, max = 200): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new AcquisitionReadError('invalid_query', 400);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new AcquisitionReadError('invalid_query', 400);
  return trimmed;
}

function integerQuery(value: unknown, fallback: number, minimum: number, maximum?: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new AcquisitionReadError('invalid_query', 400);
  const parsed = Number(value);
  if (parsed < minimum || (maximum !== undefined && parsed > maximum)) throw new AcquisitionReadError('invalid_query', 400);
  return parsed;
}

function readLimit(value: unknown, fallback = 50): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_PAGE);
}

function readOffset(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function caller(req: AuthedRequest) {
  if (!req.caller) throw new AcquisitionMappingError('caller not resolved', 500);
  return req.caller;
}

function asyncRoute(
  handler: (req: AuthedRequest, res: import('express').Response) => Promise<void>
) {
  return (
    req: AuthedRequest,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    handler(req, res).catch(next);
  };
}

// --- Session: the caller's ACTUAL workspace role (governed) --------------------
// The UI must derive its capabilities from this, never from a user-selected
// value. The role here is the one the database resolved for the caller's own
// JWT in this workspace (see provenance/auth.ts); a viewer cannot become an
// operator by picking a different option in the client.
router.get(
  '/session',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, role } = caller(req);
    res.json({ staging: true, workspaceId, role });
  })
);

// --- Normal committed acquisition-line read surface (all members) ------------
router.get('/lines', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'occurred_at';
  const order = typeof req.query.order === 'string' ? req.query.order : 'desc';
  const state = optionalQuery(req.query.classificationState);
  const method = optionalQuery(req.query.method);
  if (!SORTS.has(sort) || !ORDERS.has(order)) throw new AcquisitionReadError('invalid_sort', 400);
  if (state && !STATES.has(state)) throw new AcquisitionReadError('invalid_filter', 400);
  if (method && !METHODS.has(method)) throw new AcquisitionReadError('invalid_filter', 400);
  const args = {
    p_workspace_id: workspaceId,
    p_query: req.query.query === undefined ? null : optionalQuery(req.query.query),
    p_classification_key: optionalQuery(req.query.classification),
    p_seller_normalized: optionalQuery(req.query.seller),
    p_business_vertical: optionalQuery(req.query.businessVertical),
    p_method: method,
    p_classification_state: state,
    p_sort: sort,
    p_order: order,
    p_limit: integerQuery(req.query.limit, 50, 1, MAX_PAGE),
    p_offset: integerQuery(req.query.offset, 0, 0),
  };
  const { data, error } = await client.rpc('list_acquisition_lines' as never, args as never);
  if (error) {
    const message = String((error as { message?: string }).message ?? '');
    if (message.includes('invalid_sort')) throw new AcquisitionReadError('invalid_sort', 400);
    if (message.includes('invalid_filter')) throw new AcquisitionReadError('invalid_filter', 400);
    if (message.includes('unauthorized_workspace')) throw new AcquisitionReadError('unauthorized_workspace', 403);
    if (/function .* does not exist|schema cache/i.test(message)) throw new AcquisitionReadError('acquisition_read_contract_missing', 503);
    throw new AcquisitionReadError('dependency_failed', 502);
  }
  const payload = data as unknown as { total: number; limit: number; offset: number; rows: unknown[] };
  if (!payload || !Array.isArray(payload.rows) || !Number.isFinite(payload.total)) throw new AcquisitionReadError('acquisition_read_unavailable', 503);
  res.json({ coverage: 'governed_native_committed', historicalLegacyImported: false, ...payload });
}));

router.get('/facets', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  const { data, error } = await client.rpc('get_acquisition_facets' as never, { p_workspace_id: workspaceId } as never);
  if (error) throw new AcquisitionReadError('dependency_failed', 502);
  if (!data || typeof data !== 'object') throw new AcquisitionReadError('acquisition_read_unavailable', 503);
  res.json({ coverage: 'governed_native_committed', historicalLegacyImported: false, facets: data });
}));

router.get('/lines/:publicId',requireMember,asyncRoute(async(req,res)=>{
  const {workspaceId,client}=caller(req); const {data,error}=await client.rpc('get_acquisition_line_detail' as never,{p_workspace_id:workspaceId,p_acquisition_line_public_id:publicId(req.params.publicId)} as never);
  if(error) throw rpcError(error); if(!data) throw new AcquisitionReadError('acquisition_not_found',404); res.json(data);
}));
router.post('/lines/:publicId/classify',requireOperator,asyncRoute(async(req,res)=>{
 const {workspaceId,client}=caller(req); const {data,error}=await client.rpc('classify_acquisition_line_by_public_id' as never,{p_workspace_id:workspaceId,p_acquisition_line_public_id:publicId(req.params.publicId)} as never); if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);
}));
router.post('/lines/:publicId/classification-override',requireOwner,asyncRoute(async(req,res)=>{
 const {workspaceId,client}=caller(req); const {data,error}=await client.rpc('override_acquisition_line_classification_by_public_id' as never,{p_workspace_id:workspaceId,p_acquisition_line_public_id:publicId(req.params.publicId),p_classification_option_key:bodyText(req.body?.classificationOptionKey),p_reason:bodyText(req.body?.reason)} as never);if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);
}));
router.post('/orders/:orderPublicId/payments',requireOperator,asyncRoute(async(req,res)=>{
 const {workspaceId,client}=caller(req); const amount=req.body?.amountMinor;if(!Number.isSafeInteger(amount)||amount<=0)throw new AcquisitionReadError('invalid_amount',400);const currency=bodyText(req.body?.currency,'invalid_currency',3,3);if(!/^[A-Z]{3}$/.test(currency))throw new AcquisitionReadError('invalid_currency',400);const instrument=bodyText(req.body?.instrument,'invalid_instrument');if(!INSTRUMENTS.has(instrument))throw new AcquisitionReadError('invalid_instrument',400);
 const {data,error}=await client.rpc('record_acquisition_payment' as never,{p_workspace_id:workspaceId,p_acquisition_order_public_id:publicId(req.params.orderPublicId),p_paid_at:isoDate(req.body?.paidAt,true),p_amount_minor:amount,p_currency:currency,p_instrument:instrument,p_external_reference:optionalBodyText(req.body?.externalReference,200),p_source_record_id:null,p_evidence_note:optionalBodyText(req.body?.evidenceNote,1000),p_idempotency_key:bodyText(req.body?.idempotencyKey,'invalid_request',8,200)} as never);if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);
}));
router.post('/payments/:paymentPublicId/reverse',requireOwner,asyncRoute(async(req,res)=>{const {workspaceId,client}=caller(req);const {data,error}=await client.rpc('reverse_acquisition_payment' as never,{p_workspace_id:workspaceId,p_payment_public_id:publicId(req.params.paymentPublicId),p_reason:bodyText(req.body?.reason),p_idempotency_key:bodyText(req.body?.idempotencyKey,'invalid_request',8,200)} as never);if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);}));
router.post('/orders/:orderPublicId/shipments',requireOperator,asyncRoute(async(req,res)=>{const {workspaceId,client}=caller(req);const status=bodyText(req.body?.status??'expected');if(!SHIPMENT_STATES.has(status))throw new AcquisitionReadError('invalid_transition',400);const cost=req.body?.shippingCostMinor??null;if(cost!==null&&(!Number.isSafeInteger(cost)||cost<0))throw new AcquisitionReadError('invalid_amount',400);const currency=optionalBodyText(req.body?.currency,3);if(currency!==null&&!/^[A-Z]{3}$/.test(currency))throw new AcquisitionReadError('invalid_currency',400);const {data,error}=await client.rpc('create_acquisition_shipment' as never,{p_workspace_id:workspaceId,p_acquisition_order_public_id:publicId(req.params.orderPublicId),p_carrier:optionalBodyText(req.body?.carrier,100),p_tracking_number:optionalBodyText(req.body?.trackingNumber,200),p_shipped_at:isoDate(req.body?.shippedAt),p_expected_at:isoDate(req.body?.expectedAt),p_status:status,p_shipping_cost_minor:cost,p_currency:currency,p_source_record_id:null,p_evidence_note:optionalBodyText(req.body?.evidenceNote,1000),p_idempotency_key:bodyText(req.body?.idempotencyKey,'invalid_request',8,200)} as never);if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);}));
router.post('/shipments/:shipmentPublicId/transition',requireOperator,asyncRoute(async(req,res)=>{const {workspaceId,client}=caller(req);const expected=bodyText(req.body?.expectedStatus),next=bodyText(req.body?.newStatus);if(!SHIPMENT_STATES.has(expected)||!SHIPMENT_STATES.has(next))throw new AcquisitionReadError('invalid_transition',400);const {data,error}=await client.rpc('transition_acquisition_shipment' as never,{p_workspace_id:workspaceId,p_shipment_public_id:publicId(req.params.shipmentPublicId),p_expected_status:expected,p_new_status:next,p_received_at:isoDate(req.body?.receivedAt),p_reason:optionalBodyText(req.body?.reason,500),p_idempotency_key:bodyText(req.body?.idempotencyKey,'invalid_request',8,200)} as never);if(error)throw rpcError(error);if(!data)throw new AcquisitionReadError('dependency_failed',502);res.json(data);}));

// --- Channel registry (owner) --------------------------------------------------
router.post(
  '/channels',
  requireOwner,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client.rpc('register_channel' as never, {
      p_workspace_id: workspaceId,
      p_name: String(req.body?.name ?? ''),
      p_kind: String(req.body?.kind ?? 'marketplace'),
      p_description: req.body?.description ?? null,
      p_public_id: req.body?.publicId ?? null,
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, authoritative: false, channel: data });
  })
);

router.get(
  '/channels',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('channels')
      .select('id, public_id, name, kind, active, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, channels: data ?? [] });
  })
);

// --- Preview (operator): map a committed source job WITHOUT persisting ---------
router.post(
  '/preview',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const sourceImportJobId = String(req.body?.sourceImportJobId ?? '');
    if (!sourceImportJobId) {
      throw new AcquisitionMappingError('a sourceImportJobId is required', 400);
    }
    const rows = await readCommittedSourceRows(client, workspaceId, sourceImportJobId);
    const plan = buildAcquisitionPlan(rows, { sourceLabel: sourceImportJobId });
    res.json({
      ...summarizeAcquisitionPlan(plan),
      committed: false,
      sampleOrders: plan.orders.slice(0, 10),
      sampleDiscrepancies: plan.discrepancies.slice(0, 10),
      supplierCandidates: plan.supplierCandidates,
      note: 'Preview only. No acquisition record was created or modified.',
    });
  })
);

// --- Commit (operator): the governed end-to-end persistence path --------------
router.post(
  '/commit',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const sourceImportJobId = String(req.body?.sourceImportJobId ?? '');
    const channelId = String(req.body?.channelId ?? '');
    const idempotencyKey =
      typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
    if (!sourceImportJobId) throw new AcquisitionMappingError('a sourceImportJobId is required', 400);
    if (!channelId) throw new AcquisitionMappingError('a channelId is required', 400);

    const rows = await readCommittedSourceRows(client, workspaceId, sourceImportJobId);
    const plan = buildAcquisitionPlan(rows, { sourceLabel: sourceImportJobId });
    const outcome = await commitAcquisitionPlan(
      client,
      workspaceId,
      channelId,
      sourceImportJobId,
      plan,
      idempotencyKey
    );
    res.json({ staging: true, authoritative: false, ...outcome });
  })
);

// --- Explicit abandonment (operator) ------------------------------------------
// Marks a preview job 'failed'. This is a deliberate discard, NOT the recovery
// path: an interrupted commit leaves its job in 'preview' and is resumed by
// re-running /commit with the same idempotency key. Abandoning is terminal.
router.post(
  '/jobs/:id/abandon',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const id = await abandonAcquisitionJob(
      client,
      String(req.params.id),
      String(req.body?.failureCode ?? 'operator_abandoned'),
      typeof req.body?.failureDetail === 'string' ? req.body.failureDetail : undefined
    );
    res.json({ staging: true, abandonedJobId: id });
  })
);

// --- Stored acquisition data, read-only (members incl. viewers) ---------------
router.get(
  '/jobs',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('acquisition_import_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(readLimit(req.query.limit));
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, authoritative: false, jobs: data ?? [] });
  })
);

router.get(
  '/orders',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const limit = readLimit(req.query.limit, 50);
    const offset = readOffset(req.query.offset);
    const { data, error, count } = await client
      .from('acquisition_orders')
      .select(
        'id, public_id, source_order_reference, first_source_record_id, order_status, ' +
          'source_reported_status, source_reported_total_minor, currency, occurred_at, ' +
          'supplier_id, suppliers(public_id), created_at',
        { count: 'exact' }
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new SourceReadError(error.message, 400);
    res.json({
      staging: true,
      authoritative: false,
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
      orders: data ?? [],
    });
  })
);

// One order's full normalized picture: lots, lines (source vs normalized),
// cost components, allocations, and their provenance links.
router.get(
  '/orders/:id',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const orderId = req.params.id;

    const { data: order, error: oErr } = await client
      .from('acquisition_orders')
      .select('*, suppliers(public_id)')
      .eq('workspace_id', workspaceId)
      .eq('id', orderId)
      .limit(1);
    if (oErr) throw new SourceReadError(oErr.message, 400);
    if (!order || order.length === 0) {
      throw new SourceReadError('acquisition order not found', 404);
    }

    // Every subordinate query is error-checked: a failed lots/placements/lines/
    // components/allocations/audit query FAILS the request (closed) rather than
    // silently returning an empty section that could read as authoritative.
    const rq = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder: any
    ): Promise<Array<Record<string, unknown>>> => {
      const { data, error } = await builder;
      if (error) throw new SourceReadError((error as { message: string }).message, 400);
      return (data ?? []) as unknown as Array<Record<string, unknown>>;
    };

    const lots = await rq(
      client
        .from('acquisition_lots')
        .select('id, public_id, sequence_no, label')
        .eq('workspace_id', workspaceId)
        .eq('order_id', orderId)
        .order('sequence_no', { ascending: true })
    );
    const lotIds = lots.map((l) => String(l.id));

    // ALL placements (active + historical) for display; split by state.
    const placements =
      lotIds.length > 0
        ? await rq(
            client
              .from('acquisition_lot_lines')
              .select(
                'id, lot_id, line_item_id, sequence_no, state, superseded_by_id, ' +
                  'supersedes_id, created_at'
              )
              .eq('workspace_id', workspaceId)
              .in('lot_id', lotIds)
          )
        : [];
    const activePlacements = placements.filter((p) => p.state === 'active');
    const historicalPlacements = placements.filter((p) => p.state !== 'active');
    // A line belongs to THIS order's CURRENT total only through an ACTIVE
    // placement — a mere historical placement here does not count it.
    const currentLineIds = new Set(activePlacements.map((p) => String(p.line_item_id)));
    // Every line ever placed here (for display), current or historical.
    const allLineIds = [...new Set(placements.map((p) => String(p.line_item_id)))];

    const lines =
      allLineIds.length > 0
        ? await rq(
            client
              .from('acquisition_line_items')
              .select(
                'id, public_id, quantity, description, reference_number, source_detail, ' +
                  'source_record_id, external_identifier_id, created_at'
              )
              .eq('workspace_id', workspaceId)
              .in('id', allLineIds)
          )
        : [];

    // Components of every scope that bears on this order (for display), fetched
    // separately and merged, then split into current (unreversed) vs historical.
    const componentById = new Map<string, Record<string, unknown>>();
    for (const c of allLineIds.length > 0
      ? await rq(
          client
            .from('acquisition_cost_components')
            .select('*')
            .eq('workspace_id', workspaceId)
            .in('line_item_id', allLineIds)
        )
      : []) {
      componentById.set(String(c.id), c);
    }
    for (const c of lotIds.length > 0
      ? await rq(
          client
            .from('acquisition_cost_components')
            .select('*')
            .eq('workspace_id', workspaceId)
            .in('lot_id', lotIds)
        )
      : []) {
      componentById.set(String(c.id), c);
    }
    for (const c of await rq(
      client
        .from('acquisition_cost_components')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('order_id', orderId)
    )) {
      componentById.set(String(c.id), c);
    }
    const components = [...componentById.values()];
    const componentIds = [...componentById.keys()];
    // A component is CURRENT for this order iff it is unreversed AND, when it is
    // line-scoped, its line currently belongs to the order through an ACTIVE
    // placement. A reversed component, or a line-scoped one whose line is only
    // HISTORICALLY placed here (e.g. moved to another order), is historical.
    const isCurrentComponent = (c: Record<string, unknown>): boolean => {
      if (c.reversed_at != null) return false;
      if (c.line_item_id != null && !currentLineIds.has(String(c.line_item_id))) return false;
      return true;
    };
    const currentComponents = components.filter(isCurrentComponent);
    const historicalComponents = components.filter((c) => !isCurrentComponent(c));
    const currentComponentIds = new Set(currentComponents.map((c) => String(c.id)));

    // Allocations split by whether they belong to a CURRENT component and are
    // not themselves reversed; everything else is history.
    const allocations =
      componentIds.length > 0
        ? await rq(
            client
              .from('acquisition_cost_allocations')
              .select(
                'id, public_id, cost_component_id, line_item_id, amount_minor, method, ' +
                  'state, reviewed_by, reviewed_at, reversed_at, created_at'
              )
              .eq('workspace_id', workspaceId)
              .in('cost_component_id', componentIds)
          )
        : [];
    const currentAllocations = allocations.filter(
      (a) => a.state !== 'reversed' && currentComponentIds.has(String(a.cost_component_id))
    );
    const reversedAllocations = allocations.filter(
      (a) => a.state === 'reversed' || !currentComponentIds.has(String(a.cost_component_id))
    );

    // Reconciliation counts ONLY the current component set (already excludes
    // reversed components and lines no longer actively placed here), so a
    // reversed component and its replacement are never both counted, and a line
    // with merely a historical placement never inflates the current total.
    let knownComponentMinor = 0;
    let unknownCount = 0;
    let unresolvedCount = 0;
    for (const c of currentComponents) {
      if (c.amount_state === 'known' && typeof c.amount_minor === 'number') {
        knownComponentMinor += c.amount_minor;
      }
      if (c.amount_state === 'unknown') unknownCount += 1;
      if (c.attribution_state === 'unresolved') unresolvedCount += 1;
    }
    const orderRow = order[0] as Record<string, unknown>;
    const sourceTotal =
      typeof orderRow.source_reported_total_minor === 'number'
        ? orderRow.source_reported_total_minor
        : null;
    const discrepancy = {
      sourceReportedTotalMinor: sourceTotal,
      normalizedKnownComponentMinor: knownComponentMinor,
      differenceMinor: sourceTotal === null ? null : sourceTotal - knownComponentMinor,
      unknownComponentCount: unknownCount,
      unresolvedComponentCount: unresolvedCount,
    };

    const auditTargets = [orderId, ...lotIds, ...allLineIds, ...componentIds];
    const auditEvents =
      auditTargets.length > 0
        ? await rq(
            client
              .from('audit_events')
              .select('id, event_seq, event_type, entity_table, entity_id, created_at')
              .eq('workspace_id', workspaceId)
              .in('entity_id', auditTargets)
              .order('event_seq', { ascending: false })
              .limit(MAX_PAGE)
          )
        : [];

    res.json({
      staging: true,
      authoritative: false,
      order: orderRow,
      lots,
      placements,
      activePlacements,
      historicalPlacements,
      lines,
      costComponents: components,
      currentComponents,
      historicalComponents,
      allocations,
      currentAllocations,
      reversedAllocations,
      discrepancy,
      auditEvents,
    });
  })
);

router.get(
  '/suppliers',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    // suppliers has no source_system_id column; a supplier's source system is
    // carried by its aliases (a supplier can be sourced from more than one).
    const { data: suppliers, error } = await client
      .from('suppliers')
      .select('id, public_id, display_name, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(readLimit(req.query.limit, 100));
    if (error) throw new SourceReadError(error.message, 400);
    const { data: aliases, error: aliasError } = await client
      .from('supplier_aliases')
      .select(
        'id, supplier_id, raw_handle, normalized_handle, source_system_id, ' +
          'first_seen_source_record_id'
      )
      .eq('workspace_id', workspaceId)
      .limit(MAX_PAGE);
    // A failed alias query closes the request rather than returning an empty
    // alias list that would hide a supplier's source system.
    if (aliasError) throw new SourceReadError(aliasError.message, 400);
    res.json({ staging: true, suppliers: suppliers ?? [], aliases: aliases ?? [] });
  })
);

// Unresolved supplier candidates: normalized handles that span >1 supplier and
// were deliberately NOT merged. Computed from aliases, presented for review.
router.get(
  '/supplier-candidates',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data: aliases, error } = await client
      .from('supplier_aliases')
      .select('supplier_id, raw_handle, normalized_handle, source_system_id')
      .eq('workspace_id', workspaceId);
    if (error) throw new SourceReadError(error.message, 400);
    // Group by (source_system_id, normalized_handle) — matching the database
    // finalization contract, which counts candidates WITHIN a source system.
    // Identical normalized handles from unrelated source systems are never
    // combined into one candidate.
    const byKey = new Map<
      string,
      {
        sourceSystemId: string;
        normalizedHandle: string;
        rawHandles: Set<string>;
        suppliers: Set<string>;
      }
    >();
    for (const a of aliases ?? []) {
      const row = a as Record<string, string>;
      const key = `${row.source_system_id}|${row.normalized_handle}`;
      const g =
        byKey.get(key) ??
        {
          sourceSystemId: row.source_system_id,
          normalizedHandle: row.normalized_handle,
          rawHandles: new Set<string>(),
          suppliers: new Set<string>(),
        };
      g.rawHandles.add(row.raw_handle);
      g.suppliers.add(row.supplier_id);
      byKey.set(key, g);
    }
    const candidates = [...byKey.values()]
      .filter((g) => g.suppliers.size > 1)
      .map((g) => ({
        sourceSystemId: g.sourceSystemId,
        normalizedHandle: g.normalizedHandle,
        rawHandles: [...g.rawHandles].sort(),
        supplierCount: g.suppliers.size,
      }));
    res.json({ staging: true, candidates });
  })
);

router.get(
  '/cost-allocations',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('acquisition_cost_allocations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(readLimit(req.query.limit, 100));
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, allocations: data ?? [] });
  })
);

router.get(
  '/issues',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('data_quality_issues')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(readLimit(req.query.limit, 100));
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, issues: data ?? [] });
  })
);

router.get(
  '/audit-events',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('audit_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('event_seq', { ascending: false })
      .limit(readLimit(req.query.limit, 100));
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, appendOnly: true, auditEvents: data ?? [] });
  })
);

// --- Governed cost review actions (operator) ----------------------------------
// Each is a single governed RPC; there is deliberately no direct-table write in
// this file. The database grants the caller SELECT only.
router.post(
  '/cost-components/:id/reverse',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('reverse_cost_component' as never, {
      p_cost_component_id: req.params.id,
      p_replacement: req.body?.replacement ?? {},
      p_reason: req.body?.note ?? null,
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, result: data });
  })
);

router.post(
  '/cost-components/:id/allocations',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('propose_cost_allocation' as never, {
      p_cost_component_id: req.params.id,
      p_method: String(req.body?.method ?? ''),
      p_allocations: req.body?.allocations ?? [],
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, result: data });
  })
);

router.post(
  '/cost-components/:id/allocations/confirm',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('confirm_cost_allocation' as never, {
      p_cost_component_id: req.params.id,
      p_expected_total_minor: Number(req.body?.expectedTotalMinor ?? -1),
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, result: data });
  })
);

router.post(
  '/cost-components/:id/allocations/reverse',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('reverse_cost_allocation' as never, {
      p_cost_component_id: req.params.id,
      p_reason: req.body?.note ?? null,
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, result: data });
  })
);

router.post(
  '/lot-lines/:id/supersede',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('supersede_lot_line' as never, {
      p_lot_line_id: req.params.id,
      p_new_lot_id: String(req.body?.newLotId ?? ''),
      p_note: req.body?.note ?? null,
    } as never);
    if (error) throw new AcquisitionCommitError((error as { message: string }).message, 409);
    res.json({ staging: true, result: data });
  })
);

// Structured errors; never leaks a filesystem path or caller input.
router.use(
  (
    err: unknown,
    _req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    if (err instanceof AcquisitionMappingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SourceReadError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AcquisitionCommitError) {
      res.status(err.status).json({ error: err.message, importJobId: err.importJobId });
      return;
    }
    if (err instanceof AcquisitionReadError) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    next(err);
  }
);

export default router;

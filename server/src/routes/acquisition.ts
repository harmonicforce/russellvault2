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
import { commitAcquisitionPlan, AcquisitionCommitError } from '../acquisition/commitDriver.js';

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
        'id, public_id, source_order_reference, order_status, source_reported_status, ' +
          'source_reported_total_minor, currency, occurred_at, supplier_id, ' +
          'suppliers(public_id), created_at',
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

    const { data: lotData } = await client
      .from('acquisition_lots')
      .select('id, public_id, sequence_no, label')
      .eq('workspace_id', workspaceId)
      .eq('order_id', orderId)
      .order('sequence_no', { ascending: true });
    const lots = (lotData ?? []) as unknown as Array<Record<string, unknown>>;

    // Every line placed in this order's lots (active or superseded), via
    // lot-line placements, so the order view shows the full picture.
    const lotIds = lots.map((l) => String(l.id));
    const placements =
      lotIds.length > 0
        ? (
            (
              await client
                .from('acquisition_lot_lines')
                .select('line_item_id')
                .eq('workspace_id', workspaceId)
                .in('lot_id', lotIds)
            ).data ?? []
          ) as unknown as Array<Record<string, unknown>>
        : [];
    const lineIds = [...new Set(placements.map((p) => String(p.line_item_id)))];

    const lines =
      lineIds.length > 0
        ? (
            (
              await client
                .from('acquisition_line_items')
                .select(
                  'id, public_id, quantity, description, reference_number, source_detail, ' +
                    'source_record_id, external_identifier_id, created_at'
                )
                .eq('workspace_id', workspaceId)
                .in('id', lineIds)
            ).data ?? []
          ) as unknown as Array<Record<string, unknown>>
        : [];

    const components =
      lineIds.length > 0
        ? (
            (
              await client
                .from('acquisition_cost_components')
                .select('*')
                .eq('workspace_id', workspaceId)
                .in('line_item_id', lineIds)
            ).data ?? []
          ) as unknown as Array<Record<string, unknown>>
        : [];

    res.json({
      staging: true,
      authoritative: false,
      order: order[0],
      lots,
      lines,
      costComponents: components,
    });
  })
);

router.get(
  '/suppliers',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data: suppliers, error } = await client
      .from('suppliers')
      .select('id, public_id, source_system_id, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(readLimit(req.query.limit, 100));
    if (error) throw new SourceReadError(error.message, 400);
    const { data: aliases } = await client
      .from('supplier_aliases')
      .select('id, supplier_id, raw_handle, normalized_handle, source_system_id')
      .eq('workspace_id', workspaceId)
      .limit(MAX_PAGE);
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
      .select('supplier_id, raw_handle, normalized_handle')
      .eq('workspace_id', workspaceId);
    if (error) throw new SourceReadError(error.message, 400);
    const byNorm = new Map<string, { rawHandles: Set<string>; suppliers: Set<string> }>();
    for (const a of aliases ?? []) {
      const row = a as Record<string, string>;
      const g = byNorm.get(row.normalized_handle) ?? {
        rawHandles: new Set<string>(),
        suppliers: new Set<string>(),
      };
      g.rawHandles.add(row.raw_handle);
      g.suppliers.add(row.supplier_id);
      byNorm.set(row.normalized_handle, g);
    }
    const candidates = [...byNorm.entries()]
      .filter(([, g]) => g.suppliers.size > 1)
      .map(([normalizedHandle, g]) => ({
        normalizedHandle,
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
    next(err);
  }
);

export default router;

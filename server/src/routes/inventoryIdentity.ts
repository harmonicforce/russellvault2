// Phase 5 inventory-identity API — restricted, authenticated, workspace-scoped,
// and STRICTLY READ-ONLY. STAGING / NON-AUTHORITATIVE: the legacy SQLite
// application (served by routes/inventory.ts at /api/inventory) remains the
// authoritative system of record. This router exposes only the shadow Supabase
// identity hierarchy (product / SKU / lot / item / location) for diagnostics.
//
// It reuses the Phase 3/4 gates unchanged:
//   * Availability: every route 404s unless the shadow import surface is
//     enabled and the shadow Supabase URL/anon key are configured.
//   * Authorization: every route requires a valid caller bearer token and an
//     explicit workspaceId, resolved through the shadow Supabase client running
//     under that caller JWT, so RLS is the single authorization model.
//
// NO mutation endpoint exists here: no intake, movement, count, listing, sale,
// or reconciliation. Every query is error-checked and FAILS CLOSED — a query
// error returns an explicit error status, never a silently empty result that
// could read as authoritative.

import { Router } from 'express';
import { requireMember, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import { SourceReadError } from '../acquisition/sourceReader.js';

const router = Router();

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
  if (!req.caller) throw new SourceReadError('caller not resolved', 500);
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

// The caller's ACTUAL role, resolved by the database for the caller's JWT.
router.get(
  '/session',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, role } = caller(req);
    res.json({ staging: true, authoritative: false, workspaceId, role });
  })
);

// Generic paged list over one identity table, workspace-scoped and fail-closed.
function listRoute(
  path: string,
  table: string,
  columns: string,
  orderColumn: string
): void {
  router.get(
    path,
    requireMember,
    asyncRoute(async (req, res) => {
      const { workspaceId, client } = caller(req);
      const limit = readLimit(req.query.limit);
      const offset = readOffset(req.query.offset);
      const { data, error, count } = await client
        .from(table)
        .select(columns, { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .order(orderColumn, { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw new SourceReadError(error.message, 400);
      res.json({
        staging: true,
        authoritative: false,
        total: count ?? (data?.length ?? 0),
        limit,
        offset,
        rows: data ?? [],
      });
    })
  );
}

// Generic single-row detail by internal id, workspace-scoped and fail-closed.
function detailRoute(path: string, table: string, notFound: string): void {
  router.get(
    path,
    requireMember,
    asyncRoute(async (req, res) => {
      const { workspaceId, client } = caller(req);
      const { data, error } = await client
        .from(table)
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', req.params.id)
        .limit(1);
      if (error) throw new SourceReadError(error.message, 400);
      if (!data || data.length === 0) throw new SourceReadError(notFound, 404);
      res.json({ staging: true, authoritative: false, record: data[0] });
    })
  );
}

listRoute('/products', 'product_catalog', 'id, public_id, business_vertical, display_name, product_canonical_key, identity_schema_version, created_at', 'created_at');
detailRoute('/products/:id', 'product_catalog', 'product not found');
listRoute('/skus', 'sellable_skus', 'id, public_id, product_id, business_vertical, identity_schema_version, fingerprint, is_active, created_at', 'created_at');
detailRoute('/skus/:id', 'sellable_skus', 'sellable sku not found');
listRoute('/lots', 'inventory_lots', 'id, public_id, sku_id, tracking_mode, quantity, location_id, record_origin, mapping_version, created_at', 'public_id');
detailRoute('/lots/:id', 'inventory_lots', 'inventory lot not found');
listRoute('/items', 'inventory_items', 'id, public_id, lot_id, sku_id, scan_sku, grading_company, certificate_number, serial_number, created_at', 'public_id');
detailRoute('/items/:id', 'inventory_items', 'inventory item not found');
listRoute('/locations', 'storage_locations', 'id, public_id, location_code, parent_id, display_name, retired_at, created_at', 'location_code');
detailRoute('/locations/:id', 'storage_locations', 'storage location not found');

// Exact public-id lookup across every governed identity entity. Returns exactly
// one authorized record (with its kind) or an explicit not-found.
const PUBLIC_ID_TARGETS: ReadonlyArray<{ kind: string; table: string }> = [
  { kind: 'product', table: 'product_catalog' },
  { kind: 'sku', table: 'sellable_skus' },
  { kind: 'lot', table: 'inventory_lots' },
  { kind: 'item', table: 'inventory_items' },
  { kind: 'location', table: 'storage_locations' },
];
router.get(
  '/lookup/public-id/:publicId',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const publicId = String(req.params.publicId);
    for (const target of PUBLIC_ID_TARGETS) {
      const { data, error } = await client
        .from(target.table)
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('public_id', publicId)
        .limit(1);
      if (error) throw new SourceReadError(error.message, 400);
      if (data && data.length > 0) {
        res.json({ staging: true, authoritative: false, kind: target.kind, record: data[0] });
        return;
      }
    }
    throw new SourceReadError('no identity record with that public id', 404);
  })
);

// Fetch exactly one row by a column, workspace-scoped, failing closed. Returns
// null only when the row genuinely does not exist (not on a query error).
async function oneBy(
  client: ReturnType<typeof caller>['client'],
  workspaceId: string,
  table: string,
  column: string,
  value: string | null
): Promise<Record<string, unknown> | null> {
  if (value === null) return null;
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq(column, value)
    .limit(1);
  if (error) throw new SourceReadError(error.message, 400);
  return data && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
}

async function childCount(
  client: ReturnType<typeof caller>['client'],
  workspaceId: string,
  lotId: string
): Promise<number> {
  const { count, error } = await client
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('lot_id', lotId);
  if (error) throw new SourceReadError(error.message, 400);
  return count ?? 0;
}

// Joined lot identity: Product -> Sellable SKU -> Lot -> Location, plus the
// serialized child count and capacity. Every subordinate query fails closed.
router.get(
  '/lots/:id/detail',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const lotId = String(req.params.id);
    const lot = await oneBy(client, workspaceId, 'inventory_lots', 'id', lotId);
    if (!lot) throw new SourceReadError('inventory lot not found', 404);
    const sku = await oneBy(client, workspaceId, 'sellable_skus', 'id', String(lot['sku_id']));
    const product = sku
      ? await oneBy(client, workspaceId, 'product_catalog', 'id', String(sku['product_id']))
      : null;
    const location = await oneBy(
      client,
      workspaceId,
      'storage_locations',
      'id',
      lot['location_id'] ? String(lot['location_id']) : null
    );
    const children = await childCount(client, workspaceId, lotId);
    const serialized = lot['tracking_mode'] === 'serialized';
    res.json({
      staging: true,
      authoritative: false,
      product,
      sku,
      lot,
      location,
      serializedChildCount: children,
      capacity: serialized ? Number(lot['quantity']) : null,
      atCapacity: serialized ? children >= Number(lot['quantity']) : false,
    });
  })
);

// Find the intake entry (if any) that committed this item, then its group and
// originating session — so Item Detail can offer a readable link back to the
// intake session rather than a raw id, without fabricating one when the item
// was not created through the intake kernel (e.g. legacy-imported fixtures).
async function originatingSession(
  client: ReturnType<typeof caller>['client'],
  workspaceId: string,
  itemId: string
): Promise<{
  sessionId: string; sessionPublicId: string; sessionLabel: string | null;
  groupId: string; groupPublicId: string;
  numericGrade: string | null; gradeDesignation: string | null;
} | null> {
  const { data: entryRows, error: entryErr } = await client
    .from('intake_entries')
    .select('group_id, numeric_grade, grade_designation')
    .eq('workspace_id', workspaceId)
    .eq('committed_item_id', itemId)
    .limit(1);
  if (entryErr) throw new SourceReadError(entryErr.message, 400);
  const entry = entryRows && entryRows.length > 0
    ? (entryRows[0] as { group_id: string; numeric_grade: string | null; grade_designation: string | null })
    : null;
  const groupId = entry ? String(entry.group_id) : null;
  if (!groupId) return null;

  const { data: groupRows, error: groupErr } = await client
    .from('intake_draft_groups')
    .select('id, public_id, session_id')
    .eq('workspace_id', workspaceId)
    .eq('id', groupId)
    .limit(1);
  if (groupErr) throw new SourceReadError(groupErr.message, 400);
  if (!groupRows || groupRows.length === 0) return null;
  const group = groupRows[0] as { id: string; public_id: string; session_id: string };

  const { data: sessionRows, error: sessionErr } = await client
    .from('intake_sessions')
    .select('id, public_id, label')
    .eq('workspace_id', workspaceId)
    .eq('id', group.session_id)
    .limit(1);
  if (sessionErr) throw new SourceReadError(sessionErr.message, 400);
  if (!sessionRows || sessionRows.length === 0) return null;
  const session = sessionRows[0] as { id: string; public_id: string; label: string | null };

  return {
    sessionId: session.id,
    sessionPublicId: session.public_id,
    sessionLabel: session.label,
    groupId: group.id,
    groupPublicId: group.public_id,
    numericGrade: entry?.numeric_grade ?? null,
    gradeDesignation: entry?.grade_designation ?? null,
  };
}

// Joined item identity: Product -> Sellable SKU -> Lot -> Item -> Location,
// plus (when resolvable) the intake session that originated it.
router.get(
  '/items/:id/detail',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const item = await oneBy(client, workspaceId, 'inventory_items', 'id', String(req.params.id));
    if (!item) throw new SourceReadError('inventory item not found', 404);
    const lot = await oneBy(client, workspaceId, 'inventory_lots', 'id', String(item['lot_id']));
    const sku = await oneBy(client, workspaceId, 'sellable_skus', 'id', String(item['sku_id']));
    const product = sku
      ? await oneBy(client, workspaceId, 'product_catalog', 'id', String(sku['product_id']))
      : null;
    const location = await oneBy(
      client,
      workspaceId,
      'storage_locations',
      'id',
      lot && lot['location_id'] ? String(lot['location_id']) : null
    );
    const session = await originatingSession(client, workspaceId, String(item['id']));
    res.json({ staging: true, authoritative: false, product, sku, lot, item, location, session });
  })
);

// Exact unit scan-SKU lookup — one authorized serialized item or a not-found.
router.get(
  '/lookup/scan/:scanSku',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('inventory_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('scan_sku', String(req.params.scanSku))
      .limit(1);
    if (error) throw new SourceReadError(error.message, 400);
    if (!data || data.length === 0) {
      throw new SourceReadError('no serialized item with that scan sku', 404);
    }
    res.json({ staging: true, authoritative: false, kind: 'item', record: data[0] });
  })
);

// ---- Current Inventory: search + filter over the joined overview ----------
// Backs the new Current Inventory page. Reads the security-invoker
// inventory_item_overview view (item -> lot -> sku -> product -> location) so
// the UI can search/filter in plain language without a raw id anywhere.
const OVERVIEW_COLUMNS =
  'item_id, item_public_id, scan_sku, grading_company, certificate_number, serial_number, ' +
  'item_created_at, lot_id, lot_public_id, tracking_mode, lot_quantity, location_id, ' +
  'location_public_id, location_code, location_display_name, location_retired_at, ' +
  'sku_id, sku_public_id, business_vertical, product_id, product_public_id, product_display_name';

router.get(
  '/overview',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const limit = readLimit(req.query.limit);
    const offset = readOffset(req.query.offset);
    let q = client
      .from('inventory_item_overview')
      .select(OVERVIEW_COLUMNS, { count: 'exact' })
      .eq('workspace_id', workspaceId);

    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (term) {
      const escaped = term.replace(/[%,]/g, (c) => `\\${c}`);
      q = q.or(
        [
          `product_display_name.ilike.%${escaped}%`,
          `item_public_id.ilike.%${escaped}%`,
          `scan_sku.ilike.%${escaped}%`,
          `certificate_number.ilike.%${escaped}%`,
        ].join(',')
      );
    }
    if (typeof req.query.gradingCompany === 'string' && req.query.gradingCompany) {
      q = q.eq('grading_company', req.query.gradingCompany);
    }
    if (typeof req.query.locationId === 'string' && req.query.locationId) {
      q = q.eq('location_id', req.query.locationId);
    }
    if (typeof req.query.trackingMode === 'string' && req.query.trackingMode) {
      q = q.eq('tracking_mode', req.query.trackingMode);
    }

    const { data, error, count } = await q
      .order('item_created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new SourceReadError(error.message, 400);
    res.json({
      staging: true,
      authoritative: false,
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
      rows: data ?? [],
    });
  })
);

// ---- Dashboard summary: Supabase-workspace-scoped counts -------------------
router.get(
  '/summary',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [lotsResult, itemsResult, recentItemsResult, sessionsResult] = await Promise.all([
      client.from('inventory_lots').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      client.from('inventory_items').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      client
        .from('inventory_items')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('created_at', sevenDaysAgo),
      client
        .from('intake_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('state', 'open'),
    ]);
    for (const r of [lotsResult, itemsResult, recentItemsResult, sessionsResult]) {
      if (r.error) throw new SourceReadError(r.error.message, 400);
    }
    const totalLots = lotsResult.count ?? 0;
    const serializedItems = itemsResult.count ?? 0;
    const itemsLast7Days = recentItemsResult.count ?? 0;
    const openSessions = sessionsResult.count ?? 0;

    const { count: unlocatedCount, error: unlocatedErr } = await client
      .from('inventory_item_overview')
      .select('item_id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .or('location_id.is.null,location_retired_at.not.is.null');
    if (unlocatedErr) throw new SourceReadError(unlocatedErr.message, 400);

    res.json({
      staging: true,
      authoritative: false,
      totalLots,
      serializedItems,
      itemsAddedLast7Days: itemsLast7Days,
      openIntakeSessions: openSessions,
      itemsWithoutActiveLocation: unlocatedCount ?? 0,
    });
  })
);

export default router;

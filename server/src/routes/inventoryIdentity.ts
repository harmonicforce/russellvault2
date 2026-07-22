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

export default router;

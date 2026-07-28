// Storage location management — authenticated, workspace-scoped, fail-closed.
//
// STAGING / NON-AUTHORITATIVE, same gates and posture as the intake kernel and
// inventory-identity routers: 404 unless the shadow flags + Supabase URL/anon
// key are configured, every request needs a bearer token + explicit
// workspaceId, and every mutation calls a governed SECURITY DEFINER database
// function (register_storage_location / retire_storage_location) under the
// CALLER'S OWN JWT — there is no service-role key anywhere on this path.
// Reads allow any member; create/retire require owner or operator.

import { Router } from 'express';
import { requireMember, requireOperator, type AuthedRequest } from '../provenance/auth.js';
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

function body(req: AuthedRequest): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

const LOCATION_COLUMNS =
  'id, public_id, location_code, parent_id, display_name, retired_at, created_at, updated_at';

// List locations for the workspace. Active by default; ?includeRetired=1 adds
// retired rows too, so the UI can show them in a distinct "Retired" view.
router.get(
  '/',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const includeRetired = req.query.includeRetired === '1' || req.query.includeRetired === 'true';
    let q = client
      .from('storage_locations')
      .select(LOCATION_COLUMNS)
      .eq('workspace_id', workspaceId);
    if (!includeRetired) q = q.is('retired_at', null);
    const { data, error } = await q.order('location_code', { ascending: true });
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ locations: data ?? [] });
  })
);

// Lot/item reference counts per location, so the list view can show usage
// without a separate round trip per row.
router.get(
  '/reference-counts',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('inventory_lots')
      .select('location_id')
      .eq('workspace_id', workspaceId)
      .not('location_id', 'is', null);
    if (error) throw new SourceReadError(error.message, 400);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { location_id: string }[]) {
      counts[row.location_id] = (counts[row.location_id] ?? 0) + 1;
    }
    res.json({ counts });
  })
);

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

router.post(
  '/',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const b = body(req);
    const locationCode = readString(b.locationCode);
    if (!locationCode) throw new SourceReadError('a location code is required', 400);
    const { data, error } = await client.rpc('register_storage_location' as never, {
      p_workspace_id: workspaceId,
      p_location_code: locationCode,
      p_parent_code: readString(b.parentCode),
      p_display_name: readString(b.displayName),
    } as never);
    if (error) throw new SourceReadError(mapLocationError(error.message), 400);
    res.json({ location: data });
  })
);

router.post(
  '/:code/retire',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client.rpc('retire_storage_location' as never, {
      p_workspace_id: workspaceId,
      p_location_code: req.params.code,
    } as never);
    if (error) throw new SourceReadError(mapLocationError(error.message), 400);
    res.json({ location: data });
  })
);

// The governed functions raise plain Postgres messages; translate the two an
// operator can actually cause into plain language. Anything else passes
// through as-is rather than guessing.
function mapLocationError(message: string): string {
  if (/parent location .* not found/i.test(message)) {
    return 'That parent location does not exist. Choose an existing location, or leave it blank for a top-level location.';
  }
  if (/retry conflicts with stored hierarchy or label/i.test(message)) {
    return 'That location code is already used with a different parent or name. Choose a different code.';
  }
  if (/location .* not found/i.test(message)) {
    return 'That location does not exist.';
  }
  return message;
}

router.use((err: unknown, _req: AuthedRequest, res: import('express').Response,
  next: import('express').NextFunction) => {
  if (err instanceof SourceReadError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;

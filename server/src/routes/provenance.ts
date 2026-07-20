// Phase 3 provenance API — restricted, authenticated, workspace-scoped.
//
// AVAILABILITY vs AUTHORIZATION — these are separate and both enforced:
//   * Availability: every route 404s unless SHADOW_IMPORT=repository-fixtures
//     AND the shadow Supabase URL/anon key are configured. With the flags
//     absent — the deployed default — this router is inert and the legacy
//     SQLite application is unaffected.
//   * Authorization: the flag grants nobody anything. EVERY route below
//     additionally requires a valid caller bearer token and an explicit
//     workspaceId, and resolves membership through the shadow Supabase client
//     running under that same caller JWT (see provenance/auth.ts). No route is
//     reachable anonymously, and no fixture metadata or raw payload is served
//     to a non-member.
//
// Permissions:
//   requireMember   — any member including viewers: read-only surfaces.
//   requireOperator — owner/operator: fixture previews, commits, review work.
//   requireOwner    — owner only: source-system registration.
//
// The server holds NO service-role key and no privileged database connection.
// Stored provenance is read and written exclusively through the caller's JWT,
// so RLS and the governed SECURITY DEFINER functions are the single
// authorization model — there is no second one here to drift from it.

import { Router } from 'express';
import {
  buildImportPlan,
  summarizePlan,
  ProvenanceError,
} from '../provenance/adapter.js';
import { listFixtures } from '../provenance/fixtures.js';
import { MAPPING_VERSION, PARSER_VERSION } from '../provenance/parsers.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  requireMember,
  requireOperator,
  requireOwner,
  type AuthedRequest,
} from '../provenance/auth.js';
import { commitImportPlan, CommitError } from '../provenance/commitDriver.js';

const router = Router();

// Availability gate. 404 (not 403) so a disabled deployment does not advertise
// that the surface exists at all.
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
  if (!req.caller) throw new ProvenanceError('caller not resolved', 500);
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

// --- Fixture metadata (members) ------------------------------------------------
// Requires membership: a non-member learns nothing about what can be imported.
router.get('/fixtures', requireMember, (_req, res) => {
  res.json({
    staging: true,
    authoritative: false,
    parserVersion: PARSER_VERSION,
    mappingVersion: MAPPING_VERSION,
    fixtures: listFixtures().map((f) => ({
      filename: f.filename,
      shape: f.shape,
      description: f.description,
    })),
  });
});

// --- Preview (operator/owner) ---------------------------------------------------
// Computes what an import WOULD record. Persists nothing.
router.post('/preview', requireOperator, (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    ...summarizePlan(plan),
    committed: false,
    note: 'Preview only. No provenance record was created or modified.',
  });
});

router.post('/preview/records', requireOperator, (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const limit = readLimit(req.body?.limit, 25);
  const offset = readOffset(req.body?.offset);
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    staging: true,
    sourceLabel: plan.sourceLabel,
    contentSha256: plan.contentSha256,
    total: plan.records.length,
    limit,
    offset,
    records: plan.records.slice(offset, offset + limit),
  });
});

router.post('/preview/issues', requireOperator, (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    staging: true,
    sourceLabel: plan.sourceLabel,
    total: plan.issues.length,
    issues: plan.issues.slice(0, MAX_PAGE),
  });
});

router.post('/preview/crosswalks', requireOperator, (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    staging: true,
    sourceLabel: plan.sourceLabel,
    total: plan.crosswalks.length,
    crosswalks: plan.crosswalks.slice(0, MAX_PAGE),
  });
});

// --- Commit (operator/owner) -------------------------------------------------------
// The real end-to-end persistence path: open a governed job, stage every exact
// raw row in batches, stage identifiers, issues and candidate crosswalks, then
// finalize transactionally. Runs entirely under the caller's JWT.
router.post(
  '/commit',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const filename = String(req.body?.filename ?? '');
    const sourceSystemId = String(req.body?.sourceSystemId ?? '');
    const idempotencyKey =
      typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : null;

    if (!sourceSystemId) {
      throw new ProvenanceError('a sourceSystemId is required', 400);
    }

    // Refuses without a sufficient idempotency key, before reading any bytes.
    const plan = buildImportPlan({ filename, mode: 'commit', idempotencyKey });

    const outcome = await commitImportPlan(client, workspaceId, sourceSystemId, plan);
    res.json({
      staging: true,
      authoritative: false,
      ...outcome,
      sourceLabel: plan.sourceLabel,
      fileSha256: plan.fileSha256,
      contentSha256: plan.contentSha256,
      parserVersion: plan.parserVersion,
      mappingVersion: plan.mappingVersion,
    });
  })
);

// --- Source systems -------------------------------------------------------------------
router.get(
  '/source-systems',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('source_systems')
      .select('id, public_id, kind, instance_label, active, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, sourceSystems: data ?? [] });
  })
);

router.post(
  '/source-systems',
  requireOwner,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client.rpc('register_source_system' as never, {
      p_workspace_id: workspaceId,
      p_public_id: String(req.body?.publicId ?? ''),
      p_kind: String(req.body?.kind ?? 'repository_fixture'),
      p_instance_label: String(req.body?.instanceLabel ?? ''),
      p_description: req.body?.description ?? null,
      p_config: req.body?.config ?? {},
    } as never);
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, id: data });
  })
);

// --- Stored provenance, read-only (members incl. viewers) ---------------------------------
router.get(
  '/jobs',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('import_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(readLimit(req.query.limit));
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, authoritative: false, jobs: data ?? [] });
  })
);

router.get(
  '/jobs/:id',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('import_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .limit(1);
    if (error) throw new ProvenanceError(error.message, 400);
    if (!data || data.length === 0) {
      // Same answer for "absent" and "another workspace's".
      throw new ProvenanceError('import job not found', 404);
    }
    res.json({ staging: true, authoritative: false, job: data[0] });
  })
);

router.get(
  '/jobs/:id/records',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const limit = readLimit(req.query.limit, 25);
    const offset = readOffset(req.query.offset);
    const { data, error, count } = await client
      .from('source_records')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('import_job_id', req.params.id)
      .order('source_row_index', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({
      staging: true,
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
      records: data ?? [],
    });
  })
);

router.get(
  '/jobs/:id/issues',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const { data, error } = await client
      .from('data_quality_issues')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('import_job_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, issues: data ?? [] });
  })
);

router.get(
  '/crosswalks',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const states =
      typeof req.query.states === 'string'
        ? req.query.states.split(',').filter(Boolean)
        : ['candidate', 'rejected', 'superseded'];
    const { data, error } = await client
      .from('source_crosswalks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('review_state', states)
      .order('created_at', { ascending: false })
      .limit(readLimit(req.query.limit));
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, crosswalks: data ?? [] });
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
    if (error) throw new ProvenanceError(error.message, 400);
    res.json({ staging: true, appendOnly: true, auditEvents: data ?? [] });
  })
);

// --- Governed review actions (operator/owner) -------------------------------------------------
// Each of these is a single governed RPC. There is deliberately no direct-table
// write anywhere in this file: the database grants the caller SELECT only.
// Two explicit routes rather than one parameterised action: Express 5's router
// no longer supports inline pattern groups, and naming each RPC at its own path
// keeps the mapping from route to governed function unambiguous.
function reviewRoute(action: 'confirm' | 'reject', fn: string) {
  router.post(
    `/crosswalks/:id/${action}`,
    requireOperator,
    asyncRoute(async (req, res) => {
      const { client } = caller(req);
      const { data, error } = await client.rpc(fn as never, {
        p_crosswalk_id: req.params.id,
        p_note: req.body?.note ?? null,
      } as never);
      if (error) throw new ProvenanceError(error.message, 409);
      res.json({ staging: true, id: data, action });
    })
  );
}

reviewRoute('confirm', 'confirm_source_crosswalk');
reviewRoute('reject', 'reject_source_crosswalk');

router.post(
  '/crosswalks/:id/supersede',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('supersede_source_crosswalk' as never, {
      p_crosswalk_id: req.params.id,
      p_replacement_id: String(req.body?.replacementId ?? ''),
      p_note: req.body?.note ?? null,
    } as never);
    if (error) throw new ProvenanceError(error.message, 409);
    res.json({ staging: true, replacementId: data });
  })
);

router.post(
  '/issues/:id/resolve',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client.rpc('resolve_data_quality_issue' as never, {
      p_issue_id: req.params.id,
      p_status: String(req.body?.status ?? 'resolved'),
      p_note: req.body?.note ?? null,
    } as never);
    if (error) throw new ProvenanceError(error.message, 409);
    res.json({ staging: true, id: data });
  })
);

// Structured errors; never leaks a filesystem path or a caller's input.
router.use(
  (
    err: unknown,
    _req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    if (err instanceof ProvenanceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof CommitError) {
      res.status(err.status).json({ error: err.message, importJobId: err.importJobId });
      return;
    }
    next(err);
  }
);

export default router;

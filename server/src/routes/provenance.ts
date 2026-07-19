// Phase 3 provenance API — restricted repository-fixture import surface.
//
// SAFE BY DEFAULT: every route in this router returns 404 unless the
// SHADOW_IMPORT=repository-fixtures flag is set. With the flag absent — the
// deployed default — this router is inert, reads nothing, and the legacy
// SQLite application behaves exactly as before.
//
// SCOPE: these routes perform the deterministic, READ-ONLY transformation of
// repository fixtures into an import plan. They deliberately do NOT write to
// any database. Persistence of the plan into the shadow database, and every
// read of committed provenance, happens through the shadow Supabase client
// under the caller's own JWT, so PostgREST + the Phase 3 RLS policies are the
// authorization boundary for stored rows (see client/src/lib/provenanceApi.ts).
// That keeps a single, database-enforced permission model rather than a second
// server-side one that could drift from it.
//
// Consequently nothing here can create a canonical acquisition or inventory
// record; there is no such endpoint and no such table.

import { Router } from 'express';
import {
  buildImportPlan,
  summarizePlan,
  ProvenanceError,
} from '../provenance/adapter.js';
import { listFixtures } from '../provenance/fixtures.js';
import { MAPPING_VERSION, PARSER_VERSION } from '../provenance/parsers.js';
import { isProvenanceEnabled } from '../provenance/config.js';

const router = Router();

// Gate every route. Responds 404 (not 403) so a disabled deployment does not
// advertise that the surface exists at all.
router.use((req, res, next) => {
  if (!isProvenanceEnabled(process.env)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
});

// Cap the response size for row-level endpoints so a 2,149-row fixture cannot
// be dumped in a single response by accident.
const MAX_PAGE = 200;

function readLimit(value: unknown): number {
  const n = Number(value ?? 50);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), MAX_PAGE);
}

function readOffset(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// Which fixtures may be imported, and the governed versions in force.
router.get('/fixtures', (_req, res) => {
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

// Preview: describes what an import WOULD record. Commits nothing, and cannot —
// the plan it returns carries mode 'preview', which the database refuses to
// promote to a committed job.
router.post('/preview', (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    ...summarizePlan(plan),
    committed: false,
    note: 'Preview only. No provenance record was created or modified.',
  });
});

// The rows a preview would record, paginated. Raw payloads are returned
// verbatim so a reviewer sees exactly what the source contained.
router.post('/preview/records', (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const limit = readLimit(req.body?.limit);
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

// The data-quality issues a preview would open, with their retained payloads.
router.post('/preview/issues', (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    staging: true,
    sourceLabel: plan.sourceLabel,
    total: plan.issues.length,
    issues: plan.issues.slice(0, MAX_PAGE),
  });
});

// The crosswalk candidates a preview would propose. Every one is 'candidate';
// this endpoint has no way to emit any other state.
router.post('/preview/crosswalks', (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const plan = buildImportPlan({ filename, mode: 'preview' });
  res.json({
    staging: true,
    sourceLabel: plan.sourceLabel,
    total: plan.crosswalks.length,
    crosswalks: plan.crosswalks.slice(0, MAX_PAGE),
  });
});

// Build the commit plan. REQUIRES an idempotency key; the adapter refuses
// without one, and commit_import_job() in the database refuses again when the
// plan is actually persisted. This endpoint still writes nothing itself.
router.post('/commit-plan', (req, res) => {
  const filename = String(req.body?.filename ?? '');
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : null;
  const plan = buildImportPlan({ filename, mode: 'commit', idempotencyKey });
  res.json({
    ...summarizePlan(plan),
    idempotencyKey: plan.idempotencyKey,
    recordCount: plan.records.length,
    note:
      'Commit plan only. Persisting it runs under the caller\'s own credentials ' +
      'and is subject to workspace RLS and the commit_import_job idempotency check.',
  });
});

// Structured errors; never leaks a filesystem path.
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
    next(err);
  }
);

export default router;

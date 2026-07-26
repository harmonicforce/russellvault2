// Phase 6A intake kernel API — authenticated, workspace-scoped, fail-closed.
//
// STAGING / NON-AUTHORITATIVE. This router exposes the reusable, server-
// authoritative intake state machine and transactional commit kernel that later
// Phase 6 surfaces (Quick Add, Batch, Guided, scanner recovery) reuse. It never
// touches legacy SQLite and creates no second committed inventory truth: every
// mutation calls a governed SECURITY DEFINER database function under the
// CALLER'S OWN JWT, so RLS + the function's internal role check are the single
// authorization model. There is no service-role key anywhere on this path.
//
// Gates (identical to the Phase 3-5 shadow surfaces):
//   * Availability — every route 404s unless the shadow flag + Supabase URL/anon
//     key are configured (the OPERATOR Quick Add UI is a separate, still-gated
//     deliverable; this is the backend kernel it will call).
//   * Authorization — every request needs a valid bearer token and an explicit
//     workspaceId; membership/role are answered by the database. Reads allow any
//     member (viewers included); every mutation requires owner/operator.

import { Router } from 'express';
import { requireMember, requireOperator, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import { SourceReadError } from '../acquisition/sourceReader.js';
import {
  IntakeRequestError,
  isIntakeCategory,
  optionalUuid,
  requireAttrs,
  requireContentHash,
  requireIdempotencyKey,
  requireQuantity,
  requireUuid,
  requireVersion,
} from '../intake/kernel.js';

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

// Every mutation is a single governed RPC. A DB error fails closed with an
// explicit status; a structured conflict/blocked result is a normal 200 body
// the client inspects (outcome: 'conflict' | 'blocked').
async function rpc(
  req: AuthedRequest,
  fn: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { client } = caller(req);
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) throw new SourceReadError((error as { message: string }).message, 400);
  return data;
}

function body(req: AuthedRequest): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

// ---- Sessions -------------------------------------------------------------
router.get(
  '/session',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, role } = caller(req);
    res.json({ staging: true, authoritative: false, workspaceId, role });
  })
);

router.post(
  '/sessions',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const label = typeof b.label === 'string' ? b.label : null;
    const data = await rpc(req, 'create_intake_session', {
      p_workspace_id: workspaceId,
      p_label: label,
    });
    res.json({ staging: true, authoritative: false, session: data });
  })
);

router.get(
  '/sessions/:id',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'resume_intake_session', {
      p_workspace_id: workspaceId,
      p_session_id: requireUuid(req.params.id, 'sessionId'),
    });
    res.json({ staging: true, authoritative: false, session: data });
  })
);

router.post(
  '/sessions/:id/abandon',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const data = await rpc(req, 'abandon_intake_session', {
      p_workspace_id: workspaceId,
      p_session_id: requireUuid(req.params.id, 'sessionId'),
      p_reason: typeof b.reason === 'string' ? b.reason : null,
    });
    res.json({ staging: true, authoritative: false, session: data });
  })
);

// ---- Governed config (read) ----------------------------------------------
router.get(
  '/field-registry',
  requireMember,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    const { data, error } = await client
      .from('intake_field_registry')
      .select('field_key, label, scope, business_vertical, data_type, reference_list_key, maps_to, is_identity_driving, is_factual')
      .order('field_key', { ascending: true });
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, fields: data ?? [] });
  })
);

router.get(
  '/field-rules',
  requireMember,
  asyncRoute(async (req, res) => {
    const { client } = caller(req);
    let q = client
      .from('intake_field_rules')
      .select('category, field_key, applicability, is_required, is_commit_blocker, condition, rule_version');
    if (typeof req.query.category === 'string') q = q.eq('category', req.query.category);
    const { data, error } = await q.order('field_key', { ascending: true });
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, rules: data ?? [] });
  })
);

// ---- Draft groups and entries --------------------------------------------
function groupArgs(workspaceId: string, groupId: string | null, b: Record<string, unknown>) {
  if (!isIntakeCategory(b.category)) throw new IntakeRequestError('a governed category is required');
  const trackingMode = b.trackingMode === 'serialized' ? 'serialized' : 'lot_managed';
  // A create carries no version; every content update requires expectedVersion.
  const expectedVersion = groupId === null ? null : requireVersion(b.expectedVersion);
  return {
    p_workspace_id: workspaceId,
    p_session_id: requireUuid(b.sessionId, 'sessionId'),
    p_group_id: groupId,
    p_expected_version: expectedVersion,
    p_category: b.category,
    p_display_name: String(b.displayName ?? ''),
    p_quantity: requireQuantity(b.quantity),
    p_tracking_mode: trackingMode,
    p_serialized_child_count: Number.isInteger(b.serializedChildCount)
      ? (b.serializedChildCount as number)
      : 0,
    p_product_attrs: requireAttrs(b.productAttrs, 'productAttrs'),
    p_sku_attrs: requireAttrs(b.skuAttrs, 'skuAttrs'),
    // Governed source evidence (a source_kind asserts a stated source); the
    // server rejects an ungoverned source_kind and never lets a bare "stated"
    // bypass source review. 'candidate' is derived from evidence links, never set here.
    p_source_evidence: requireAttrs(b.sourceEvidence, 'sourceEvidence'),
    p_condition_state: typeof b.conditionState === 'string' ? b.conditionState : null,
    p_location_code: typeof b.locationCode === 'string' ? b.locationCode : null,
    p_owner_tagged: b.ownerTagged === true,
    p_unique_condition: b.uniqueCondition === true,
    p_requires_item_media: b.requiresItemMedia === true,
    p_security_sensitive: b.securitySensitive === true,
  };
}

router.post(
  '/groups',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'upsert_intake_group', groupArgs(workspaceId, null, body(req)));
    res.json({ staging: true, authoritative: false, group: data });
  })
);

router.patch(
  '/groups/:id',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(
      req,
      'upsert_intake_group',
      groupArgs(workspaceId, requireUuid(req.params.id, 'groupId'), body(req))
    );
    res.json({ staging: true, authoritative: false, group: data });
  })
);

router.post(
  '/groups/:id/entries',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const idx = Number(b.entryIndex);
    if (!Number.isInteger(idx) || idx < 1) throw new IntakeRequestError('entryIndex must be >= 1');
    const data = await rpc(req, 'upsert_intake_entry', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
      p_expected_version: requireVersion(b.expectedVersion),
      p_entry_index: idx,
      p_grading_company: typeof b.gradingCompany === 'string' ? b.gradingCompany : null,
      p_numeric_grade: typeof b.numericGrade === 'string' ? b.numericGrade : null,
      p_grade_designation: typeof b.gradeDesignation === 'string' ? b.gradeDesignation : null,
      p_certificate_number: typeof b.certificateNumber === 'string' ? b.certificateNumber : null,
      p_serial_number: typeof b.serialNumber === 'string' ? b.serialNumber : null,
      p_entry_attrs: requireAttrs(b.entryAttrs, 'entryAttrs'),
    });
    res.json({ staging: true, authoritative: false, entry: data });
  })
);

// ---- Rule evaluation, readiness, transition ------------------------------
router.get(
  '/groups/:id/rules',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'evaluate_intake_field_rules', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
    });
    res.json({ staging: true, evaluation: data });
  })
);

router.post(
  '/groups/:id/readiness',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'validate_intake_readiness', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
    });
    res.json({ staging: true, readiness: data });
  })
);

router.post(
  '/groups/:id/transition',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const data = await rpc(req, 'transition_intake_group', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
      p_target_state: String(b.targetState ?? ''),
      p_reason: requireAttrs(b.reason, 'reason'),
    });
    res.json({ staging: true, authoritative: false, transition: data });
  })
);

// ---- Candidate acquisition evidence (zero financial effect) --------------
router.post(
  '/groups/:id/candidates',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const data = await rpc(req, 'attach_intake_candidate', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
      p_expected_version: requireVersion(b.expectedVersion),
      p_acquisition_line_item_id: requireUuid(b.acquisitionLineItemId, 'acquisitionLineItemId'),
      p_entry_id: optionalUuid(b.entryId, 'entryId'),
      p_confidence: typeof b.confidence === 'string' ? b.confidence : 'low',
      p_evidence: requireAttrs(b.evidence, 'evidence'),
    });
    res.json({ staging: true, authoritative: false, candidate: data });
  })
);

router.delete(
  '/candidates/:id',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'remove_intake_candidate', {
      p_workspace_id: workspaceId,
      p_candidate_link_id: requireUuid(req.params.id, 'candidateLinkId'),
      p_expected_version: requireVersion(body(req).expectedVersion),
    });
    res.json({ staging: true, authoritative: false, removed: data });
  })
);

// ---- Preview, commit, receipt, next action -------------------------------
router.get(
  '/groups/:id/preview',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'preview_intake_commit', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
    });
    res.json({ staging: true, authoritative: false, preview: data });
  })
);

router.post(
  '/groups/:id/commit',
  requireOperator,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const b = body(req);
    const data = await rpc(req, 'commit_intake_group', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
      p_idempotency_key: requireIdempotencyKey(b.idempotencyKey),
      p_expected_version: requireVersion(b.expectedVersion),
      p_content_hash: requireContentHash(b.contentHash),
    });
    res.json({ staging: true, authoritative: false, result: data });
  })
);

router.get(
  '/groups/:id/receipt',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = await rpc(req, 'get_intake_commit_receipt', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
    });
    res.json({ staging: true, authoritative: false, receipt: data });
  })
);

router.get(
  '/groups/:id/next-action',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId } = caller(req);
    const data = (await rpc(req, 'get_intake_commit_receipt', {
      p_workspace_id: workspaceId,
      p_group_id: requireUuid(req.params.id, 'groupId'),
    })) as { next_action?: string } | null;
    res.json({ staging: true, next_action: data?.next_action ?? null });
  })
);

// Express error mapper for request-shape errors raised by the helpers.
router.use((err: unknown, _req: AuthedRequest, res: import('express').Response,
  next: import('express').NextFunction) => {
  if (err instanceof IntakeRequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SourceReadError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;

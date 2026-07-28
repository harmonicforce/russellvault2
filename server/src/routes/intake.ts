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

// List sessions for the workspace, newest-activity first, with a per-state
// draft-group count so the UI can show "3 open, 1 committed" without a
// separate round trip per session. No raw ids are required from the caller —
// this is a plain workspace-scoped, paginated read.
const MAX_SESSION_PAGE = 100;
function readSessionLimit(value: unknown): number {
  const n = Number(value ?? 25);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(Math.floor(n), MAX_SESSION_PAGE);
}
function readSessionOffset(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

router.get(
  '/sessions',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const limit = readSessionLimit(req.query.limit);
    const offset = readSessionOffset(req.query.offset);
    const sessionColumns: string =
      'id, public_id, label, state, opened_by, opened_at, abandoned_by, abandoned_at, ' +
      'abandon_reason, created_at, updated_at';
    const { data: sessions, error, count } = (await client
      .from('intake_sessions')
      .select(sessionColumns, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)) as unknown as {
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
      count: number | null;
    };
    if (error) throw new SourceReadError(error.message, 400);

    const ids = (sessions ?? []).map((s) => (s as { id: string }).id);
    const counts: Record<string, Record<string, number>> = {};
    if (ids.length > 0) {
      const groupStateColumns: string = 'session_id, state';
      const { data: groups, error: gErr } = (await client
        .from('intake_draft_groups')
        .select(groupStateColumns)
        .eq('workspace_id', workspaceId)
        .in('session_id', ids)) as unknown as {
        data: { session_id: string; state: string }[] | null;
        error: { message: string } | null;
      };
      if (gErr) throw new SourceReadError(gErr.message, 400);
      for (const row of groups ?? []) {
        counts[row.session_id] ??= {};
        counts[row.session_id][row.state] = (counts[row.session_id][row.state] ?? 0) + 1;
      }
    }

    res.json({
      staging: true,
      authoritative: false,
      total: count ?? sessions?.length ?? 0,
      limit,
      offset,
      sessions: (sessions ?? []).map((s) => ({
        ...(s as Record<string, unknown>),
        groupCounts: counts[(s as { id: string }).id] ?? {},
      })),
    });
  })
);

// ---- Read-only recovery contract -----------------------------------------
// These GET routes let a resumed session recover exactly what the server holds:
// list a session's groups, and fetch one complete group snapshot. They are
// authenticated, workspace-scoped, RLS-governed (member read), caller-token
// based, and strictly read-only — no mutation, no query platform, no Phase 6B.
// Terminal committed/abandoned groups are returned as-is (read-only truth).

// Summary columns for the group list (enough to pick a resume target and show
// each group's terminal/editable posture without a full snapshot per row).
const GROUP_SUMMARY_COLUMNS =
  'id, public_id, session_id, state, version, category, business_vertical, ' +
  'display_name, quantity, tracking_mode, serialized_child_count, source_state, ' +
  'location_code, next_action, applied_rule_version, committed_at, created_at, updated_at';

router.get(
  '/sessions/:id/groups',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const sessionId = requireUuid(req.params.id, 'sessionId');
    const { data, error } = await client
      .from('intake_draft_groups')
      .select(GROUP_SUMMARY_COLUMNS)
      .eq('workspace_id', workspaceId)
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false });
    if (error) throw new SourceReadError(error.message, 400);
    res.json({ staging: true, authoritative: false, groups: data ?? [] });
  })
);

// A complete, read-only snapshot of one group: the exact stored draft values and
// current version, its entries and candidate evidence, the live blocker/rule
// evaluation while it is still editable (draft/ready_to_commit), and the
// immutable commit receipt once it is committed. A resumed client hydrates from
// this and never invents a value the server did not return.
router.get(
  '/groups/:id/snapshot',
  requireMember,
  asyncRoute(async (req, res) => {
    const { workspaceId, client } = caller(req);
    const groupId = requireUuid(req.params.id, 'groupId');

    const { data: group, error: gErr } = await client
      .from('intake_draft_groups')
      .select(
        'id, public_id, session_id, state, version, category, business_vertical, ' +
          'display_name, product_attrs, sku_attrs, quantity, tracking_mode, ' +
          'serialized_child_count, source_state, source_evidence, condition_state, ' +
          'location_code, owner_tagged, unique_condition, requires_item_media, ' +
          'security_sensitive, applied_rule_version, next_action, committed_product_id, ' +
          'committed_sku_id, committed_lot_id, committed_at, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('id', groupId)
      .maybeSingle();
    if (gErr) throw new SourceReadError(gErr.message, 400);
    if (!group) {
      res.status(404).json({ error: 'intake group not found' });
      return;
    }

    const { data: entries, error: eErr } = await client
      .from('intake_entries')
      .select(
        'id, public_id, entry_index, grading_company, numeric_grade, grade_designation, ' +
          'certificate_number, serial_number, entry_attrs, committed_item_id'
      )
      .eq('workspace_id', workspaceId)
      .eq('group_id', groupId)
      .order('entry_index', { ascending: true });
    if (eErr) throw new SourceReadError(eErr.message, 400);

    const { data: candidates, error: cErr } = await client
      .from('intake_candidate_links')
      .select(
        'id, entry_id, acquisition_line_item_id, evidence, confidence, source_state, ' +
          'review_state, created_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });
    if (cErr) throw new SourceReadError(cErr.message, 400);

    const state = (group as { state?: string }).state;
    const terminal = state === 'committed' || state === 'abandoned';

    // Live blockers + rule version only while the group is still editable; a
    // terminal group is read-only and carries no fresh evaluation.
    let evaluation: unknown = null;
    if (!terminal) {
      evaluation = await rpc(req, 'evaluate_intake_field_rules', {
        p_workspace_id: workspaceId,
        p_group_id: groupId,
      });
    }

    // The immutable receipt is the committed truth; only present once committed.
    let receipt: unknown = null;
    if (state === 'committed') {
      receipt = await rpc(req, 'get_intake_commit_receipt', {
        p_workspace_id: workspaceId,
        p_group_id: groupId,
      });
    }

    res.json({
      staging: true,
      authoritative: false,
      snapshot: {
        group,
        entries: entries ?? [],
        candidates: candidates ?? [],
        evaluation,
        receipt,
        editable: !terminal,
      },
    });
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

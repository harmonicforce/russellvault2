// Listing Prep Command Center.
//
// The operational layer between "this is in inventory" and "this is listed
// somewhere". Every route calls a SECURITY DEFINER function on the CALLER's
// own token, so membership, role and readiness are all decided by the
// database. This file never holds a privileged credential and never writes to
// a table directly.
//
// It publishes nothing to any marketplace, and recording that something was
// listed moves no stock: inventory leaves on sale, through governed inventory
// exit, which is a different slice.

import { Router, type NextFunction, type Response } from 'express';
import { requireMember, requireOperator, requireOwner, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import { asSubjectKind } from '../media/contract.js';
import {
  INVENTORY_SUBTYPES, PREP_PRIORITIES, PREP_STATUSES, READINESS_STATUSES,
  asBulkAction, asBulkIds, asCheckState, asContentPatch, asEnumFilter, asOffset,
  asPageSize, asPrepPriority, asPrepStatus, asRequirementKey, asText, asUuid,
} from '../listingPrep/contract.js';

const router = Router();
router.use((_req, res, next) => (isProvenanceEnabled(process.env) ? next() : res.status(404).json({ error: 'not found' })));

function asyncRoute(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
}
function ctx(req: AuthedRequest) {
  if (!req.caller) throw new Error('caller not resolved');
  return req.caller;
}
function body(req: AuthedRequest) { return (req.body ?? {}) as Record<string, unknown>; }

/**
 * Order matters: the first pattern wins. "The assignee is not a member" is a
 * bad request about somebody else, not a refusal of the caller, so it is
 * matched before the membership rule below it.
 */
const ERROR_MAP: readonly [RegExp, number, string][] = [
  [/assignee is not a member/i, 422, 'invalid_request'],
  [/not found in this workspace/i, 404, 'not_found'],
  [/owner authority|not a member|permission denied|row-level security|viewer cannot/i, 403, 'forbidden'],
  [/already open for this record|is already |cannot move to|no longer ready|only a ready-to-list|reopen this preparation|outstanding blocker/i, 409, 'lifecycle_conflict'],
  [/required|invalid|unrecognized|unknown|cannot be prepared|prepared through its items|whole minor units|no such preparation|at most 200|in the future|single unit|defines no values|say why|say how/i, 422, 'invalid_request'],
  [/already exists/i, 409, 'conflict'],
];

/**
 * A failed request must never render as an empty queue. Every governed failure
 * gets a status code and a stable machine-readable code, and the database's
 * own sentence is passed through so the operator is told what actually
 * stopped them rather than "something went wrong".
 */
function dbFailure(res: Response, message: string): void {
  const match = ERROR_MAP.find(([pattern]) => pattern.test(message));
  res.status(match?.[1] ?? 400).json({
    error: match?.[2] ?? 'governed_operation_failed',
    detail: message,
  });
}
function invalid(res: Response, field: string): void {
  res.status(422).json({ error: 'invalid_request', field });
}

async function rpc(req: AuthedRequest, res: Response, fn: string, args: Record<string, unknown>) {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.rpc(fn as never, { p_workspace_id: workspaceId, ...args } as never);
  if (error) return dbFailure(res, error.message);
  res.json(data);
}

// ---- reads -----------------------------------------------------------------

/**
 * The queue. Filters are applied in the database against live readiness and
 * then paginated, so a filtered page never silently drops rows that a
 * post-pagination filter would have removed.
 */
router.get('/', requireMember, asyncRoute(async (req, res) => {
  const q = req.query;
  const statuses = asEnumFilter(PREP_STATUSES, q.status);
  const readiness = asEnumFilter(READINESS_STATUSES, q.readiness);
  const subtypes = asEnumFilter(INVENTORY_SUBTYPES, q.subtype);
  const priorities = asEnumFilter(PREP_PRIORITIES, q.priority);
  if (statuses === 'invalid') return invalid(res, 'status');
  if (readiness === 'invalid') return invalid(res, 'readiness');
  if (subtypes === 'invalid') return invalid(res, 'subtype');
  if (priorities === 'invalid') return invalid(res, 'priority');

  const assignedTo = q.assignedTo === undefined ? null : asUuid(q.assignedTo);
  if (q.assignedTo !== undefined && !assignedTo) return invalid(res, 'assignedTo');

  const subjectKind = q.subjectKind === undefined ? null : asSubjectKind(q.subjectKind);
  if (q.subjectKind !== undefined && !subjectKind) return invalid(res, 'subjectKind');

  return rpc(req, res, 'list_listing_prep_queue', {
    p_statuses: statuses,
    p_readiness: readiness,
    p_subtypes: subtypes,
    p_priorities: priorities,
    p_assigned_to: assignedTo,
    p_unassigned_only: q.unassigned === 'true',
    p_subject_kind: subjectKind,
    p_search: asText(q.search, 120),
    p_limit: asPageSize(q.limit, 50, 200),
    p_offset: asOffset(q.offset),
  });
}));

/** Bounded counts for the Workbench: never a second copy of the queue. */
router.get('/summary', requireMember, asyncRoute(async (req, res) =>
  rpc(req, res, 'get_listing_prep_summary', {})));

router.get('/presets', requireMember, asyncRoute(async (req, res) =>
  rpc(req, res, 'list_listing_package_presets', {
    p_include_retired: req.query.includeRetired === 'true',
  })));

/**
 * Answers "does this item already have a preparation open?" so Item and Lot
 * detail can offer the right action without the client guessing.
 */
router.get('/for-subject', requireMember, asyncRoute(async (req, res) => {
  const kind = asSubjectKind(req.query.subjectKind);
  const subjectId = asUuid(req.query.subjectId);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');
  return rpc(req, res, 'get_listing_prep_for_subject', {
    p_subject_kind: kind, p_subject_id: subjectId,
  });
}));

router.get('/:prepId', requireMember, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  if (!prepId) return invalid(res, 'prepId');
  return rpc(req, res, 'get_listing_prep', { p_prep_id: prepId });
}));

/** Recompute on demand — readiness is derived live, never read from a cache. */
router.get('/:prepId/readiness', requireMember, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  if (!prepId) return invalid(res, 'prepId');
  return rpc(req, res, 'evaluate_listing_prep_readiness', { p_prep_id: prepId });
}));

// ---- preparation work (operator) -------------------------------------------

router.post('/', requireOperator, asyncRoute(async (req, res) => {
  const b = body(req);
  const kind = asSubjectKind(b.subjectKind);
  const subjectId = asUuid(b.subjectId);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');

  const priority = b.priority === undefined ? 'normal' : asPrepPriority(b.priority);
  if (!priority) return invalid(res, 'priority');
  const assignedTo = b.assignedTo === undefined || b.assignedTo === null ? null : asUuid(b.assignedTo);
  if (b.assignedTo !== undefined && b.assignedTo !== null && !assignedTo) return invalid(res, 'assignedTo');

  return rpc(req, res, 'start_listing_prep', {
    p_subject_kind: kind, p_subject_id: subjectId,
    p_priority: priority, p_assigned_to: assignedTo,
  });
}));

router.patch('/:prepId/content', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  if (!prepId) return invalid(res, 'prepId');
  const { patch, invalidField } = asContentPatch(body(req).content);
  if (invalidField || !patch) return invalid(res, invalidField ?? 'content');
  return rpc(req, res, 'update_listing_prep_content', { p_prep_id: prepId, p_patch: patch });
}));

router.post('/:prepId/checks', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const b = body(req);
  const key = asRequirementKey(b.requirementKey);
  const state = asCheckState(b.state);
  if (!prepId) return invalid(res, 'prepId');
  if (!key) return invalid(res, 'requirementKey');
  if (!state) return invalid(res, 'state');
  return rpc(req, res, 'set_listing_prep_check', {
    p_prep_id: prepId, p_requirement_key: key, p_state: state,
    p_note: asText(b.note, 1000),
  });
}));

router.post('/:prepId/assign', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const raw = body(req).assignedTo;
  if (!prepId) return invalid(res, 'prepId');
  const assignee = raw === null || raw === undefined ? null : asUuid(raw);
  if (raw !== null && raw !== undefined && !assignee) return invalid(res, 'assignedTo');
  return rpc(req, res, 'assign_listing_prep', { p_prep_id: prepId, p_assignee: assignee });
}));

router.post('/:prepId/priority', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const priority = asPrepPriority(body(req).priority);
  if (!prepId) return invalid(res, 'prepId');
  if (!priority) return invalid(res, 'priority');
  return rpc(req, res, 'set_listing_prep_priority', { p_prep_id: prepId, p_priority: priority });
}));

/**
 * One route for every status change. `ready_to_list` is accepted here but the
 * database still requires an OWNER and still recomputes readiness, so an
 * operator reaching this route gets a 403 from the authority that matters
 * rather than a check this file could drift out of sync with.
 */
router.post('/:prepId/transition', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const b = body(req);
  const status = asPrepStatus(b.status);
  if (!prepId) return invalid(res, 'prepId');
  if (!status) return invalid(res, 'status');
  if (status === 'listed') return invalid(res, 'status');
  return rpc(req, res, 'transition_listing_prep', {
    p_prep_id: prepId, p_to_status: status, p_reason: asText(b.reason, 500),
  });
}));

router.post('/:prepId/package-preset', requireOperator, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const presetId = asUuid(body(req).presetId);
  if (!prepId) return invalid(res, 'prepId');
  if (!presetId) return invalid(res, 'presetId');
  return rpc(req, res, 'apply_listing_package_preset', {
    p_prep_id: prepId, p_preset_id: presetId,
  });
}));

// ---- final review (owner) --------------------------------------------------

/**
 * Recording that goods were listed elsewhere. Owner-only, gated on a fresh
 * readiness check, and it changes no inventory: the external reference is a
 * note about where the owner listed it, not a marketplace integration.
 */
router.post('/:prepId/listed', requireOwner, asyncRoute(async (req, res) => {
  const prepId = asUuid(req.params.prepId);
  const b = body(req);
  const ref = asText(b.externalListingRef, 400);
  if (!prepId) return invalid(res, 'prepId');
  if (!ref) return invalid(res, 'externalListingRef');
  const listedAt = typeof b.listedAt === 'string' && !Number.isNaN(Date.parse(b.listedAt))
    ? new Date(b.listedAt).toISOString() : null;
  if (b.listedAt !== undefined && b.listedAt !== null && !listedAt) return invalid(res, 'listedAt');
  return rpc(req, res, 'mark_listing_prep_listed', {
    p_prep_id: prepId, p_external_listing_ref: ref, p_listed_at: listedAt,
  });
}));

// ---- package presets -------------------------------------------------------

router.post('/presets', requireOperator, asyncRoute(async (req, res) => {
  const b = body(req);
  const name = asText(b.name, 80);
  if (!name) return invalid(res, 'name');
  const dims = ['packageWeightGrams', 'packageLengthMm', 'packageWidthMm', 'packageHeightMm'] as const;
  const values: Record<string, number | null> = {};
  for (const field of dims) {
    const raw = b[field];
    if (raw === undefined || raw === null) { values[field] = null; continue; }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return invalid(res, field);
    values[field] = raw;
  }
  return rpc(req, res, 'create_listing_package_preset', {
    p_name: name,
    p_package_weight_grams: values.packageWeightGrams,
    p_package_length_mm: values.packageLengthMm,
    p_package_width_mm: values.packageWidthMm,
    p_package_height_mm: values.packageHeightMm,
    p_shipping_policy_ref: asText(b.shippingPolicyRef, 120),
    p_return_policy_ref: asText(b.returnPolicyRef, 120),
  });
}));

router.post('/presets/:presetId/retire', requireOperator, asyncRoute(async (req, res) => {
  const presetId = asUuid(req.params.presetId);
  if (!presetId) return invalid(res, 'presetId');
  return rpc(req, res, 'retire_listing_package_preset', { p_preset_id: presetId });
}));

// ---- bulk ------------------------------------------------------------------

/**
 * Bounded, and no shortcut: the database applies each record through the same
 * single-record function, so owner-only gates and per-record readiness still
 * hold. Per-record failures come back in the response instead of aborting the
 * batch, because a batch that stops on record 7 of 50 tells the operator
 * nothing about the other 43.
 */
router.post('/bulk', requireOperator, asyncRoute(async (req, res) => {
  const b = body(req);
  const action = asBulkAction(b.action);
  const ids = asBulkIds(b.prepIds);
  if (!action) return invalid(res, 'action');
  if (!ids) return invalid(res, 'prepIds');

  const params: Record<string, unknown> = {};
  if (action === 'assign') {
    const raw = b.assignedTo;
    const assignee = raw === null || raw === undefined ? null : asUuid(raw);
    if (raw !== null && raw !== undefined && !assignee) return invalid(res, 'assignedTo');
    params.assigned_to = assignee;
  }
  if (action === 'set_priority') {
    const priority = asPrepPriority(b.priority);
    if (!priority) return invalid(res, 'priority');
    params.priority = priority;
  }
  if (action === 'apply_package_preset') {
    const presetId = asUuid(b.presetId);
    if (!presetId) return invalid(res, 'presetId');
    params.preset_id = presetId;
  }
  if (action === 'mark_blocked') {
    const reason = asText(b.reason, 500);
    if (!reason) return invalid(res, 'reason');
    params.reason = reason;
  } else {
    const reason = asText(b.reason, 500);
    if (reason) params.reason = reason;
  }

  return rpc(req, res, 'bulk_listing_prep_action', {
    p_prep_ids: ids, p_action: action, p_params: params,
  });
}));

export default router;

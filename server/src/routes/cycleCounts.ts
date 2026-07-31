import { Router, type NextFunction, type Response } from 'express';
import { requireMember, requireOperator, requireOwner, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';

const router = Router();
router.use((_req, res, next) => isProvenanceEnabled(process.env) ? next() : res.status(404).json({ error: 'not found' }));

function asyncRoute(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
}
function ctx(req: AuthedRequest) {
  if (!req.caller) throw new Error('caller not resolved');
  return req.caller;
}
function body(req: AuthedRequest) { return (req.body ?? {}) as Record<string, unknown>; }
function text(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function uuid(v: unknown): string | null { const s = text(v); return s && /^[0-9a-f-]{36}$/i.test(s) ? s : null; }
function bool(v: unknown): boolean { return v === true; }

const ERROR_MAP: readonly [RegExp, number, string][] = [
  [/not found in this workspace/i, 404, 'not_found'],
  [/reviewer authority|required role|permission denied|row-level security/i, 403, 'forbidden'],
  [/not accepting|not counting|requires review|only.*review|cannot|conflict/i, 409, 'lifecycle_conflict'],
  [/required|invalid|eligible|scope|destination/i, 422, 'invalid_request'],
];
function dbFailure(res: Response, message: string): void {
  const match = ERROR_MAP.find(([pattern]) => pattern.test(message));
  res.status(match?.[1] ?? 400).json({ error: match?.[2] ?? 'governed_operation_failed', code: match?.[2] ?? 'GOVERNED_OPERATION_FAILED' });
}
async function rpc(req: AuthedRequest, res: Response, fn: string, args: Record<string, unknown>) {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.rpc(fn as never, { p_workspace_id: workspaceId, ...args } as never);
  if (error) return dbFailure(res, error.message);
  res.json(data);
}

router.get('/sessions', requireMember, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.from('cycle_count_sessions').select('id,public_id,status,scope_type,blind_count,created_at,current_round_id').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  if (error) return dbFailure(res, error.message);
  res.json({ sessions: data ?? [] });
}));
router.post('/sessions', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'create_cycle_count', {
  p_root_location_code: text(body(req).rootLocationCode), p_include_descendants: bool(body(req).includeDescendants),
  p_subtype_filter: text(body(req).subtypeFilter), p_vertical_filter: text(body(req).verticalFilter),
  p_blind_count: body(req).blindCount !== false, p_notes: text(body(req).notes),
})));
router.post('/:sessionId/start', requireOperator, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.rpc('start_cycle_count' as never, { p_workspace_id: workspaceId, p_session_id: req.params.sessionId } as never);
  if (error) return dbFailure(res, error.message);
  const result = data && typeof data === 'object' && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : data;
  if (result && typeof result === 'object') {
    delete result.expected_item_count;
    delete result.expected_lot_count;
    delete result.expected_unit_count;
  }
  res.json(result);
}));
router.get('/:sessionId/progress', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'get_cycle_count_round_progress', { p_session_id: req.params.sessionId })));
router.post('/:sessionId/items', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'observe_cycle_count_item', {
  p_session_id: req.params.sessionId, p_identifier: text(body(req).identifier), p_observed_location_code: text(body(req).locationCode),
  p_idempotency_key: uuid(body(req).idempotencyKey), p_note: text(body(req).note),
})));
router.post('/:sessionId/lots', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'observe_cycle_count_lot', {
  p_session_id: req.params.sessionId, p_lot_public_id: text(body(req).lotPublicId), p_observed_quantity: body(req).observedQuantity,
  p_idempotency_key: uuid(body(req).idempotencyKey), p_note: text(body(req).note),
})));
router.post('/:sessionId/item-absence', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'attest_cycle_count_item_absence', {
  p_session_id: req.params.sessionId, p_item_public_id: text(body(req).itemPublicId),
  p_attestation: text(body(req).attestation), p_reason: text(body(req).reason),
  p_idempotency_key: uuid(body(req).idempotencyKey),
})));
router.post('/:sessionId/observations/:observationId/void', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'void_cycle_count_observation', {
  p_session_id: req.params.sessionId, p_observation_id: req.params.observationId,
  p_subject_kind: text(body(req).subjectKind), p_reason: text(body(req).reason),
  p_idempotency_key: uuid(body(req).idempotencyKey),
})));
router.post('/:sessionId/submit', requireOperator, asyncRoute(async (req, res) => rpc(req, res, 'submit_cycle_count_round', { p_session_id: req.params.sessionId, p_confirm_uncounted: bool(body(req).confirmUncounted) })));
router.get('/:sessionId/results', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'list_cycle_count_round_results', { p_session_id: req.params.sessionId, p_round_id: uuid(req.query.roundId) })));
router.get('/:sessionId/discrepancies', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'list_current_cycle_count_discrepancies', { p_session_id: req.params.sessionId })));
router.get('/:sessionId/history', requireMember, asyncRoute(async (req, res) => rpc(req, res, 'list_cycle_count_history', { p_session_id: req.params.sessionId })));
router.get('/:sessionId/attempts', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'list_cycle_count_resolution_attempts', { p_session_id: req.params.sessionId })));
router.post('/:sessionId/recount-selection', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'mark_cycle_count_discrepancies_for_recount', { p_session_id: req.params.sessionId, p_discrepancy_ids: body(req).discrepancyIds, p_reason: text(body(req).reason) })));
router.post('/:sessionId/recount', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'begin_cycle_count_recount', { p_session_id: req.params.sessionId, p_reason: text(body(req).reason) })));
router.post('/discrepancies/:id/attempts', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'create_cycle_count_resolution_attempt', { p_discrepancy_id: req.params.id, p_action: text(body(req).action), p_reason: text(body(req).reason), p_reviewed_destination_code: text(body(req).destinationCode), p_idempotency_key: uuid(body(req).idempotencyKey) })));
router.post('/attempts/:id/execute', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'execute_cycle_count_resolution_attempt', { p_attempt_id: req.params.id })));
router.post('/attempts/:id/approve', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'approve_cycle_count_resolution_attempt', { p_attempt_id: req.params.id })));
router.post('/:sessionId/complete', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'complete_cycle_count_latest', { p_session_id: req.params.sessionId, p_allow_deferred: bool(body(req).allowDeferred), p_note: text(body(req).note) })));
router.post('/:sessionId/cancel', requireOwner, asyncRoute(async (req, res) => rpc(req, res, 'cancel_cycle_count', { p_session_id: req.params.sessionId, p_reason: text(body(req).reason) })));

export default router;

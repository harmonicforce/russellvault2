import { Router, type NextFunction, type Response } from 'express';
import { requireMember, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  classifyDependencyFailure, panelFailure, parsePageWindow, parseReadinessStatuses,
} from '../operationsDashboard/contract.js';

const router = Router();
router.use((_req, res, next) => isProvenanceEnabled(process.env)
  ? next()
  : res.status(404).json(panelFailure('feature_unavailable', 404).body));
const run = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
function caller(req: AuthedRequest) {
  if (!req.caller) throw new Error('caller not resolved');
  return req.caller;
}

/**
 * The raw database sentence is logged where an engineer can read it and is
 * never returned. The browser gets a stable code and an actionable message, so
 * a missing migration reads as "the required database update has not been
 * applied" rather than naming an internal function and its arguments.
 *
 * Returns nothing so callers can `return fail(...)` and end the handler.
 */
function fail(res: Response, panel: string, rawMessage: string): void {
  const failure = classifyDependencyFailure(rawMessage);
  console.error(
    `[operations-dashboard] ${panel} unavailable (${failure.body.code}): ${rawMessage}`,
  );
  res.status(failure.status).json(failure.body);
}

export function priorityScore(ruleWeight: number, ageDays: number): { score: number; explanation: string } {
  const agePoints = Math.min(Math.max(Math.floor(ageDays), 0), 30);
  return { score: ruleWeight + agePoints, explanation: `${ruleWeight} rule weight + ${agePoints} age points` };
}

router.get('/health', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const result = await client.rpc('get_operations_inventory_health' as never, { p_workspace_id: workspaceId } as never);
  if (result.error) return fail(res, 'health', result.error.message);
  res.json({ asOf: new Date().toISOString(), ...(result.data as object) });
}));

type WorkRow = { subject_kind: string; subject_id: string; subject_public_id: string; display_name: string; created_at: string };
export function rankWorkCandidates(locationRows: WorkRow[], photoRows: WorkRow[], now = Date.now()) {
  const make = (row: WorkRow, taskType: 'missing_location' | 'missing_media') => {
    const ageDays = Math.max(0, Math.floor((now - Date.parse(row.created_at)) / 86400000));
    const isLocation = taskType === 'missing_location';
    const priority = priorityScore(isLocation ? 80 : 50, ageDays);
    return { taskType, subjectKind: row.subject_kind, subjectId: row.subject_id,
      publicId: row.subject_public_id, displayName: row.display_name,
      reason: isLocation ? 'No active storage location is recorded.' : 'No active inventory photograph is recorded.',
      ageDays, severity: isLocation ? 'high' : 'medium', score: priority.score,
      scoreExplanation: priority.explanation,
      destination: isLocation ? '/inventory/current?needsLocation=1' : '/inventory/current?needsPhotos=1' };
  };
  const unique = new Map<string, ReturnType<typeof make>>();
  for (const row of locationRows) unique.set(`missing_location:${row.subject_kind}:${row.subject_id}`, make(row, 'missing_location'));
  for (const row of photoRows) unique.set(`missing_media:${row.subject_kind}:${row.subject_id}`, make(row, 'missing_media'));
  return [...unique.values()].sort((a, b) => b.score - a.score || a.taskType.localeCompare(b.taskType)
    || a.subjectKind.localeCompare(b.subjectKind) || a.subjectId.localeCompare(b.subjectId)).slice(0, 20);
}

router.get('/work', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const fields = 'subject_kind,subject_id,subject_public_id,display_name,created_at';
  // Batch intake shares one transaction timestamp across many rows, so
  // `created_at` alone is not a total order and the database may return an
  // arbitrary subset before ranking ever runs. Order fully, then limit.
  //
  // Each rule stays independently bounded, which is sound here because age is
  // the only term that varies within a rule: oldest-first IS score-descending,
  // so each query's own 20 really are its top 20, and merging two correct
  // top-20s yields the correct global top 20.
  const boundedByRule = (column: 'needs_location' | 'needs_photos') =>
    client.from('inventory_work_queue').select(fields)
      .eq('workspace_id', workspaceId).eq(column, true)
      .order('created_at', { ascending: true })
      .order('subject_kind', { ascending: true })
      .order('subject_id', { ascending: true })
      .limit(20);
  const [locations, photos] = await Promise.all([
    boundedByRule('needs_location'),
    boundedByRule('needs_photos'),
  ]);
  if (locations.error || photos.error) return fail(res, 'work', locations.error?.message ?? photos.error!.message);
  const tasks = rankWorkCandidates((locations.data ?? []) as WorkRow[], (photos.data ?? []) as WorkRow[]);
  res.json({ asOf: new Date().toISOString(), definition: 'Rule weight plus one inventory age point per day since inventory record creation, capped at 30 age points.', tasks });
}));

router.get('/workflows', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  // get_operations_media_backlog is EXACT: `no_active_photo` counts the whole
  // work queue rather than the twenty candidates /work returns, so the tile
  // cannot understate a real backlog.
  const [media, prep] = await Promise.all([
    client.rpc('get_operations_media_backlog' as never, { p_workspace_id: workspaceId } as never),
    client.rpc('get_listing_prep_summary' as never, { p_workspace_id: workspaceId } as never),
  ]);
  if (media.error || prep.error) return fail(res, 'workflows', media.error?.message ?? prep.error!.message);
  res.json({ asOf: new Date().toISOString(), media: media.data, listingPrep: prep.data });
}));

/**
 * The destination for "missing required angles". A record can hold a front
 * photograph and still owe its back, label or condition shot, so this is a
 * different population from the no-active-photo filter and needs its own page.
 */
router.get('/media-readiness', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  // An unrecognised status matches no rows, so passing it through would answer
  // "nothing outstanding" for a question that was never asked. Refuse instead.
  const { statuses, invalid } = parseReadinessStatuses(req.query.status);
  if (invalid.length > 0) {
    const failure = panelFailure('invalid_status', 400);
    return void res.status(failure.status).json(failure.body);
  }
  const { limit, offset } = parsePageWindow(req.query.limit, req.query.offset);
  const { data, error } = await client.rpc('list_current_media_readiness' as never, {
    p_workspace_id: workspaceId,
    p_statuses: statuses,
    p_limit: limit,
    p_offset: offset,
  } as never);
  if (error) return fail(res, 'media-readiness', error.message);
  res.json({ asOf: new Date().toISOString(), ...(data as object) });
}));

router.get('/activity', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const { data, error } = await client.from('inventory_movements')
    .select('id,public_id,subject_kind,item_id,lot_id,moved_at,note').eq('workspace_id', workspaceId)
    .order('moved_at', { ascending: false }).limit(20);
  if (error) return fail(res, 'activity', error.message);
  res.json({ asOf: new Date().toISOString(), source: 'immutable inventory_movements', events: (data ?? []).map((e: any) => ({
    ...e, eventType: 'inventory_moved', destination: e.subject_kind === 'item' ? `/inventory/current/${e.item_id}` : `/inventory/lots/${e.lot_id}`,
  })) });
}));

export default router;

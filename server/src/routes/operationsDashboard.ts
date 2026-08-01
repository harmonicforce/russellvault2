import { Router, type NextFunction, type Response } from 'express';
import { requireMember, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';

const router = Router();
router.use((_req, res, next) => isProvenanceEnabled(process.env) ? next() : res.status(404).json({ error: 'not found' }));
const run = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
function caller(req: AuthedRequest) {
  if (!req.caller) throw new Error('caller not resolved');
  return req.caller;
}
function fail(res: Response, message: string) { res.status(503).json({ error: 'panel_unavailable', detail: message }); }

export function priorityScore(ruleWeight: number, ageDays: number): { score: number; explanation: string } {
  const agePoints = Math.min(Math.max(Math.floor(ageDays), 0), 30);
  return { score: ruleWeight + agePoints, explanation: `${ruleWeight} rule weight + ${agePoints} age points` };
}

router.get('/health', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const result = await client.rpc('get_operations_inventory_health' as never, { p_workspace_id: workspaceId } as never);
  if (result.error) return fail(res, result.error.message);
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
  const [locations, photos] = await Promise.all([
    client.from('inventory_work_queue').select(fields).eq('workspace_id', workspaceId).eq('needs_location', true).order('created_at', { ascending: true }).limit(20),
    client.from('inventory_work_queue').select(fields).eq('workspace_id', workspaceId).eq('needs_photos', true).order('created_at', { ascending: true }).limit(20),
  ]);
  if (locations.error || photos.error) return fail(res, locations.error?.message ?? photos.error!.message);
  const tasks = rankWorkCandidates((locations.data ?? []) as WorkRow[], (photos.data ?? []) as WorkRow[]);
  res.json({ asOf: new Date().toISOString(), definition: 'Rule weight plus one inventory age point per day since inventory record creation, capped at 30 age points.', tasks });
}));

router.get('/workflows', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const [media, prep] = await Promise.all([
    client.rpc('get_media_readiness_summary' as never, { p_workspace_id: workspaceId } as never),
    client.rpc('get_listing_prep_summary' as never, { p_workspace_id: workspaceId } as never),
  ]);
  if (media.error || prep.error) return fail(res, media.error?.message ?? prep.error!.message);
  res.json({ asOf: new Date().toISOString(), media: media.data, listingPrep: prep.data });
}));

router.get('/activity', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const { data, error } = await client.from('inventory_movements')
    .select('id,public_id,subject_kind,item_id,lot_id,moved_at,note').eq('workspace_id', workspaceId)
    .order('moved_at', { ascending: false }).limit(20);
  if (error) return fail(res, error.message);
  res.json({ asOf: new Date().toISOString(), source: 'immutable inventory_movements', events: (data ?? []).map((e: any) => ({
    ...e, eventType: 'inventory_moved', destination: e.subject_kind === 'item' ? `/inventory/current/${e.item_id}` : `/inventory/lots/${e.lot_id}`,
  })) });
}));

export default router;

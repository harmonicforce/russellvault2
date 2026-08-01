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
function fail(res: Response, message: string) { res.status(400).json({ error: 'panel_unavailable', detail: message }); }

export function priorityScore(ruleWeight: number, ageDays: number): { score: number; explanation: string } {
  const agePoints = Math.min(Math.max(Math.floor(ageDays), 0), 30);
  return { score: ruleWeight + agePoints, explanation: `${ruleWeight} rule weight + ${agePoints} age points` };
}

router.get('/health', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const [items, lots, unlocatedItems, unlocatedLots] = await Promise.all([
    client.from('inventory_item_overview').select('item_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    client.from('inventory_lot_overview').select('lot_id,quantity,tracking_mode').eq('workspace_id', workspaceId).eq('tracking_mode', 'lot_managed'),
    client.from('inventory_item_overview').select('item_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).or('location_id.is.null,location_retired_at.not.is.null'),
    client.from('inventory_lot_overview').select('lot_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('tracking_mode', 'lot_managed').or('location_id.is.null,location_retired_at.not.is.null'),
  ]);
  const error = [items, lots, unlocatedItems, unlocatedLots].find(x => x.error)?.error;
  if (error) return fail(res, error.message);
  const lotRows = (lots.data ?? []) as Array<{ quantity: number }>;
  res.json({ asOf: new Date().toISOString(), serializedUnits: items.count ?? 0,
    lotManagedRecords: lotRows.length, lotManagedUnits: lotRows.reduce((n, r) => n + r.quantity, 0),
    withoutLocation: (unlocatedItems.count ?? 0) + (unlocatedLots.count ?? 0) });
}));

router.get('/work', requireMember, run(async (req, res) => {
  const { client, workspaceId } = caller(req);
  const { data, error } = await client.from('inventory_work_queue')
    .select('subject_kind,subject_id,subject_public_id,display_name,created_at,needs_location,needs_photos')
    .eq('workspace_id', workspaceId).or('needs_location.eq.true,needs_photos.eq.true')
    .order('created_at', { ascending: true }).limit(20);
  if (error) return fail(res, error.message);
  const now = Date.now();
  const tasks = (data ?? []).flatMap((row: any) => {
    const ageDays = Math.max(0, Math.floor((now - Date.parse(row.created_at)) / 86400000));
    const task = (type: string, reason: string, weight: number, destination: string) => {
      const priority = priorityScore(weight, ageDays);
      return ({
      taskType: type, subjectKind: row.subject_kind, subjectId: row.subject_id,
      publicId: row.subject_public_id, displayName: row.display_name, reason, ageDays,
      severity: weight >= 80 ? 'high' : 'medium', score: priority.score,
      scoreExplanation: priority.explanation, destination,
    }); };
    return [row.needs_location && task('missing_location', 'No active storage location is recorded.', 80, '/inventory/current?needsLocation=true'),
      row.needs_photos && task('missing_media', 'No inventory photograph is recorded.', 50, '/media?status=missing')].filter(Boolean);
  }).sort((a: any, b: any) => b.score - a.score).slice(0, 20);
  res.json({ asOf: new Date().toISOString(), definition: 'Rule weight plus one point per day since intake, capped at 30 age points.', tasks });
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
    ...e, eventType: 'inventory_moved', destination: e.subject_kind === 'item' ? `/inventory/items/${e.item_id}` : `/inventory/lots/${e.lot_id}`,
  })) });
}));

export default router;

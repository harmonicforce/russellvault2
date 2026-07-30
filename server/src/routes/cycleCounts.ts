import { Router, type NextFunction, type Response } from 'express';
import { requireMember, requireOperator, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import { SourceReadError } from '../acquisition/sourceReader.js';

const router = Router();
router.use((_req, res, next) => isProvenanceEnabled(process.env) ? next() : res.status(404).json({ error: 'not found' }));
const run = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const ctx = (req: AuthedRequest) => {
  if (!req.caller) throw new SourceReadError('caller not resolved', 500);
  return req.caller;
};
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const bool = (v: unknown, fallback = false) => typeof v === 'boolean' ? v : fallback;
const rpc = async (req: AuthedRequest, name: string, args: Record<string, unknown>) => {
  const { client } = ctx(req);
  const { data, error } = await client.rpc(name as never, args as never);
  if (error) throw new SourceReadError(error.message, /only a draft|already|status|block|recount/i.test(error.message) ? 409 : 400);
  return data;
};

router.get('/', requireMember, run(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.from('cycle_count_session_overview').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  if (error) throw new SourceReadError(error.message, 400);
  res.json({ sessions: data ?? [] });
}));
router.post('/', requireOperator, run(async (req, res) => {
  const { workspaceId } = ctx(req); const b = req.body ?? {};
  if (!text(b.locationCode)) throw new SourceReadError('locationCode is required', 400);
  res.status(201).json({ session: await rpc(req, 'create_cycle_count', { p_workspace_id: workspaceId, p_root_location_code: text(b.locationCode), p_include_descendants: bool(b.includeDescendants), p_subtype_filter: text(b.subtypeFilter), p_vertical_filter: text(b.verticalFilter), p_blind_count: true, p_notes: text(b.notes) }) });
}));
router.post('/:id/preview', requireMember, run(async (req, res) => res.json({ preview: await rpc(req, 'preview_cycle_count_scope', { p_workspace_id: ctx(req).workspaceId, p_session_id: req.params.id }) })));
router.post('/:id/start', requireOperator, run(async (req, res) => res.json({ session: await rpc(req, 'start_cycle_count', { p_workspace_id: ctx(req).workspaceId, p_session_id: req.params.id }) })));
router.get('/:id/pass', requireMember, run(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const { data: session, error: se } = await client.from('cycle_count_session_overview').select('*').eq('workspace_id', workspaceId).eq('session_id', req.params.id).single();
  if (se) throw new SourceReadError('cycle count not found', 404);
  const [items, lots] = await Promise.all([
    client.from('cycle_count_expected_items').select('id,item_public_id,scan_sku,display_name,expected_location_code').eq('workspace_id', workspaceId).eq('session_id', req.params.id),
    client.from('cycle_count_expected_lots').select('id,lot_public_id,display_name,expected_location_code').eq('workspace_id', workspaceId).eq('session_id', req.params.id),
  ]);
  if (items.error || lots.error) throw new SourceReadError((items.error ?? lots.error)!.message, 400);
  res.json({ session, items: items.data ?? [], lots: lots.data ?? [] });
}));
router.post('/:id/items', requireOperator, run(async (req, res) => { const b=req.body??{}; if(!text(b.identifier)||!text(b.locationCode)) throw new SourceReadError('identifier and locationCode are required',400); res.json({ observation: await rpc(req,'observe_cycle_count_item',{p_workspace_id:ctx(req).workspaceId,p_session_id:req.params.id,p_identifier:text(b.identifier),p_observed_location_code:text(b.locationCode),p_note:text(b.note)})}); }));
router.post('/:id/lots', requireOperator, run(async (req,res)=>{const b=req.body??{}; const q=Number(b.quantity); if(!text(b.lotPublicId)||!Number.isSafeInteger(q)||q<0) throw new SourceReadError('lotPublicId and a non-negative whole quantity are required',400); res.json({observation:await rpc(req,'observe_cycle_count_lot',{p_workspace_id:ctx(req).workspaceId,p_session_id:req.params.id,p_lot_public_id:text(b.lotPublicId),p_observed_quantity:q,p_note:text(b.note)})});}));
router.post('/:id/submit', requireOperator, run(async(req,res)=>res.json({session:await rpc(req,'submit_cycle_count_for_review',{p_workspace_id:ctx(req).workspaceId,p_session_id:req.params.id,p_confirm_uncounted:bool(req.body?.confirmUncounted)})})));
router.get('/:id/discrepancies', requireMember, run(async(req,res)=>{const {client,workspaceId}=ctx(req); const {data,error}=await client.from('cycle_count_discrepancies').select('*').eq('workspace_id',workspaceId).eq('session_id',req.params.id).order('created_at'); if(error) throw new SourceReadError(error.message,400); res.json({discrepancies:data??[]});}));
router.post('/:id/discrepancies/:discrepancyId/recount', requireOperator, run(async(req,res)=>res.json({result:await rpc(req,'request_cycle_count_recount',{p_workspace_id:ctx(req).workspaceId,p_discrepancy_id:req.params.discrepancyId,p_note:text(req.body?.note)})})));
router.post('/:id/discrepancies/:discrepancyId/resolve', requireOperator, run(async(req,res)=>{if(!text(req.body?.action)) throw new SourceReadError('action is required',400); res.json({result:await rpc(req,'resolve_cycle_count_discrepancy',{p_workspace_id:ctx(req).workspaceId,p_discrepancy_id:req.params.discrepancyId,p_action:text(req.body.action),p_note:text(req.body.note),p_to_location_code:text(req.body.toLocationCode)})});}));
router.post('/:id/complete', requireOperator, run(async(req,res)=>res.json({session:await rpc(req,'complete_cycle_count',{p_workspace_id:ctx(req).workspaceId,p_session_id:req.params.id,p_allow_deferred:bool(req.body?.allowDeferred),p_note:text(req.body?.note)})})));
router.post('/:id/cancel', requireOperator, run(async(req,res)=>{if(!text(req.body?.reason)) throw new SourceReadError('reason is required',400); res.json({session:await rpc(req,'cancel_cycle_count',{p_workspace_id:ctx(req).workspaceId,p_session_id:req.params.id,p_reason:text(req.body.reason)})});}));
router.use((err: unknown,_req:AuthedRequest,res:Response,next:NextFunction)=>{if(err instanceof SourceReadError){res.status(err.status).json({error:err.message,code:err.status===409?'conflict':'invalid_request'});return;}next(err);});
export default router;

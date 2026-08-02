import { useEffect,useMemo,useRef,useState } from 'react';
import { ClipboardCheck,History,Plus,RefreshCw,ScanLine } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createCycleCountTransport,type CycleCountScope,type CurrentObservation,type CycleCountCompletionSummary,type CycleCountDiscrepancy,type CycleCountRoundHistory,type CycleCountSession,type ResolutionAttempt,type RoundProgress } from '../lib/cycleCountApi';
const newKey=()=>crypto.randomUUID();

export default function CycleCounts(){
 const {workspace,client}=useWorkspace();
 const api=useMemo(()=>createCycleCountTransport(client as never,()=>workspace?.id??null),[client,workspace?.id]);
 const [sessions,setSessions]=useState<readonly CycleCountSession[]>([]),[selected,setSelected]=useState<CycleCountSession|null>(null);
 const [creating,setCreating]=useState(false);
 const canCount=workspace?.role==='owner'||workspace?.role==='operator';
 const [progress,setProgress]=useState<RoundProgress|null>(null),[discrepancies,setDiscrepancies]=useState<readonly CycleCountDiscrepancy[]>([]);
 const [rounds,setRounds]=useState<readonly CycleCountRoundHistory[]>([]),[attempts,setAttempts]=useState<readonly ResolutionAttempt[]>([]);
 const [summary,setSummary]=useState<CycleCountCompletionSummary|null>(null);
 const [identifier,setIdentifier]=useState(''),[location,setLocation]=useState(''),[lot,setLot]=useState(''),[qty,setQty]=useState('');
 const [chosen,setChosen]=useState<Set<string>>(new Set()),[reason,setReason]=useState(''),[message,setMessage]=useState('');
 const detailRequest=useRef(0),selectedRef=useRef<CycleCountSession|null>(null);
 selectedRef.current=selected;
 const loadSessions=async()=>{try{const rows=await api.list();setSessions(rows);return rows}catch(e){setMessage((e as Error).message);return [] as readonly CycleCountSession[]}};
 const loadDetail=async(session=selectedRef.current)=>{if(!session)return;const request=++detailRequest.current;const [nextProgress,h,nextDiscrepancies,nextAttempts]=await Promise.all([
  api.progress(session.id),
  session.status==='in_progress'?Promise.resolve(null):api.history(session.id),
  session.status==='review'&&workspace?.role==='owner'?api.discrepancies(session.id):Promise.resolve([]),
  session.status==='review'&&workspace?.role==='owner'?api.attempts(session.id):Promise.resolve([]),
 ]);if(request!==detailRequest.current||selectedRef.current?.id!==session.id)return;setProgress(nextProgress);setRounds(h?.rounds??[]);setSummary(h?.completion_summary??null);setDiscrepancies(nextDiscrepancies);setAttempts(nextAttempts)};
 useEffect(()=>{if(workspace)void loadSessions()},[workspace?.id]);
 useEffect(()=>{void loadDetail().catch(e=>setMessage((e as Error).message))},[selected?.id,selected?.status]);
 const run=async(p:Promise<Record<string,unknown>>)=>{let r:Record<string,unknown>;try{r=await p;setMessage(String(r.outcome??'Done'))}catch(e){setMessage((e as Error).message);return}try{const current=selectedRef.current;const rows=await loadSessions();const fresh=current?rows.find(x=>x.id===current.id)??current:null;if(fresh!==current)setSelected(fresh);await loadDetail(fresh)}catch(e){setMessage(`Saved, but refresh failed: ${(e as Error).message}`)}return r};
 const toggle=(id:string)=>setChosen(old=>{const n=new Set(old);n.has(id)?n.delete(id):n.add(id);return n});
 const startRecount=async()=>{if(!selected||chosen.size===0)return;await run(api.selectRecount(selected.id,[...chosen],reason));await run(api.beginRecount(selected.id,reason));setChosen(new Set());setReason('')};
 return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
  <header className="flex items-start justify-between"><div><h1 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="h-5 w-5 text-accent"/>Cycle Counts</h1><p className="text-xs text-ink-muted">Blind, explicit-round evidence and governed review.</p></div><div className="flex items-center gap-2">
   {canCount&&<button onClick={()=>setCreating(true)} className="flex items-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4"/>Start cycle count</button>}
   <button onClick={()=>void loadSessions()} aria-label="Refresh cycle counts"><RefreshCw className="h-4 w-4"/></button>
  </div></header>
  {creating&&<NewCycleCount api={api} canCount={canCount} onCancel={()=>setCreating(false)} onStarted={async(session)=>{setCreating(false);await loadSessions();setSelected(session)}}/>}
  {message&&<div role="status" className="rounded border border-hairline bg-surface-1 p-3 text-sm">{message}</div>}
  <div className="grid gap-4 lg:grid-cols-[18rem_1fr]"><SessionList rows={sessions} selected={selected?.id} onSelect={setSelected}/><main className="space-y-4">{!selected?<Empty/>:<>
   <RoundHeader session={selected} progress={progress}/>
   {selected.status==='in_progress'?<Counting session={selected} progress={progress} identifier={identifier} location={location} lot={lot} qty={qty} setIdentifier={setIdentifier} setLocation={setLocation} setLot={setLot} setQty={setQty} run={run} api={api}/>:null}
   {selected.status==='review'&&workspace?.role==='owner'?<Review session={selected} discrepancies={discrepancies} attempts={attempts} chosen={chosen} toggle={toggle} reason={reason} setReason={setReason} startRecount={startRecount} run={run} api={api}/>:null}
   {selected.status==='completed'&&summary?<CompletionSummary summary={summary}/>:null}
   <HistoryPanel rounds={rounds}/>
  </>}</main></div>
 </div>;
}

function SessionList({rows,selected,onSelect}:{rows:readonly CycleCountSession[];selected?:string;onSelect:(s:CycleCountSession)=>void}){return <aside className="rounded-lg border border-hairline bg-surface-1 p-3"><h2 className="mb-2 text-sm font-semibold">Sessions</h2>{rows.length===0?<p className="text-sm text-ink-muted">No cycle counts.</p>:rows.map(s=><button key={s.id} onClick={()=>onSelect(s)} className={`mb-2 w-full rounded border p-3 text-left ${selected===s.id?'border-accent bg-accent/5':'border-hairline'}`}><div className="font-medium">{s.public_id}</div><div className="text-xs text-ink-muted">{s.status} · {s.blind_count?'Blind':'Visible'}</div></button>)}</aside>}
function Empty(){return <div className="rounded border border-hairline p-8 text-center text-sm text-ink-muted">Choose a session, or start a new cycle count.</div>}
function RoundHeader({session,progress}:{session:CycleCountSession;progress:RoundProgress|null}){return <section className="rounded-lg border border-hairline bg-surface-1 p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{session.public_id}</h2><p className="text-xs text-ink-muted">{progress?`${progress.round_type} round ${progress.round_number}`:'Loading round…'}</p></div>{progress?.blind&&<span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold">Blind counting</span>}</div>{progress&&<div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Items observed" value={progress.current_round_observed_item_count}/><Metric label="Lots observed" value={progress.current_round_observed_lot_count}/><Metric label="Remaining" value={progress.current_round_remaining_count??'Hidden'}/><Metric label="Rounds" value={progress.historical_round_count}/></div>}</section>}
function Counting({session,progress,identifier,location,lot,qty,setIdentifier,setLocation,setLot,setQty,run,api}:{session:CycleCountSession;progress:RoundProgress|null;identifier:string;location:string;lot:string;qty:string;setIdentifier:(x:string)=>void;setLocation:(x:string)=>void;setLot:(x:string)=>void;setQty:(x:string)=>void;run:(p:Promise<Record<string,unknown>>)=>Promise<unknown>;api:ReturnType<typeof createCycleCountTransport>}){const itemKey=useRef(newKey()),lotKey=useRef(newKey()),absenceKey=useRef(newKey());const [absenceItem,setAbsenceItem]=useState(''),[absenceReason,setAbsenceReason]=useState(''),[confirm,setConfirm]=useState<Record<string,unknown>|null>(null),[observations,setObservations]=useState<readonly CurrentObservation[]>([]);const loadObservations=()=>api.observations(session.id).then(setObservations);useEffect(()=>{void loadObservations()},[session.id]);const observeItem=async()=>{const result=await run(api.observeItem(session.id,identifier,location,itemKey.current));if(result){itemKey.current=newKey();await loadObservations()}};const observeLot=async()=>{const result=await run(api.observeLot(session.id,lot,Number(qty),lotKey.current));if(result){lotKey.current=newKey();await loadObservations()}};const attest=async()=>{const result=await run(api.attestItemAbsence(session.id,absenceItem,'not_found',absenceReason,absenceKey.current));if(result)absenceKey.current=newKey()};const voidObservation=async(o:CurrentObservation)=>{const why=window.prompt(`Why should ${o.subject_public_id} be voided?`);if(!why?.trim())return;const result=await run(api.voidObservation(session.id,o.id,o.subject_kind,why,newKey()));if(result)await loadObservations()};const submit=async(confirmed=false)=>{const result=await run(api.submit(session.id,confirmed)) as Record<string,unknown>|undefined;setConfirm(result?.outcome==='confirmation_required'?result:null)};return <section className="grid gap-4 md:grid-cols-2"><form className="rounded-lg border border-hairline p-4" onSubmit={e=>{e.preventDefault();void observeItem()}}><h3 className="mb-3 flex gap-2 font-semibold"><ScanLine className="h-4 w-4"/>Serialized observation</h3><input aria-label="Item identifier" required value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Scan identifier" className="mb-2 w-full rounded border border-hairline p-2"/><input aria-label="Observed location" required value={location} onChange={e=>setLocation(e.target.value)} placeholder="Location code" className="mb-3 w-full rounded border border-hairline p-2"/><button className="rounded bg-accent px-3 py-2 text-sm text-white">Record observation</button></form><form className="rounded-lg border border-hairline p-4" onSubmit={e=>{e.preventDefault();void observeLot()}}><h3 className="mb-3 font-semibold">Lot observation</h3><input aria-label="Lot public ID" required value={lot} onChange={e=>setLot(e.target.value)} placeholder="Lot ID" className="mb-2 w-full rounded border border-hairline p-2"/><input aria-label="Observed quantity" required type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)} placeholder="Quantity" className="mb-3 w-full rounded border border-hairline p-2"/><button className="rounded bg-accent px-3 py-2 text-sm text-white">Record lot</button></form><div className="rounded-lg border border-hairline p-4 md:col-span-2"><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Current round observations</h3><button onClick={()=>void loadObservations()} className="text-xs text-accent">Refresh</button></div>{observations.length===0?<p className="text-sm text-ink-muted">No live observations.</p>:observations.map(o=><div key={o.id} className="flex items-center justify-between border-t border-hairline py-2 text-sm"><span>{o.subject_public_id} · {o.subject_kind==='item'?`location ${o.detail}`:`quantity ${o.detail}`}</span><button onClick={()=>void voidObservation(o)} className="rounded border border-warning px-2 py-1 text-warning">Void mistake</button></div>)}</div>{progress?.round_type==='recount'&&<form className="rounded-lg border border-hairline p-4 md:col-span-2" onSubmit={e=>{e.preventDefault();void attest()}}><h3 className="mb-1 font-semibold">Missing item attestation</h3><p className="mb-3 text-xs text-ink-muted">Use this when an item in the recount scope could not be found.</p><div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"><input aria-label="Missing item public ID" required value={absenceItem} onChange={e=>setAbsenceItem(e.target.value)} placeholder="Item public ID" className="rounded border border-hairline p-2"/><input aria-label="Absence reason" required value={absenceReason} onChange={e=>setAbsenceReason(e.target.value)} placeholder="Reason item was not found" className="rounded border border-hairline p-2"/><button className="rounded bg-accent px-3 py-2 text-sm text-white">Attest not found</button></div></form>}<div className="md:col-span-2"><button onClick={()=>void submit()} className="rounded border border-accent px-3 py-2 text-sm font-semibold text-accent">Submit current round</button>{confirm&&<div role="alert" className="mt-3 rounded border border-warning bg-warning/10 p-3 text-sm"><p>This initial round still has {String(confirm.uncounted_item_count??0)} uncounted items and {String(confirm.uncounted_lot_count??0)} uncounted lots. Submit them as missing or uncounted?</p><button onClick={()=>void submit(true)} className="mt-2 rounded bg-accent px-3 py-2 font-semibold text-white">Confirm incomplete round</button></div>}</div></section>}
function Review({session,discrepancies,attempts,chosen,toggle,reason,setReason,startRecount,run,api}:{session:CycleCountSession;discrepancies:readonly CycleCountDiscrepancy[];attempts:readonly ResolutionAttempt[];chosen:Set<string>;toggle:(x:string)=>void;reason:string;setReason:(x:string)=>void;startRecount:()=>Promise<void>;run:(p:Promise<Record<string,unknown>>)=>Promise<unknown>;api:ReturnType<typeof createCycleCountTransport>}){return <section className="space-y-3 rounded-lg border border-hairline p-4"><h3 className="font-semibold">Current discrepancies</h3>{discrepancies.length===0?<p className="text-sm text-ink-muted">No current discrepancies.</p>:discrepancies.map(d=><DiscrepancyCard key={d.id} d={d} checked={chosen.has(d.id)} toggle={()=>toggle(d.id)} run={run} api={api}/>) }{discrepancies.length>0&&<div className="rounded bg-surface-2 p-3"><label className="text-xs font-medium">Recount reason</label><input value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded border border-hairline p-2"/><button disabled={chosen.size===0||!reason.trim()} onClick={()=>void startRecount()} className="mt-2 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">Begin one recount ({chosen.size})</button></div>}<h3 className="pt-2 font-semibold">Resolution attempts</h3>{attempts.length===0?<p className="text-sm text-ink-muted">No resolution attempts.</p>:attempts.map(a=><div key={a.id} className="flex items-center justify-between rounded border border-hairline p-3 text-sm"><span>{a.action.replaceAll('_',' ')} · {a.status}{a.failure_classification?` · ${a.failure_classification}`:''}</span>{a.status==='pending'&&<button onClick={async()=>{const approved=await run(api.approveAttempt(a.id)) as Record<string,unknown>|undefined;if(approved?.outcome==='approved'||approved?.outcome==='already_approved')await run(api.executeAttempt(a.id))}} className="rounded border border-accent px-2 py-1">Approve and execute</button>}{a.status==='failed'&&<button onClick={()=>void run(api.executeAttempt(a.id))} className="rounded border border-hairline px-2 py-1">Retry</button>}</div>)}<div className="flex justify-end border-t border-hairline pt-3"><button disabled={discrepancies.length>0} onClick={()=>void run(api.complete(session.id,false,'All current results reviewed'))} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Complete cycle count</button></div></section>}
function DiscrepancyCard({d,checked,toggle,run,api}:{d:CycleCountDiscrepancy;checked:boolean;toggle:()=>void;run:(p:Promise<Record<string,unknown>>)=>Promise<unknown>;api:ReturnType<typeof createCycleCountTransport>}){const [action,setAction]=useState(d.allowed_actions[0]?.action??''),[reason,setReason]=useState(''),[destination,setDestination]=useState(''),[postSnapshotReviewed,setPostSnapshotReviewed]=useState(false);const rule=d.allowed_actions.find(x=>x.action===action),changed=d.post_snapshot_classification!=='none';return <article className="rounded border border-hairline p-3"><div className="flex gap-3"><input aria-label={`Select ${d.public_id} for recount`} type="checkbox" checked={checked} onChange={toggle}/><div className="flex-1"><div className="font-medium">{d.kind.replaceAll('_',' ')}</div><div className="text-xs text-ink-muted">{d.classification.replaceAll('_',' ')}{d.observed_quantity!==null?` · observed ${d.observed_quantity}`:''}{d.computed_variance!==null?` · variance ${d.computed_variance}`:''}</div>{changed&&<div role="alert" className="mt-2 rounded border border-warning bg-warning/10 p-2 text-sm font-semibold">Post-snapshot change: {d.post_snapshot_classification.replaceAll('_',' ')}. Verify current inventory before resolving.<label className="mt-2 flex gap-2 text-xs font-normal"><input type="checkbox" checked={postSnapshotReviewed} onChange={e=>setPostSnapshotReviewed(e.target.checked)}/>I reviewed the post-snapshot activity</label></div>}</div></div><div className="mt-3 grid gap-2 md:grid-cols-3"><select aria-label="Resolution action" value={action} onChange={e=>setAction(e.target.value)} className="rounded border border-hairline p-2 text-sm">{d.allowed_actions.map(a=><option key={a.action} value={a.action}>{a.action.replaceAll('_',' ')}</option>)}</select><input aria-label="Resolution reason" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason" className="rounded border border-hairline p-2 text-sm"/>{rule?.destination_mode==='reviewed'?<input aria-label="Reviewed destination" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Destination code" className="rounded border border-hairline p-2 text-sm"/>:<div className="p-2 text-xs text-ink-muted">{rule?.destination_mode==='observed'?'Destination locked to counted location':'No destination required'}</div>}</div><button disabled={!action||(rule?.reason_required&&!reason.trim())||(changed&&!postSnapshotReviewed)} onClick={async()=>{const r=await run(api.createAttempt(d.id,action,reason,rule?.destination_mode==='reviewed'?destination:null,newKey())) as Record<string,unknown>|undefined;if(r?.attempt_id&&!rule?.approval_required)await run(api.executeAttempt(String(r.attempt_id)))} } className="mt-2 rounded border border-accent px-3 py-1.5 text-sm text-accent disabled:opacity-50">Resolve current result</button></article>}
function HistoryPanel({rounds}:{rounds:readonly CycleCountRoundHistory[]}){return <section className="rounded-lg border border-hairline p-4"><h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4"/>Round and evidence history</h3><div className="mt-3 space-y-2">{rounds.map(r=><div key={r.id} className="rounded bg-surface-2 p-3 text-sm"><b>Round {r.round_number} · {r.round_type}</b><div className="text-xs text-ink-muted">{r.status} · {r.subject_count} subjects · {r.item_observation_count} item and {r.lot_observation_count} lot observations · {r.result_count} results</div></div>)}</div></section>}
function CompletionSummary({summary}:{summary:CycleCountCompletionSummary}){return <section aria-label="Latest-result completion summary" className="rounded-lg border border-hairline bg-surface-1 p-4"><h3 className="font-semibold">Completed latest-result summary</h3><p className="mt-1 text-xs text-ink-muted">Each subject contributes only its latest accepted round result. Historical evidence is excluded from inventory totals.</p><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Latest subjects" value={summary.latest_subject_count}/><Metric label="Found items" value={summary.found_item_count}/><Metric label="Observed lot units" value={summary.observed_lot_quantity}/><Metric label="Net variance" value={summary.net_variance}/><Metric label="Shortage units" value={summary.shortage_quantity}/><Metric label="Overage units" value={summary.overage_quantity}/><Metric label="Resolved" value={summary.resolved_discrepancy_count}/><Metric label="Deferred" value={summary.deferred_discrepancy_count}/></div></section>}
function Metric({label,value}:{label:string;value:string|number}){return <div className="rounded bg-surface-2 p-3"><div className="text-xs text-ink-muted">{label}</div><div className="text-lg font-semibold">{value}</div></div>}

/**
 * First-use workflow: configure scope, review it, create a draft, then start
 * explicitly. Create and start stay separate because starting freezes the
 * expected-inventory snapshot, and freezing is the moment worth confirming.
 *
 * The idempotency key is minted once per attempt and held in a ref, but the
 * guarantee is the database's: create_cycle_count_session refuses a request
 * without a key and returns the original session on replay. A key in browser
 * memory alone would prove nothing after a lost response.
 */
function NewCycleCount({api,canCount,onCancel,onStarted}:{
 api:ReturnType<typeof createCycleCountTransport>;
 canCount:boolean;
 onCancel:()=>void;
 onStarted:(session:CycleCountSession)=>void|Promise<void>;
}){
 const [scope,setScope]=useState<CycleCountScope>({rootLocationCode:'',idempotencyKey:newKey(),includeDescendants:false,blindCount:true,notes:''});
 const [stage,setStage]=useState<'scope'|'review'|'draft'>('scope');
 const [draft,setDraft]=useState<{id:string;public_id:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);

 if(!canCount) return null;
 const field='w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm';

 const create=async()=>{
  setBusy(true); setError(null);
  try{
   const result=await api.create(scope);
   setDraft({id:result.id,public_id:result.public_id});
   setStage('draft');
   // A replay is reported, not hidden: the operator should know the retry
   // reattached to the session the first attempt created.
   setNotice(result.outcome==='idempotent_replay'
    ?`Reattached to the draft this request already created (${result.public_id}).`
    :`Draft ${result.public_id} created. It is not counting yet.`);
  }catch(e){
   // The key is deliberately NOT regenerated: if this failed after the
   // database committed, retrying with the same key must find that session
   // rather than open a second count over the same shelf.
   setError((e as Error).message);
  }finally{setBusy(false)}
 };

 const start=async()=>{
  if(!draft) return;
  setBusy(true); setError(null);
  try{
   await api.start(draft.id);
   await onStarted({id:draft.id,public_id:draft.public_id,status:'in_progress',blind_count:scope.blindCount!==false,created_at:new Date().toISOString(),current_round_id:null});
  }catch(e){
   // Creation succeeded and starting did not. Say exactly that, and leave the
   // draft reachable rather than pretending nothing happened.
   setError(`${(e as Error).message} The draft ${draft.public_id} was created and is still waiting to be started.`);
  }finally{setBusy(false)}
 };

 return <section aria-label="Start a cycle count" className="rounded-lg border border-accent/40 bg-accent/5 p-4">
  <h2 className="mb-3 text-sm font-semibold">Start a cycle count</h2>
  {error&&<p role="alert" className="mb-3 rounded border border-bad/40 bg-bad/10 p-2 text-sm text-bad">{error}</p>}
  {notice&&<p role="status" className="mb-3 rounded border border-hairline bg-surface-1 p-2 text-sm">{notice}</p>}

  {stage==='scope'&&<form onSubmit={e=>{e.preventDefault();setStage('review')}} className="space-y-3">
   <div>
    <label className="block text-xs" htmlFor="cc-root">Root location code</label>
    <input id="cc-root" required value={scope.rootLocationCode} className={field}
      onChange={e=>setScope({...scope,rootLocationCode:e.target.value})}/>
   </div>
   <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={scope.includeDescendants??false}
      onChange={e=>setScope({...scope,includeDescendants:e.target.checked})}/>
    Include locations inside it
   </label>
   <div className="grid gap-3 md:grid-cols-2">
    <div>
     <label className="block text-xs" htmlFor="cc-subtype">Category (optional)</label>
     <input id="cc-subtype" value={scope.subtypeFilter??''} className={field}
       onChange={e=>setScope({...scope,subtypeFilter:e.target.value||null})}/>
    </div>
    <div>
     <label className="block text-xs" htmlFor="cc-vertical">Business vertical (optional)</label>
     <input id="cc-vertical" value={scope.verticalFilter??''} className={field}
       onChange={e=>setScope({...scope,verticalFilter:e.target.value||null})}/>
    </div>
   </div>
   <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={scope.blindCount!==false}
      onChange={e=>setScope({...scope,blindCount:e.target.checked})}/>
    Blind count — do not show what is expected
   </label>
   <div>
    <label className="block text-xs" htmlFor="cc-notes">Notes (optional)</label>
    <input id="cc-notes" value={scope.notes??''} className={field}
      onChange={e=>setScope({...scope,notes:e.target.value})}/>
   </div>
   <div className="flex gap-2">
    <button type="submit" className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white">Review scope</button>
    <button type="button" onClick={onCancel} className="rounded border border-hairline px-3 py-2 text-sm">Cancel</button>
   </div>
  </form>}

  {stage==='review'&&<div className="space-y-3">
   {/* Deliberately no expected totals here. Telling a blind count what it
       should find is the one thing a blind count exists to prevent. */}
   <dl className="grid grid-cols-2 gap-2 text-sm">
    <dt className="text-ink-muted">Root location</dt><dd>{scope.rootLocationCode}</dd>
    <dt className="text-ink-muted">Locations inside it</dt><dd>{scope.includeDescendants?'Included':'Not included'}</dd>
    <dt className="text-ink-muted">Category</dt><dd>{scope.subtypeFilter||'Any'}</dd>
    <dt className="text-ink-muted">Business vertical</dt><dd>{scope.verticalFilter||'Any'}</dd>
    <dt className="text-ink-muted">Counting</dt><dd>{scope.blindCount!==false?'Blind':'Expected quantities visible'}</dd>
   </dl>
   {scope.blindCount!==false&&<p className="text-xs text-ink-muted">
    This is a blind count, so nothing here or on the counting screen will tell you what is expected.
   </p>}
   <div className="flex gap-2">
    <button type="button" disabled={busy} onClick={()=>void create()}
      className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
     {busy?'Creating…':'Create draft'}
    </button>
    <button type="button" disabled={busy} onClick={()=>setStage('scope')} className="rounded border border-hairline px-3 py-2 text-sm">Back</button>
   </div>
  </div>}

  {stage==='draft'&&draft&&<div className="space-y-3">
   <p className="text-sm">Draft <strong>{draft.public_id}</strong> is ready. Starting it freezes what the count expects to find.</p>
   <div className="flex gap-2">
    <button type="button" disabled={busy} onClick={()=>void start()}
      className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
     {busy?'Starting…':'Start counting'}
    </button>
    <button type="button" onClick={onCancel} className="rounded border border-hairline px-3 py-2 text-sm">Leave as draft</button>
   </div>
  </div>}
 </section>;
}

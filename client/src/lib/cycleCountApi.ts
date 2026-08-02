import type { SupabaseClient } from '@supabase/supabase-js';
export type CycleCountStatus='draft'|'in_progress'|'review'|'completed'|'cancelled';
export interface CycleCountSession { id:string; public_id:string; status:CycleCountStatus; blind_count:boolean; created_at:string; current_round_id:string|null }
export interface RoundProgress { round_id:string;round_number:number;round_type:'initial'|'recount';round_status:string;current_round_expected_subject_count:number|null;current_round_observed_item_count:number;current_round_observed_lot_count:number;current_round_remaining_count:number|null;historical_round_count:number;total_historical_observations:number;blind:boolean }
export interface ResolutionAction {action:string;reason_required:boolean;destination_mode:'none'|'observed'|'reviewed';quantity_mode:'none'|'latest_observed';approval_required:boolean}
export interface CycleCountDiscrepancy {id:string;public_id:string;kind:string;status:string;classification:string;subject_type:'item'|'lot';expected_quantity:number|null;observed_quantity:number|null;computed_variance:number|null;post_snapshot_classification:string;recount_outcome:string|null;allowed_actions:readonly ResolutionAction[]}
export interface CycleCountRoundHistory {id:string;public_id:string;round_number:number;round_type:'initial'|'recount';status:string;reason:string|null;subject_count:number;item_observation_count:number;lot_observation_count:number;result_count:number}
export interface ResolutionAttempt {id:string;discrepancy_id:string;action:string;reason:string|null;reviewed_destination_code:string|null;status:'pending'|'executing'|'succeeded'|'failed';failure_classification:string|null;created_at:string;events:readonly {type:string;failure_classification:string|null;occurred_at:string}[]}
export interface CurrentObservation {id:string;subject_kind:'item'|'lot';subject_public_id:string;detail:string;recorded_at:string}
export interface CycleCountCompletionSummary {latest_subject_count:number;found_item_count:number;observed_lot_quantity:number;shortage_quantity:number;overage_quantity:number;net_variance:number;resolved_discrepancy_count:number;deferred_discrepancy_count:number}
export interface CycleCountTransport {
 list():Promise<readonly CycleCountSession[]>; progress(id:string):Promise<RoundProgress>;
 observeItem(id:string,identifier:string,locationCode:string,key:string):Promise<Record<string,unknown>>;
 observeLot(id:string,lotPublicId:string,quantity:number,key:string):Promise<Record<string,unknown>>;
 attestItemAbsence(id:string,itemPublicId:string,attestation:'not_found'|'unable_to_count',reason:string,key:string):Promise<Record<string,unknown>>;
 observations(id:string):Promise<readonly CurrentObservation[]>;
 voidObservation(id:string,observationId:string,subjectKind:'item'|'lot',reason:string,key:string):Promise<Record<string,unknown>>;
/** Scope of a new count. Blind unless the operator deliberately says otherwise. */
 create(scope:CycleCountScope):Promise<{id:string;public_id:string;status:string;outcome?:string}>;
 start(id:string):Promise<Record<string,unknown>>;
 submit(id:string,confirm:boolean):Promise<Record<string,unknown>>;
 selectRecount(id:string,discrepancyIds:string[],reason:string):Promise<Record<string,unknown>>;
 beginRecount(id:string,reason:string):Promise<Record<string,unknown>>;
 discrepancies(id:string):Promise<readonly CycleCountDiscrepancy[]>;
 history(id:string):Promise<{status:string;completion_summary:CycleCountCompletionSummary|null;rounds:readonly CycleCountRoundHistory[]}>;
 attempts(id:string):Promise<readonly ResolutionAttempt[]>;
 createAttempt(discrepancyId:string,action:string,reason:string,destinationCode:string|null,key:string):Promise<Record<string,unknown>>;
 approveAttempt(attemptId:string):Promise<Record<string,unknown>>;
 executeAttempt(attemptId:string):Promise<Record<string,unknown>>;
 complete(id:string,allowDeferred:boolean,note:string):Promise<Record<string,unknown>>;
 cancel(id:string,reason:string):Promise<Record<string,unknown>>;
}
export interface CycleCountScope {
  rootLocationCode:string;
  /** The database rejects a create without one; a retry must not open a second count. */
  idempotencyKey:string;
  includeDescendants?:boolean;
  subtypeFilter?:string|null;
  verticalFilter?:string|null;
  blindCount?:boolean;
  notes?:string|null;
}

export function createCycleCountTransport(client:SupabaseClient<never,never,never>,workspaceId:()=>string|null):CycleCountTransport {
 const db=client as unknown as {from(t:string):any;rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:any;error:{message:string}|null}>};
 const ws=()=>{const id=workspaceId();if(!id)throw new Error('No workspace selected.');return id};
 const rpc=async(fn:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(fn,{p_workspace_id:ws(),...args});if(error)throw new Error(error.message);return (data??{}) as Record<string,unknown>};
 return {
  async list(){const {data,error}=await db.from('cycle_count_sessions').select('id,public_id,status,blind_count,created_at,current_round_id').eq('workspace_id',ws()).order('created_at',{ascending:false});if(error)throw new Error(error.message);return data??[]},
  async progress(id){return await rpc('get_cycle_count_round_progress',{p_session_id:id}) as unknown as RoundProgress},
  observeItem:(id,identifier,locationCode,key)=>rpc('observe_cycle_count_item',{p_session_id:id,p_identifier:identifier,p_observed_location_code:locationCode,p_idempotency_key:key,p_note:null}),
  observeLot:(id,lotPublicId,quantity,key)=>rpc('observe_cycle_count_lot',{p_session_id:id,p_lot_public_id:lotPublicId,p_observed_quantity:quantity,p_idempotency_key:key,p_note:null}),
  attestItemAbsence:(id,itemPublicId,attestation,reason,key)=>rpc('attest_cycle_count_item_absence',{p_session_id:id,p_item_public_id:itemPublicId,p_attestation:attestation,p_reason:reason,p_idempotency_key:key}),
  async observations(id){return await rpc('list_current_cycle_count_observations',{p_session_id:id}) as unknown as CurrentObservation[]},
  voidObservation:(id,observationId,subjectKind,reason,key)=>rpc('void_cycle_count_observation',{p_session_id:id,p_observation_id:observationId,p_subject_kind:subjectKind,p_reason:reason,p_idempotency_key:key}),
  async create(scope){
    const result = await rpc('create_cycle_count_session',{
      p_root_location_code:scope.rootLocationCode,
      p_idempotency_key:scope.idempotencyKey,
      p_include_descendants:scope.includeDescendants ?? false,
      p_subtype_filter:scope.subtypeFilter ?? null,
      p_vertical_filter:scope.verticalFilter ?? null,
      p_blind_count:scope.blindCount !== false,
      p_notes:scope.notes ?? null,
    });
    return result as unknown as {id:string;public_id:string;status:string;outcome?:string};
  },
  start:(id)=>rpc('start_cycle_count',{p_session_id:id}),
  submit:(id,confirm)=>rpc('submit_cycle_count_round',{p_session_id:id,p_confirm_uncounted:confirm}),
  selectRecount:(id,ids,reason)=>rpc('mark_cycle_count_discrepancies_for_recount',{p_session_id:id,p_discrepancy_ids:ids,p_reason:reason}),
  beginRecount:(id,reason)=>rpc('begin_cycle_count_recount',{p_session_id:id,p_reason:reason}),
  async discrepancies(id){return await rpc('list_current_cycle_count_discrepancies',{p_session_id:id}) as unknown as CycleCountDiscrepancy[]},
  async history(id){return await rpc('list_cycle_count_history',{p_session_id:id}) as unknown as {status:string;completion_summary:CycleCountCompletionSummary|null;rounds:CycleCountRoundHistory[]}},
  async attempts(id){return await rpc('list_cycle_count_resolution_attempts',{p_session_id:id}) as unknown as ResolutionAttempt[]},
  createAttempt:(discrepancyId,action,reason,destinationCode,key)=>rpc('create_cycle_count_resolution_attempt',{p_discrepancy_id:discrepancyId,p_action:action,p_reason:reason,p_reviewed_destination_code:destinationCode,p_idempotency_key:key}),
  approveAttempt:(attemptId)=>rpc('approve_cycle_count_resolution_attempt',{p_attempt_id:attemptId}),
  executeAttempt:(attemptId)=>rpc('execute_cycle_count_resolution_attempt',{p_attempt_id:attemptId}),
  complete:(id,allowDeferred,note)=>rpc('complete_cycle_count_latest',{p_session_id:id,p_allow_deferred:allowDeferred,p_note:note||null}),
  cancel:(id,reason)=>rpc('cancel_cycle_count',{p_session_id:id,p_reason:reason}),
 };
}

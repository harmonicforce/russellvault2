import type { SupabaseClient } from '@supabase/supabase-js';
export type CountStatus='draft'|'in_progress'|'review'|'completed'|'cancelled';
export interface CountSession {session_id:string;public_id:string;status:CountStatus;root_location_code:string;root_location_display_name:string|null;created_at:string;expected_item_count:number;observed_item_count:number;expected_lot_count:number;observed_lot_count:number;open_discrepancy_count:number;total_discrepancy_count:number;completion_summary:Record<string,unknown>|null}
export interface CountDiscrepancy {id:string;public_id:string;discrepancy_kind:string;status:string;item_id:string|null;lot_id:string|null;expected_quantity:number|null;observed_quantity:number|null;expected_location_id:string|null;observed_location_id:string|null}
const friendly=(m:string)=>/row-level security|permission denied/i.test(m)?'You do not have permission to perform that count action.':m;
export function createCycleCountApi(client:SupabaseClient<never,never,never>, workspace:()=>string|null){
 const db=client as unknown as {from:(t:string)=>any;rpc:(f:string,a:Record<string,unknown>)=>PromiseLike<{data:any,error:{message:string}|null}>}; // eslint-disable-line @typescript-eslint/no-explicit-any
 const ws=()=>{const id=workspace();if(!id)throw new Error('No workspace selected.');return id};
 const rpc=async(f:string,a:Record<string,unknown>)=>{const {data,error}=await db.rpc(f,{p_workspace_id:ws(),...a});if(error)throw new Error(friendly(error.message));return data};
 return {
  async list(){const {data,error}=await db.from('cycle_count_session_overview').select('*').eq('workspace_id',ws()).order('created_at',{ascending:false});if(error)throw new Error(friendly(error.message));return (data??[]) as CountSession[]},
  async locations(){const {data,error}=await db.from('storage_locations').select('location_code,display_name').eq('workspace_id',ws()).is('retired_at',null).order('location_code');if(error)throw new Error(friendly(error.message));return data as {location_code:string;display_name:string|null}[]},
  create:(location:string,desc:boolean,subtype:string|null,vertical:string|null,notes:string|null)=>rpc('create_cycle_count',{p_root_location_code:location,p_include_descendants:desc,p_subtype_filter:subtype||null,p_vertical_filter:vertical||null,p_blind_count:true,p_notes:notes||null}),
  preview:(id:string)=>rpc('preview_cycle_count_scope',{p_session_id:id}), start:(id:string)=>rpc('start_cycle_count',{p_session_id:id}),
  async detail(id:string){const {data,error}=await db.from('cycle_count_session_overview').select('*').eq('workspace_id',ws()).eq('session_id',id).single();if(error)throw new Error(friendly(error.message));return data as CountSession},
  async lots(id:string){const {data,error}=await db.from('cycle_count_expected_lots').select('lot_public_id,display_name,expected_location_code').eq('workspace_id',ws()).eq('session_id',id).order('display_name');if(error)throw new Error(friendly(error.message));return data as {lot_public_id:string;display_name:string;expected_location_code:string}[]},
  observeItem:(id:string,identifier:string,location:string)=>rpc('observe_cycle_count_item',{p_session_id:id,p_identifier:identifier,p_observed_location_code:location,p_note:null}),
  observeLot:(id:string,lot:string,quantity:number)=>rpc('observe_cycle_count_lot',{p_session_id:id,p_lot_public_id:lot,p_observed_quantity:quantity,p_note:null}),
  submit:(id:string,confirm:boolean)=>rpc('submit_cycle_count_for_review',{p_session_id:id,p_confirm_uncounted:confirm}),
  async discrepancies(id:string){const {data,error}=await db.from('cycle_count_discrepancies').select('*').eq('workspace_id',ws()).eq('session_id',id).order('created_at');if(error)throw new Error(friendly(error.message));return (data??[]) as CountDiscrepancy[]},
  recount:(d:string,note:string)=>rpc('request_cycle_count_recount',{p_discrepancy_id:d,p_note:note||null}),
  resolve:(d:string,action:string,note:string,location:string|null)=>rpc('resolve_cycle_count_discrepancy',{p_discrepancy_id:d,p_action:action,p_note:note||null,p_to_location_code:location||null}),
  complete:(id:string,allow:boolean,note:string)=>rpc('complete_cycle_count',{p_session_id:id,p_allow_deferred:allow,p_note:note||null}),
 };
}
export const isBlindPass=(status:string)=>status==='in_progress';

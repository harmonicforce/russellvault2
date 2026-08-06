export type AcquisitionSort = 'occurred_at'|'created_at'|'seller'|'title'|'quantity'|'classification';
export type AcquisitionExclusionState='included'|'excluded';
export type AcquisitionOrder = 'asc'|'desc';
export interface AcquisitionLine { source_system_public_id:string; acquisition_line_public_id:string; full_title:string|null; delivered_item_title:string|null; seller_normalized:string|null; business_vertical:string|null; quantity:number; occurred_at:string|null; created_at:string; source_order_reference:string|null; classification_key:string|null; classification_label:string|null; classification_method:string|null; classification_state:'classified'|'needs_review'|'unclassified'; exclusion_state:AcquisitionExclusionState; current_exclusion_public_id:string|null; current_exclusion_reason:string|null; excluded_at:string|null }
export interface FacetCount { value:string; count:number }
export interface ClassificationFacet { key:string; label:string; count:number }
export interface AcquisitionFacets { classificationOptions:ClassificationFacet[]; unclassified:number; methods:FacetCount[]; states:FacetCount[]; exclusionStates:FacetCount[]; sellers:FacetCount[]; businessVerticals:FacetCount[] }
export interface LineParams { query?:string; classification?:string; seller?:string; businessVertical?:string; method?:string; classificationState?:string; exclusionState?:AcquisitionExclusionState; sort:AcquisitionSort; order:AcquisitionOrder; limit:number; offset:number }
export class AcquisitionLinesError extends Error { readonly code:string; constructor(code:string){super(code);this.code=code} }

async function request<T>(tokenProvider:()=>Promise<string|null>, path:string):Promise<T>{
  const token=await tokenProvider();
  if(!token) throw new AcquisitionLinesError('signed_out');
  const response=await fetch(`/api/acquisition${path}`,{headers:{authorization:`Bearer ${token}`}});
  const body=await response.json().catch(()=>null) as {error?:string}|null;
  if(!response.ok) throw new AcquisitionLinesError(body?.error && /^[a-z_]+$/.test(body.error)?body.error:'acquisition_read_unavailable');
  return body as T;
}
export function createAcquisitionLinesTransport(tokenProvider:()=>Promise<string|null>){
  return {
    lines(workspaceId:string,p:LineParams){ const q=new URLSearchParams({workspaceId,sort:p.sort,order:p.order,limit:String(p.limit),offset:String(p.offset)}); Object.entries(p).forEach(([k,v])=>{if(!['sort','order','limit','offset'].includes(k)&&v)q.set(k,String(v))}); return request<{coverage:'governed_native_committed';historicalLegacyImported:false;total:number;limit:number;offset:number;rows:AcquisitionLine[]}>(tokenProvider,`/lines?${q}`)},
    facets(workspaceId:string){return request<{coverage:'governed_native_committed';historicalLegacyImported:false;facets:AcquisitionFacets}>(tokenProvider,`/facets?workspaceId=${encodeURIComponent(workspaceId)}`)}
  };
}

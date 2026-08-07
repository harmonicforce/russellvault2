// S1.4 acquisition HTTP acceptance.
//
// Every assertion below issues a real HTTP request against the acquisition
// router mounted on a live Express server and inspects the status, the JSON
// body, and the exact RPC arguments the route forwarded. Nothing here reads the
// route's source text: a handler that merely contains the right identifiers but
// forwards the wrong arguments, or maps the wrong status, must fail this file.
//
// The Supabase client is injected through setCallerClientFactoryForTests, so it
// is also the ONLY data path available to the router. Any route that reached a
// service-role client, a second privileged connection, or a local SQLite file
// would answer without recording a call here — which is what the transport
// assertions below actually check.
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {setCallerClientFactoryForTests} from '../provenance/auth.js';

const {default:router}=await import('./acquisition.js');
const WS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roles:Record<string,string|undefined>={owner:'owner',operator:'operator',viewer:'viewer',stranger:undefined};
let calls:Array<{fn:string;args:Record<string,unknown>}>=[];
let rpcError:string|null=null;
let rpcNullData=false;
function fake(token:string){const role=roles[token];return {
 auth:{getUser:async()=>role!==undefined||token==='stranger'?{data:{user:{id:token}},error:null}:{data:{user:null},error:{message:'bad token'}}},
 from(table:string){const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:table==='workspace_members'&&role?[{role}]:[],error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({data:table==='workspace_members'&&role?[{role}]:[],error:null}))};return q},
 rpc:async(fn:string,args:Record<string,unknown>)=>{calls.push({fn,args});if(rpcError)return {data:null,error:{message:rpcError}};if(rpcNullData)return {data:null,error:null};
  // The list route validates the governed payload shape, so the double stands
  // in with a well-formed page rather than a placeholder the route must reject.
  if(fn==='list_acquisition_lines')return {data:{total:0,limit:args.p_limit,offset:args.p_offset,rows:[]},error:null};
  return {data:{ok:true},error:null}}
};}
let server:Server,base='';
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/acquisition',router);app.use((_e:unknown,_q:unknown,res:express.Response)=>res.status(500).json({error:'internal_error'}));await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>{const a=server.address();base=`http://127.0.0.1:${typeof a==='object'&&a?a.port:0}`;resolve()})});setCallerClientFactoryForTests(t=>fake(t) as never)});
afterAll(()=>{server.close();setCallerClientFactoryForTests(null)});
beforeEach(()=>{calls=[];rpcError=null;rpcNullData=false;process.env.SHADOW_IMPORT='repository-fixtures';process.env.SUPABASE_URL='http://127.0.0.1';process.env.SUPABASE_ANON_KEY='test'});
async function request(method:string,path:string,token?:string,body?:unknown){return fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
const path=(suffix:string)=>`/api/acquisition${suffix}${suffix.includes('?')?'&':'?'}workspaceId=${WS}`;
const payment=(over:Record<string,unknown>={})=>({amountMinor:1234,currency:'USD',instrument:'card',paidAt:'2026-08-06T12:00:00.000Z',idempotencyKey:'payment-key-1',...over});
const shipment=(over:Record<string,unknown>={})=>({status:'expected',idempotencyKey:'shipment-key-1',...over});
const transition=(over:Record<string,unknown>={})=>({expectedStatus:'expected',newStatus:'in_transit',idempotencyKey:'transition-key-1',...over});

describe('S1.4 acquisition HTTP availability and authority',()=>{
 it('returns 404 when governed mode is disabled',async()=>{delete process.env.SHADOW_IMPORT;const r=await request('GET',path('/sources/SRC/lines/LINE'),'viewer');expect(r.status).toBe(404);expect(calls).toHaveLength(0)});
 it('404s every mutation when governed mode is disabled',async()=>{delete process.env.SHADOW_IMPORT;expect((await request('POST',path('/orders/O/payments'),'owner',payment())).status).toBe(404);expect((await request('POST',path('/orders/O/shipments'),'owner',shipment())).status).toBe(404);expect(calls).toHaveLength(0)});
 it('denies a missing bearer token',async()=>{const r=await request('GET',path('/sources/SRC/lines/LINE'));expect(r.status).toBe(401);expect(calls).toHaveLength(0)});
 it('denies an unrecognized bearer token',async()=>expect((await request('GET',path('/sources/SRC/lines/LINE'),'nobody')).status).toBe(401));
 it('denies a non-member of the workspace',async()=>expect((await request('GET',path('/sources/SRC/lines/LINE'),'stranger')).status).toBe(403));
 it('permits viewer source-qualified detail and forwards both identities',async()=>{expect((await request('GET',path('/sources/SRC-A/lines/LINE-1'),'viewer')).status).toBe(200);expect(calls[0]).toEqual({fn:'get_acquisition_line_detail_by_source',args:{p_workspace_id:WS,p_source_system_public_id:'SRC-A',p_acquisition_line_public_id:'LINE-1'}})});
 it('forwards percent-encoded identities decoded exactly once',async()=>{await request('GET',path(`/sources/${encodeURIComponent('SRC A/B')}/lines/${encodeURIComponent('LINE #1')}`),'viewer');expect(calls[0].args).toMatchObject({p_source_system_public_id:'SRC A/B',p_acquisition_line_public_id:'LINE #1'})});
 it('denies viewer classification',async()=>{expect((await request('POST',path('/sources/S/lines/L/classify'),'viewer',{})).status).toBe(403);expect(calls).toHaveLength(0)});
 it('denies viewer payments, shipments, and transitions',async()=>{expect((await request('POST',path('/orders/O/payments'),'viewer',payment())).status).toBe(403);expect((await request('POST',path('/orders/O/shipments'),'viewer',shipment())).status).toBe(403);expect((await request('POST',path('/shipments/S/transition'),'viewer',transition())).status).toBe(403);expect((await request('POST',path('/payments/P/reverse'),'viewer',{reason:'x',idempotencyKey:'reverse-key-1'})).status).toBe(403);expect(calls).toHaveLength(0)});
 it('permits operator classify',async()=>{expect((await request('POST',path('/sources/S/lines/L/classify'),'operator',{})).status).toBe(200);expect(calls[0].fn).toBe('classify_acquisition_line_by_source')});
 it('denies operator override',async()=>{expect((await request('POST',path('/sources/S/lines/L/classification-override'),'operator',{classificationOptionKey:'sealed',reason:'observed'})).status).toBe(403);expect(calls).toHaveLength(0)});
 it('denies operator payment reversal',async()=>{expect((await request('POST',path('/payments/P/reverse'),'operator',{reason:'duplicate',idempotencyKey:'reverse-key-1'})).status).toBe(403);expect(calls).toHaveLength(0)});
 it('permits owner override and forwards trimmed evidence',async()=>{expect((await request('POST',path('/sources/S/lines/L/classification-override'),'owner',{classificationOptionKey:'sealed',reason:' observed '})).status).toBe(200);expect(calls[0]).toMatchObject({fn:'override_acquisition_line_classification_by_source',args:{p_classification_option_key:'sealed',p_reason:'observed'}})});
 it('requires an override reason',async()=>{expect((await request('POST',path('/sources/S/lines/L/classification-override'),'owner',{classificationOptionKey:'sealed',reason:'   '})).status).toBe(400);expect(calls).toHaveLength(0)});
});

describe('S1.4 acquisition HTTP payment transport',()=>{
 it('forwards validated payment RPC arguments',async()=>{expect((await request('POST',path('/orders/O-1/payments'),'operator',payment())).status).toBe(200);expect(calls[0]).toMatchObject({fn:'record_acquisition_payment',args:{p_workspace_id:WS,p_acquisition_order_public_id:'O-1',p_amount_minor:1234,p_currency:'USD',p_instrument:'card',p_paid_at:'2026-08-06T12:00:00.000Z',p_idempotency_key:'payment-key-1'}})});
 // Source evidence is NOT accepted over HTTP: the route pins it to null rather
 // than letting a client attach an unvalidated source_record_id to money.
 it('never forwards a client-supplied source record id',async()=>{await request('POST',path('/orders/O/payments'),'operator',payment({sourceRecordId:'11111111-1111-4111-8111-111111111111'}));expect(calls[0].args.p_source_record_id).toBeNull()});
 it('forwards optional payment evidence and trims it',async()=>{await request('POST',path('/orders/O/payments'),'operator',payment({externalReference:'  EXT-1  ',evidenceNote:'  seen on statement  '}));expect(calls[0].args).toMatchObject({p_external_reference:'EXT-1',p_evidence_note:'seen on statement'})});
 it('forwards absent optional payment evidence as null',async()=>{await request('POST',path('/orders/O/payments'),'operator',payment());expect(calls[0].args).toMatchObject({p_external_reference:null,p_evidence_note:null})});
 it.each([
  ['a zero amount',{amountMinor:0}],
  ['a negative amount',{amountMinor:-1}],
  ['a fractional amount',{amountMinor:12.5}],
  ['an unsafe integer amount',{amountMinor:Number.MAX_SAFE_INTEGER+2}],
  ['a missing amount',{amountMinor:undefined}],
  ['a lowercase currency',{currency:'usd'}],
  ['an over-long currency',{currency:'USDD'}],
  ['an instrument outside the vocabulary',{instrument:'wire'}],
  ['a date-only paidAt',{paidAt:'2026-08-06'}],
  ['a non-UTC paidAt',{paidAt:'2026-08-06T12:00:00+02:00'}],
  ['a missing paidAt',{paidAt:undefined}],
  ['a short idempotency key',{idempotencyKey:'short'}],
  ['a missing idempotency key',{idempotencyKey:undefined}],
 ])('rejects %s before any RPC',async(_label,over)=>{const r=await request('POST',path('/orders/O/payments'),'operator',payment(over));expect(r.status).toBe(400);expect(calls).toHaveLength(0)});
 it('forwards the reversal key and reason unchanged',async()=>{await request('POST',path('/payments/P-1/reverse'),'owner',{reason:'duplicate charge',idempotencyKey:'reverse-Key-1'});expect(calls[0]).toMatchObject({fn:'reverse_acquisition_payment',args:{p_payment_public_id:'P-1',p_reason:'duplicate charge',p_idempotency_key:'reverse-Key-1'}})});
 it('requires a reversal reason and key',async()=>{expect((await request('POST',path('/payments/P/reverse'),'owner',{idempotencyKey:'reverse-key-1'})).status).toBe(400);expect((await request('POST',path('/payments/P/reverse'),'owner',{reason:'x'})).status).toBe(400);expect(calls).toHaveLength(0)});
});

describe('S1.4 acquisition HTTP shipment transport',()=>{
 it('preserves raw shipment carrier and tracking evidence',async()=>{await request('POST',path('/orders/O/shipments'),'operator',shipment({carrier:'USPS Priority Mail',trackingNumber:'9400 1234-5678'}));expect(calls[0].args).toMatchObject({p_carrier:'USPS Priority Mail',p_tracking_number:'9400 1234-5678'})});
 it('forwards an untracked shipment as explicit nulls',async()=>{await request('POST',path('/orders/O/shipments'),'operator',shipment());expect(calls[0].args).toMatchObject({p_carrier:null,p_tracking_number:null,p_shipped_at:null,p_expected_at:null,p_shipping_cost_minor:null,p_currency:null})});
 it('never forwards a client-supplied shipment source record id',async()=>{await request('POST',path('/orders/O/shipments'),'operator',shipment({sourceRecordId:'11111111-1111-4111-8111-111111111111'}));expect(calls[0].args.p_source_record_id).toBeNull()});
 it('forwards a paired shipping reference amount and currency',async()=>{await request('POST',path('/orders/O/shipments'),'operator',shipment({shippingCostMinor:450,currency:'USD'}));expect(calls[0].args).toMatchObject({p_shipping_cost_minor:450,p_currency:'USD'})});
 it.each([
  ['an initially delivered shipment',{status:'delivered'}],
  ['an initially lost shipment',{status:'lost'}],
  ['an initially cancelled shipment',{status:'cancelled'}],
  ['an unknown initial status',{status:'teleported'}],
  ['a negative shipping amount',{shippingCostMinor:-1}],
  ['a fractional shipping amount',{shippingCostMinor:4.5}],
  ['a lowercase shipping currency',{shippingCostMinor:450,currency:'usd'}],
  ['a date-only shippedAt',{shippedAt:'2026-08-06'}],
  ['a date-only expectedAt',{expectedAt:'2026-08-06'}],
  ['a short idempotency key',{idempotencyKey:'short'}],
 ])('rejects %s before any RPC',async(_label,over)=>{const r=await request('POST',path('/orders/O/shipments'),'operator',shipment(over));expect(r.status).toBe(400);expect(calls).toHaveLength(0)});
 it('forwards the transition expected status, target, and key',async()=>{await request('POST',path('/shipments/S-1/transition'),'operator',transition({expectedStatus:'in_transit',newStatus:'delivered',receivedAt:'2026-08-06T12:00:00.000Z'}));expect(calls[0]).toMatchObject({fn:'transition_acquisition_shipment',args:{p_shipment_public_id:'S-1',p_expected_status:'in_transit',p_new_status:'delivered',p_received_at:'2026-08-06T12:00:00.000Z',p_idempotency_key:'transition-key-1'}})});
 it('forwards a lost transition reason unchanged',async()=>{await request('POST',path('/shipments/S/transition'),'operator',transition({newStatus:'lost',reason:'carrier reported loss'}));expect(calls[0].args).toMatchObject({p_new_status:'lost',p_reason:'carrier reported loss',p_received_at:null})});
 // The reason requirement for lost/cancelled is enforced by the database, and
 // the transport must surface that refusal as a bounded 400 rather than a 200.
 it('surfaces the database reason requirement for lost and cancelled',async()=>{rpcError='invalid_request';const r=await request('POST',path('/shipments/S/transition'),'operator',transition({newStatus:'cancelled'}));expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});expect(calls[0].args.p_reason).toBeNull()});
 it.each([
  ['an unknown expected status',{expectedStatus:'teleported'}],
  ['an unknown target status',{newStatus:'teleported'}],
  ['a date-only receivedAt',{newStatus:'delivered',receivedAt:'2026-08-06'}],
  ['a short idempotency key',{idempotencyKey:'short'}],
 ])('rejects %s before any RPC',async(_label,over)=>{const r=await request('POST',path('/shipments/S/transition'),'operator',transition(over));expect(r.status).toBe(400);expect(calls).toHaveLength(0)});
});

describe('S1.4 acquisition HTTP failure bounding',()=>{
 it.each([
  ['ambiguous_acquisition_line_id',409],
  ['acquisition_integrity_error',409],
  ['stale_status',409],
  ['idempotency_conflict',409],
  ['already_reversed',409],
  ['duplicate_external_reference',409],
  ['duplicate_tracking',409],
  ['acquisition_not_found',404],
  ['payment_not_found',404],
  ['shipment_not_found',404],
  ['unauthorized_workspace',403],
  ['invalid_source_evidence',400],
  ['invalid_initial_status',400],
  ['invalid_currency',400],
  ['invalid_instrument',400],
  ['invalid_transition',400],
 ])('maps %s to a bounded %i',async(message,status)=>{rpcError=message;const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(status);expect(await r.json()).toEqual({error:message})});
 it('maps a missing governed contract to 503',async()=>{rpcError='function public.get_acquisition_line_detail_by_source does not exist';const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'acquisition_detail_contract_missing'})});
 it('maps an unrecognized dependency failure to 502',async()=>{rpcError='database connection failed';const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'dependency_failed'})});
 // An empty detail is a real zero match, not a dependency failure: the governed
 // read returns null for a line that does not exist and for one belonging to
 // another workspace alike, and the transport must bound it as a 404 rather
 // than answering 200 with an empty body.
 it('bounds an empty detail as a 404 rather than an empty success',async()=>{rpcNullData=true;const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(404);expect(await r.json()).toEqual({error:'acquisition_not_found'})});
 // A MUTATION that answers with nothing is a failure, never a quiet success.
 it.each([
  ['classify','POST','/sources/S/lines/L/classify'],
  ['payment','POST','/orders/O/payments'],
  ['shipment','POST','/orders/O/shipments'],
  ['transition','POST','/shipments/S/transition'],
 ])('never turns an empty %s dependency response into a success',async(kind,method,suffix)=>{rpcNullData=true;const body=kind==='payment'?payment():kind==='shipment'?shipment():kind==='transition'?transition():{};const r=await request(method,path(suffix),'owner',body);expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'dependency_failed'})});
 it.each([
  ['payment','/orders/O/payments'],
  ['shipment','/orders/O/shipments'],
  ['transition','/shipments/S/transition'],
 ])('never turns a failed %s dependency into a success',async(kind,suffix)=>{rpcError='database connection failed';const body=kind==='payment'?payment():kind==='shipment'?shipment():transition();const r=await request('POST',path(suffix),'owner',body);expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'dependency_failed'})});
 it('does not expose raw SQL, constraint names, or table names',async()=>{rpcError='duplicate key value violates unique constraint "acquisition_payments_workspace_id_external_reference_key" SQL: insert into secrets';const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(502);const text=JSON.stringify(await r.json());expect(text).toBe('{"error":"dependency_failed"}');expect(text).not.toMatch(/constraint|insert into|acquisition_payments_workspace/i)});
 it('does not leak a bounded code as a leading error prefix',async()=>{rpcError='PGRST202 could not find function in schema cache';const r=await request('GET',path('/sources/S/lines/L'),'viewer');expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toMatch(/PGRST202|schema cache/)});
});

describe('S1.4 acquisition HTTP data path',()=>{
 // The injected caller client is the router's only data path. A route reaching
 // a service-role client, a second privileged connection, or a local SQLite
 // file would still answer while recording nothing here.
 it.each([
  ['detail','GET','/sources/S/lines/L','get_acquisition_line_detail_by_source'],
  ['classify','POST','/sources/S/lines/L/classify','classify_acquisition_line_by_source'],
  ['override','POST','/sources/S/lines/L/classification-override','override_acquisition_line_classification_by_source'],
  ['payment','POST','/orders/O/payments','record_acquisition_payment'],
  ['reversal','POST','/payments/P/reverse','reverse_acquisition_payment'],
  ['shipment','POST','/orders/O/shipments','create_acquisition_shipment'],
  ['transition','POST','/shipments/S/transition','transition_acquisition_shipment'],
 ])('routes %s exclusively through the caller-token client',async(kind,method,suffix,fn)=>{
  process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-must-not-be-used';
  const body=kind==='payment'?payment():kind==='shipment'?shipment():kind==='transition'?transition():kind==='reversal'?{reason:'duplicate',idempotencyKey:'reverse-key-1'}:kind==='override'?{classificationOptionKey:'sealed',reason:'observed'}:{};
  const r=await request(method,path(suffix),'owner',method==='POST'?body:undefined);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(r.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].fn).toBe(fn);
  expect(calls[0].args.p_workspace_id).toBe(WS);
 });
 // With the caller client refusing the token there is no privileged fallback:
 // the request fails rather than being served from another source.
 it('has no privileged fallback when the caller token is refused',async()=>{process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-must-not-be-used';const r=await request('GET',path('/sources/S/lines/L'),'nobody');delete process.env.SUPABASE_SERVICE_ROLE_KEY;expect(r.status).toBe(401);expect(calls).toHaveLength(0)});
 it('scopes every governed call to the requested workspace',async()=>{await request('POST',path('/orders/O/payments'),'operator',payment());expect(calls[0].args.p_workspace_id).toBe(WS);expect(Object.values(calls[0].args)).not.toContain(undefined)});
 it('requires a workspace id on every governed call',async()=>expect((await request('GET','/api/acquisition/sources/S/lines/L','viewer')).status).toBe(400));
});

const exclusion=(over:Record<string,unknown>={})=>({reason:'food and candy, not resale inventory',idempotencyKey:'exclusion-key-1',...over});

describe('S1.5 acquisition exclusion HTTP transport',()=>{
 it.each([['exclude'],['restore']])('permits an owner to %s and forwards the governed arguments exactly',async(op)=>{
  const r=await request('POST',path(`/sources/SRC-A/lines/LINE-1/${op}`),'owner',exclusion());
  expect(r.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({fn:`${op==='exclude'?'exclude':'restore'}_acquisition_line_by_source`,args:{
   p_workspace_id:WS,p_source_system_public_id:'SRC-A',p_acquisition_line_public_id:'LINE-1',
   p_reason:'food and candy, not resale inventory',p_idempotency_key:'exclusion-key-1'}});
 });
 it.each([['exclude'],['restore']])('denies an operator from %s',async(op)=>{
  expect((await request('POST',path(`/sources/S/lines/L/${op}`),'operator',exclusion())).status).toBe(403);
  expect(calls).toHaveLength(0);
 });
 it.each([['exclude'],['restore']])('denies a viewer from %s',async(op)=>{
  expect((await request('POST',path(`/sources/S/lines/L/${op}`),'viewer',exclusion())).status).toBe(403);
  expect(calls).toHaveLength(0);
 });
 it.each([['exclude'],['restore']])('denies an unauthenticated %s',async(op)=>{
  expect((await request('POST',path(`/sources/S/lines/L/${op}`),undefined,exclusion())).status).toBe(401);
  expect(calls).toHaveLength(0);
 });
 it('forwards percent-encoded source and line identities decoded exactly once',async()=>{
  await request('POST',path(`/sources/${encodeURIComponent('SRC A/B')}/lines/${encodeURIComponent('LINE #1')}/exclude`),'owner',exclusion());
  expect(calls[0].args).toMatchObject({p_source_system_public_id:'SRC A/B',p_acquisition_line_public_id:'LINE #1'});
 });
 it('normalizes surrounding whitespace in the reason',async()=>{
  await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion({reason:'   trimmed reason   '}));
  expect(calls[0].args.p_reason).toBe('trimmed reason');
 });
 it('forwards the exact idempotency key unchanged',async()=>{
  await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion({idempotencyKey:'Mixed-Case_Key-0001'}));
  expect(calls[0].args.p_idempotency_key).toBe('Mixed-Case_Key-0001');
 });
 it.each([
  ['a missing reason',{reason:undefined}],
  ['a blank reason',{reason:'   '}],
  ['an empty reason',{reason:''}],
  ['an overlong reason',{reason:'x'.repeat(501)}],
  ['a missing idempotency key',{idempotencyKey:undefined}],
  ['a short idempotency key',{idempotencyKey:'short'}],
  ['an overlong idempotency key',{idempotencyKey:'k'.repeat(201)}],
 ])('rejects %s before any RPC',async(_label,over)=>{
  const r=await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion(over));
  expect(r.status).toBe(400);
  expect(calls).toHaveLength(0);
 });
 it.each([
  ['already_excluded',409],
  ['not_excluded',409],
  ['idempotency_conflict',409],
  ['acquisition_integrity_error',409],
  ['ambiguous_acquisition_line_id',409],
  ['acquisition_not_found',404],
  ['unauthorized_workspace',403],
  ['invalid_request',400],
 ])('bounds a %s decision failure as %i',async(message,status)=>{
  rpcError=message;
  const r=await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion());
  expect(r.status).toBe(status);
  expect(await r.json()).toEqual({error:message});
 });
 it('bounds an unexpected exclusion dependency failure as 502 without leaking internals',async()=>{
  rpcError='duplicate key value violates unique constraint "acquisition_line_exclusions_current_uidx" SQL: select * from public.acquisition_line_exclusions';
  const r=await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion());
  expect(r.status).toBe(502);
  const text=JSON.stringify(await r.json());
  expect(text).toBe('{"error":"dependency_failed"}');
  expect(text).not.toMatch(/constraint|select \*|acquisition_line_exclusions|SQL/i);
 });
 it('never turns an empty exclusion dependency response into a success',async()=>{
  rpcNullData=true;
  const r=await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion());
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({error:'dependency_failed'});
 });
 // The injected caller-token client is the only data path: a route reaching a
 // service-role client or a local SQLite file would answer while recording
 // nothing here.
 it.each([['exclude'],['restore']])('routes %s exclusively through the caller-token client',async(op)=>{
  process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-must-not-be-used';
  const r=await request('POST',path(`/sources/S/lines/L/${op}`),'owner',exclusion());
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(r.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].args.p_workspace_id).toBe(WS);
 });
 it('has no privileged fallback when the caller token is refused',async()=>{
  const r=await request('POST',path('/sources/S/lines/L/exclude'),'nobody',exclusion());
  expect(r.status).toBe(401);
  expect(calls).toHaveLength(0);
 });
 it('404s the exclusion routes when governed mode is disabled',async()=>{
  delete process.env.SHADOW_IMPORT;
  expect((await request('POST',path('/sources/S/lines/L/exclude'),'owner',exclusion())).status).toBe(404);
  expect((await request('POST',path('/sources/S/lines/L/restore'),'owner',exclusion())).status).toBe(404);
  expect(calls).toHaveLength(0);
 });
 it('rejects an unsupported exclusion filter on the list route before any RPC',async()=>{
  const r=await request('GET',path('/lines?exclusionState=banana'),'viewer');
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({error:'invalid_filter'});
  expect(calls).toHaveLength(0);
 });
 it.each([['included'],['excluded']])('forwards a valid %s exclusion filter to the list RPC',async(state)=>{
  const r=await request('GET',path(`/lines?exclusionState=${state}`),'viewer');
  expect(r.status).toBe(200);
  expect(calls[0].args.p_exclusion_state).toBe(state);
 });
 it('forwards no exclusion filter when none is requested',async()=>{
  await request('GET',path('/lines'),'viewer');
  expect(calls[0].args.p_exclusion_state).toBeNull();
 });
 it('forwards the requested page window to the list RPC',async()=>{
  await request('GET',path('/lines?limit=25&offset=50'),'viewer');
  expect(calls[0].args).toMatchObject({p_limit:25,p_offset:50});
 });
 // A list response without a truthful total is unusable for pagination, so the
 // route refuses it rather than rendering a page whose count cannot be trusted.
 it('refuses a governed list payload that carries no total',async()=>{
  rpcNullData=true;
  const r=await request('GET',path('/lines'),'viewer');
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({error:'acquisition_read_unavailable'});
 });
});

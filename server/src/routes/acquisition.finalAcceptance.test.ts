import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {setCallerClientFactoryForTests} from '../provenance/auth.js';

const {default:router}=await import('./acquisition.js');
const WS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roles:Record<string,string|undefined>={owner:'owner',operator:'operator',viewer:'viewer',stranger:undefined};
let calls:Array<{fn:string;args:Record<string,unknown>}>=[];
let rpcError:string|null=null;
function fake(token:string){const role=roles[token];return {
 auth:{getUser:async()=>role!==undefined||token==='stranger'?{data:{user:{id:token}},error:null}:{data:{user:null},error:{message:'bad token'}}},
 from(table:string){const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:table==='workspace_members'&&role?[{role}]:[],error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({data:table==='workspace_members'&&role?[{role}]:[],error:null}))};return q},
 rpc:async(fn:string,args:Record<string,unknown>)=>{calls.push({fn,args});return rpcError?{data:null,error:{message:rpcError}}:{data:{ok:true},error:null}}
};}
let server:Server,base='';
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/acquisition',router);app.use((_e:unknown,_q:unknown,res:express.Response)=>res.status(500).json({error:'internal_error'}));await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>{const a=server.address();base=`http://127.0.0.1:${typeof a==='object'&&a?a.port:0}`;resolve()})});setCallerClientFactoryForTests(t=>fake(t) as never)});
afterAll(()=>{server.close();setCallerClientFactoryForTests(null)});
beforeEach(()=>{calls=[];rpcError=null;process.env.SHADOW_IMPORT='repository-fixtures';process.env.SUPABASE_URL='http://127.0.0.1';process.env.SUPABASE_ANON_KEY='test'});
async function request(method:string,path:string,token?:string,body?:unknown){return fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
const path=(suffix:string)=>`/api/acquisition${suffix}${suffix.includes('?')?'&':'?'}workspaceId=${WS}`;

describe('S1.4 executable acquisition HTTP acceptance',()=>{
 it('returns 404 when governed mode is disabled',async()=>{delete process.env.SHADOW_IMPORT;expect((await request('GET',path('/sources/SRC/lines/LINE'),'viewer')).status).toBe(404)});
 it('denies a missing bearer token',async()=>expect((await request('GET',path('/sources/SRC/lines/LINE'))).status).toBe(401));
 it('permits viewer source-qualified detail and forwards both identities',async()=>{expect((await request('GET',path('/sources/SRC-A/lines/LINE-1'),'viewer')).status).toBe(200);expect(calls[0]).toEqual({fn:'get_acquisition_line_detail_by_source',args:{p_workspace_id:WS,p_source_system_public_id:'SRC-A',p_acquisition_line_public_id:'LINE-1'}})});
 it('denies viewer mutations',async()=>expect((await request('POST',path('/sources/S/lines/L/classify'),'viewer',{})).status).toBe(403));
 it('permits operator classify',async()=>{expect((await request('POST',path('/sources/S/lines/L/classify'),'operator',{})).status).toBe(200);expect(calls[0].fn).toBe('classify_acquisition_line_by_source')});
 it('denies operator override',async()=>expect((await request('POST',path('/sources/S/lines/L/classification-override'),'operator',{classificationOptionKey:'sealed',reason:'observed'})).status).toBe(403));
 it('permits owner override and forwards evidence',async()=>{expect((await request('POST',path('/sources/S/lines/L/classification-override'),'owner',{classificationOptionKey:'sealed',reason:' observed '})).status).toBe(200);expect(calls[0]).toMatchObject({fn:'override_acquisition_line_classification_by_source',args:{p_classification_option_key:'sealed',p_reason:'observed'}})});
 it('rejects invalid payment input before RPC',async()=>{expect((await request('POST',path('/orders/O/payments'),'operator',{amountMinor:0,currency:'usd',instrument:'wire'})).status).toBe(400);expect(calls).toHaveLength(0)});
 it('forwards validated payment RPC arguments',async()=>{const body={amountMinor:1234,currency:'USD',instrument:'card',paidAt:'2026-08-06T12:00:00Z',idempotencyKey:'payment-key-1'};expect((await request('POST',path('/orders/O/payments'),'operator',body)).status).toBe(200);expect(calls[0]).toMatchObject({fn:'record_acquisition_payment',args:{p_amount_minor:1234,p_currency:'USD',p_instrument:'card',p_idempotency_key:'payment-key-1'}})});
 it('forwards reversal key unchanged',async()=>{await request('POST',path('/payments/P/reverse'),'owner',{reason:'duplicate',idempotencyKey:'reverse-Key-1'});expect(calls[0].args.p_idempotency_key).toBe('reverse-Key-1')});
 it('preserves raw shipment carrier and tracking evidence',async()=>{await request('POST',path('/orders/O/shipments'),'operator',{status:'expected',carrier:'USPS Priority Mail',trackingNumber:'9400 1234-5678',idempotencyKey:'shipment-key-1'});expect(calls[0].args).toMatchObject({p_carrier:'USPS Priority Mail',p_tracking_number:'9400 1234-5678'})});
 it('rejects an initially delivered shipment',async()=>{expect((await request('POST',path('/orders/O/shipments'),'operator',{status:'delivered',idempotencyKey:'shipment-key-2'})).status).toBe(400);expect(calls).toHaveLength(0)});
 it('rejects non-strict timestamps',async()=>{expect((await request('POST',path('/orders/O/payments'),'operator',{amountMinor:1,currency:'USD',instrument:'cash',paidAt:'2026-08-06',idempotencyKey:'payment-key-2'})).status).toBe(400)});
 it('forwards transition state and received time',async()=>{await request('POST',path('/shipments/S/transition'),'operator',{expectedStatus:'in_transit',newStatus:'delivered',receivedAt:'2026-08-06T12:00:00.000Z',idempotencyKey:'transition-key-1'});expect(calls[0]).toMatchObject({fn:'transition_acquisition_shipment',args:{p_expected_status:'in_transit',p_new_status:'delivered',p_received_at:'2026-08-06T12:00:00.000Z'}})});
 it.each([['ambiguous_acquisition_line_id',409],['acquisition_integrity_error',409],['database connection failed',502]])('bounds dependency error %s',async(message,status)=>{rpcError=message;const response=await request('GET',path('/sources/S/lines/L'),'viewer');expect(response.status).toBe(status);expect(await response.json()).toEqual({error:message==='database connection failed'?'dependency_failed':message})});
 it('does not expose raw SQL or constraint names',async()=>{rpcError='duplicate key violates acquisition_payments_workspace_id_external_reference_key SQL: insert into secrets';const response=await request('GET',path('/sources/S/lines/L'),'viewer');expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).toBe('{"error":"dependency_failed"}')});
});

// @vitest-environment jsdom
//
// S1.4 rendered acceptance for the governed acquisition detail page.
//
// The page is RENDERED and driven through the DOM: roles are proved by which
// controls exist, mutations by the exact transport arguments they produce, and
// recovery by what a Retry actually resends. Nothing here searches the page's
// source text — a page that merely mentions a control but never wires it must
// fail this file.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import AcquisitionDetail from './AcquisitionDetail';
import {AcquisitionDetailError,validLocalDate,type AcquisitionDetail as Detail,type Payment,type Shipment} from '../lib/acquisitionDetailApi';

const SOURCE='SRC-A',LINE='LINE-1';
let role:'owner'|'operator'|'viewer';
let workspaceId:string;
let detail:Detail|null;
let detailError:AcquisitionDetailError|null;
let calls:Array<{fn:string;args:unknown[]}>;
// Per-operation queued outcomes: 'ok' resolves, anything else rejects with it.
let outcomes:Record<string,Array<'ok'|AcquisitionDetailError>>;
// Operations held in flight, so a pending state can be observed rather than raced.
let holdFns:Set<string>;
let releases:Array<()=>void>;
let holdDetail:boolean;

vi.mock('../lib/workspaceContext',()=>({useWorkspace:()=>({workspace:{id:workspaceId,name:'Vault',role}})}));
vi.mock('../lib/supabaseShadow',()=>({createShadowClient:()=>({})}));
vi.mock('../lib/tokenProvider',()=>({tokenProviderFromClient:()=>async()=>'jwt'}));

function outcome(fn:string):Promise<unknown>{
 if(holdFns.has(fn))return new Promise(resolve=>{releases.push(()=>resolve({ok:true}))});
 const next=outcomes[fn]?.shift()??'ok';
 return next==='ok'?Promise.resolve({ok:true}):Promise.reject(next);
}
function record(fn:string,...args:unknown[]){calls.push({fn,args});return outcome(fn)}

vi.mock('../lib/acquisitionDetailApi',async(importOriginal)=>({
 ...(await importOriginal<Record<string,unknown>>()),
 createAcquisitionDetailTransport:()=>({
  detail:()=>holdDetail?new Promise(()=>undefined):(detailError?Promise.reject(detailError):Promise.resolve(detail)),
  classify:(...a:unknown[])=>record('classify',...a),
  override:(...a:unknown[])=>record('override',...a),
  recordPayment:(...a:unknown[])=>record('recordPayment',...a),
  reversePayment:(...a:unknown[])=>record('reversePayment',...a),
  createShipment:(...a:unknown[])=>record('createShipment',...a),
  transitionShipment:(...a:unknown[])=>record('transitionShipment',...a),
 }),
}));

function makePayment(over:Partial<Payment>={}):Payment{
 return {publicId:'RV-APAY-AAA111',paidAt:'2026-08-03T09:00:00.000Z',amountMinor:1500,currency:'USD',instrument:'card',externalReference:null,evidenceNote:null,state:'active',reversedAt:null,reversalReason:null,reversalEvent:null,...over} as Payment;
}
function makeShipment(over:Partial<Shipment>={}):Shipment{
 return {publicId:'RV-ASHIP-BBB222',carrier:'USPS Priority Mail',trackingNumber:'9400 1234-5678',status:'expected',shippedAt:null,expectedAt:null,receivedAt:null,shippingReferenceMinor:450,currency:'USD',evidenceNote:null,transitionHistory:[],allowedNextTransitions:['in_transit','delivered','lost','cancelled'],...over} as Shipment;
}
function makeDetail(over:Partial<Detail>={}):Detail{
 return {
  coverage:'governed_native_committed',historicalLegacyImported:false,
  identity:{sourceSystemPublicId:SOURCE,linePublicId:LINE},
  line:{publicId:LINE,quantity:2,description:'A line',referenceNumber:'REF-1',createdAt:'2026-08-01T00:00:00.000Z',businessVertical:'Pokémon / TCG',fullTitle:'Sealed booster box',deliveredItemTitle:'booster box',sellerNormalized:'seller'},
  order:{publicId:'RV-ACQ-AAA111',sourceOrderReference:'ORDER-1',status:'unknown',sourceReportedStatus:'shipped',sourceReportedTotalMinor:5000,currency:'USD',occurredAt:'2026-08-01T10:00:00.000Z',channel:{publicId:'RV-CH-1',name:'Channel'},supplier:{publicId:'RV-SUP-1',displayName:'A seller'},sourceSystem:{publicId:SOURCE,kind:'manual'}},
  placement:{lotPublicId:'RV-ALOT-AAA111',sequence:1,label:'Lot A',integrityState:'current'},
  classification:{publicId:'RV-ACL-1',optionKey:'sealed',optionLabel:'Sealed',method:'rule',confidence:1,createdAt:'2026-08-01T00:00:00.000Z',state:'classified'},
  classificationHistory:[{publicId:'RV-ACL-0',optionKey:'slab',optionLabel:'Slab',method:'rule',confidence:1,createdAt:'2026-08-01T00:00:00.000Z',supersededAt:'2026-08-02T00:00:00.000Z',ownerOverrideReason:null},
   {publicId:'RV-ACL-1',optionKey:'sealed',optionLabel:'Sealed',method:'owner_override',confidence:1,createdAt:'2026-08-02T00:00:00.000Z',supersededAt:null,ownerOverrideReason:'owner inspected the sealed case'}],
  classificationOptions:[{key:'sealed',label:'Sealed'},{key:'slab',label:'Slab'},{key:'single',label:'Single'}],
  payments:[makePayment()],
  paymentSummary:{activeCount:1,activeCurrencies:['USD'],mixedCurrencies:false,activeTotalMinor:1500,sourceReportedTotalMinor:5000,differenceMinor:3500},
  shipments:[makeShipment()],
  sourceEvidence:{sourceSystemPublicId:SOURCE,sourceRecordRowKey:'a-row-1',sourceImportJobPublicId:'IMP-A'},
  ...over,
 } as Detail;
}

function tree(){
 return (
  <QueryClientProvider client={client}>
   <MemoryRouter initialEntries={[`/acquisitions/sources/${SOURCE}/lines/${LINE}`]}>
    <Routes><Route path="/acquisitions/sources/:sourceSystemPublicId/lines/:linePublicId" element={<AcquisitionDetail/>}/></Routes>
   </MemoryRouter>
  </QueryClientProvider>
 );
}
let client:QueryClient;
function renderPage(){
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 return render(tree());
}
const ready=()=>screen.findByText('Sealed booster box');

beforeEach(()=>{role='owner';workspaceId='ws-1';detail=makeDetail();detailError=null;calls=[];outcomes={};holdFns=new Set();releases=[];holdDetail=false});
afterEach(cleanup);

describe('acquisition detail — role matrix',()=>{
 it('lets a viewer read the governed detail',async()=>{role='viewer';renderPage();expect(await ready()).toBeTruthy();expect(screen.getByText(/ORDER-1/)).toBeTruthy()});
 it('offers a viewer no mutation control at all',async()=>{role='viewer';renderPage();await ready();
  expect(screen.queryByText('Run governed classifier')).toBeNull();
  expect(screen.queryByLabelText('Owner classification override')).toBeNull();
  expect(screen.queryByLabelText('Record payment')).toBeNull();
  expect(screen.queryByLabelText('Create shipment')).toBeNull();
  expect(screen.queryByText('Reverse (preserve history)')).toBeNull();
  expect(screen.queryByRole('button',{name:'in transit'})).toBeNull();
 });
 it('gives an operator the classifier, payment, shipment, and transition controls',async()=>{role='operator';renderPage();await ready();
  expect(screen.getByText('Run governed classifier')).toBeTruthy();
  expect(screen.getByLabelText('Record payment')).toBeTruthy();
  expect(screen.getByLabelText('Create shipment')).toBeTruthy();
  expect(screen.getByRole('button',{name:'in transit'})).toBeTruthy();
 });
 it('withholds owner override and payment reversal from an operator',async()=>{role='operator';renderPage();await ready();
  expect(screen.queryByLabelText('Owner classification override')).toBeNull();
  expect(screen.queryByText('Reverse (preserve history)')).toBeNull();
 });
 it('gives an owner every control including override and reversal',async()=>{renderPage();await ready();
  expect(screen.getByText('Run governed classifier')).toBeTruthy();
  expect(screen.getByLabelText('Owner classification override')).toBeTruthy();
  expect(screen.getByText('Reverse (preserve history)')).toBeTruthy();
  expect(screen.getByLabelText('Record payment')).toBeTruthy();
  expect(screen.getByLabelText('Create shipment')).toBeTruthy();
 });
});

describe('acquisition detail — classification',()=>{
 it('offers the active options for an owner override',async()=>{renderPage();await ready();
  const options=within(screen.getByLabelText('Classification option')).getAllByRole('option');
  expect(options.map(o=>o.textContent)).toEqual(['Sealed','Slab','Single']);
 });
 it('requires a reason and sends nothing without one',async()=>{renderPage();await ready();
  fireEvent.submit(screen.getByLabelText('Owner classification override'));
  expect(await screen.findByText('An override reason is required.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends the exact option and trimmed reason on a valid override',async()=>{renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Classification option'),{target:{value:'slab'}});
  fireEvent.change(screen.getByLabelText('Required reason'),{target:{value:'  owner saw a slab  '}});
  fireEvent.submit(screen.getByLabelText('Owner classification override'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='override')).toBeTruthy());
  expect(calls[0].args).toEqual(['ws-1',SOURCE,LINE,'slab','owner saw a slab']);
 });
 it('runs the automatic classifier and reports success',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByText('Run governed classifier'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='classify')).toBeTruthy());
  expect(calls[0].args).toEqual(['ws-1',SOURCE,LINE]);
  expect(await screen.findByText('Classification refreshed.')).toBeTruthy();
 });
 it('makes an automatic classifier failure visible',async()=>{outcomes={classify:[new AcquisitionDetailError('dependency_failed',502)]};renderPage();await ready();
  fireEvent.click(screen.getByText('Run governed classifier'));
  expect(await screen.findByText('Classification could not be confirmed. Try again.')).toBeTruthy();
 });
 it('makes an owner override failure visible',async()=>{outcomes={override:[new AcquisitionDetailError('dependency_failed',502)]};renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Required reason'),{target:{value:'owner reason'}});
  fireEvent.submit(screen.getByLabelText('Owner classification override'));
  expect(await screen.findByText('Override could not be confirmed. Try again.')).toBeTruthy();
 });
 it('disables the classifier while a classification is pending',async()=>{
  holdFns.add('classify');renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'Run governed classifier'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Run governed classifier'}) as HTMLButtonElement).disabled).toBe(true));
  // A second click while pending must not produce a second governed request.
  fireEvent.click(screen.getByRole('button',{name:'Run governed classifier'}));
  expect(calls.filter(c=>c.fn==='classify')).toHaveLength(1);
  releases.forEach(r=>r());
 });
 it('renders the classification history and the owner reason',async()=>{renderPage();await ready();
  expect(screen.getByText(/Slab · rule/)).toBeTruthy();
  expect(screen.getByText(/owner inspected the sealed case/)).toBeTruthy();
 });
});

describe('acquisition detail — payment and shipment forms',()=>{
 async function fillPayment(over:{amount?:string;paidAt?:string}={}){
  fireEvent.change(screen.getByLabelText('Payment amount'),{target:{value:over.amount??'12.34'}});
  fireEvent.change(screen.getByLabelText('Payment date and time'),{target:{value:over.paidAt??'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
 }
 it('sends a valid payment with minor units, uppercase currency, and a key',async()=>{renderPage();await ready();
  await fillPayment();
  await waitFor(()=>expect(calls.find(c=>c.fn==='recordPayment')).toBeTruthy());
  const body=calls[0].args[2] as Record<string,unknown>;
  expect(calls[0].args[1]).toBe('RV-ACQ-AAA111');
  expect(body.amountMinor).toBe(1234);
  expect(body.currency).toBe('USD');
  expect(typeof body.idempotencyKey).toBe('string');
 });
 it('sends no request for an invalid payment amount',async()=>{renderPage();await ready();
  await fillPayment({amount:'12.345'});
  expect(await screen.findByText('Enter a valid amount and payment date.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends no request for a missing payment date',async()=>{renderPage();await ready();
  await fillPayment({paidAt:''});
  expect(await screen.findByText('Enter a valid amount and payment date.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 // A native datetime-local control cannot hold an unparseable string: jsdom
 // applies the same value sanitization a browser does, so an invalid entry
 // arrives as an empty value. The reachable DOM paths are asserted here and
 // the unparseable guard is proved directly against validLocalDate rather
 // than pretended at the DOM.
 it('sends null for an omitted optional shipment date',async()=>{renderPage();await ready();
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='createShipment')).toBeTruthy());
  expect((calls[0].args[2] as Record<string,unknown>).shippedAt).toBeNull();
 });
 it('normalizes an entered shipment date to an exact instant',async()=>{renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Shipped date and time'),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='createShipment')).toBeTruthy());
  expect((calls[0].args[2] as Record<string,unknown>).shippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
 });
 it('treats an unparseable date value as no date at all',()=>{expect(validLocalDate('not-a-date')).toBeNull()});
 it('sends no request for an invalid shipping reference amount',async()=>{renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Shipping reference amount'),{target:{value:'12.345'}});
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  expect(await screen.findByText('Enter valid shipment dates and reference amount.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends a shipping currency only when an amount is present',async()=>{renderPage();await ready();
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='createShipment')).toBeTruthy());
  expect((calls[0].args[2] as Record<string,unknown>).currency).toBeNull();
  expect((calls[0].args[2] as Record<string,unknown>).shippingCostMinor).toBeNull();
 });
 it('sends the shipping currency alongside an amount',async()=>{renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Shipping reference amount'),{target:{value:'4.50'}});
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='createShipment')).toBeTruthy());
  expect((calls[0].args[2] as Record<string,unknown>).shippingCostMinor).toBe(450);
  expect((calls[0].args[2] as Record<string,unknown>).currency).toBe('USD');
 });
 it('preserves raw carrier and tracking formatting on the way out',async()=>{renderPage();await ready();
  fireEvent.change(screen.getByLabelText('Carrier'),{target:{value:'USPS Priority Mail'}});
  fireEvent.change(screen.getByLabelText('Tracking number'),{target:{value:'9400 1234-5678'}});
  fireEvent.submit(screen.getByLabelText('Create shipment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='createShipment')).toBeTruthy());
  expect(calls[0].args[2]).toMatchObject({carrier:'USPS Priority Mail',trackingNumber:'9400 1234-5678'});
 });
 it('does not offer an initially delivered shipment',async()=>{renderPage();await ready();
  const values=within(screen.getByLabelText('Initial shipment status')).getAllByRole('option').map(o=>(o as HTMLOptionElement).value);
  expect(values).toEqual(['expected','in_transit']);
 });
});

describe('acquisition detail — transitions and history',()=>{
 it('requires an actual received time before a delivered transition',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'delivered'}));
  fireEvent.click(screen.getByText('Confirm transition'));
  expect(await screen.findByText('Provide the required transition evidence.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends the confirmed received time on a delivered transition',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'delivered'}));
  fireEvent.change(screen.getByLabelText('Actual received time'),{target:{value:'2026-08-06T12:00'}});
  fireEvent.click(screen.getByText('Confirm transition'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='transitionShipment')).toBeTruthy());
  const body=calls[0].args[2] as Record<string,unknown>;
  expect(body.expectedStatus).toBe('expected');
  expect(body.newStatus).toBe('delivered');
  expect(typeof body.receivedAt).toBe('string');
 });
 it.each([['lost'],['cancelled']])('requires a reason before a %s transition',async(next)=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:next}));
  fireEvent.click(screen.getByText('Confirm transition'));
  expect(await screen.findByText('Provide the required transition evidence.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends the reason on a lost transition',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'lost'}));
  fireEvent.change(screen.getByLabelText('Transition reason'),{target:{value:'carrier reported loss'}});
  fireEvent.click(screen.getByText('Confirm transition'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='transitionShipment')).toBeTruthy());
  expect((calls[0].args[2] as Record<string,unknown>).reason).toBe('carrier reported loss');
 });
 it('renders the payment reversal history',async()=>{
  detail=makeDetail({payments:[makePayment({state:'reversed',reversedAt:'2026-08-04T00:00:00.000Z',reversalReason:'duplicate charge',reversalEvent:{publicId:'RV-APREV-1',actorId:'user-1',reversedAt:'2026-08-04T00:00:00.000Z',reason:'duplicate charge'}})]});
  renderPage();await ready();
  expect(screen.getByText('Reversal history')).toBeTruthy();
  expect(screen.getByText('duplicate charge')).toBeTruthy();
 });
 it('renders the shipment transition history',async()=>{
  detail=makeDetail({shipments:[makeShipment({status:'in_transit',allowedNextTransitions:['delivered','lost','cancelled'],transitionHistory:[{publicId:'RV-ASTRAN-1',fromStatus:'expected',toStatus:'in_transit',applied:true,receivedAt:null,reason:null,actorId:'user-1',createdAt:'2026-08-03T00:00:00.000Z'}]})]});
  renderPage();await ready();
  expect(screen.getByText(/expected → in_transit/)).toBeTruthy();
 });
 it('shows no combined total when currencies are mixed',async()=>{
  detail=makeDetail({paymentSummary:{activeCount:2,activeCurrencies:['USD','EUR'],mixedCurrencies:true,activeTotalMinor:null,sourceReportedTotalMinor:5000,differenceMinor:null}});
  renderPage();await ready();
  expect(screen.getByText('Mixed currencies — no combined total')).toBeTruthy();
  expect(screen.queryByText(/Payment difference/)).toBeNull();
 });
 it('shows the payment difference only when it is comparable',async()=>{renderPage();await ready();
  expect(screen.getByText(/Payment difference/)).toBeTruthy();
 });
});

describe('acquisition detail — retry lifecycle',()=>{
 const failure=()=>new AcquisitionDetailError('dependency_failed',502);
 // One case per operation class: fail once, Retry, and prove the retry carried
 // the IDENTICAL payload and the IDENTICAL idempotency key.
 async function startPayment(){
  fireEvent.change(screen.getByLabelText('Payment amount'),{target:{value:'12.34'}});
  fireEvent.change(screen.getByLabelText('Payment date and time'),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
 }
 async function startReversal(){
  fireEvent.click(screen.getByText('Reverse (preserve history)'));
  fireEvent.change(screen.getByLabelText('Reversal reason'),{target:{value:'duplicate charge'}});
  fireEvent.click(screen.getByText('Confirm reversal'));
 }
 async function startShipment(){fireEvent.submit(screen.getByLabelText('Create shipment'))}
 async function startTransition(){
  fireEvent.click(screen.getByRole('button',{name:'in transit'}));
  fireEvent.click(screen.getByText('Confirm transition'));
 }
 const CASES:Array<[string,string,()=>Promise<void>]>=[
  ['payment','recordPayment',startPayment],
  ['payment reversal','reversePayment',startReversal],
  ['shipment','createShipment',startShipment],
  ['shipment transition','transitionShipment',startTransition],
 ];
 it.each(CASES)('retries a failed %s with the identical payload and key',async(_label,fn,start)=>{
  outcomes={[fn]:[failure()]};renderPage();await ready();
  await start();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  const first=calls.filter(c=>c.fn===fn);
  expect(first).toHaveLength(1);
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(calls.filter(c=>c.fn===fn)).toHaveLength(2));
  expect(calls.filter(c=>c.fn===fn)[1].args).toEqual(first[0].args);
 });
 it.each(CASES)('clears the retained %s once the retry succeeds',async(_label,fn,start)=>{
  outcomes={[fn]:[failure()]};renderPage();await ready();
  await start();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(screen.queryByText('Retry exact request')).toBeNull());
  expect(await screen.findByText('Saved.')).toBeTruthy();
 });
 it.each(CASES)('discards a retained %s without sending anything',async(_label,fn,start)=>{
  outcomes={[fn]:[failure()]};renderPage();await ready();
  await start();
  await waitFor(()=>expect(screen.getByText('Discard retry')).toBeTruthy());
  const before=calls.length;
  fireEvent.click(screen.getByText('Discard retry'));
  await waitFor(()=>expect(screen.queryByText('Discard retry')).toBeNull());
  expect(calls).toHaveLength(before);
  expect(screen.getByText('Unconfirmed request discarded. Nothing was sent.')).toBeTruthy();
 });
 // Two unresolved idempotency keys must never coexist: the owner would have no
 // way to know which one the server accepted.
 it('refuses a second payment while an unresolved payment is retained',async()=>{
  outcomes={recordPayment:[failure()]};renderPage();await ready();
  await startPayment();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  const before=calls.filter(c=>c.fn==='recordPayment').length;
  await startPayment();
  await waitFor(()=>expect(screen.getByText(/Resolve the unconfirmed payment first/)).toBeTruthy());
  expect(calls.filter(c=>c.fn==='recordPayment')).toHaveLength(before);
 });
 it('refuses a shipment while an unresolved payment is retained',async()=>{
  outcomes={recordPayment:[failure()]};renderPage();await ready();
  await startPayment();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  await startShipment();
  expect(calls.filter(c=>c.fn==='createShipment')).toHaveLength(0);
 });
 it('lets work continue once the retained operation is discarded',async()=>{
  outcomes={recordPayment:[failure()]};renderPage();await ready();
  await startPayment();
  await waitFor(()=>expect(screen.getByText('Discard retry')).toBeTruthy());
  fireEvent.click(screen.getByText('Discard retry'));
  await startShipment();
  await waitFor(()=>expect(calls.filter(c=>c.fn==='createShipment')).toHaveLength(1));
 });
 // A stale transition is a KNOWN-wrong expected status. Replaying it under the
 // same key would be meaningless, so it is never offered as a blind Retry.
 it('does not offer a blind retry for a stale shipment transition',async()=>{
  outcomes={transitionShipment:[new AcquisitionDetailError('stale_status',409)]};renderPage();await ready();
  await startTransition();
  await waitFor(()=>expect(screen.getByText(/Shipment changed elsewhere/)).toBeTruthy());
  expect(screen.queryByText('Retry exact request')).toBeNull();
 });
 it('requires a newly confirmed transition with a new key after a stale status',async()=>{
  outcomes={transitionShipment:[new AcquisitionDetailError('stale_status',409)]};renderPage();await ready();
  await startTransition();
  await waitFor(()=>expect(screen.getByText(/Shipment changed elsewhere/)).toBeTruthy());
  const first=calls.filter(c=>c.fn==='transitionShipment')[0].args[2] as Record<string,unknown>;
  await startTransition();
  await waitFor(()=>expect(calls.filter(c=>c.fn==='transitionShipment')).toHaveLength(2));
  const second=calls.filter(c=>c.fn==='transitionShipment')[1].args[2] as Record<string,unknown>;
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
 });
});

describe('acquisition detail — system states',()=>{
 it('renders an initial loading state',async()=>{
  holdDetail=true;renderPage();
  expect(screen.getByRole('status').textContent).toContain('Loading governed acquisition detail');
  expect(screen.queryByText('Sealed booster box')).toBeNull();
 });
 it('renders a distinct not-found state',async()=>{detailError=new AcquisitionDetailError('acquisition_not_found',404);renderPage();
  expect(await screen.findByText('Acquisition not found')).toBeTruthy()});
 it('renders a distinct unauthorized state',async()=>{detailError=new AcquisitionDetailError('unauthorized_workspace',403);renderPage();
  expect(await screen.findByText('Not authorized')).toBeTruthy()});
 it('renders a distinct dependency-unavailable state',async()=>{detailError=new AcquisitionDetailError('dependency_failed',502);renderPage();
  expect(await screen.findByText('Acquisition dependency unavailable')).toBeTruthy()});
 it('states plainly when no payment has been recorded',async()=>{
  detail=makeDetail({payments:[],paymentSummary:{activeCount:0,activeCurrencies:[],mixedCurrencies:false,activeTotalMinor:null,sourceReportedTotalMinor:5000,differenceMinor:null}});
  renderPage();await ready();
  expect(screen.getByText('No payments have been recorded.')).toBeTruthy();
 });
 it('states plainly when no shipment has been recorded',async()=>{
  detail=makeDetail({shipments:[]});renderPage();await ready();
  expect(screen.getByText('No inbound shipments recorded.')).toBeTruthy();
 });
 // A workspace switch changes the query key, so the previous workspace's
 // detail must never remain on screen while the new one loads.
 it('does not flash the previous workspace detail on a workspace switch',async()=>{
  const {rerender}=renderPage();
  await ready();
  // Same QueryClient: the switch changes the query KEY, which is the real
  // mechanism, rather than remounting the provider and trivially clearing it.
  workspaceId='ws-2';
  detail=makeDetail({line:{...makeDetail().line,fullTitle:'Second workspace line'}});
  rerender(tree());
  expect(screen.queryByText('Sealed booster box')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading governed acquisition detail');
  expect(await screen.findByText('Second workspace line')).toBeTruthy();
 });
});

describe('acquisition detail — coverage and scope',()=>{
 it('states the committed governed-native scope and its limits',async()=>{renderPage();await ready();
  const notice=screen.getByRole('note').textContent??'';
  expect(notice).toContain('committed governed-native record');
  expect(notice).toContain('Historical legacy purchases have not yet been imported');
  expect(notice).toContain('must not be added together');
  expect(notice).toContain('Recorded payments may be incomplete before reconciliation');
 });
 it('names the source evidence truthfully',async()=>{renderPage();await ready();
  expect(screen.getByText(/Source record row key: a-row-1/)).toBeTruthy();
  expect(screen.getByText(/Source import job: IMP-A/)).toBeTruthy();
 });
 it('shows no receiving, cost-basis, profit, or payout control',async()=>{renderPage();await ready();
  const text=document.body.textContent??'';
  expect(text).not.toMatch(/receiv(e|ing) into inventory|cost basis|profit|payout|discrepanc/i);
 });
});

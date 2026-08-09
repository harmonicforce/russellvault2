// @vitest-environment jsdom
//
// S1.4 rendered acceptance for the governed acquisition detail page.
//
// The page is RENDERED and driven through the DOM: roles are proved by which
// controls exist, mutations by the exact transport arguments they produce, and
// recovery by what a Retry actually resends. Nothing here searches the page's
// source text — a page that merely mentions a control but never wires it must
// fail this file.
//
// S1.6.6 REBUILT THE PRESENTATION AND THIS FILE KEPT ITS ASSERTIONS.
//
// Every business claim proved here in S1.4 is still proved here. What changed
// is how each one is REACHED: labelled fields carry a "(required)" suffix in
// their computed label text, the eligibility confirmation is the shared
// governed overlay rather than an inline form, system states are rendered by
// the truth-state vocabulary, and one global "Saved." became bounded
// per-operation feedback. Selectors moved; assertions did not.
//
// One assertion was deliberately INVERTED, and it is the point of the slice:
// stopping a retained retry used to claim "Nothing was sent". That was false,
// so the test that demanded it now forbids it. See
// AcquisitionDetail.reference.test.tsx for the load-bearing regression suite.
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
let detailFetches:number;

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
  detail:()=>{detailFetches++;return holdDetail?new Promise(()=>undefined):(detailError?Promise.reject(detailError):Promise.resolve(detail))},
  classify:(...a:unknown[])=>record('classify',...a),
  override:(...a:unknown[])=>record('override',...a),
  recordPayment:(...a:unknown[])=>record('recordPayment',...a),
  reversePayment:(...a:unknown[])=>record('reversePayment',...a),
  createShipment:(...a:unknown[])=>record('createShipment',...a),
  transitionShipment:(...a:unknown[])=>record('transitionShipment',...a),
  exclude:(...a:unknown[])=>record('exclude',...a),
  restore:(...a:unknown[])=>record('restore',...a),
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
  exclusion:{state:'included',current:null,history:[]},
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
const EXCLUDED_DECISION={publicId:'RV-AEXCL-ABCDEF123456',state:'excluded' as const,reason:'food and candy, not resale inventory',actorId:'user-1',createdAt:'2026-08-03T00:00:00.000Z',supersededAt:null};
const RESTORED_HISTORY=[{publicId:'RV-AEXCL-AAAAAA111111',state:'excluded' as const,reason:'first exclusion',actorId:'user-1',createdAt:'2026-08-01T00:00:00.000Z',supersededAt:'2026-08-02T00:00:00.000Z'},
 {publicId:'RV-AEXCL-BBBBBB222222',state:'included' as const,reason:'owner reviewed',actorId:'user-1',createdAt:'2026-08-02T00:00:00.000Z',supersededAt:null}];
const excludedDetail=()=>makeDetail({exclusion:{state:'excluded',current:EXCLUDED_DECISION,history:[EXCLUDED_DECISION]}});

function renderPage(){
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 return render(tree());
}
const ready=()=>screen.findByText('Sealed booster box');

beforeEach(()=>{role='owner';workspaceId='ws-1';detail=makeDetail();detailError=null;calls=[];outcomes={};holdFns=new Set();releases=[];holdDetail=false;detailFetches=0});
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
  fireEvent.change(screen.getByLabelText(/Payment amount/),{target:{value:over.amount??'12.34'}});
  fireEvent.change(screen.getByLabelText(/Payment date and time/),{target:{value:over.paidAt??'2026-08-06T12:00'}});
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
  fireEvent.change(screen.getByLabelText(/Payment amount/),{target:{value:'12.34'}});
  fireEvent.change(screen.getByLabelText(/Payment date and time/),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
 }
 async function startReversal(){
  fireEvent.click(screen.getByText('Reverse (preserve history)'));
  fireEvent.change(screen.getByLabelText(/Reversal reason/),{target:{value:'duplicate charge'}});
  fireEvent.click(screen.getByText('Confirm reversal'));
 }
 async function startShipment(){fireEvent.submit(screen.getByLabelText('Create shipment'))}
 async function startTransition(){
  fireEvent.click(screen.getByRole('button',{name:'in transit'}));
  fireEvent.click(screen.getByText('Confirm transition'));
 }
 // The fourth element is the operation's OWN confirmation sentence. S1.6.6
 // replaced one global "Saved." with bounded per-operation feedback, so each
 // case now asserts that the page named the record that actually changed.
 const CASES:Array<[string,string,()=>Promise<void>,string]>=[
  ['payment','recordPayment',startPayment,'Payment recorded and the governed detail was re-read.'],
  ['payment reversal','reversePayment',startReversal,'Payment reversal recorded and the governed detail was re-read.'],
  ['shipment','createShipment',startShipment,'Shipment created and the governed detail was re-read.'],
  ['shipment transition','transitionShipment',startTransition,'Shipment transition recorded and the governed detail was re-read.'],
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
 it.each(CASES)('clears the retained %s once the retry succeeds',async(_label,fn,start,confirmed)=>{
  outcomes={[fn]:[failure()]};renderPage();await ready();
  await start();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(screen.queryByText('Retry exact request')).toBeNull());
  expect(await screen.findByText(confirmed)).toBeTruthy();
 });
 // S1.6.6: the retained retry can be STOPPED, but the request cannot be
 // un-sent. Stopping re-reads the governed record and says so; it never claims
 // the earlier request failed to arrive.
 it.each(CASES)('stops the retained %s retry without sending anything and never claims nothing was sent',async(_label,fn,start)=>{
  outcomes={[fn]:[failure()]};renderPage();await ready();
  await start();
  await waitFor(()=>expect(screen.getByText('Stop retrying and verify')).toBeTruthy());
  const before=calls.length;
  fireEvent.click(screen.getByText('Stop retrying and verify'));
  await waitFor(()=>expect(screen.queryByText('Stop retrying and verify')).toBeNull());
  // Stopping sends no further governed mutation. That much WAS true before.
  expect(calls).toHaveLength(before);
  // What was false before, and is now load-bearing: the page must not tell the
  // operator the request never reached the server.
  expect(document.body.textContent).not.toContain('Nothing was sent');
  expect(screen.getByText(/still unknown/)).toBeTruthy();
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
 // Unlocking is allowed only AFTER the authoritative re-read succeeded, which
 // it does here. The failed-verification case is proved in the S1.6.6 suite.
 it('lets work continue once the retained operation is stopped and the record re-read',async()=>{
  outcomes={recordPayment:[failure()]};renderPage();await ready();
  await startPayment();
  await waitFor(()=>expect(screen.getByText('Stop retrying and verify')).toBeTruthy());
  fireEvent.click(screen.getByText('Stop retrying and verify'));
  await waitFor(()=>expect(screen.queryByText('Stop retrying and verify')).toBeNull());
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
 // Each system state is rendered by the S1.6 truth-state vocabulary, so the
 // assertions moved from three ad hoc headings to the three DISTINCT states
 // themselves. A 404 is `empty` — the governed backend looked and proved there
 // is no such line — which is a different answer from "we could not find out".
 it('renders a distinct not-found state',async()=>{detailError=new AcquisitionDetailError('acquisition_not_found',404);renderPage();
  expect(await screen.findByText('Acquisition line not found')).toBeTruthy();
  expect(document.querySelector('[data-truth-state="empty"]')).toBeTruthy();
  expect(document.querySelector('[data-truth-state="unavailable"]')).toBeNull()});
 it('renders a distinct unauthorized state',async()=>{detailError=new AcquisitionDetailError('unauthorized_workspace',403);renderPage();
  expect(await screen.findByText('You do not have access to this')).toBeTruthy();
  expect(document.querySelector('[data-truth-state="unauthorized"]')).toBeTruthy();
  // Never rendered as an authoritative zero.
  expect(document.querySelector('[data-truth-state="empty"]')).toBeNull()});
 it('renders a distinct dependency-unavailable state',async()=>{detailError=new AcquisitionDetailError('dependency_failed',502);renderPage();
  expect(await screen.findByText('Could not be loaded')).toBeTruthy();
  expect(document.querySelector('[data-truth-state="unavailable"]')).toBeTruthy();
  expect(document.querySelector('[data-truth-state="empty"]')).toBeNull()});
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
 // The four claims are unchanged; they are now carried by the shared
 // CoverageNotice plus the page's own scope sentence, in a named region.
 it('states the committed governed-native scope and its limits',async()=>{renderPage();await ready();
  const notice=screen.getByLabelText('Governed coverage').textContent??'';
  expect(notice).toContain('governed-native acquisition evidence');
  expect(notice).toContain('Historical legacy Whatnot acquisition history, which has not been imported');
  expect(notice).toContain('must not be added together');
  expect(notice).toContain('Recorded payments may be incomplete before reconciliation');
  // Nothing may imply the historical reconciliation has actually happened.
  expect(notice).toContain('record-level historical reconciliation has been performed');
 });
 it('names the source evidence truthfully',async()=>{renderPage();await ready();
  const evidence=within(screen.getByLabelText('Source evidence'));
  expect(evidence.getByText('Source record row key')).toBeTruthy();
  expect(evidence.getByText('a-row-1')).toBeTruthy();
  expect(evidence.getByText('Source import job')).toBeTruthy();
  expect(evidence.getByText('IMP-A')).toBeTruthy();
  // The raw source row key must never read as a governed RV identity.
  expect(evidence.getByText(/Not a Russell Vault governed identity/)).toBeTruthy();
 });
 it('shows no receiving, cost-basis, profit, or payout control',async()=>{renderPage();await ready();
  const text=document.body.textContent??'';
  expect(text).not.toMatch(/receiv(e|ing) into inventory|cost basis|profit|payout|discrepanc/i);
 });
});

describe('acquisition detail — downstream eligibility decisions',()=>{
 const failure=()=>new AcquisitionDetailError('dependency_failed',502);
 const confirmExclusion=(reason='food and candy, not resale inventory')=>{
  fireEvent.click(screen.getByRole('button',{name:'Exclude from downstream workflows'}));
  fireEvent.change(screen.getByLabelText(/Eligibility decision reason/),{target:{value:reason}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 };
 const confirmRestoration=(reason='owner reviewed: genuinely resale inventory')=>{
  fireEvent.click(screen.getByRole('button',{name:'Restore downstream eligibility'}));
  fireEvent.change(screen.getByLabelText(/Eligibility decision reason/),{target:{value:reason}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 };

 it.each([['viewer'],['operator']])('lets a %s read the state, reason, and history without any control',async(r)=>{
  role=r as 'viewer'|'operator';
  detail=makeDetail({exclusion:{state:'excluded',current:EXCLUDED_DECISION,history:RESTORED_HISTORY}});
  renderPage();await ready();
  const eligibility=within(screen.getByLabelText('Downstream eligibility'));
  expect(eligibility.getByText('Excluded')).toBeTruthy();
  expect(eligibility.getByText(/Current reason: food and candy/)).toBeTruthy();
  expect(screen.getByText(/first exclusion/)).toBeTruthy();
  expect(screen.getByText(/owner reviewed/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Exclude from downstream workflows'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Restore downstream eligibility'})).toBeNull();
 });
 it('shows an included line as Included with no decision history',async()=>{
  role='viewer';renderPage();await ready();
  const eligibility=within(screen.getByLabelText('Downstream eligibility'));
  expect(eligibility.getByText('Included')).toBeTruthy();
  expect(eligibility.getByText('No explicit eligibility decisions.')).toBeTruthy();
 });
 it('offers an owner the exclusion control on an included line',async()=>{renderPage();await ready();
  expect(screen.getByRole('button',{name:'Exclude from downstream workflows'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Restore downstream eligibility'})).toBeNull();
 });
 it('offers an owner the restoration control on an excluded line',async()=>{
  detail=excludedDetail();renderPage();await ready();
  expect(screen.getByRole('button',{name:'Restore downstream eligibility'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Exclude from downstream workflows'})).toBeNull();
 });
 it('sends nothing when the reason is left empty',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'Exclude from downstream workflows'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  // The panel's own rule refuses an empty reason, so the confirmation simply
  // stays open and nothing is sent.
  expect(await screen.findByText('A reason is required.')).toBeTruthy();
  expect(calls).toHaveLength(0);
  expect(screen.getByLabelText(/Eligibility decision reason/)).toBeTruthy();
 });
 // Whitespace satisfies `required`, so the trim check is the real guard.
 it('rejects a whitespace-only reason and sends nothing',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'Exclude from downstream workflows'}));
  fireEvent.change(screen.getByLabelText(/Eligibility decision reason/),{target:{value:'    '}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  expect(await screen.findByText('A reason is required.')).toBeTruthy();
  expect(calls).toHaveLength(0);
 });
 it('sends nothing when the confirmation is cancelled',async()=>{renderPage();await ready();
  fireEvent.click(screen.getByRole('button',{name:'Exclude from downstream workflows'}));
  fireEvent.change(screen.getByLabelText(/Eligibility decision reason/),{target:{value:'a reason'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(calls).toHaveLength(0);
  expect(screen.getByRole('button',{name:'Exclude from downstream workflows'})).toBeTruthy();
 });
 it('sends the exact source, line, trimmed reason, and a key on exclusion',async()=>{renderPage();await ready();
  confirmExclusion('   food and candy, not resale inventory   ');
  await waitFor(()=>expect(calls.find(c=>c.fn==='exclude')).toBeTruthy());
  expect(calls[0].args.slice(0,4)).toEqual(['ws-1',SOURCE,LINE,'food and candy, not resale inventory']);
  expect(typeof calls[0].args[4]).toBe('string');
  expect((calls[0].args[4] as string).length).toBeGreaterThan(7);
 });
 it('sends the exact restoration request on an excluded line',async()=>{
  detail=excludedDetail();renderPage();await ready();
  confirmRestoration();
  await waitFor(()=>expect(calls.find(c=>c.fn==='restore')).toBeTruthy());
  expect(calls[0].args.slice(0,4)).toEqual(['ws-1',SOURCE,LINE,'owner reviewed: genuinely resale inventory']);
 });
 it('closes the confirmation form once the decision is confirmed',async()=>{renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.queryByLabelText(/Eligibility decision reason/)).toBeNull());
 });
 it('disables Confirm while the decision is in flight and cannot send a second request',async()=>{
  holdFns.add('exclude');renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect((screen.getByRole('button',{name:'Confirm'}) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  expect(calls.filter(c=>c.fn==='exclude')).toHaveLength(1);
  releases.forEach(r=>r());
 });
 // The pending flag must belong to THIS operation, not to an unrelated
 // payment or shipment request that happens to be in flight.
 it('does not disable the exclusion control because a payment is in flight',async()=>{
  holdFns.add('recordPayment');renderPage();await ready();
  fireEvent.change(screen.getByLabelText(/Payment amount/),{target:{value:'12.34'}});
  fireEvent.change(screen.getByLabelText(/Payment date and time/),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
  await waitFor(()=>expect(calls.find(c=>c.fn==='recordPayment')).toBeTruthy());
  expect((screen.getByRole('button',{name:'Exclude from downstream workflows'}) as HTMLButtonElement).disabled).toBe(false);
  releases.forEach(r=>r());
 });

 it('retries a failed exclusion with the identical target, reason, and key',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  const first=calls.filter(c=>c.fn==='exclude');
  expect(first).toHaveLength(1);
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(calls.filter(c=>c.fn==='exclude')).toHaveLength(2));
  expect(calls.filter(c=>c.fn==='exclude')[1].args).toEqual(first[0].args);
 });
 it('retries a failed restoration with the identical target, reason, and key',async()=>{
  outcomes={restore:[failure()]};detail=excludedDetail();renderPage();await ready();
  confirmRestoration();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  const first=calls.filter(c=>c.fn==='restore');
  expect(first).toHaveLength(1);
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(calls.filter(c=>c.fn==='restore')).toHaveLength(2));
  expect(calls.filter(c=>c.fn==='restore')[1].args).toEqual(first[0].args);
 });
 it('names the failed operation in the governed retry notice',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  const named=await screen.findAllByText(/Exclusion was not confirmed/);
  expect(named.length).toBeGreaterThan(0);
  expect(screen.getByRole('alert').textContent).toContain('Exclusion was not confirmed');
 });
 it('clears the retained exclusion once the retry succeeds',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  fireEvent.click(screen.getByText('Retry exact request'));
  await waitFor(()=>expect(screen.queryByText('Retry exact request')).toBeNull());
  expect(await screen.findByText('Eligibility decision confirmed and the governed detail was re-read.')).toBeTruthy();
 });
 it('stops a retained exclusion retry without sending anything',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.getByText('Stop retrying and verify')).toBeTruthy());
  const before=calls.length;
  fireEvent.click(screen.getByText('Stop retrying and verify'));
  await waitFor(()=>expect(screen.queryByText('Stop retrying and verify')).toBeNull());
  expect(calls).toHaveLength(before);
  expect(document.body.textContent).not.toContain('Nothing was sent');
 });
 it('refuses a second eligibility decision while one is unresolved',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  // The confirmation stays open after a failure, so the lock is on Confirm.
  expect((screen.getByRole('button',{name:'Confirm'}) as HTMLButtonElement).disabled).toBe(true);
  // Submitting the payment form directly bypasses every disabled button and
  // proves the refusal is enforced in the coordinator, not only by markup.
  fireEvent.change(screen.getByLabelText(/Payment amount/),{target:{value:'12.34'}});
  fireEvent.change(screen.getByLabelText(/Payment date and time/),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
  await waitFor(()=>expect(screen.getByText(/Resolve the unconfirmed exclusion first/)).toBeTruthy());
  expect(calls.filter(c=>c.fn==='exclude')).toHaveLength(1);
  expect(calls.filter(c=>c.fn==='recordPayment')).toHaveLength(0);
 });
 it('refuses a payment while an unresolved exclusion is retained',async()=>{
  outcomes={exclude:[failure()]};renderPage();await ready();
  confirmExclusion();
  await waitFor(()=>expect(screen.getByText('Retry exact request')).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/Payment amount/),{target:{value:'12.34'}});
  fireEvent.change(screen.getByLabelText(/Payment date and time/),{target:{value:'2026-08-06T12:00'}});
  fireEvent.submit(screen.getByLabelText('Record payment'));
  expect(calls.filter(c=>c.fn==='recordPayment')).toHaveLength(0);
 });
 it('invalidates the detail, list, and facet queries on a confirmed decision',async()=>{
  renderPage();await ready();
  const seen:unknown[][]=[];
  const original=client.invalidateQueries.bind(client);
  client.invalidateQueries=((args:{queryKey:unknown[]})=>{seen.push(args.queryKey);return original(args)}) as typeof client.invalidateQueries;
  const detailFetchesBefore=detailFetches;
  confirmExclusion();
  await waitFor(()=>expect(screen.queryByText('Eligibility decision confirmed and the governed detail was re-read.')).toBeTruthy());
  expect(seen.some(k=>Array.isArray(k)&&k[0]==='acquisition-lines')).toBe(true);
  expect(seen.some(k=>Array.isArray(k)&&k[0]==='acquisition-facets')).toBe(true);
  // The detail is refetched directly rather than invalidated.
  expect(detailFetches).toBeGreaterThan(detailFetchesBefore);
 });
});

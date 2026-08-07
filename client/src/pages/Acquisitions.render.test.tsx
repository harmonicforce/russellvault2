// @vitest-environment jsdom
//
// S1.5 rendered acceptance for the governed acquisitions list.
//
// The page is RENDERED and driven through the DOM and the URL. Filters are
// proved by the parameters the transport actually receives, and URL governance
// is proved by what the address bar holds afterwards. No source text is read.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Acquisitions from './Acquisitions';
import type {AcquisitionLine,AcquisitionFacets,LineParams} from '../lib/acquisitionLinesApi';

let role:'owner'|'operator'|'viewer';
let workspaceId:string;
let rows:AcquisitionLine[];
let total:number;
let calls:LineParams[];
let linesError:Error|null;

vi.mock('../lib/workspaceContext',()=>({useWorkspace:()=>({workspace:{id:workspaceId,name:'Vault',role}})}));
vi.mock('../lib/supabaseShadow',()=>({createShadowClient:()=>({})}));
vi.mock('../lib/tokenProvider',()=>({tokenProviderFromClient:()=>async()=>'jwt'}));

const facets:AcquisitionFacets={
 classificationOptions:[{key:'sealed',label:'Sealed',count:3},{key:'slab',label:'Slab',count:1}],
 unclassified:0,methods:[],states:[],
 exclusionStates:[{value:'included',count:3},{value:'excluded',count:1}],
 sellers:[{value:'seller-a',count:4}],businessVerticals:[{value:'Pokémon / TCG',count:4}],
};
vi.mock('../lib/acquisitionLinesApi',async(importOriginal)=>({
 ...(await importOriginal<Record<string,unknown>>()),
 createAcquisitionLinesTransport:()=>({
  lines:async(_w:string,p:LineParams)=>{calls.push(p);if(linesError)throw linesError;return {coverage:'governed_native_committed',historicalLegacyImported:false,total,limit:p.limit,offset:p.offset,rows}},
  facets:async()=>({coverage:'governed_native_committed',historicalLegacyImported:false,facets}),
 }),
}));

function makeLine(over:Partial<AcquisitionLine>={}):AcquisitionLine{
 return {source_system_public_id:'SRC-A',acquisition_line_public_id:'LINE-1',full_title:'Sealed booster box',
  delivered_item_title:'booster box',seller_normalized:'seller-a',business_vertical:'Pokémon / TCG',quantity:2,
  occurred_at:'2026-08-01T10:00:00.000Z',created_at:'2026-08-01T00:00:00.000Z',source_order_reference:'ORDER-1',
  classification_key:'sealed',classification_label:'Sealed',classification_method:'rule',classification_state:'classified',
  exclusion_state:'included',current_exclusion_public_id:null,current_exclusion_reason:null,excluded_at:null,...over} as AcquisitionLine;
}
const EXCLUDED=makeLine({acquisition_line_public_id:'LINE-2',full_title:'食 candy bundle',exclusion_state:'excluded',
 current_exclusion_public_id:'RV-AEXCL-ABCDEF123456',current_exclusion_reason:'food and candy',excluded_at:'2026-08-03T00:00:00.000Z'});

// Exposes the live URL so URL governance can be asserted directly.
let currentSearch='';
function SearchProbe(){currentSearch=useLocation().search;return null}

function renderList(initial='/acquisitions'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(
  <QueryClientProvider client={client}>
   <MemoryRouter initialEntries={[initial]}>
    <Routes><Route path="/acquisitions" element={<><Acquisitions/><SearchProbe/></>}/></Routes>
   </MemoryRouter>
  </QueryClientProvider>
 );
}
const lastCall=()=>calls[calls.length-1];
// The page renders a desktop table AND a mobile card list, hidden from each
// other only by CSS that jsdom does not apply, so every row's text appears
// twice. Queries here are plural by design rather than by accident.
const ready=()=>screen.findAllByText('Sealed booster box');
const eligibility=()=>screen.getAllByRole('combobox').find(sel=>
 Array.from(sel.querySelectorAll('option')).some(o=>o.textContent==='All eligibility states'))! as HTMLSelectElement;
// The eligibility filter also contains the word "Excluded", so a badge query
// has to exclude the <option> elements to mean anything.
const excludedBadges=()=>screen.queryAllByText('Excluded').filter(el=>el.tagName!=='OPTION');

beforeEach(()=>{role='owner';workspaceId='ws-1';rows=[makeLine(),EXCLUDED];total=2;calls=[];linesError=null;currentSearch=''});
afterEach(cleanup);

describe('acquisitions list — exclusion evidence',()=>{
 it('marks an excluded line with a visible badge',async()=>{renderList();
  await ready();
  expect(excludedBadges().length).toBeGreaterThan(0);
 });
 it('does not badge an included line',async()=>{rows=[makeLine()];total=1;renderList();
  await ready();
  expect(excludedBadges()).toHaveLength(0);
 });
 // An excluded acquisition is a decision, not a deletion: it must stay on the
 // page and stay findable.
 it('keeps excluded lines visible and linkable in the unfiltered view',async()=>{renderList();
  await ready();
  expect(lastCall().exclusionState).toBeUndefined();
  expect(screen.getAllByRole('link',{name:'LINE-2'}).length).toBeGreaterThan(0);
 });
 it('reports the governed total, not the page size',async()=>{total=137;renderList();
  expect(await screen.findByText('137 filtered lines')).toBeTruthy();
 });
 it('keeps excluded lines searchable',async()=>{renderList();
  await ready();
  fireEvent.change(screen.getByPlaceholderText('Search acquisitions'),{target:{value:'candy'}});
  fireEvent.submit(screen.getByPlaceholderText('Search acquisitions').closest('form')!);
  await waitFor(()=>expect(lastCall().query).toBe('candy'));
  expect(lastCall().exclusionState).toBeUndefined();
 });
});

describe('acquisitions list — eligibility filter',()=>{
 it('offers the governed eligibility options',async()=>{renderList();
  await ready();
  const options=within(eligibility()).getAllByRole('option').map(o=>(o as HTMLOptionElement).value);
  expect(options).toEqual(['','included','excluded']);
 });
 it.each([['included'],['excluded']])('sends the %s filter and mirrors it in the URL',async(state)=>{renderList();
  await ready();
  fireEvent.change(eligibility(),{target:{value:state}});
  await waitFor(()=>expect(lastCall().exclusionState).toBe(state));
  expect(currentSearch).toContain(`exclusionState=${state}`);
 });
 it('reads a valid eligibility filter straight from the URL',async()=>{renderList('/acquisitions?exclusionState=excluded');
  await waitFor(()=>expect(lastCall().exclusionState).toBe('excluded'));
  expect(currentSearch).toContain('exclusionState=excluded');
 });
 it('clears the filter back to all states',async()=>{renderList('/acquisitions?exclusionState=excluded');
  await waitFor(()=>expect(lastCall().exclusionState).toBe('excluded'));
  fireEvent.change(eligibility(),{target:{value:''}});
  await waitFor(()=>expect(lastCall().exclusionState).toBeUndefined());
  expect(currentSearch).not.toContain('exclusionState');
 });
});

describe('acquisitions list — unsupported URL filters',()=>{
 // An unsupported filter that is silently ignored shows an unfiltered page
 // while the URL still claims a filter is applied. It must be removed and
 // reported through the same governed warning as every other filter.
 it('removes an unsupported eligibility state and says so',async()=>{renderList('/acquisitions?exclusionState=banana');
  expect(await screen.findByText('Unsupported URL filters were removed.')).toBeTruthy();
  await waitFor(()=>expect(currentSearch).not.toContain('exclusionState'));
  expect(lastCall().exclusionState).toBeUndefined();
 });
 it('never sends an unsupported eligibility state to the transport',async()=>{renderList('/acquisitions?exclusionState=banana');
  await ready();
  expect(calls.every(c=>c.exclusionState===undefined)).toBe(true);
 });
 it('keeps the supported filters while removing only the unsupported one',async()=>{renderList('/acquisitions?exclusionState=banana&classificationState=classified');
  expect(await screen.findByText('Unsupported URL filters were removed.')).toBeTruthy();
  await waitFor(()=>expect(currentSearch).toContain('classificationState=classified'));
  expect(currentSearch).not.toContain('exclusionState');
  expect(lastCall().classificationState).toBe('classified');
 });
 it.each([
  ['an unsupported sort','/acquisitions?sort=banana','sort'],
  ['an unsupported order','/acquisitions?order=sideways','order'],
  ['an unsupported review state','/acquisitions?classificationState=banana','classificationState'],
 ])('still governs %s the same way',async(_label,initial,param)=>{renderList(initial);
  expect(await screen.findByText('Unsupported URL filters were removed.')).toBeTruthy();
  await waitFor(()=>expect(currentSearch).not.toContain(param));
 });
 it('leaves a fully valid URL untouched and shows no warning',async()=>{renderList('/acquisitions?exclusionState=included&sort=quantity&order=asc');
  await ready();
  expect(screen.queryByText('Unsupported URL filters were removed.')).toBeNull();
  expect(currentSearch).toContain('exclusionState=included');
  expect(lastCall()).toMatchObject({exclusionState:'included',sort:'quantity',order:'asc'});
 });
});

describe('acquisitions list — system states',()=>{
 it('surfaces a load failure without assuming an empty result',async()=>{
  linesError=new Error('dependency_failed');renderList();
  expect(await screen.findByText(/No empty result has been assumed/)).toBeTruthy();
  expect(screen.queryByText('No acquisitions match these filters.')).toBeNull();
 });
 it('states plainly when nothing matches the filters',async()=>{rows=[];total=0;renderList();
  expect(await screen.findByText('No acquisitions match these filters.')).toBeTruthy();
 });
 // A workspace switch must not carry the previous workspace's filters over
 // onto a different workspace's data.
 it('clears prior workspace filter state on a workspace switch',async()=>{
  const {rerender}=renderList('/acquisitions?exclusionState=excluded');
  await waitFor(()=>expect(lastCall().exclusionState).toBe('excluded'));
  workspaceId='ws-2';
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  rerender(
   <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/acquisitions?exclusionState=excluded']}>
     <Routes><Route path="/acquisitions" element={<><Acquisitions/><SearchProbe/></>}/></Routes>
    </MemoryRouter>
   </QueryClientProvider>
  );
  await waitFor(()=>expect(currentSearch).not.toContain('exclusionState'));
 });
});

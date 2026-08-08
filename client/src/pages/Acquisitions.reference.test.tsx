// @vitest-environment jsdom
//
// S1.6.5 rendered acceptance for the governed-list REFERENCE patterns.
//
// `Acquisitions.render.test.tsx` remains the S1.5 business preservation
// contract. This file proves the properties that make this page the pattern
// other governed lists copy:
//
//   - the URL is the list state;
//   - lines and facets fail independently;
//   - the exact total comes from the server and is never a fabricated zero;
//   - coverage is stated and totals are never invited to be added;
//   - every detail link is source-qualified and carries a return URL.
//
// WHAT THIS FILE CANNOT PROVE
//
// jsdom applies no CSS, so the desktop table and the responsive record list are
// BOTH in the document at once. Nothing here demonstrates which one a real
// viewport shows. That is S1.6.7's browser gate; the assertions below are about
// content, not geometry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Acquisitions from './Acquisitions';
import { AcquisitionLinesError, type AcquisitionFacets, type AcquisitionLine, type LineParams } from '../lib/acquisitionLinesApi';

let workspaceId: string;
let rows: AcquisitionLine[];
let total: number;
let calls: LineParams[];
let linesError: Error | null;
let facetsError: Error | null;
let facetCalls: number;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: { id: workspaceId, name: 'Vault', role: 'owner' } }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

const FACETS: AcquisitionFacets = {
  classificationOptions: [
    { key: 'sealed', label: 'Sealed', count: 3 },
    { key: 'unreviewed', label: 'Unreviewed', count: 2 },
  ],
  unclassified: 4,
  methods: [{ value: 'rule', count: 5 }],
  states: [],
  exclusionStates: [],
  sellers: [{ value: 'seller-a', count: 4 }],
  businessVerticals: [{ value: 'Pokémon / TCG', count: 4 }],
};

vi.mock('../lib/acquisitionLinesApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAcquisitionLinesTransport: () => ({
    lines: async (_w: string, p: LineParams) => {
      calls.push(p);
      if (linesError) throw linesError;
      return { coverage: 'governed_native_committed', historicalLegacyImported: false, total, limit: p.limit, offset: p.offset, rows };
    },
    facets: async () => {
      facetCalls += 1;
      if (facetsError) throw facetsError;
      return { coverage: 'governed_native_committed', historicalLegacyImported: false, facets: FACETS };
    },
  }),
}));

function makeLine(over: Partial<AcquisitionLine> = {}): AcquisitionLine {
  return {
    source_system_public_id: 'SRC-A',
    acquisition_line_public_id: 'LINE-1',
    full_title: 'Sealed booster box',
    delivered_item_title: 'booster box',
    seller_normalized: 'seller-a',
    business_vertical: 'Pokémon / TCG',
    quantity: 2,
    occurred_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    source_order_reference: 'ORDER-1',
    classification_key: 'sealed',
    classification_label: 'Sealed',
    classification_method: 'rule',
    classification_state: 'classified',
    exclusion_state: 'included',
    current_exclusion_public_id: null,
    current_exclusion_reason: null,
    excluded_at: null,
    ...over,
  } as AcquisitionLine;
}

let currentSearch = '';
function SearchProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderList(initial = '/acquisitions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="/acquisitions"
            element={
              <>
                <Acquisitions />
                <SearchProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastCall = () => calls[calls.length - 1];
const ready = () => screen.findAllByText('Sealed booster box');
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
const table = () => screen.getByRole('table', { name: 'Governed acquisition lines' });

beforeEach(() => {
  workspaceId = 'ws-1';
  rows = [makeLine()];
  total = 1;
  calls = [];
  linesError = null;
  facetsError = null;
  facetCalls = 0;
  currentSearch = '';
});
afterEach(cleanup);

describe('the exact total is the server total', () => {
  it('shows no count at all while lines are loading', () => {
    renderList();
    expect(screen.getByText(/Loading exact line count/)).toBeTruthy();
    // The failure this prevents: a confident zero for a fact nobody has
    // established yet.
    expect(text()).not.toMatch(/\b0 filtered lines\b/);
  });

  it('reports a confirmed zero as confirmed, not merely as nothing', async () => {
    rows = [];
    total = 0;
    renderList();
    await waitFor(() => expect(screen.getByText(/0 filtered lines/)).toBeTruthy());
    expect(text()).toMatch(/confirmed zero from the governed backend/i);
  });

  it('says the count is unavailable when the read failed', async () => {
    linesError = new AcquisitionLinesError('dependency_failed');
    renderList();
    await waitFor(() => expect(screen.getByText(/Exact line count unavailable/)).toBeTruthy());
    expect(text()).toMatch(/No total has been assumed/i);
    expect(text()).not.toMatch(/0 filtered lines/);
  });

  // rows.length is the PAGE size, not the filtered total.
  it('reports the server total even when this page holds fewer rows', async () => {
    total = 137;
    rows = [makeLine()];
    renderList();
    await waitFor(() => expect(screen.getByText(/137 filtered lines/)).toBeTruthy());
  });

  it('keeps the exact total across a page change', async () => {
    total = 137;
    renderList();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastCall().offset).toBe(50));
    // Page 2 is a fresh governed read, so the count is briefly "loading"
    // rather than a stale 137 presented as current. It returns unchanged.
    await waitFor(() => expect(screen.getByText(/137 filtered lines/)).toBeTruthy());
  });
});

describe('lines and facets are independent dependencies', () => {
  it('keeps ready rows when only the facets fail', async () => {
    facetsError = new AcquisitionLinesError('dependency_failed');
    total = 12;
    renderList();
    await ready();
    // The rows survive, and so does the exact count.
    expect(screen.getByText(/12 filtered lines/)).toBeTruthy();
    expect(table()).toBeTruthy();
    // And the facet problem is stated on its own terms rather than replacing
    // the page with one generic error.
    expect(screen.getByText(/Filter suggestions and the classification summary are unavailable/)).toBeTruthy();
    expect(text()).toMatch(/acquisition lines below are unaffected/i);
  });

  it('invents no zero facet counts when facets fail', async () => {
    facetsError = new AcquisitionLinesError('dependency_failed');
    renderList();
    await ready();
    // "Sealed: 0" would claim there are no sealed acquisitions. Nobody counted.
    expect(screen.queryByRole('region', { name: 'Classification summary' })).toBeNull();
    expect(text()).not.toMatch(/Sealed: 0/);
    expect(text()).not.toMatch(/Unclassified: 0/);
    expect(text()).toMatch(/No classification counts have been assumed/i);
  });

  it('keeps the applied filter truthful when the facet suggestions cannot load', async () => {
    facetsError = new AcquisitionLinesError('dependency_failed');
    renderList('/acquisitions?seller=seller-a');
    await ready();
    // The suggestion list is gone; the operator's actual selection is not.
    const seller = screen.getByRole('combobox', { name: 'Seller' }) as HTMLSelectElement;
    expect(seller.value).toBe('seller-a');
    expect(lastCall().seller).toBe('seller-a');
  });

  it('renders the classification summary from facets when they succeed', async () => {
    renderList();
    await ready();
    const summary = screen.getByRole('region', { name: 'Classification summary' });
    expect(within(summary).getByText(/Sealed: 3/)).toBeTruthy();
    expect(within(summary).getByText(/Unclassified: 4/)).toBeTruthy();
    // Review work earns attention; an ordinary category does not.
    expect(within(summary).getByText(/Unreviewed: 2/).getAttribute('data-tone')).toBe('warning');
    expect(within(summary).getByText(/Sealed: 3/).getAttribute('data-tone')).toBe('neutral');
  });

  it('retries only the facets without disturbing the list or its filters', async () => {
    facetsError = new AcquisitionLinesError('dependency_failed');
    renderList('/acquisitions?seller=seller-a&page=2');
    await ready();
    const callsBefore = calls.length;

    facetsError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry summary' }));
    await waitFor(() => expect(facetCalls).toBeGreaterThan(1));

    // The lines query was not re-issued, and no list state was cleared.
    expect(calls.length).toBe(callsBefore);
    expect(currentSearch).toContain('seller=seller-a');
    expect(currentSearch).toContain('page=2');
  });

  it('renders a lines failure without ever rendering the empty presentation', async () => {
    linesError = new AcquisitionLinesError('dependency_failed');
    renderList();
    await waitFor(() => expect(screen.getAllByText(/The request failed/i).length).toBeGreaterThan(0));
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(screen.queryAllByText('No acquisitions match these filters.')).toHaveLength(0);
    // The bounded server code is surfaced verbatim rather than flattened.
    expect(text()).toMatch(/dependency_failed/);
  });

  it('reports an authorization refusal as its own thing', async () => {
    linesError = new AcquisitionLinesError('unauthorized_workspace');
    renderList();
    await waitFor(() => expect(text()).toMatch(/not a member of this workspace/i));
  });
});

describe('coverage truth', () => {
  it('states the governed-native coverage and the missing legacy history', async () => {
    renderList();
    await ready();
    expect(text()).toMatch(/Committed governed-native acquisition lines/i);
    expect(text()).toMatch(/Historical legacy Whatnot purchases, which have not been imported yet/i);
  });

  it('forbids adding the two populations together', async () => {
    renderList();
    await ready();
    // CoverageNotice states this unconditionally when the subset is unsafe to
    // aggregate, which is exactly what a governed-only subset is.
    expect(text()).toMatch(/Do not total these figures/i);
    expect(text()).not.toMatch(/combined total|add(ed)? together to get|grand total/i);
  });
});

describe('sorting is the server’s', () => {
  it('exposes the six supported sort keys and no others', async () => {
    renderList();
    await ready();
    const headers = within(table()).getAllByRole('columnheader');
    const sortable = headers.filter((header) => header.getAttribute('aria-sort') !== null);
    expect(sortable).toHaveLength(6);
  });

  it('writes the sort key and direction to the URL', async () => {
    renderList();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /^Seller/ }));
    await waitFor(() => expect(currentSearch).toContain('sort=seller'));
    expect(currentSearch).toContain('order=asc');
    await waitFor(() => expect(lastCall()).toMatchObject({ sort: 'seller', order: 'asc' }));
  });

  it('flips the direction when the active column is pressed again', async () => {
    renderList('/acquisitions?sort=seller&order=asc');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /^Seller/ }));
    await waitFor(() => expect(currentSearch).toContain('order=desc'));
    await waitFor(() => expect(lastCall()).toMatchObject({ sort: 'seller', order: 'desc' }));
  });

  it('announces the active direction rather than showing only a glyph', async () => {
    renderList('/acquisitions?sort=quantity&order=asc');
    await ready();
    expect(screen.getByRole('button', { name: /Quantity, sorted ascending/i })).toBeTruthy();
  });

  it('resets to page 1 when the sort changes', async () => {
    total = 200;
    renderList('/acquisitions?page=3');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /^Seller/ }));
    await waitFor(() => expect(lastCall().offset).toBe(0));
    expect(currentSearch).not.toContain('page=3');
  });

  it('never re-sorts the server rows locally', async () => {
    rows = [makeLine({ acquisition_line_public_id: 'LINE-B', seller_normalized: 'zeta' }), makeLine({ acquisition_line_public_id: 'LINE-A', seller_normalized: 'alpha' })];
    total = 2;
    renderList('/acquisitions?sort=seller&order=asc');
    await ready();
    // The server said zeta first. A page that "helpfully" re-sorted would
    // disagree with the ordering the next page was computed against.
    const bodyRows = within(table()).getAllByRole('row').slice(1);
    expect(within(bodyRows[0]).getByText('zeta')).toBeTruthy();
  });
});

describe('the classification-method filter', () => {
  // Verified against server/src/routes/acquisition.ts, which validates
  // `method` against exactly these five values and answers `invalid_filter`
  // for anything else. Surfacing it exposes an existing backend capability.
  it('offers exactly the five server-supported methods', async () => {
    renderList();
    await ready();
    const select = screen.getByRole('combobox', { name: 'Classification method' });
    const values = within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(['', 'rule', 'owner_override', 'seller_specialization', 'explicit_evidence', 'system_fallback']);
  });

  it('sends the method to the transport and mirrors it in the URL', async () => {
    renderList();
    await ready();
    fireEvent.change(screen.getByRole('combobox', { name: 'Classification method' }), { target: { value: 'owner_override' } });
    await waitFor(() => expect(lastCall().method).toBe('owner_override'));
    expect(currentSearch).toContain('method=owner_override');
  });

  it('fails closed on an unsupported method from the URL', async () => {
    renderList('/acquisitions?method=telepathy');
    expect(await screen.findByText('Unsupported URL filters were removed.')).toBeTruthy();
    await waitFor(() => expect(currentSearch).not.toContain('method'));
    // It must never reach the transport, which would answer invalid_filter.
    expect(calls.every((call) => call.method === undefined)).toBe(true);
  });
});

describe('filters are labelled and clearable', () => {
  it('gives every filter a programmatic label', async () => {
    renderList();
    await ready();
    for (const label of ['Classification', 'Seller', 'Business vertical', 'Review state', 'Eligibility', 'Classification method']) {
      expect(screen.getByRole('combobox', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('searchbox', { name: 'Search acquisitions' })).toBeTruthy();
  });

  it('reports how many filters are applied', async () => {
    renderList('/acquisitions?seller=seller-a&exclusionState=excluded');
    await ready();
    expect(screen.getByText('2 filters applied.')).toBeTruthy();
  });

  it('offers no clear control when nothing is filtered', async () => {
    renderList();
    await ready();
    expect(screen.getByText('No filters applied.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('clears the filters and keeps the search term, as its label promises', async () => {
    renderList('/acquisitions?query=candy&seller=seller-a&exclusionState=excluded&page=2');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastCall().seller).toBeUndefined());
    expect(lastCall().exclusionState).toBeUndefined();
    // The control says "Clear filters", so it does not silently discard what
    // the operator typed.
    expect(lastCall().query).toBe('candy');
    expect(currentSearch).toContain('query=candy');
    expect(currentSearch).not.toContain('page=2');
  });
});

describe('search', () => {
  it('shows the URL query in the field and submits deliberately', async () => {
    renderList('/acquisitions?query=candy');
    await ready();
    const field = screen.getByRole('searchbox', { name: 'Search acquisitions' }) as HTMLInputElement;
    expect(field.value).toBe('candy');

    fireEvent.change(field, { target: { value: 'booster' } });
    // Typing alone must not issue a governed query per keystroke.
    expect(lastCall().query).toBe('candy');

    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(lastCall().query).toBe('booster'));
    expect(currentSearch).toContain('query=booster');
  });

  it('removes the query from the URL when cleared', async () => {
    renderList('/acquisitions?query=candy');
    await ready();
    const field = screen.getByRole('searchbox', { name: 'Search acquisitions' });
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(lastCall().query).toBeUndefined());
    expect(currentSearch).not.toContain('query');
  });

  it('resets to page 1 and survives a later sort change', async () => {
    total = 300;
    renderList('/acquisitions?page=4');
    await ready();
    const field = screen.getByRole('searchbox', { name: 'Search acquisitions' });
    fireEvent.change(field, { target: { value: 'booster' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(lastCall().offset).toBe(0));

    fireEvent.click(screen.getByRole('button', { name: /^Seller/ }));
    await waitFor(() => expect(lastCall().sort).toBe('seller'));
    expect(lastCall().query).toBe('booster');
  });
});

describe('the desktop table', () => {
  it('names its columns accessibly', async () => {
    renderList();
    await ready();
    const headers = within(table()).getAllByRole('columnheader').map((header) => header.textContent?.replace(/,.*/, '').trim());
    expect(headers).toEqual(['Classification', 'Date', 'Recorded', 'Seller', 'Product / title', 'Quantity', 'Vertical', 'Line / order', 'Method']);
  });

  it('keeps source line identity and the order reference on screen', async () => {
    renderList();
    await ready();
    expect(within(table()).getByText('ORDER-1')).toBeTruthy();
    expect(within(table()).getAllByRole('link', { name: 'LINE-1' }).length).toBeGreaterThan(0);
  });

  it('says Unclassified in words rather than leaving a blank cell', async () => {
    rows = [makeLine({ classification_label: null })];
    renderList();
    await waitFor(() => expect(within(table()).getByText('Unclassified')).toBeTruthy());
  });

  it('uses bounded unknowns instead of ambiguous blanks', async () => {
    rows = [makeLine({ seller_normalized: null, business_vertical: null, source_order_reference: null, classification_method: null })];
    renderList();
    await waitFor(() => expect(within(table()).getByText('Unknown seller')).toBeTruthy());
    expect(within(table()).getByText('Unknown vertical')).toBeTruthy();
    expect(within(table()).getByText('No source order')).toBeTruthy();
    expect(within(table()).getByText('No classification method')).toBeTruthy();
  });

  it('renders quantity with tabular figures', async () => {
    renderList();
    await ready();
    const quantity = within(table()).getAllByRole('cell').find((cell) => cell.textContent === '2')!;
    expect(quantity.className).toContain('tabular-nums');
  });

  it('marks an excluded line in words, not colour alone', async () => {
    rows = [makeLine({ exclusion_state: 'excluded' })];
    renderList();
    await waitFor(() => expect(within(table()).getByText('Excluded')).toBeTruthy());
    // Still visible, still linkable: excluded is a decision, not a deletion.
    expect(within(table()).getAllByRole('link', { name: 'LINE-1' }).length).toBeGreaterThan(0);
  });
});

describe('the responsive record list', () => {
  const records = () => screen.getByRole('list', { name: 'Governed acquisition lines' });

  // Contract-level only: jsdom applies no CSS, so this proves which breakpoint
  // the handoff is WIRED to, not what a 768px viewport actually renders.
  it('hands over at lg, so a tablet in portrait gets records instead of a sideways scroll', async () => {
    renderList();
    await ready();
    expect(table().closest('.hidden')?.className).toContain('lg:block');
    expect(records().closest('.lg\\:hidden')).toBeTruthy();
  });

  it('keeps classification, eligibility, quantity, seller, date and vertical', async () => {
    rows = [makeLine({ exclusion_state: 'excluded' })];
    renderList();
    await ready();
    const list = records();
    expect(within(list).getByText('Sealed')).toBeTruthy();
    expect(within(list).getByText('Excluded')).toBeTruthy();
    expect(within(list).getByText('2')).toBeTruthy();
    expect(within(list).getByText('seller-a')).toBeTruthy();
    expect(within(list).getByText('Pokémon / TCG')).toBeTruthy();
    expect(within(list).getByText('Quantity')).toBeTruthy();
    expect(within(list).getByText('Date')).toBeTruthy();
  });

  it('states Included rather than leaving eligibility to be inferred', async () => {
    renderList();
    await ready();
    expect(within(records()).getByText('Included')).toBeTruthy();
  });

  it('keeps the source-qualified identity and secondary evidence', async () => {
    renderList();
    await ready();
    const list = records();
    expect(within(list).getAllByRole('link', { name: 'LINE-1' }).length).toBeGreaterThan(0);
    expect(within(list).getByText('ORDER-1')).toBeTruthy();
    expect(within(list).getByText('Rule')).toBeTruthy();
  });
});

describe('source-qualified detail addressing', () => {
  it('addresses every link with BOTH the source system and the line id', async () => {
    rows = [makeLine({ source_system_public_id: 'SRC-B', acquisition_line_public_id: 'LINE-9' })];
    renderList();
    await ready();
    const links = screen.getAllByRole('link', { name: 'LINE-9' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      // A single-segment path would address the wrong record as soon as a
      // second source system exists.
      expect(link.getAttribute('href')).toBe('/acquisitions/SRC-B/LINE-9');
    }
  });

  it('encodes identifiers that need encoding', async () => {
    rows = [makeLine({ source_system_public_id: 'SRC/A', acquisition_line_public_id: 'LINE 1' })];
    renderList();
    await ready();
    const [link] = screen.getAllByRole('link', { name: 'LINE 1' });
    expect(link.getAttribute('href')).toBe('/acquisitions/SRC%2FA/LINE%201');
  });

  it('exposes no internal UUID in any link', async () => {
    renderList();
    await ready();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    }
  });
});

describe('the return state', () => {
  function LocationProbe() {
    const location = useLocation();
    return <pre data-testid="detail-state">{JSON.stringify(location.state)}</pre>;
  }

  it('carries the exact filtered list URL so Detail can come back to it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/acquisitions?seller=seller-a&sort=quantity&order=asc&page=2']}>
          <Routes>
            <Route path="/acquisitions" element={<Acquisitions />} />
            <Route path="/acquisitions/:source/:line" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findAllByText('Sealed booster box');
    fireEvent.click(screen.getAllByRole('link', { name: 'LINE-1' })[0]);

    const state = JSON.parse(await screen.findByTestId('detail-state').then((node) => node.textContent!));
    // The whole query string, not just the path: returning to an unfiltered
    // list would lose the operator's place entirely.
    expect(state.from).toContain('/acquisitions?');
    expect(state.from).toContain('seller=seller-a');
    expect(state.from).toContain('sort=quantity');
    expect(state.from).toContain('page=2');
  });
});

describe('pagination against the exact total', () => {
  it('disables Previous on page 1', async () => {
    total = 200;
    renderList();
    await ready();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reaches page 2 when the total proves one exists', async () => {
    total = 137;
    renderList();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastCall().offset).toBe(50));
    expect(lastCall().limit).toBe(50);
    expect(currentSearch).toContain('page=2');
    await waitFor(() => expect(screen.getByText(/Page 2 of 3/)).toBeTruthy());
  });

  it('disables Next on the true last page even when that page is full', async () => {
    // 100 records, 50 per page: page 2 is full AND final. Deriving "there might
    // be more" from rows.length would offer a page that does not exist.
    total = 100;
    rows = Array.from({ length: 50 }, (_, index) => makeLine({ acquisition_line_public_id: `LINE-${index}` }));
    renderList('/acquisitions?page=2');
    await ready();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps every other list parameter when the page changes', async () => {
    total = 300;
    renderList('/acquisitions?query=candy&seller=seller-a&exclusionState=excluded&sort=quantity&order=asc');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastCall().offset).toBe(50));
    expect(lastCall()).toMatchObject({
      query: 'candy',
      seller: 'seller-a',
      exclusionState: 'excluded',
      sort: 'quantity',
      order: 'asc',
    });
  });

  it('offers no pagination controls that pretend to work while the count is unknown', async () => {
    linesError = new AcquisitionLinesError('dependency_failed');
    renderList();
    await waitFor(() => expect(screen.getByText(/Exact line count unavailable/)).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the URL is the list state', () => {
  it('initialises every supported parameter from the URL', async () => {
    renderList(
      '/acquisitions?query=candy&classification=sealed&seller=seller-a&businessVertical=Pok%C3%A9mon%20%2F%20TCG&method=rule&classificationState=classified&exclusionState=excluded&sort=quantity&order=asc&page=2',
    );
    await waitFor(() =>
      expect(lastCall()).toMatchObject({
        query: 'candy',
        classification: 'sealed',
        seller: 'seller-a',
        businessVertical: 'Pokémon / TCG',
        method: 'rule',
        classificationState: 'classified',
        exclusionState: 'excluded',
        sort: 'quantity',
        order: 'asc',
        offset: 50,
      }),
    );
    // Nothing was stripped: every one of these is supported.
    expect(screen.queryByText('Unsupported URL filters were removed.')).toBeNull();
  });

  it('removes a page the list cannot have', async () => {
    renderList('/acquisitions?page=0');
    expect(await screen.findByText('Unsupported URL filters were removed.')).toBeTruthy();
    await waitFor(() => expect(currentSearch).not.toContain('page'));
    expect(calls.every((call) => call.offset === 0)).toBe(true);
  });

  it('clears prior list state on a workspace switch', async () => {
    const { rerender } = renderList('/acquisitions?query=candy&seller=seller-a&page=2');
    await waitFor(() => expect(lastCall().seller).toBe('seller-a'));

    workspaceId = 'ws-2';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/acquisitions?query=candy&seller=seller-a&page=2']}>
          <Routes>
            <Route
              path="/acquisitions"
              element={
                <>
                  <Acquisitions />
                  <SearchProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(currentSearch).not.toContain('seller'));
    expect(currentSearch).not.toContain('query');
    expect(currentSearch).not.toContain('page');
  });
});

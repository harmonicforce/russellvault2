// @vitest-environment jsdom
//
// Home is MIXED SOURCE, and S1.6.4 must not quietly make it look uniform.
//
// This file pins the boundary: the governed awareness region is customizable,
// everything below it is fixed, and the legacy spreadsheet-imported panel is
// never a widget, never in the catalogue, and never rearrangeable into the
// governed region. Letting an operator drop legacy SQLite figures into the same
// arrangement as governed ones would teach exactly the equivalence the legacy
// retirement programme exists to break.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';

let legacy: Promise<unknown>;

vi.mock('../lib/api', () => ({ get: () => legacy }));
vi.mock('../lib/provenanceConfig', () => ({
  getProvenanceUiConfig: () => ({ mode: 'repository-fixtures', url: 'http://supabase.test', anonKey: 'anon' }),
}));
vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Vault', role: 'owner' }, client: {}, userId: 'user-a' }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));
vi.mock('../lib/inventoryData', () => ({
  createInventoryData: () => ({
    workQueueCounts: async () => ({ needsLocation: 5, needsPhotos: 2, total: 61 }),
    workQueue: async () => [],
    operationsQueueCounts: async () => ({ unclassified: 0, needsConditionDetails: 0, zeroQuantity: 0 }),
    operationsQueueRows: async () => [],
    openCorrectionCount: async () => 4,
  }),
}));
vi.mock('../lib/intakeApi', () => ({
  createIntakeTransport: () => ({ listSessions: async () => ({ total: 0, limit: 10, offset: 0, sessions: [] }) }),
}));
vi.mock('../lib/listingPrepApi', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createListingPrepTransport: () => ({
    summary: async () => ({ by_readiness: {}, by_status: {}, no_active_preparation: 0 }),
  }),
}));
vi.mock('../lib/operationsDashboardApi', () => ({
  createOperationsDashboardTransport: () => ({
    health: async () => ({ asOf: '2026-08-01T00:00:00Z', serializedUnits: 2, lotManagedRecords: 1, lotManagedUnits: 4, withoutLocation: 1 }),
    work: async () => ({ asOf: '2026-08-01T00:00:00Z', definition: 'inventory age', tasks: [] }),
    workflows: async () => ({
      asOf: '2026-08-01T00:00:00Z',
      media: { no_active_photo: 7, by_readiness: {}, open_issue_count: 2 },
      listingPrep: { by_status: {}, by_readiness: {}, no_active_preparation: 6, ready_now: 3, regressed_ready: 1 },
    }),
    activity: async () => ({ asOf: '2026-08-01T00:00:00Z', source: 'immutable inventory_movements', events: [] }),
  }),
}));

const LEGACY_PAYLOAD = {
  inventory: {
    lotCount: 12, totalUnits: 30, availableUnits: 25, recordedValue: 5000,
    totalCostBasis: 4000, uncostedCount: 2, costedCount: 9, partialCostedCount: 1,
  },
  purchases: { lineCount: 8, totalPaid: 900, remainingCost: 100, unmatchedCount: 1, fullyMatchedCount: 6, partiallyMatchedCount: 1 },
  links: { total: 4, candidateCount: 1, confirmedCount: 3, rejectedCount: 0 },
  listings: { total: 5, draftCount: 1, activeCount: 3, soldCount: 1 },
  sales: { total: 2, totalNetProceeds: 300, totalProfit: 50, unitsSold: 2, unavailableProfitCount: 0 },
  checks: [{ status: 'PASS', n: 4 }],
  recentSales: [],
  recentPurchases: [],
  topVerticals: [{ business_vertical: 'graded_card', lotCount: 3, value: 1200 }],
};

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  legacy = Promise.resolve(LEGACY_PAYLOAD);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const governedRegion = () => document.querySelector('[data-workbench-surface="home"]') as HTMLElement;
const legacyRegion = () => document.querySelector('[data-legacy-region]') as HTMLElement;

describe('the governed configurable region', () => {
  it('exists on Home and is customizable', async () => {
    renderHome();
    await waitFor(() => expect(governedRegion()).toBeTruthy());
    expect(within(governedRegion()).getByRole('button', { name: /Customize/i })).toBeTruthy();
  });

  it('renders governed facts from governed transports', async () => {
    renderHome();
    await waitFor(() => expect(document.querySelector('[data-widget-id="inventory.record-count"]')).toBeTruthy());
    const metric = document.querySelector('[data-widget-id="inventory.record-count"]') as HTMLElement;
    await waitFor(() => expect(within(metric).getAllByText('61').length).toBeGreaterThan(0));
  });

  it('stores its layout under the home surface, separately from Daily Workbench', async () => {
    renderHome();
    await waitFor(() => expect(governedRegion()).toBeTruthy());
    fireEvent.click(within(governedRegion()).getByRole('button', { name: /Customize/i }));
    const titles = within(governedRegion())
      .getAllByRole('region')
      .map((section) => section.getAttribute('aria-label'));
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }));

    const keys = Object.keys(window.localStorage);
    expect(keys.some((key) => key.endsWith('.home'))).toBe(true);
    expect(keys.some((key) => key.endsWith('.daily-workbench'))).toBe(false);
  });
});

describe('the legacy region stays fixed and outside customization', () => {
  it('renders the legacy panel outside the governed configurable region', async () => {
    renderHome();
    await screen.findByText('Legacy spreadsheet-imported inventory');
    expect(legacyRegion()).toBeTruthy();
    // Structurally outside: the governed region does not contain it.
    expect(governedRegion().contains(legacyRegion())).toBe(false);
  });

  it('keeps the legacy panel labelled as legacy and non-authoritative', async () => {
    renderHome();
    const heading = await screen.findByText('Legacy spreadsheet-imported inventory');
    expect(heading).toBeTruthy();
    expect(within(governedRegion()).queryByText(/Legacy spreadsheet-imported inventory/)).toBeNull();
  });

  it('gives the legacy panel no customization furniture, even in edit mode', async () => {
    renderHome();
    await waitFor(() => expect(governedRegion()).toBeTruthy());
    fireEvent.click(within(governedRegion()).getByRole('button', { name: /Customize/i }));

    // The legacy figures are still on screen, and still not movable.
    expect(await screen.findByText('Inventory lots')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Move Inventory lots (earlier|later)/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Inventory lots/i })).toBeNull();
    expect(legacyRegion().querySelector('[data-drag-handle]')).toBeNull();
  });

  it('never offers legacy data in the governed widget catalog', async () => {
    renderHome();
    await waitFor(() => expect(governedRegion()).toBeTruthy());
    fireEvent.click(within(governedRegion()).getByRole('button', { name: /Customize/i }));
    fireEvent.click(within(governedRegion()).getByRole('button', { name: /Widget catalog/i }));

    const list = screen.getByRole('list', { name: 'Available widgets' });
    for (const legacyLabel of [
      /Legacy/i,
      /Recorded value/i,
      /Uncosted lots/i,
      /Recent purchases/i,
      /Recent sales/i,
      /Reconciliation health/i,
      /vertical/i,
    ]) {
      expect(within(list).queryByText(legacyLabel)).toBeNull();
    }
  });
});

describe('the fixed governed operations panels are not swallowed either', () => {
  it("keeps Today's Work outside the customizable region", async () => {
    renderHome();
    const panel = await screen.findByText(/Today’s Work — Vault/);
    expect(governedRegion().contains(panel)).toBe(false);
  });
});

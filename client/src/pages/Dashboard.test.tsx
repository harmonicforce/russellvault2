// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';

let legacy: Promise<unknown>;
const calls = { health: 0, work: 0, workflows: 0, activity: 0 };

vi.mock('../lib/api', () => ({ get: () => legacy }));
vi.mock('../lib/provenanceConfig', () => ({ getProvenanceUiConfig: () => ({ mode: 'repository-fixtures', url: 'http://supabase.test', anonKey: 'anon' }) }));
vi.mock('../lib/workspaceContext', () => ({ useWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Vault', role: 'owner' } }) }));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));
vi.mock('../lib/operationsDashboardApi', () => ({
  createOperationsDashboardTransport: () => ({
    health: async () => { calls.health++; return { asOf: '2026-08-01T00:00:00Z', serializedUnits: 2, lotManagedRecords: 1, lotManagedUnits: 4, withoutLocation: 1 }; },
    work: async () => { calls.work++; return { asOf: '2026-08-01T00:00:00Z', definition: 'inventory age', tasks: [{ taskType: 'missing_location', subjectKind: 'item', subjectId: 'i1', publicId: 'RV-I1', displayName: 'Charizard', reason: 'No active storage location is recorded.', ageDays: 3, severity: 'high', score: 83, scoreExplanation: '80 rule weight + 3 age points', destination: '/inventory/current?needsLocation=1' }] }; },
    workflows: async () => { calls.workflows++; return { asOf: '2026-08-01T00:00:00Z', media: { no_active_photo: 7, by_readiness: { missing_required_angle: 3 }, open_issue_count: 2 }, listingPrep: { by_status: { ready_to_list: 4 }, by_readiness: { needs_owner_review: 1, needs_photos: 5, blocked: 2 }, no_active_preparation: 6, ready_now: 3, regressed_ready: 1 } }; },
    activity: async () => { calls.activity++; return { asOf: '2026-08-01T00:00:00Z', source: 'immutable inventory_movements', events: [{ id: 'm1', public_id: 'RV-M1', eventType: 'inventory_moved', moved_at: '2026-08-01T00:00:00Z', destination: '/inventory/current/i1' }, { id: 'm2', public_id: 'RV-M2', eventType: 'inventory_moved', moved_at: '2026-08-01T00:00:00Z', destination: '/inventory/lots/l1' }] }; },
  }),
}));

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  Object.keys(calls).forEach(key => { calls[key as keyof typeof calls] = 0; });
  legacy = new Promise(() => undefined);
});
afterEach(cleanup);

describe('operational Dashboard', () => {
  it('renders governed panels while the legacy dashboard remains pending', async () => {
    renderDashboard();
    expect(await screen.findByText(/Today’s Work — Vault/)).toBeTruthy();
    expect(screen.getByText(/Loading legacy spreadsheet-imported inventory/)).toBeTruthy();
    expect(await screen.findByText('Charizard')).toBeTruthy();
  });

  it('keeps governed panels visible when the legacy dashboard fails', async () => {
    legacy = Promise.reject(new Error('legacy unavailable'));
    renderDashboard();
    expect(await screen.findByText('Legacy dashboard unavailable.')).toBeTruthy();
    expect(screen.getByText(/Today’s Work — Vault/)).toBeTruthy();
    expect(await screen.findByText('Charizard')).toBeTruthy();
  });

  it('renders workflow facts, canonical links, movement links, and refreshes every panel', async () => {
    renderDashboard();
    expect(await screen.findByText('Ready to list')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Records without location/ }).getAttribute('href')).toBe('/inventory/current?needsLocation=1');
    // Two populations, two destinations. "No photo yet" is the exact
    // no-active-photo count and opens the filter that contains exactly those
    // records; "Missing required angles" is a different, larger question and
    // must not be sent to the same page.
    expect(screen.getByRole('link', { name: /No photo yet/ }).getAttribute('href')).toBe('/inventory/current?needsPhotos=1');
    expect(screen.getByRole('link', { name: /No photo yet/ }).textContent).toContain('7');
    expect(screen.getByRole('link', { name: /Missing required angles/ }).getAttribute('href'))
      .toBe('/photo-issues?tab=readiness&status=missing_required_angle');
    expect(screen.getByRole('link', { name: /Missing required angles/ }).textContent).toContain('3');
    expect(screen.getByRole('link', { name: /Inventory moved · RV-M1/ }).getAttribute('href')).toBe('/inventory/current/i1');
    expect(screen.getByRole('link', { name: /Inventory moved · RV-M2/ }).getAttribute('href')).toBe('/inventory/lots/l1');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(calls).toEqual({ health: 2, work: 2, workflows: 2, activity: 2 }));
  });
});

describe('backlog tiles open exactly what they counted', () => {
  const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href');

  it('sends every Listing Prep readiness tile to a destination spanning live statuses', async () => {
    renderDashboard();
    await screen.findByText('Ready to list');
    // No tab=queue. That filter excluded ready_to_list, which is exactly where
    // a regressed record lives, so the tile counted records the page could not
    // show.
    for (const [label, readiness] of [
      [/Needs owner review/, 'needs_owner_review'],
      [/Prep needs photos/, 'needs_photos'],
      [/^Blocked/, 'blocked'],
    ] as const) {
      expect(href(label)).toBe(`/listing-prep?readiness=${readiness}`);
      expect(href(label)).not.toContain('tab=queue');
    }
  });

  it('counts genuinely-ready records, not the raw ready_to_list status', async () => {
    renderDashboard();
    await screen.findByText('Ready to list');
    // by_status.ready_to_list is 4; only 3 are still actually ready.
    expect(screen.getByRole('link', { name: /Ready to list/ }).textContent).toContain('3');
    expect(href(/Ready to list/)).toBe('/listing-prep?tab=ready');
  });

  it('gives regressed-from-ready records their own honest destination', async () => {
    renderDashboard();
    await screen.findByText('Regressed from ready');
    expect(screen.getByRole('link', { name: /Regressed from ready/ }).textContent).toContain('1');
    expect(href(/Regressed from ready/)).toBe('/listing-prep?tab=ready&regressed=1');
  });

  it('sends unprepared inventory to a queue that can actually contain it', async () => {
    renderDashboard();
    await screen.findByText('No active preparation');
    // The old link was tab=queue, which reads listing_prep rows — and a
    // never-started record has none by definition.
    expect(href(/No active preparation/)).toBe('/listing-prep?tab=candidates');
  });
});

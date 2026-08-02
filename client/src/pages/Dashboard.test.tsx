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
    workflows: async () => { calls.workflows++; return { asOf: '2026-08-01T00:00:00Z', media: { counts: { missing_required_angle: 3 }, open_issue_count: 2 }, listingPrep: { by_status: { ready_to_list: 4 }, by_readiness: { needs_owner_review: 1, needs_photos: 5, blocked: 2 }, never_started: 6 } }; },
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
    expect(screen.getByRole('link', { name: /Missing photo work/ }).getAttribute('href')).toBe('/inventory/current?needsPhotos=1');
    expect(screen.getByRole('link', { name: /Inventory moved · RV-M1/ }).getAttribute('href')).toBe('/inventory/current/i1');
    expect(screen.getByRole('link', { name: /Inventory moved · RV-M2/ }).getAttribute('href')).toBe('/inventory/lots/l1');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(calls).toEqual({ health: 2, work: 2, workflows: 2, activity: 2 }));
  });
});

// @vitest-environment jsdom
//
// The drawer with the governed surfaces ON — the configuration the operator
// actually uses, and the only one where the nav contains anything other than
// destinations.
//
// The regression this file exists for: the close handler was on the <nav>, so
// every click inside it bubbled up and shut the drawer. Opening "Tools &
// legacy" closed the panel containing the thing that had just been opened,
// which made the legacy destinations unreachable from a tablet altogether.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('./lib/provenanceConfig', () => ({
  isProvenanceUiEnabled: () => true,
  getProvenanceUiConfig: () => ({ mode: 'repository-fixtures', url: 'http://supabase.test', anonKey: 'anon' }),
  SHADOW_IMPORT_FLAG: 'VITE_SHADOW_IMPORT',
  STAGING_NOTICE: '',
}));
// Fully governed configuration — the mode the operator actually runs.
vi.mock('./lib/appConfig', () => ({
  resolveAppConfig: () => ({ mode: 'governed', url: 'http://supabase.test', anonKey: 'anon' }),
}));
vi.mock('./lib/api', () => ({ get: () => new Promise(() => undefined) }));
vi.mock('./lib/healthApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/healthApi')>()),
  fetchSystemHealth: () => new Promise(() => undefined),
}));
// AuthShell would demand a real shadow session; the navigation under test sits
// inside it and does not depend on it.
vi.mock('./components/AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// `loading` keeps FirstRunGate from mounting a routed page, so this file tests
// the chrome and nothing else. WorkspaceHeader renders nothing without a
// workspace, which is why the sign-out button is not asserted here.
vi.mock('./lib/workspaceContext', () => ({
  useWorkspace: () => ({
    workspace: null, workspaces: [], loading: true,
    selectWorkspace: () => undefined, signOut: () => undefined, email: null,
  }),
}));

const { default: App } = await import('./App');

afterEach(() => cleanup());

const renderApp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><App /></MemoryRouter>
    </QueryClientProvider>
  );
};

/** Render the shell and open the drawer — every case here starts there. */
const openDrawer = () => {
  if (!screen.queryByLabelText('Open navigation')) renderApp();
  fireEvent.click(screen.getByLabelText('Open navigation'));
  return screen.getByRole('dialog', { name: 'Navigation' });
};

describe('tablet drawer with governed surfaces enabled', () => {
  it('shows the governed destinations, not the legacy-only set', () => {
    const drawer = openDrawer();
    expect(within(drawer).getByText('Current Inventory')).toBeTruthy();
    expect(within(drawer).getByText('Cycle Counts')).toBeTruthy();
    expect(within(drawer).getByText('Listing Prep')).toBeTruthy();
  });

  // THE REGRESSION. Expanding a group is not choosing a destination.
  it('expands Tools & legacy without closing the drawer', () => {
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText(/Tools & legacy/));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeNull();
    expect(screen.getByLabelText('Open navigation').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the nested destinations reachable once expanded', () => {
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText(/Tools & legacy/));
    // Still the same open drawer, now carrying the legacy group.
    const open = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(open).getByText('Whatnot Purchases')).toBeTruthy();
    expect(within(open).getByText('Health Checks')).toBeTruthy();
  });

  it('closes when a nested destination is chosen', () => {
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText(/Tools & legacy/));
    const open = screen.getByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(open).getByText('eBay Listings'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('closes when a top-level destination is chosen', () => {
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText('Cycle Counts'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('still closes on the backdrop and on Escape', () => {
    openDrawer();
    fireEvent.click(screen.getByLabelText('Close navigation'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();

    const reopened = openDrawer();
    fireEvent.keyDown(reopened, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('expands the group without navigating away from the current page', () => {
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText(/Tools & legacy/));
    // A group toggle is a button, not a link — it must not be a destination.
    const toggle = within(screen.getByRole('dialog', { name: 'Navigation' }))
      .getByText(/Tools & legacy/).closest('button');
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
  });
});

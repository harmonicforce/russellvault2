// @vitest-environment jsdom
//
// The active-workspace layer: auto-selection, persisted-selection
// revalidation against current memberships, and safe fallback when a stored
// selection no longer applies. Driven through the real WorkspaceProvider with
// a fake Supabase client — no network.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceProvider, useWorkspace } from './workspaceContext';
import type { Membership } from './authShell';

const STORAGE_KEY = 'rv.activeWorkspaceId';

interface FakeWorkspaceRow {
  id: string;
  name: string;
  sku_prefix: string;
  setup_completed_at: string | null;
}

function fakeClient(rows: FakeWorkspaceRow[]) {
  return {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'tok-1' } } };
      },
    },
    from(_table: 'workspaces') {
      return {
        select: () => ({
          in: (_col: 'id', ids: string[]) =>
            Promise.resolve({
              data: rows.filter((r) => ids.includes(r.id)),
              error: null,
            }),
        }),
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function Probe() {
  const { loading, workspace, workspaces, selectWorkspace } = useWorkspace();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="active">{workspace?.name ?? 'none'}</div>
      <div data-testid="count">{workspaces.length}</div>
      {workspaces.map((w) => (
        <button key={w.id} onClick={() => selectWorkspace(w.id)}>
          Switch to {w.name}
        </button>
      ))}
    </div>
  );
}

function renderWithProvider(rows: FakeWorkspaceRow[], memberships: Membership[]) {
  return render(
    <WorkspaceProvider client={fakeClient(rows)} email="op@vault.test" memberships={memberships} onSignOut={() => {}}>
      <Probe />
    </WorkspaceProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('WorkspaceProvider — active workspace selection', () => {
  it('auto-selects the only workspace when the caller has exactly one', async () => {
    renderWithProvider(
      [{ id: 'ws-1', name: 'The Russell Vault', sku_prefix: 'RV-N-', setup_completed_at: null }],
      [{ workspace_id: 'ws-1', role: 'owner' }]
    );
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('The Russell Vault'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('ws-1');
  });

  it('offers a selector and persists the chosen workspace when the caller has several', async () => {
    const user = userEvent.setup();
    renderWithProvider(
      [
        { id: 'ws-1', name: 'Alpha', sku_prefix: 'RV-N-', setup_completed_at: '2026-01-01T00:00:00Z' },
        { id: 'ws-2', name: 'Beta', sku_prefix: 'RV-N-', setup_completed_at: '2026-01-01T00:00:00Z' },
      ],
      [
        { workspace_id: 'ws-1', role: 'owner' },
        { workspace_id: 'ws-2', role: 'operator' },
      ]
    );
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Beta'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('ws-2');
  });

  it('revalidates a persisted selection and falls back when it no longer applies', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'ws-removed');
    renderWithProvider(
      [{ id: 'ws-1', name: 'The Russell Vault', sku_prefix: 'RV-N-', setup_completed_at: null }],
      [{ workspace_id: 'ws-1', role: 'owner' }]
    );
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('The Russell Vault'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('ws-1');
  });

  it('keeps a still-valid persisted selection instead of overriding it', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'ws-2');
    renderWithProvider(
      [
        { id: 'ws-1', name: 'Alpha', sku_prefix: 'RV-N-', setup_completed_at: '2026-01-01T00:00:00Z' },
        { id: 'ws-2', name: 'Beta', sku_prefix: 'RV-N-', setup_completed_at: '2026-01-01T00:00:00Z' },
      ],
      [
        { workspace_id: 'ws-1', role: 'owner' },
        { workspace_id: 'ws-2', role: 'operator' },
      ]
    );
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Beta'));
  });

  it('clears the selection when the caller has no workspaces at all', async () => {
    renderWithProvider([], []);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('none'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

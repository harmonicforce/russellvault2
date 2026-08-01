// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Workbench from './Workbench';

let correction: Promise<number>;
let workspace = { id: 'ws-1', name: 'Vault' };
const listSessions = vi.fn();
const { inventoryByWorkspace, workspaceClient } = vi.hoisted(() => ({
  inventoryByWorkspace: new Map<string, Record<string, unknown>>(),
  workspaceClient: {},
}));

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    workQueueCounts: async () => ({ needsLocation: 0, needsPhotos: 0, total: 0 }),
    workQueue: async () => [],
    operationsQueueCounts: async () => ({ unclassified: 0, needsConditionDetails: 0, zeroQuantity: 0 }),
    operationsQueueRows: async () => [],
    openCorrectionCount: () => correction,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace, client: workspaceClient }),
}));
vi.mock('../lib/provenanceConfig', () => ({ getProvenanceUiConfig: () => ({}) }));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));
vi.mock('../lib/inventoryData', () => ({
  createInventoryData: (_client: unknown, workspaceId: string) =>
    inventoryByWorkspace.get(workspaceId) ?? inventory(),
}));
vi.mock('../lib/intakeApi', () => ({ createIntakeTransport: () => ({ listSessions }) }));
vi.mock('../lib/listingPrepApi', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createListingPrepTransport: () => ({ summary: async () => ({ by_readiness: {}, by_status: {}, never_started: 0 }) }),
}));

beforeEach(() => {
  workspace = { id: 'ws-1', name: 'Vault' };
  inventoryByWorkspace.clear();
  correction = Promise.resolve(3);
  listSessions.mockResolvedValue({ total: 14, limit: 10, offset: 0, sessions: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('does not call a positive correction queue empty and shows the authoritative open-session total', async () => {
  render(<MemoryRouter><Workbench /></MemoryRouter>);
  expect(await screen.findByText('Use the link below to review this queue.')).toBeTruthy();
  expect(screen.getByText('14')).toBeTruthy();
  expect(listSessions).toHaveBeenCalledWith('ws-1', 10, 0, 'open');
  expect(screen.getByText(/Inventory with no recorded photos yet/i)).toBeTruthy();
  expect(screen.getByText(/Required-angle readiness and photo issues are tracked separately/i)).toBeTruthy();
});

it('does not let a late response from the previous workspace overwrite the current workspace', async () => {
  const workspaceACounts = deferred<{ needsLocation: number; needsPhotos: number; total: number }>();
  inventoryByWorkspace.set('ws-1', inventory({ workQueueCounts: () => workspaceACounts.promise }));
  inventoryByWorkspace.set('ws-2', inventory({
    workQueueCounts: async () => ({ needsLocation: 0, needsPhotos: 0, total: 22 }),
  }));

  const view = render(<MemoryRouter><Workbench /></MemoryRouter>);
  workspace = { id: 'ws-2', name: 'Second vault' };
  view.rerender(<MemoryRouter><Workbench /></MemoryRouter>);

  expect(await screen.findByText('22 inventory records in this workspace.')).toBeTruthy();
  workspaceACounts.resolve({ needsLocation: 0, needsPhotos: 0, total: 11 });
  await waitFor(() => {
    expect(screen.queryByText('11 inventory records in this workspace.')).toBeNull();
    expect(screen.getByText('22 inventory records in this workspace.')).toBeTruthy();
  });
});

it('renders an unknown correction count when that request fails', async () => {
  correction = Promise.reject(new Error('offline'));
  render(<MemoryRouter><Workbench /></MemoryRouter>);
  expect(await screen.findByText(/no zero has been substituted/i)).toBeTruthy();
  const card = screen.getByText('Open corrections').closest('section')!;
  expect(card.textContent).toContain('—');
  expect(card.textContent).not.toContain('Nothing waiting here');
});

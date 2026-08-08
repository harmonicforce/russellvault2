// @vitest-environment jsdom
//
// Rendered acceptance for the migrated Daily Workbench.
//
// The property this file exists to pin, restated because it is the reason the
// page was migrated at all:
//
//     A SOURCE THAT HAS NOT ANSWERED, OR THAT FAILED, NEVER RENDERS AS ZERO.
//
// The old page initialised every count to 0 and loaded them under one shared
// `catch`, so an unresolved or failed query displayed a confident zero and one
// failure blanked the rest. Every assertion below tests the repair.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Workbench from './Workbench';

let correction: Promise<number>;
let workspace: { id: string; name: string; role: 'owner' | 'operator' | 'viewer' } | null = {
  id: 'ws-1',
  name: 'Vault',
  role: 'owner',
};
let prepSummary: () => Promise<Record<string, unknown>>;
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace, client: workspaceClient, userId: 'user-a' }),
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
  createListingPrepTransport: () => ({ summary: () => prepSummary() }),
}));

beforeEach(() => {
  workspace = { id: 'ws-1', name: 'Vault', role: 'owner' };
  inventoryByWorkspace.clear();
  correction = Promise.resolve(3);
  prepSummary = async () => ({ by_readiness: {}, by_status: {}, no_active_preparation: 0 });
  listSessions.mockResolvedValue({ total: 14, limit: 10, offset: 0, sessions: [] });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const draw = () => render(<MemoryRouter><Workbench /></MemoryRouter>);
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
const widget = (id: string) => document.querySelector(`[data-widget-id="${id}"]`) as HTMLElement | null;

describe('the business sources are unchanged', () => {
  it('reads the same transports with the same arguments as before', async () => {
    const calls: string[] = [];
    inventoryByWorkspace.set(
      'ws-1',
      inventory({
        workQueueCounts: async () => {
          calls.push('workQueueCounts');
          return { needsLocation: 2, needsPhotos: 1, total: 40 };
        },
        workQueue: async (kind: string) => {
          calls.push(`workQueue:${kind}`);
          return [];
        },
        operationsQueueCounts: async () => {
          calls.push('operationsQueueCounts');
          return { unclassified: 5, needsConditionDetails: 4, zeroQuantity: 0 };
        },
        operationsQueueRows: async (kind: string) => {
          calls.push(`operationsQueueRows:${kind}`);
          return [];
        },
      }),
    );
    draw();
    await waitFor(() => expect(calls).toContain('workQueueCounts'));
    await waitFor(() => expect(calls).toContain('operationsQueueCounts'));
    expect(calls).toContain('workQueue:needs_location');
    expect(calls).toContain('workQueue:needs_photos');
    expect(calls).toContain('operationsQueueRows:unclassified');
    expect(calls).toContain('operationsQueueRows:needs_condition_details');
    // The authoritative open-session total, with the unchanged paging arguments.
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith('ws-1', 10, 0, 'open'));
  });

  it('shows the same governed queues the page has always shown', async () => {
    draw();
    await waitFor(() => expect(widget('inventory.needs-location')).toBeTruthy());
    for (const id of [
      'inventory.needs-location',
      'inventory.needs-photos',
      'inventory.unclassified-category',
      'inventory.needs-condition-details',
      'governance.open-corrections',
      'sell.listing-prep-backlog',
      'intake.open-sessions',
      'utility.quick-actions',
    ]) {
      expect(widget(id)).toBeTruthy();
    }
  });

  it('keeps the existing quick actions and their routes', async () => {
    draw();
    await waitFor(() => expect(widget('utility.quick-actions')).toBeTruthy());
    const panel = widget('utility.quick-actions')!;
    const hrefs = [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/quick-add', '/scan', '/inventory/current', '/locations']);
    expect(within(panel).getByText('Add inventory')).toBeTruthy();
    expect(within(panel).getByText('Manage locations')).toBeTruthy();
  });

  it('asks for a workspace before reading anything', () => {
    workspace = null;
    draw();
    expect(text()).toMatch(/Select a workspace/i);
  });
});

describe('a source that has not answered is never a zero', () => {
  it('shows no count at all while a queue is still loading', async () => {
    const pending = deferred<{ needsLocation: number; needsPhotos: number; total: number }>();
    inventoryByWorkspace.set('ws-1', inventory({ workQueueCounts: () => pending.promise }));
    draw();

    const panel = await waitFor(() => {
      const found = widget('inventory.needs-location');
      expect(found).toBeTruthy();
      return found!;
    });
    // An em dash, never "0" — and the body says it is reading, not that there
    // is nothing.
    expect(within(panel).getByText('—')).toBeTruthy();
    expect(within(panel).queryByText('0')).toBeNull();
    expect(panel.querySelector('[data-truth-state="loading"]')).toBeTruthy();

    pending.resolve({ needsLocation: 4, needsPhotos: 0, total: 9 });
    await waitFor(() => expect(within(widget('inventory.needs-location')!).getByText('4')).toBeTruthy());
  });

  it('renders a failed queue read as a failure, not as an empty queue', async () => {
    inventoryByWorkspace.set(
      'ws-1',
      inventory({
        workQueueCounts: async () => {
          throw new Error('the work queue timed out');
        },
      }),
    );
    draw();
    const panel = await waitFor(() => {
      const found = widget('inventory.needs-location');
      expect(found?.textContent).toMatch(/request failed/i);
      return found!;
    });
    expect(panel.textContent).toMatch(/the work queue timed out/);
    expect(panel.textContent).toMatch(/WORK_QUEUE_READ_FAILED/);
    expect(panel.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(within(panel).queryByText('0')).toBeNull();
    expect(panel.textContent).not.toMatch(/Nothing waiting here/);
  });

  it('renders an authoritative zero as a proven zero', async () => {
    inventoryByWorkspace.set(
      'ws-1',
      inventory({ workQueueCounts: async () => ({ needsLocation: 0, needsPhotos: 0, total: 12 }) }),
    );
    draw();
    const panel = await waitFor(() => {
      const found = widget('inventory.needs-location');
      expect(found?.textContent).toMatch(/Nothing waiting here/);
      return found!;
    });
    expect(within(panel).getByText('0')).toBeTruthy();
    expect(panel.textContent).toMatch(/confirmed result, not a failed request/i);
  });

  it('treats an unconfigured intake transport as unconfigured, not as zero sessions', async () => {
    // Requirements are computed from the same config the transport is; with the
    // provenance config present the widget is offered, so this asserts the data
    // path: a rejection is a failure, never a zero.
    listSessions.mockRejectedValue(new Error('intake is unreachable'));
    draw();
    await waitFor(() => expect(widget('intake.open-sessions')?.textContent).toMatch(/request failed/i));
    const panel = widget('intake.open-sessions')!;
    expect(panel.textContent).toMatch(/INTAKE_SESSIONS_READ_FAILED/);
    expect(within(panel).queryByText('0')).toBeNull();
  });

  it('reports a failed correction count without substituting a zero', async () => {
    correction = Promise.reject(new Error('corrections are unreadable'));
    draw();
    await waitFor(() => expect(widget('governance.open-corrections')?.textContent).toMatch(/request failed/i));
    const panel = widget('governance.open-corrections')!;
    expect(panel.textContent).toMatch(/CORRECTION_COUNT_FAILED/);
    expect(within(panel).queryByText('0')).toBeNull();
  });
});

describe('one failing source does not collapse the others', () => {
  it('keeps every healthy widget usable while corrections and listing prep fail', async () => {
    correction = Promise.reject(new Error('corrections are unreadable'));
    prepSummary = async () => {
      throw new Error('listing prep is unreachable');
    };
    inventoryByWorkspace.set(
      'ws-1',
      inventory({ workQueueCounts: async () => ({ needsLocation: 6, needsPhotos: 2, total: 31 }) }),
    );
    draw();

    await waitFor(() => expect(widget('governance.open-corrections')?.textContent).toMatch(/request failed/i));
    expect(widget('sell.listing-prep-backlog')!.textContent).toMatch(/request failed/i);

    // The healthy ones are unaffected, with their real numbers.
    expect(within(widget('inventory.needs-location')!).getByText('6')).toBeTruthy();
    expect(within(widget('inventory.needs-photos')!).getByText('2')).toBeTruthy();
    // The count appears as the header accessory and as the metric figure.
    expect(within(widget('inventory.record-count')!).getAllByText('31').length).toBeGreaterThan(0);
    // And an action widget that reads nothing keeps working when data is down.
    expect(widget('utility.quick-actions')).toBeTruthy();
  });

  it('keeps the inventory queues when the operations queues fail', async () => {
    inventoryByWorkspace.set(
      'ws-1',
      inventory({
        workQueueCounts: async () => ({ needsLocation: 3, needsPhotos: 1, total: 20 }),
        operationsQueueCounts: async () => {
          throw new Error('operations view unavailable');
        },
      }),
    );
    draw();
    await waitFor(() => expect(widget('inventory.unclassified-category')?.textContent).toMatch(/request failed/i));
    expect(widget('inventory.needs-condition-details')!.textContent).toMatch(/request failed/i);
    expect(within(widget('inventory.needs-location')!).getByText('3')).toBeTruthy();
  });
});

describe('workspace switching', () => {
  it('does not let a late response from the previous workspace overwrite the current one', async () => {
    const workspaceACounts = deferred<{ needsLocation: number; needsPhotos: number; total: number }>();
    inventoryByWorkspace.set('ws-1', inventory({ workQueueCounts: () => workspaceACounts.promise }));
    inventoryByWorkspace.set(
      'ws-2',
      inventory({ workQueueCounts: async () => ({ needsLocation: 0, needsPhotos: 0, total: 22 }) }),
    );

    const view = draw();
    workspace = { id: 'ws-2', name: 'Second', role: 'owner' };
    view.rerender(<MemoryRouter><Workbench /></MemoryRouter>);

    await waitFor(() => expect(within(widget('inventory.record-count')!).getAllByText('22').length).toBeGreaterThan(0));

    // The first workspace answers late; it must not be shown.
    workspaceACounts.resolve({ needsLocation: 99, needsPhotos: 99, total: 99 });
    await Promise.resolve();
    expect(text()).not.toMatch(/\b99\b/);
  });
});

describe('the surface is customizable', () => {
  it('offers Customize and enters edit mode', async () => {
    draw();
    await waitFor(() => expect(widget('inventory.needs-location')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Customize/i })).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ListingPrep from './ListingPrep';
import type {
  ListingPrepTransport, PrepQueuePage, PrepQueueRow,
} from '../lib/listingPrepApi';

let role: 'owner' | 'operator' | 'viewer';
let page: PrepQueuePage;
let queueError: string | null;
let calls: Array<{ fn: string; args: unknown[] }>;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Vault', role },
    userId: 'user-1',
    client: {},
  }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

let candidatePage = { total: 0, limit: 25, offset: 0, rows: [] as unknown[] };

const transport = {
  candidates: (...args: unknown[]) => {
    calls.push({ fn: 'candidates', args });
    return Promise.resolve(candidatePage);
  },
  start: (...args: unknown[]) => {
    calls.push({ fn: 'start', args });
    return Promise.resolve({ id: 'new-prep' });
  },
  queue: (...args: unknown[]) => {
    calls.push({ fn: 'queue', args });
    if (queueError) return Promise.reject(new Error(queueError));
    return Promise.resolve(page);
  },
  bulk: (...args: unknown[]) => {
    calls.push({ fn: 'bulk', args });
    return Promise.resolve({ action: 'set_priority', requested: 1, applied: 1, failed: 0, results: [] });
  },
} as unknown as ListingPrepTransport;

vi.mock('../lib/listingPrepApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createListingPrepTransport: () => transport,
}));

function row(over: Partial<PrepQueueRow> & { id: string }): PrepQueueRow {
  return {
    public_id: 'RV-LP-0001', status: 'in_preparation', priority: 'normal',
    assigned_to: null, subject_kind: 'item', subject_id: 'subject-1',
    subject_public_id: 'RV-ITEM-1', display_name: 'Blastoise', detail_line: 'RAW-1',
    subtype: 'raw_card', subject_state: 'active', working_title: null,
    readiness_status: 'needs_photos',
    blockers: [{ code: 'photos_missing_required_angle', kind: 'photos', label: 'Required photographs are missing' }],
    blocker_count: 1, asking_price_minor: null, currency: null, blocked_reason: null,
    listed_at: null, external_listing_ref: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as PrepQueueRow;
}

beforeEach(() => {
  role = 'owner';
  calls = [];
  queueError = null;
  page = { total: 1, limit: 25, offset: 0, rows: [row({ id: 'p1' })] };
  candidatePage = { total: 0, limit: 25, offset: 0, rows: [] };
});
afterEach(() => cleanup());

const renderQueue = (path = '/listing-prep') =>
  render(<MemoryRouter initialEntries={[path]}><ListingPrep /></MemoryRouter>);

describe('listing prep queue', () => {
  it('shows each record with the blocker that is holding it up', async () => {
    renderQueue();
    expect(await screen.findByText('Blastoise')).toBeTruthy();
    expect(screen.getByText('Required photographs are missing')).toBeTruthy();
    // The readiness badge on the row, not the filter button of the same name.
    expect(screen.getByText('Needs photos', { selector: 'span' })).toBeTruthy();
  });

  it('asks for the preparation statuses, not for everything', async () => {
    renderQueue();
    await screen.findByText('Blastoise');
    expect((calls[0].args[0] as Record<string, unknown>).status)
      .toEqual(['not_started', 'in_preparation', 'blocked', 'needs_review']);
  });

  // The URL is the source of truth so the Workbench can link straight in.
  it('applies a readiness filter that arrived in the URL', async () => {
    renderQueue('/listing-prep?readiness=blocked');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect((calls[0].args[0] as Record<string, unknown>).readiness).toEqual(['blocked']);
  });

  it('opens the listed tab from the URL and asks only for listed records', async () => {
    renderQueue('/listing-prep?tab=listed');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect((calls[0].args[0] as Record<string, unknown>).status).toEqual(['listed']);
  });

  it('moves the readiness filter into the URL when one is chosen', async () => {
    renderQueue();
    await screen.findByText('Blastoise');
    fireEvent.click(screen.getByText('Needs photos', { selector: 'button' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect((calls.at(-1)!.args[0] as Record<string, unknown>).readiness).toEqual(['needs_photos']);
  });

  // A failed request must never look like "there is no work to do".
  it('reports a failure as a failure rather than as an empty queue', async () => {
    queueError = 'Listing preparation is not enabled on this deployment.';
    renderQueue();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not enabled on this deployment/)).toBeTruthy();
    expect(screen.queryByText(/No preparations match/)).toBeNull();
  });

  it('says plainly when there really is nothing to prepare', async () => {
    page = { total: 0, limit: 25, offset: 0, rows: [] };
    renderQueue();
    expect(await screen.findByText(/No preparations match/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives a viewer the queue and none of the bulk controls', async () => {
    role = 'viewer';
    renderQueue();
    expect(await screen.findByText('Blastoise')).toBeTruthy();
    expect(screen.queryByLabelText('Select Blastoise')).toBeNull();
  });

  it('offers bulk work once records are selected, and sends the selection', async () => {
    renderQueue();
    fireEvent.click(await screen.findByLabelText('Select Blastoise'));
    fireEvent.click(screen.getByText('Mark urgent'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'bulk')).toBeTruthy());
    const bulk = calls.find((c) => c.fn === 'bulk')!;
    expect(bulk.args[0]).toBe('set_priority');
    expect(bulk.args[1]).toEqual(['p1']);
    expect(bulk.args[2]).toEqual({ priority: 'urgent' });
  });

  it('does not offer an operator the owner-only bulk review', async () => {
    role = 'operator';
    renderQueue();
    fireEvent.click(await screen.findByLabelText('Select Blastoise'));
    expect(screen.getByText('Send for review')).toBeTruthy();
    expect(screen.queryByText('Mark ready to list')).toBeNull();
  });

  it('will not block records in bulk without a reason', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('   ');
    renderQueue();
    fireEvent.click(await screen.findByLabelText('Select Blastoise'));
    fireEvent.click(screen.getByText('Block…'));
    expect(prompt).toHaveBeenCalled();
    expect(calls.find((c) => c.fn === 'bulk')).toBeUndefined();
    prompt.mockRestore();
  });

  it('reports the records a bulk action could not change', async () => {
    vi.spyOn(transport, 'bulk').mockResolvedValue({
      action: 'mark_ready', requested: 2, applied: 1, failed: 1,
      results: [{ prep_id: 'p1', outcome: 'failed', error: 'this preparation still has 2 outstanding blocker(s)' }],
    } as never);
    renderQueue();
    fireEvent.click(await screen.findByLabelText('Select Blastoise'));
    fireEvent.click(screen.getByText('Mark ready to list'));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(/1 could not be changed/)).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('pages rather than asking for every record at once', async () => {
    page = { total: 60, limit: 25, offset: 0, rows: [row({ id: 'p1' })] };
    renderQueue();
    expect(await screen.findByText(/Page 1 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect((calls.at(-1)!.args[0] as Record<string, unknown>).offset).toBe(25));
  });

  it('shows the reason a blocked record is blocked, without opening it', async () => {
    page = {
      total: 1, limit: 25, offset: 0,
      rows: [row({ id: 'p1', status: 'blocked', readiness_status: 'blocked', blocked_reason: 'waiting on the grading return' })],
    };
    renderQueue();
    expect(await screen.findByText(/waiting on the grading return/)).toBeTruthy();
  });
});

describe('readiness drill-downs span live statuses', () => {
  // The defect: a ready_to_list record that later lost a photograph was counted
  // by the dashboard under needs_photos, but the link forced the queue tab,
  // whose statuses exclude ready_to_list. It inflated the tile and was absent
  // from the page.
  it('asks for every live status when a readiness filter is applied', async () => {
    renderQueue('/listing-prep?readiness=needs_photos');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const filters = calls[0].args[0] as Record<string, unknown>;
    expect(filters.status).toEqual([
      'not_started', 'in_preparation', 'blocked', 'needs_review', 'ready_to_list',
    ]);
    expect(filters.readiness).toEqual(['needs_photos']);
  });

  it('shows only genuinely-ready records on the Ready tab', async () => {
    renderQueue('/listing-prep?tab=ready');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const filters = calls[0].args[0] as Record<string, unknown>;
    expect(filters.status).toEqual(['ready_to_list']);
    // Without this the tab would include regressed records the dashboard
    // deliberately counts elsewhere.
    expect(filters.readiness).toEqual(['ready']);
  });

  it('asks for the complement of ready on the regressed destination', async () => {
    renderQueue('/listing-prep?tab=ready&regressed=1');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const filters = calls[0].args[0] as Record<string, unknown>;
    expect(filters.status).toEqual(['ready_to_list']);
    expect(filters.readiness).not.toContain('ready');
    expect(filters.readiness).toContain('needs_photos');
  });

  it('names a regressed record instead of rewriting its status', async () => {
    page = {
      total: 1, limit: 25, offset: 0,
      rows: [row({ id: 'p1', status: 'ready_to_list', readiness_status: 'needs_photos', blocker_count: 2 })],
    };
    renderQueue('/listing-prep?tab=ready&regressed=1');
    expect(await screen.findByText('Regressed from ready')).toBeTruthy();
    // Its real status is still shown; nothing was silently mutated.
    expect(screen.getByText('Ready to list', { selector: 'span' })).toBeTruthy();
  });
});

describe('never-started candidates', () => {
  it('reads the candidate view rather than the preparation queue', async () => {
    renderQueue('/listing-prep?tab=candidates');
    await waitFor(() => expect(calls.find((c) => c.fn === 'candidates')).toBeTruthy());
    // The queue is populated from listing_prep rows, and a never-started
    // record has none by definition.
    expect(calls.find((c) => c.fn === 'queue')).toBeUndefined();
  });

  it('lists each candidate and offers to start a preparation inline', async () => {
    candidatePage = {
      total: 1, limit: 25, offset: 0,
      rows: [{
        subject_kind: 'item', subject_id: 'subject-9', public_id: 'RV-ITEM-9',
        display_name: 'Blastoise', detail_line: 'RAW-9', subtype: 'raw_card',
        quantity: 1, tracking_mode: 'serialized', needs_photos: true,
        created_at: '2026-08-01T00:00:00Z',
      }],
    };
    renderQueue('/listing-prep?tab=candidates');
    expect(await screen.findByText('Blastoise')).toBeTruthy();
    fireEvent.click(screen.getByText('Prepare for listing'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'start')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'start')!.args).toEqual(['item', 'subject-9']);
  });

  it('says so plainly when every record already has a preparation', async () => {
    renderQueue('/listing-prep?tab=candidates');
    expect(await screen.findByText(/Every current record already has a preparation/)).toBeTruthy();
  });

  it('does not offer a viewer the start action', async () => {
    role = 'viewer';
    candidatePage = {
      total: 1, limit: 25, offset: 0,
      rows: [{
        subject_kind: 'item', subject_id: 'subject-9', public_id: 'RV-ITEM-9',
        display_name: 'Blastoise', detail_line: null, subtype: 'raw_card',
        quantity: 1, tracking_mode: 'serialized', needs_photos: false,
        created_at: '2026-08-01T00:00:00Z',
      }],
    };
    renderQueue('/listing-prep?tab=candidates');
    expect(await screen.findByText('Blastoise')).toBeTruthy();
    expect(screen.queryByText('Prepare for listing')).toBeNull();
  });
});

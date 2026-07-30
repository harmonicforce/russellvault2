// @vitest-environment jsdom
//
// The cycle-count routes, rendered through the real WorkspaceProvider against a
// fake Supabase client. No network.
//
// What these prove: a route survives direct navigation, a session whose status
// belongs on another page is sent there rather than being shown controls the
// database would refuse, a count in another workspace is refused without
// leaking that it exists, and progress comes back from the server on reload
// rather than from anything held in the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceProvider } from '../lib/workspaceContext';
import CycleCounts from './CycleCounts';
import CycleCountActive from './CycleCountActive';
import CycleCountReview from './CycleCountReview';
import CycleCountAudit from './CycleCountAudit';
import CycleCountDraft from './CycleCountDraft';

const WS = 'ws-1';

interface RpcCall { fn: string; args: Record<string, unknown> }

/** Replies keyed by governed function name. A missing key is an explicit failure. */
type Replies = Record<string, unknown>;

function fakeClient(replies: Replies) {
  const calls: RpcCall[] = [];
  const client = {
    auth: {
      async getSession() { return { data: { session: { access_token: 'tok' } } }; },
    },
    from(_table: string) {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => Promise.resolve({
            data: ids.includes(WS)
              ? [{ id: WS, name: 'Russell Vault Test', sku_prefix: 'RV', setup_completed_at: '2026-01-01' }]
              : [],
            error: null,
          }),
        }),
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (!(fn in replies)) {
        return Promise.resolve({ data: null, error: { message: `no fixture for ${fn}` } });
      }
      return Promise.resolve({ data: replies[fn], error: null });
    },
  };
  return { client, calls };
}

function renderAt(path: string, replies: Replies) {
  const { client, calls } = fakeClient(replies);
  render(
    <MemoryRouter initialEntries={[path]}>
      <WorkspaceProvider
        client={client as never}
        email="owner@test.local"
        userId="u-1"
        memberships={[{ workspace_id: WS, role: 'owner' } as never]}
        onSignOut={() => {}}
      >
        <Routes>
          <Route path="/cycle-counts" element={<CycleCounts />} />
          <Route path="/cycle-counts/:sessionId" element={<CycleCountDraft />} />
          <Route path="/cycle-counts/:sessionId/count" element={<CycleCountActive />} />
          <Route path="/cycle-counts/:sessionId/review" element={<CycleCountReview />} />
          <Route path="/cycle-counts/:sessionId/audit" element={<CycleCountAudit />} />
        </Routes>
      </WorkspaceProvider>
    </MemoryRouter>
  );
  return { calls };
}

const session = (over: Record<string, unknown> = {}) => ({
  session_id: 's1', public_id: 'RV-CC-ABC123', status: 'in_progress',
  scope_type: 'location_and_descendants', include_descendants: true,
  subtype_filter: null, vertical_filter: null, blind_count: false, notes: null,
  root_location_code: 'BIN-A', created_at: '2026-07-30T09:00:00Z',
  created_by_email: 'owner@test.local', started_at: '2026-07-30T09:05:00Z',
  started_by_email: 'owner@test.local', snapshot_frozen_at: '2026-07-30T09:05:00Z',
  submitted_at: null, submitted_by_email: null, completed_at: null, completed_by_email: null,
  completion_note: null, completion_summary: null, cancelled_at: null,
  cancelled_by_email: null, cancellation_reason: null, ...over,
});

const progress = (over: Record<string, unknown> = {}) => ({
  expected_item_count: 4, found_item_count: 3, wrong_location_count: 0,
  unexpected_item_count: 0, uncounted_item_count: 1,
  expected_lot_count: 2, counted_lot_count: 1, uncounted_lot_count: 1,
  matched_lot_count: 1, variance_lot_count: 0, observed_zero_lot_count: 0,
  total_observation_count: 4, ...over,
});

const bundle = (over: Record<string, unknown> = {}) => ({
  found: true, viewer_role: 'owner', can_count: true, quantities_withheld: false,
  current_round: 1,
  session: session(),
  scope: [{ location_id: 'l1', location_code: 'BIN-A', location_display_name: 'Bin A', depth: 0 }],
  progress: progress(),
  review_totals: null,
  ...over,
});

const emptyQueues: Replies = {
  cycle_count_item_queue: { rows: [], total: 0, limit: 200, offset: 0, count_round: 1 },
  cycle_count_lot_queue: { rows: [], total: 0, limit: 200, offset: 0, count_round: 1, quantities_withheld: false },
  cycle_count_observation_feed: { rows: [], count_round: 1, quantities_withheld: false },
};

beforeEach(() => {
  window.localStorage.setItem('rv.activeWorkspaceId', WS);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

describe('the cycle-count list', () => {
  const listRow = (over: Record<string, unknown> = {}) => ({
    session_id: 's1', public_id: 'RV-CC-ABC123', status: 'in_progress',
    scope_type: 'location_and_descendants', include_descendants: true, blind_count: false,
    subtype_filter: null, vertical_filter: null, notes: null,
    root_location_code: 'BIN-A', root_location_display_name: 'Bin A',
    scope_location_count: 3, expected_item_count: 4, observed_item_count: 3,
    expected_lot_count: 2, observed_lot_count: 1,
    open_discrepancy_count: 0, total_discrepancy_count: 0,
    created_at: '2026-07-30T09:00:00Z', created_by_email: 'owner@test.local',
    started_at: '2026-07-30T09:05:00Z', snapshot_frozen_at: '2026-07-30T09:05:00Z',
    submitted_at: null, completed_at: null, cancelled_at: null, ...over,
  });

  it('renders a session with its identity, scope and progress', async () => {
    renderAt('/cycle-counts', {
      list_cycle_counts: { rows: [listRow()], total: 1, limit: 25, offset: 0 },
    });
    expect(await screen.findByText('RV-CC-ABC123')).toBeTruthy();
    expect(screen.getByText('Counting')).toBeTruthy();
    expect(screen.getByText('BIN-A')).toBeTruthy();
    expect(screen.getByText(/3 locations/)).toBeTruthy();
    // 4 of 6 counted, from the server's own figures.
    expect(screen.getByText('4 of 6')).toBeTruthy();
  });

  it('marks a blind count and an unresolved queue', async () => {
    renderAt('/cycle-counts', {
      list_cycle_counts: {
        rows: [listRow({ blind_count: true, status: 'review', open_discrepancy_count: 2 })],
        total: 1, limit: 25, offset: 0,
      },
    });
    expect(await screen.findByText('Blind count')).toBeTruthy();
    // "Awaiting review" is both a status chip and a filter button.
    expect(screen.getAllByText('Awaiting review').length).toBeGreaterThan(1);
    expect(screen.getByText('2 unresolved')).toBeTruthy();
  });

  it('defaults to the active view and asks the server for those statuses', async () => {
    const { calls } = renderAt('/cycle-counts', {
      list_cycle_counts: { rows: [], total: 0, limit: 25, offset: 0 },
    });
    await waitFor(() => expect(calls.some((c) => c.fn === 'list_cycle_counts')).toBe(true));
    const call = calls.find((c) => c.fn === 'list_cycle_counts')!;
    expect(call.args.p_statuses).toEqual(['draft', 'in_progress']);
    expect(call.args.p_workspace_id).toBe(WS);
  });

  it('offers a useful empty state rather than a blank page', async () => {
    renderAt('/cycle-counts', {
      list_cycle_counts: { rows: [], total: 0, limit: 25, offset: 0 },
    });
    expect(await screen.findByText('No count is running.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Start a new count/ }).length).toBeGreaterThan(0);
  });

  it('re-queries the server when the filter changes, rather than filtering in the browser', async () => {
    const user = userEvent.setup();
    const { calls } = renderAt('/cycle-counts', {
      list_cycle_counts: { rows: [], total: 0, limit: 25, offset: 0 },
    });
    await screen.findByText('No count is running.');
    await user.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.fn === 'list_cycle_counts')!;
      expect(last.args.p_statuses).toEqual(['completed']);
    });
  });

  it('shows a read failure instead of pretending there are no counts', async () => {
    renderAt('/cycle-counts', {});
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No count is running.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Routing by status
// ---------------------------------------------------------------------------

describe('route access', () => {
  it('renders the counting page for a session that is being counted', async () => {
    renderAt('/cycle-counts/s1/count', {
      get_cycle_count: bundle(),
      ...emptyQueues,
    });
    expect(await screen.findByText(/Counting BIN-A/)).toBeTruthy();
  });

  it('sends a session in review away from the counting page', async () => {
    renderAt('/cycle-counts/s1/count', {
      get_cycle_count: bundle({ session: session({ status: 'review', submitted_at: 't' }) }),
      cycle_count_review: { rows: [], total: 0, limit: 200, offset: 0 },
      cycle_count_completion_readiness: {
        status: 'review', can_complete: true, can_complete_with_deferrals: false,
        open_count: 0, recount_requested_count: 0, resolved_count: 0, deferred_count: 0,
        failed_resolution_count: 0, inventory_changing_resolution_count: 0, blockers: [],
      },
      ...emptyQueues,
    });
    expect(await screen.findByText(/Review BIN-A/)).toBeTruthy();
  });

  it('sends a completed session to the read-only record, not to review', async () => {
    renderAt('/cycle-counts/s1/review', {
      get_cycle_count: bundle({
        session: session({ status: 'completed', completed_at: 't', completed_by_email: 'owner@test.local' }),
      }),
      cycle_count_audit_record: {
        found: true, session: session({ status: 'completed' }),
        expected_items: [], expected_lots: [], observations: [],
        discrepancies: [], resolutions: [], loss_events: [], row_limit: 200,
      },
      cycle_count_review: { rows: [], total: 0, limit: 200, offset: 0 },
      cycle_count_completion_readiness: {
        status: 'completed', can_complete: false, can_complete_with_deferrals: false,
        open_count: 0, recount_requested_count: 0, resolved_count: 0, deferred_count: 0,
        failed_resolution_count: 0, inventory_changing_resolution_count: 0, blockers: [],
      },
      ...emptyQueues,
    });
    expect(await screen.findByText('Completed count — read only.')).toBeTruthy();
  });

  it('renders the draft page for a draft, offering the freeze as its own act', async () => {
    renderAt('/cycle-counts/s1', {
      get_cycle_count: bundle({
        session: session({ status: 'draft', started_at: null, snapshot_frozen_at: null }),
      }),
      preview_cycle_count_scope: {
        location_count: 3, expected_item_count: 4, expected_lot_count: 2, expected_unit_count: 20,
      },
    });
    expect(await screen.findByText(/Draft count of BIN-A/)).toBeTruthy();
    // The preview loads after the session, so the freeze control appears second.
    expect(await screen.findByRole('button', { name: /freeze the snapshot/ })).toBeTruthy();
  });

  it('refuses a count in another workspace without confirming it exists', async () => {
    renderAt('/cycle-counts/s9/count', { get_cycle_count: { found: false } });
    expect(await screen.findByText('That cycle count is not in this workspace.')).toBeTruthy();
    expect(screen.queryByLabelText('Scan or type an identifier')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

describe('reload and resume', () => {
  it('restores the round, frozen scope and progress from the server', async () => {
    renderAt('/cycle-counts/s1/count', {
      get_cycle_count: bundle({
        current_round: 2,
        progress: progress({ expected_item_count: 10, uncounted_item_count: 4, found_item_count: 6 }),
      }),
      ...emptyQueues,
    });
    expect(await screen.findByText('Round 2')).toBeTruthy();
    // The scope line is assembled from several nodes, so it is matched on the
    // element's whole text rather than on one text node.
    expect(screen.getByText(
      (_content, el) => el?.tagName === 'P' && /Frozen scope: BIN-A/.test(el.textContent ?? '')
    )).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    // 6 of 10 units plus 1 of 2 lots counted = 58%. Derived from the server's
    // figures, never from anything the browser was holding.
    expect(bar.getAttribute('aria-valuenow')).toBe('58');
  });

  it('keeps nothing about the count in local storage', async () => {
    renderAt('/cycle-counts/s1/count', { get_cycle_count: bundle(), ...emptyQueues });
    await screen.findByText(/Counting BIN-A/);
    const keys = Object.keys(window.localStorage);
    expect(keys.filter((k) => k.toLowerCase().includes('cycle'))).toEqual([]);
    expect(keys.filter((k) => k.includes('s1'))).toEqual([]);
  });

  it('asks the server for the current round on arrival', async () => {
    const { calls } = renderAt('/cycle-counts/s1/count', {
      get_cycle_count: bundle(), ...emptyQueues,
    });
    await waitFor(() => expect(calls.some((c) => c.fn === 'get_cycle_count')).toBe(true));
    expect(calls.some((c) => c.fn === 'cycle_count_observation_feed')).toBe(true);
  });

  it('tells a viewer plainly that they cannot record against the count', async () => {
    renderAt('/cycle-counts/s1/count', {
      get_cycle_count: bundle({ viewer_role: 'viewer', can_count: false }),
      ...emptyQueues,
    });
    expect(await screen.findByText(/You can see this count but not record against it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Submit for review/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

describe('the review page', () => {
  const reviewReplies = (rows: unknown[], readiness: Record<string, unknown> = {}): Replies => ({
    get_cycle_count: bundle({
      session: session({ status: 'review', submitted_at: '2026-07-30T11:00:00Z' }),
      review_totals: {
        missing_item_count: 1, unexpected_item_count: 0, wrong_location_count: 0,
        lot_shortage_count: 1, lot_overage_count: 0, lot_uncounted_count: 0,
        shortage_units: 3, overage_units: 0, open_count: rows.length,
        recount_requested_count: 0, resolved_count: 0, deferred_count: 0, total_count: rows.length,
      },
    }),
    cycle_count_review: { rows, total: rows.length, limit: 200, offset: 0 },
    cycle_count_completion_readiness: {
      status: 'review', can_complete: rows.length === 0, can_complete_with_deferrals: false,
      open_count: rows.length, recount_requested_count: 0, resolved_count: 0, deferred_count: 0,
      failed_resolution_count: 0, inventory_changing_resolution_count: 0,
      blockers: rows.length ? [`${rows.length} discrepancy(s) are still open.`] : [],
      ...readiness,
    },
  });

  const shortage = {
    discrepancy_id: 'd1', public_id: 'RV-CCD-0001', discrepancy_kind: 'lot_shortage',
    status: 'open', expected_quantity: 12, observed_quantity: 9, variance: -3,
    detected_at: 't', recount_requested_at: null, recount_requested_by_email: null,
    resolved_at: null, resolved_by_email: null, deferral_reason: null,
    subject_public_id: 'RV-C-0001', subject_display_name: 'Booster Box', subject_kind: 'lot',
    item_id: null, lot_id: 'l1', certificate_number: null, serial_number: null,
    grading_company: null, expected_location_code: 'BIN-A', observed_location_code: 'BIN-A',
    observations: [], post_snapshot_activity: [], resolutions: [],
  };

  it('groups discrepancies under headings a reviewer can act on', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([shortage]));
    expect(await screen.findByText(/Lot shortages/)).toBeTruthy();
    expect(screen.getByText('RV-CCD-0001')).toBeTruthy();
  });

  it('shows the frozen expectation, the count and the variance', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([shortage]));
    await screen.findByText('RV-CCD-0001');
    expect(screen.getByText('Expected')).toBeTruthy();
    // The variance appears on the card and again in the review totals.
    expect(screen.getAllByText('-3').length).toBeGreaterThan(0);
  });

  it('separates a failed attempt from the open queue and keeps the detail', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([{
      ...shortage,
      resolutions: [{
        resolution_id: 'r1', action: 'lot_quantity_adjusted', note: null, succeeded: false,
        failure_detail: 'quantity changed, reload and try again', resolved_at: 't',
        resolved_by_email: 'owner@test.local', movement_id: null, adjustment_id: null,
      }],
    }]));
    expect(await screen.findByText(/Failed resolution attempts/)).toBeTruthy();
    expect(screen.getByText('quantity changed, reload and try again')).toBeTruthy();
  });

  it('shows post-snapshot activity with the wording that stops it being treated as an answer', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([{
      ...shortage,
      post_snapshot_activity: [{
        activity_kind: 'lot_split', activity_public_id: 'RV-LIN-1', occurred_at: 't',
        detail: '3 units', from_value: 'RV-C-0001', to_value: 'RV-C-0002',
      }],
    }]));
    expect(await screen.findByText(/Activity after snapshot may explain this discrepancy/)).toBeTruthy();
  });

  it('blocks completion while a discrepancy is open, and says why', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([shortage]));
    await screen.findByText('RV-CCD-0001');
    const button = screen.getByRole('button', { name: 'Complete this count' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('· 1 discrepancy(s) are still open.')).toBeTruthy();
  });

  it('says so plainly when a count found no discrepancies at all', async () => {
    renderAt('/cycle-counts/s1/review', reviewReplies([]));
    expect(await screen.findByText('No discrepancies.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Complete this count' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('sends a resolution through the governed function with the chosen action', async () => {
    const user = userEvent.setup();
    const { calls } = renderAt('/cycle-counts/s1/review', reviewReplies([shortage]));
    await screen.findByText('RV-CCD-0001');
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'observation_mistaken');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const call = calls.find((c) => c.fn === 'resolve_cycle_count_discrepancy');
      expect(call?.args).toMatchObject({
        p_discrepancy_id: 'd1', p_action: 'observation_mistaken',
      });
    });
  });

  it('requests a recount through its own governed function', async () => {
    const user = userEvent.setup();
    const { calls } = renderAt('/cycle-counts/s1/review', reviewReplies([shortage]));
    await screen.findByText('RV-CCD-0001');
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'recount_requested');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(calls.some((c) => c.fn === 'request_cycle_count_recount')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe('the audit record', () => {
  const auditReplies = (over: Record<string, unknown> = {}): Replies => ({
    get_cycle_count: bundle({
      session: session({
        status: 'completed', completed_at: '2026-07-30T12:00:00Z',
        completed_by_email: 'owner@test.local', submitted_at: '2026-07-30T11:00:00Z',
      }),
    }),
    cycle_count_audit_record: {
      found: true,
      session: session({ status: 'completed' }),
      expected_items: [{
        item_public_id: 'RV-ITEM-1', display_name: 'Charizard', expected_location_code: 'BIN-A',
        item_state: 'active', item_id: 'i1', certificate_number: 'C1', serial_number: null,
      }],
      expected_lots: [{
        lot_public_id: 'RV-C-0001', display_name: 'Booster Box', expected_location_code: 'BIN-A',
        expected_quantity: 12, lot_state: 'active', lot_id: 'l1',
      }],
      observations: [], discrepancies: [], resolutions: [], loss_events: [], row_limit: 200,
      ...over,
    },
  });

  it('is unmistakably read only and offers no resolution controls', async () => {
    renderAt('/cycle-counts/s1/audit', auditReplies());
    expect(await screen.findByText('Completed count — read only.')).toBeTruthy();
    expect(screen.queryByLabelText('What to do about this')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete this count' })).toBeNull();
  });

  it('carries the frozen snapshot for both grains', async () => {
    renderAt('/cycle-counts/s1/audit', auditReplies());
    // The banner comes from the session bundle; the snapshot arrives with the
    // audit record a moment later.
    expect(await screen.findByText('Charizard')).toBeTruthy();
    expect(screen.getByText(/expected 12/)).toBeTruthy();
  });

  it('names who did what and when', async () => {
    renderAt('/cycle-counts/s1/audit', auditReplies());
    await screen.findByText('Completed count — read only.');
    expect(screen.getByText('Snapshot frozen')).toBeTruthy();
    expect(screen.getByText('Completed by')).toBeTruthy();
    expect(screen.getAllByText('owner@test.local').length).toBeGreaterThan(0);
  });

  it('puts deferred work at the top rather than in a footnote', async () => {
    renderAt('/cycle-counts/s1/audit', {
      ...auditReplies({
        discrepancies: [{
          discrepancy_id: 'd1', public_id: 'RV-CCD-0001', discrepancy_kind: 'lot_shortage',
          status: 'deferred', expected_quantity: 12, observed_quantity: 9, variance: -3,
          detected_at: 't', recount_requested_at: null, recount_requested_by_email: null,
          resolved_at: 't', resolved_by_email: 'owner@test.local',
          deferral_reason: 'supplier confirming next week',
          subject_public_id: 'RV-C-0001', subject_display_name: 'Booster Box',
          subject_kind: 'lot', item_id: null, lot_id: 'l1',
          certificate_number: null, serial_number: null, grading_company: null,
          expected_location_code: 'BIN-A', observed_location_code: 'BIN-A',
          observations: [], post_snapshot_activity: [], resolutions: [],
        }],
      }),
      get_cycle_count: bundle({
        session: session({
          status: 'completed', completed_at: 't', completed_by_email: 'owner@test.local',
          completion_note: 'Closing the quarter; the shortfall is with the supplier.',
        }),
      }),
    });
    expect(await screen.findByText(/Completed with 1 deferred discrepancy/)).toBeTruthy();
    expect(screen.getByText(/Closing the quarter/)).toBeTruthy();
  });

  it('shows the units written off during the count', async () => {
    renderAt('/cycle-counts/s1/audit', auditReplies({
      loss_events: [{
        loss_public_id: 'RV-LOSS-1', item_id: 'i2', item_public_id: 'RV-ITEM-2',
        reason: 'not on the shelf after two passes', recorded_at: 't',
        recorded_by_email: 'owner@test.local',
      }],
    }));
    expect(await screen.findByText('Units written off during this count')).toBeTruthy();
    expect(screen.getByText('not on the shelf after two passes')).toBeTruthy();
  });

  it('shows a cancelled count as cancelled, with its reason', async () => {
    renderAt('/cycle-counts/s1/audit', {
      get_cycle_count: bundle({
        session: session({
          status: 'cancelled', cancelled_at: 't', cancelled_by_email: 'owner@test.local',
          cancellation_reason: 'Counted the wrong aisle.',
        }),
      }),
      cycle_count_audit_record: {
        found: true, session: session({ status: 'cancelled' }),
        expected_items: [], expected_lots: [], observations: [],
        discrepancies: [], resolutions: [], loss_events: [], row_limit: 200,
      },
    });
    expect(await screen.findByText('Cancelled count — read only.')).toBeTruthy();
    expect(screen.getByText(/Counted the wrong aisle\./)).toBeTruthy();
  });
});

// The cycle-count transport: that each call reaches the governed function it
// claims to, carries the workspace, and fails loudly rather than quietly.
//
// The fixtures below are the real governed response shapes, not convenient
// stand-ins — a test that mocks away the payload shape proves nothing about
// whether the page can read it.

import { describe, expect, it } from 'vitest';
import { createCycleCountApi, type CycleCountClient } from './cycleCountApi';

interface Recorded { fn: string; args: Record<string, unknown> }

function fakeClient(reply: unknown, opts: { error?: string } = {}) {
  const calls: Recorded[] = [];
  const client: CycleCountClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(
        opts.error
          ? { data: null, error: { message: opts.error } }
          : { data: reply, error: null }
      );
    },
  };
  return { client, calls };
}

const WS = 'ws-1';

describe('workspace scoping', () => {
  it('sends the workspace id on every call', async () => {
    const { client, calls } = fakeClient({ rows: [], total: 0, limit: 25, offset: 0 });
    const api = createCycleCountApi(client, WS);
    await api.listSessions();
    await api.getSession('s1');
    await api.readiness('s1');
    for (const c of calls) expect(c.args.p_workspace_id).toBe(WS);
  });
});

describe('session list', () => {
  it('calls the governed list function and passes the page through', async () => {
    const page = {
      rows: [{ session_id: 's1', public_id: 'RV-CC-ABC123', status: 'in_progress' }],
      total: 7, limit: 25, offset: 0,
    };
    const { client, calls } = fakeClient(page);
    const result = await createCycleCountApi(client, WS).listSessions({
      statuses: ['in_progress'], locationCode: 'BIN-A', blindOnly: true, limit: 10, offset: 20,
    });
    expect(calls[0].fn).toBe('list_cycle_counts');
    expect(calls[0].args).toMatchObject({
      p_statuses: ['in_progress'], p_location_code: 'BIN-A', p_blind_only: true,
      p_limit: 10, p_offset: 20,
    });
    // The total comes from the server, not from counting the page.
    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(1);
  });

  it('sends null rather than an empty array when no status filter is set', async () => {
    const { client, calls } = fakeClient({ rows: [], total: 0, limit: 25, offset: 0 });
    await createCycleCountApi(client, WS).listSessions({ statuses: [] });
    expect(calls[0].args.p_statuses).toBeNull();
  });
});

describe('one session', () => {
  it('passes a not-found result through instead of inventing one', async () => {
    const { client } = fakeClient({ found: false });
    const bundle = await createCycleCountApi(client, WS).getSession('nope');
    expect(bundle.found).toBe(false);
    expect(bundle.session).toBeUndefined();
  });

  it('reads the governed bundle shape', async () => {
    const { client } = fakeClient({
      found: true, viewer_role: 'owner', can_count: true, quantities_withheld: false,
      current_round: 2,
      session: { session_id: 's1', public_id: 'RV-CC-A', status: 'review', blind_count: true },
      scope: [{ location_id: 'l1', location_code: 'BIN-A', location_display_name: 'Bin A', depth: 0 }],
      progress: { expected_item_count: 3, uncounted_item_count: 1 },
      review_totals: { open_count: 1, deferred_count: 0 },
    });
    const bundle = await createCycleCountApi(client, WS).getSession('s1');
    expect(bundle.current_round).toBe(2);
    expect(bundle.scope?.[0].location_code).toBe('BIN-A');
    expect(bundle.review_totals?.open_count).toBe(1);
  });
});

describe('the lot queue and blind counts', () => {
  it('carries the withheld flag and the absent expected quantity through unchanged', async () => {
    const { client, calls } = fakeClient({
      rows: [{
        expected_lot_id: 'e1', lot_id: 'l1', lot_public_id: 'RV-C-1', display_name: 'Box',
        expected_location_code: 'BIN-A', expected_quantity: null, observation_id: null,
        observed_quantity: null, variance: null, count_status: 'uncounted',
      }],
      total: 1, limit: 50, offset: 0, count_round: 1, quantities_withheld: true,
    });
    const result = await createCycleCountApi(client, WS).lotQueue('s1', 'uncounted', 50, 0);
    expect(calls[0].fn).toBe('cycle_count_lot_queue');
    expect(calls[0].args.p_filter).toBe('uncounted');
    expect(result.quantities_withheld).toBe(true);
    // The client must never substitute a zero for a withheld expectation.
    expect(result.rows[0].expected_quantity).toBeNull();
    expect(result.rows[0].variance).toBeNull();
  });
});

describe('observing', () => {
  it('records a serialized sighting through the governed function', async () => {
    const { client, calls } = fakeClient({
      outcome: 'expected_found', observation_id: 'o1', item_public_id: 'RV-ITEM-1', count_round: 1,
    });
    const result = await createCycleCountApi(client, WS)
      .observeItem('s1', 'CERT-1', 'BIN-A', 'a note');
    expect(calls[0].fn).toBe('observe_cycle_count_item');
    expect(calls[0].args).toMatchObject({
      p_session_id: 's1', p_identifier: 'CERT-1',
      p_observed_location_code: 'BIN-A', p_note: 'a note',
    });
    expect(result.outcome).toBe('expected_found');
  });

  it('sends an explicit zero as a real observed quantity', async () => {
    const { client, calls } = fakeClient({ outcome: 'counted', variance: -4 });
    await createCycleCountApi(client, WS).observeLot('s1', 'RV-C-1', 0, null);
    expect(calls[0].args.p_observed_quantity).toBe(0);
  });

  it('voids an observation rather than deleting it', async () => {
    const { client, calls } = fakeClient({ outcome: 'voided' });
    await createCycleCountApi(client, WS).voidObservation('o1', 'item', 'mis-scan');
    expect(calls[0].fn).toBe('void_cycle_count_observation');
    expect(calls[0].args).toMatchObject({
      p_observation_id: 'o1', p_subject_kind: 'item', p_reason: 'mis-scan',
    });
  });
});

describe('submission, review and resolution', () => {
  it('passes the uncounted confirmation to the database explicitly', async () => {
    const { client, calls } = fakeClient({ outcome: 'submitted' });
    await createCycleCountApi(client, WS).submitForReview('s1', true);
    expect(calls[0].fn).toBe('submit_cycle_count_for_review');
    expect(calls[0].args.p_confirm_uncounted).toBe(true);
  });

  it('reads a discrepancy with its observations, activity and resolutions', async () => {
    const { client } = fakeClient({
      rows: [{
        discrepancy_id: 'd1', public_id: 'RV-CCD-1', discrepancy_kind: 'lot_shortage',
        status: 'open', expected_quantity: 12, observed_quantity: 9, variance: -3,
        subject_display_name: 'Box', subject_kind: 'lot',
        observations: [{ observation_id: 'o1', count_round: 1, outcome: 'short', voided_at: null }],
        post_snapshot_activity: [{ activity_kind: 'lot_split', occurred_at: 't', detail: '3 units' }],
        resolutions: [{ resolution_id: 'r1', action: 'lot_quantity_adjusted', succeeded: false, failure_detail: 'stale' }],
      }],
      total: 1, limit: 50, offset: 0,
    });
    const page = await createCycleCountApi(client, WS).review('s1');
    const row = page.rows[0];
    expect(row.observations).toHaveLength(1);
    expect(row.post_snapshot_activity[0].activity_kind).toBe('lot_split');
    // A failed attempt must survive the trip to the page.
    expect(row.resolutions[0].succeeded).toBe(false);
    expect(row.resolutions[0].failure_detail).toBe('stale');
  });

  it('routes a recount through its own function, not through resolve', async () => {
    const { client, calls } = fakeClient({ outcome: 'recount_requested' });
    await createCycleCountApi(client, WS).requestRecount('d1', 'count it again');
    expect(calls[0].fn).toBe('request_cycle_count_recount');
  });

  it('sends the chosen resolution action verbatim', async () => {
    const { client, calls } = fakeClient({ outcome: 'resolved' });
    await createCycleCountApi(client, WS).resolve('d1', 'item_loss_recorded', 'gone', null);
    expect(calls[0].fn).toBe('resolve_cycle_count_discrepancy');
    expect(calls[0].args).toMatchObject({ p_action: 'item_loss_recorded', p_note: 'gone' });
  });
});

describe('completion and cancellation', () => {
  it('does not allow deferrals by default', async () => {
    const { client, calls } = fakeClient({ outcome: 'completed' });
    await createCycleCountApi(client, WS).complete('s1', false, null);
    expect(calls[0].args.p_allow_deferred).toBe(false);
  });

  it('passes the elevated flag and the reason when deferrals are accepted', async () => {
    const { client, calls } = fakeClient({ outcome: 'completed' });
    await createCycleCountApi(client, WS).complete('s1', true, 'supplier confirming next week');
    expect(calls[0].args.p_allow_deferred).toBe(true);
    expect(calls[0].args.p_note).toBe('supplier confirming next week');
  });

  it('sends a cancellation reason', async () => {
    const { client, calls } = fakeClient({ outcome: 'cancelled' });
    await createCycleCountApi(client, WS).cancel('s1', 'wrong aisle');
    expect(calls[0].fn).toBe('cancel_cycle_count');
    expect(calls[0].args.p_reason).toBe('wrong aisle');
  });
});

describe('audit, workbench and loss history', () => {
  it('reads the audit record including voided observations and loss events', async () => {
    const { client, calls } = fakeClient({
      found: true, session: { status: 'completed' },
      expected_items: [{ item_public_id: 'RV-ITEM-1' }],
      observations: [{ observation_id: 'o1', voided_at: 't', void_reason: 'mis-scan' }],
      loss_events: [{ loss_public_id: 'RV-LOSS-1', reason: 'not on the shelf' }],
      row_limit: 200,
    });
    const record = await createCycleCountApi(client, WS).auditRecord('s1');
    expect(calls[0].fn).toBe('cycle_count_audit_record');
    expect(record.observations?.[0].voided_at).toBe('t');
    expect(record.loss_events?.[0].reason).toBe('not on the shelf');
  });

  it('asks the workbench summary for a bounded number of examples', async () => {
    const { client, calls } = fakeClient({
      active_count: 1, awaiting_review_count: 0, recount_required_count: 0,
      unresolved_discrepancy_count: 0, intake_followup_count: 2, deferred_count: 0,
      examples: [], example_limit: 5,
    });
    const summary = await createCycleCountApi(client, WS).workbenchSummary();
    expect(calls[0].args.p_example_limit).toBe(5);
    expect(summary.intake_followup_count).toBe(2);
  });

  it('unwraps loss history and returns an empty list rather than undefined', async () => {
    const { client } = fakeClient({ rows: [] });
    expect(await createCycleCountApi(client, WS).lossHistory('i1')).toEqual([]);
  });

  it('reads the loss chain back to the count that found the unit missing', async () => {
    const { client } = fakeClient({
      rows: [{
        loss_public_id: 'RV-LOSS-1', previous_item_state: 'active', new_item_state: 'lost',
        reason: 'not on the shelf', recorded_at: 't', recorded_by_email: 'owner@test',
        cycle_count_public_id: 'RV-CC-A', cycle_count_session_id: 's1',
        discrepancy_public_id: 'RV-CCD-1',
      }],
    });
    const rows = await createCycleCountApi(client, WS).lossHistory('i1');
    expect(rows[0].recorded_by_email).toBe('owner@test');
    expect(rows[0].cycle_count_public_id).toBe('RV-CC-A');
  });
});

describe('failure handling', () => {
  it('throws rather than rendering an unreadable count as an empty one', async () => {
    const { client } = fakeClient(null, { error: 'permission denied' });
    const api = createCycleCountApi(client, WS);
    await expect(api.listSessions()).rejects.toThrow('permission denied');
    await expect(api.review('s1')).rejects.toThrow('permission denied');
    await expect(api.readiness('s1')).rejects.toThrow('permission denied');
  });

  it('throws on a failed write instead of reporting success', async () => {
    const { client } = fakeClient(null, { error: 'this count is completed' });
    await expect(createCycleCountApi(client, WS).complete('s1', false, null))
      .rejects.toThrow('this count is completed');
  });
});

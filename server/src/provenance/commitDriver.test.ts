// Phase 3 commit-driver tests.
//
// Proves the end-to-end persistence path drives the governed RPCs in the right
// ORDER, in bounded BATCHES, with the idempotency key carried through, and that
// a failure anywhere marks the job failed rather than leaving it committed.
//
// A recording fake stands in for the shadow database so the sequence of calls
// is directly observable. The database's own enforcement of the same rules is
// covered by supabase/tests/10_provenance_workflow.sql.

import { describe, it, expect } from 'vitest';
import {
  commitImportPlan,
  CommitError,
  RECORD_BATCH_SIZE,
} from './commitDriver.js';
import { buildImportPlan } from './adapter.js';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SYS = '55555555-5555-5555-5555-555555555555';

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

function makeRecordingClient(
  overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}
) {
  const calls: Call[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (overrides[fn]) {
        try {
          return { data: overrides[fn](args), error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      }
      switch (fn) {
        case 'begin_import_job':
          return { data: { id: 'job-1', status: 'preview', resumed: false }, error: null };
        case 'stage_source_records':
          return {
            data: {
              batch: (args.p_records as unknown[]).length,
              inserted: (args.p_records as unknown[]).length,
              staged_total: 0,
            },
            error: null,
          };
        case 'stage_external_identifiers':
          return { data: { inserted: (args.p_identifiers as unknown[]).length }, error: null };
        case 'stage_import_derivatives':
          return { data: { issues: 1, crosswalks: 3, skipped: false }, error: null };
        case 'finalize_import_job':
          return {
            data: {
              id: 'job-1',
              status: 'committed',
              source_rows: args.p_expected_source_rows,
              accepted_rows: args.p_expected_accepted_rows,
              issue_rows: args.p_expected_issue_rows,
              issues: 1,
              crosswalks: args.p_expected_crosswalks,
              external_identifiers: 2149,
            },
            error: null,
          };
        case 'fail_import_job':
          return { data: 'job-1', error: null };
        default:
          return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
    },
  };
  return { client, calls };
}

function commitPlan(filename: string, key = 'commit-key-0001') {
  return buildImportPlan({ filename, mode: 'commit', idempotencyKey: key });
}

describe('the 2,149-row fixture commits in bounded batches', () => {
  it('stages every raw row without one oversized payload', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();

    const outcome = await commitImportPlan(client as never, WS, SYS, plan);

    const recordCalls = calls.filter((c) => c.fn === 'stage_source_records');
    const staged = recordCalls.reduce(
      (n, c) => n + (c.args.p_records as unknown[]).length,
      0
    );

    expect(staged).toBe(2149);
    expect(recordCalls.length).toBe(Math.ceil(2149 / RECORD_BATCH_SIZE));
    // No single RPC argument is ever large.
    for (const c of recordCalls) {
      expect((c.args.p_records as unknown[]).length).toBeLessThanOrEqual(RECORD_BATCH_SIZE);
    }
    expect(outcome.status).toBe('committed');
    expect(outcome.sourceRows).toBe(2149);
  });

  it('carries the exact raw payloads through unmodified', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const first = (calls.find((c) => c.fn === 'stage_source_records')!
      .args.p_records as Array<Record<string, unknown>>)[0];

    expect(first.source_row_index).toBe(0);
    expect(first.source_row_key).toBe('WN-A-000001');
    expect((first.raw_payload as Record<string, unknown>).acquisition_line_id).toBe(
      'WN-A-000001'
    );
    expect((first.raw_payload as Record<string, unknown>).order_id).toBe(
      'mKsPQvjaxGowpfFB3tP6zU'
    );
  });

  it('derives scoped external identifiers from source row keys', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const idCalls = calls.filter((c) => c.fn === 'stage_external_identifiers');
    const ids = idCalls.flatMap((c) => c.args.p_identifiers as Array<Record<string, unknown>>);

    expect(ids.length).toBe(2149);
    expect(ids[0].scope).toBe('fixture.whatnot_purchases');
    expect(ids[0].identifier_type).toBe('source_row_key');
    expect(ids[0].identifier_value).toBe('WN-A-000001');
  });
});

describe('ordering: raw rows are written before anything derived', () => {
  it('stages every source record before identifiers, derivatives, or finalize', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const order = calls.map((c) => c.fn);
    const lastRecord = order.lastIndexOf('stage_source_records');
    const firstIdentifier = order.indexOf('stage_external_identifiers');
    const derivatives = order.indexOf('stage_import_derivatives');
    const finalize = order.indexOf('finalize_import_job');

    expect(order[0]).toBe('begin_import_job');
    expect(lastRecord).toBeLessThan(firstIdentifier);
    expect(firstIdentifier).toBeLessThan(derivatives);
    expect(derivatives).toBeLessThan(finalize);
    expect(finalize).toBe(order.length - 1);
  });

  it('never sends a review_state for a crosswalk', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const crosswalks = calls.find((c) => c.fn === 'stage_import_derivatives')!
      .args.p_crosswalks as Array<Record<string, unknown>>;

    expect(crosswalks.length).toBeGreaterThan(0);
    for (const c of crosswalks) {
      expect(c).not.toHaveProperty('review_state');
      expect(c).not.toHaveProperty('reviewed_by');
    }
  });
});

describe('idempotency', () => {
  it('refuses a plan that is not a commit plan', async () => {
    const preview = buildImportPlan({ filename: 'checks.json', mode: 'preview' });
    const { client } = makeRecordingClient();
    await expect(commitImportPlan(client as never, WS, SYS, preview)).rejects.toThrow(
      /idempotency key/i
    );
  });

  it('passes the idempotency key to both begin and finalize', async () => {
    const plan = commitPlan('checks.json', 'my-idem-key-01');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    expect(calls.find((c) => c.fn === 'begin_import_job')!.args.p_idempotency_key).toBe(
      'my-idem-key-01'
    );
    expect(calls.find((c) => c.fn === 'finalize_import_job')!.args.p_idempotency_key).toBe(
      'my-idem-key-01'
    );
  });

  it('reports a resumed job rather than duplicating', async () => {
    const plan = commitPlan('checks.json');
    const { client } = makeRecordingClient({
      begin_import_job: () => ({ id: 'job-1', status: 'preview', resumed: true }),
    });
    const outcome = await commitImportPlan(client as never, WS, SYS, plan);
    expect(outcome.resumed).toBe(true);
  });

  it('refuses to re-commit an already-committed job', async () => {
    const plan = commitPlan('checks.json');
    const { client, calls } = makeRecordingClient({
      begin_import_job: () => ({ id: 'job-1', status: 'committed', resumed: true }),
    });

    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toThrow(
      /already committed/i
    );
    // It stopped immediately: no rows were staged again.
    expect(calls.filter((c) => c.fn === 'stage_source_records')).toHaveLength(0);
  });

  it('surfaces the database refusal of a duplicate identity', async () => {
    const plan = commitPlan('checks.json');
    const { client } = makeRecordingClient({
      begin_import_job: () => {
        throw new Error('an identical import is already committed');
      },
    });
    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toThrow(
      /already committed/i
    );
  });
});

describe('failure never leaves a partially populated committed job', () => {
  it('marks the job failed when staging fails', async () => {
    const plan = commitPlan('checks.json');
    const { client, calls } = makeRecordingClient({
      stage_source_records: () => {
        throw new Error('connection lost mid-upload');
      },
    });

    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toThrow(
      /connection lost/
    );

    const failCall = calls.find((c) => c.fn === 'fail_import_job');
    expect(failCall).toBeDefined();
    expect(failCall!.args.p_failure_code).toBe('staging_failed');
    expect(String(failCall!.args.p_failure_detail)).toMatch(/connection lost/);
    // Never finalized.
    expect(calls.find((c) => c.fn === 'finalize_import_job')).toBeUndefined();
  });

  it('marks the job failed when finalize is refused', async () => {
    const plan = commitPlan('checks.json');
    const { client, calls } = makeRecordingClient({
      finalize_import_job: () => {
        throw new Error('incomplete import: 2 of 7 declared source rows are staged');
      },
    });

    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toThrow(
      /incomplete import/
    );
    expect(calls.find((c) => c.fn === 'fail_import_job')).toBeDefined();
  });

  it('reports the import job id so a failed attempt stays traceable', async () => {
    const plan = commitPlan('checks.json');
    const { client } = makeRecordingClient({
      stage_source_records: () => {
        throw new Error('boom');
      },
    });

    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toMatchObject({
      importJobId: 'job-1',
    });
  });

  it('still surfaces the original error if marking the failure also fails', async () => {
    const plan = commitPlan('checks.json');
    const { client } = makeRecordingClient({
      stage_source_records: () => {
        throw new Error('original failure');
      },
      fail_import_job: () => {
        throw new Error('could not record failure');
      },
    });

    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toThrow(
      /original failure/
    );
  });

  it('raises a CommitError, not a bare Error', async () => {
    const plan = commitPlan('checks.json');
    const { client } = makeRecordingClient({
      stage_source_records: () => {
        throw new Error('boom');
      },
    });
    await expect(commitImportPlan(client as never, WS, SYS, plan)).rejects.toBeInstanceOf(
      CommitError
    );
  });
});

describe('expectations sent to finalize match the plan', () => {
  it("sends the plan's own counts so the database can reconcile", async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const finalize = calls.find((c) => c.fn === 'finalize_import_job')!;
    expect(finalize.args.p_expected_source_rows).toBe(2149);
    expect(finalize.args.p_expected_accepted_rows).toBe(plan.acceptedRowCount);
    expect(finalize.args.p_expected_issue_rows).toBe(plan.issueRowCount);
    expect(finalize.args.p_expected_crosswalks).toBe(plan.crosswalks.length);
  });

  it('sends the declared source row count and totals when opening the job', async () => {
    const plan = commitPlan('whatnot_purchases.json');
    const { client, calls } = makeRecordingClient();
    await commitImportPlan(client as never, WS, SYS, plan);

    const begin = calls.find((c) => c.fn === 'begin_import_job')!;
    expect(begin.args.p_source_row_count).toBe(2149);
    expect(begin.args.p_workspace_id).toBe(WS);
    expect(begin.args.p_source_system_id).toBe(SYS);
    expect((begin.args.p_source_totals as Record<string, number>).row_count).toBe(2149);
    expect(begin.args.p_file_sha256).toBe(
      '71c55d607191c8f0a4e3d6858ef6bbe1217880602ba96f92757e9dabca8367cd'
    );
  });
});

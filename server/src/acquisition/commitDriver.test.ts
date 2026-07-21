// Phase 4 commit-driver tests.
//
// Proves the end-to-end persistence path drives the governed RPCs in the right
// ORDER, in bounded BATCHES, reads ids back between stages, carries the six
// finalize counts explicitly, and marks the job failed rather than committed
// when any step throws. A recording in-memory fake stands in for the shadow
// database; the database's own enforcement is covered by
// supabase/tests/13_acquisition_workflow.sql.

import { describe, it, expect } from 'vitest';
import { buildImportPlan } from '../provenance/adapter.js';
import { buildAcquisitionPlan, type CommittedSourceRow } from './adapter.js';
import {
  commitAcquisitionPlan,
  abandonAcquisitionJob,
  AcquisitionCommitError,
  BATCH_SIZE,
} from './commitDriver.js';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CH = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SRCJOB = '55555555-5555-5555-5555-555555555555';

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

function committedRows(): CommittedSourceRow[] {
  const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
  return plan.records.map((r) => ({
    sourceRecordId: `sr-${r.sourceRowIndex}`,
    externalIdentifierId: r.sourceRowKey ? `ext-${r.sourceRowIndex}` : null,
    sourceRowIndex: r.sourceRowIndex,
    rawPayload: r.rawPayload,
  }));
}

function makeFakeClient(
  overrides: Record<string, (args: Record<string, unknown>) => unknown> = {},
  beginStatus: 'preview' | 'committed' = 'preview',
  resumed = false
) {
  const calls: Call[] = [];
  const orders = new Map<string, { id: string; source_order_reference: string }>();
  const lots: Array<{ id: string; sequence_no: number; source_order_reference: string }> = [];
  const lines = new Map<string, { id: string; public_id: string }>();
  // Test-controlled single interruption: the named rpc fails once, then the
  // flag clears so a resume succeeds. Simulates an interrupted commit.
  const control: { failOnce: string | null } = { failOnce: null };
  let beginCount = 0;
  // Once finalize commits, later begins report the job committed (a replay) and
  // the governed summary read returns the stored reconciliation counts.
  let committedSummary: Record<string, unknown> | null = null;
  let seq = 0;
  const nextId = (p: string) => `${p}-${(seq += 1)}`;

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (control.failOnce === fn) {
        control.failOnce = null;
        return { data: null, error: { message: `interrupted at ${fn}` } };
      }
      if (overrides[fn]) {
        try {
          return { data: overrides[fn](args), error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      }
      switch (fn) {
        case 'begin_acquisition_import_job': {
          beginCount += 1;
          // After a successful finalize, a replay reports the job committed.
          const status = committedSummary ? 'committed' : beginStatus;
          return {
            data: { id: 'ajob-1', status, resumed: resumed || beginCount > 1 || !!committedSummary },
            error: null,
          };
        }
        case 'get_committed_acquisition_summary':
          return {
            data:
              committedSummary ?? {
                id: 'ajob-1',
                status: 'committed',
                orders: 2149,
                lots: 2149,
                line_items: 2149,
                cost_components: 2149,
                unresolved_supplier_candidates: 1,
                unresolved_cost_components: 0,
              },
            error: null,
          };
        case 'stage_acquisition_orders': {
          const rows = args.p_orders as Array<Record<string, string>>;
          for (const o of rows) {
            if (!orders.has(o.source_order_reference)) {
              orders.set(o.source_order_reference, {
                id: nextId('ord'),
                source_order_reference: o.source_order_reference,
              });
            }
          }
          return { data: { batch: rows.length, inserted: rows.length }, error: null };
        }
        case 'stage_acquisition_lots': {
          const rows = args.p_lots as Array<Record<string, unknown>>;
          for (const l of rows) {
            const ord = [...orders.values()].find((o) => o.id === l.order_id);
            lots.push({
              id: nextId('lot'),
              sequence_no: Number(l.sequence_no),
              source_order_reference: ord?.source_order_reference ?? '',
            });
          }
          return { data: { batch: rows.length, inserted: rows.length }, error: null };
        }
        case 'stage_acquisition_line_items': {
          const rows = args.p_lines as Array<Record<string, string>>;
          for (const li of rows) {
            if (!lines.has(li.public_id)) {
              lines.set(li.public_id, { id: nextId('line'), public_id: li.public_id });
            }
          }
          return {
            data: { batch: rows.length, inserted: rows.length, staged_total: lines.size },
            error: null,
          };
        }
        case 'stage_acquisition_cost_components': {
          const rows = args.p_components as unknown[];
          return { data: { batch: rows.length, inserted: rows.length }, error: null };
        }
        case 'finalize_acquisition_import_job': {
          const finalizedData = {
            id: 'ajob-1',
            status: 'committed',
            orders: args.p_expected_orders,
            lots: args.p_expected_lots,
            line_items: args.p_expected_line_items,
            cost_components: args.p_expected_cost_components,
            unresolved_supplier_candidates: args.p_expected_unresolved_supplier_candidates,
            unresolved_cost_components: args.p_expected_unresolved_cost_components,
          };
          // Remember the committed result so a later replay can read it back.
          committedSummary = finalizedData;
          return { data: finalizedData, error: null };
        }
        case 'fail_acquisition_import_job':
          return { data: 'ajob-1', error: null };
        default:
          return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
    },
    from: (table: string) => {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        range(fromIdx: number, toIdx: number) {
          let rows: Array<Record<string, unknown>> = [];
          if (table === 'acquisition_orders') {
            rows = [...orders.values()];
          } else if (table === 'acquisition_lots') {
            rows = lots.map((l) => ({
              id: l.id,
              sequence_no: l.sequence_no,
              acquisition_orders: { source_order_reference: l.source_order_reference },
            }));
          } else if (table === 'acquisition_line_items') {
            rows = [...lines.values()];
          }
          return Promise.resolve({ data: rows.slice(fromIdx, toIdx + 1), error: null });
        },
      };
      return q;
    },
  };
  return { client, calls, orders, lots, lines, control };
}

function fixturePlan() {
  return buildAcquisitionPlan(committedRows(), { sourceLabel: 'whatnot_purchases.json' });
}

describe('the 2,149-line acquisition job commits in bounded batches', () => {
  it('stages orders, lots, lines and components then finalizes, in order', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient();

    const outcome = await commitAcquisitionPlan(
      client as never,
      WS,
      CH,
      SRCJOB,
      plan,
      'acq-key-00001'
    );

    expect(outcome.status).toBe('committed');
    expect(outcome.orders).toBe(2149);
    expect(outcome.lots).toBe(2149);
    expect(outcome.lineItems).toBe(2149);
    expect(outcome.costComponents).toBe(2149);
    expect(outcome.unresolvedSupplierCandidates).toBe(1);
    expect(outcome.unresolvedCostComponents).toBe(0);

    // First call opens the job; last call finalizes it.
    expect(calls[0].fn).toBe('begin_acquisition_import_job');
    expect(calls[calls.length - 1].fn).toBe('finalize_acquisition_import_job');

    // Stage phases appear in the required order.
    const stageOrder = calls
      .map((c) => c.fn)
      .filter((f) => f.startsWith('stage_'));
    const firstIndex = (f: string) => stageOrder.indexOf(f);
    expect(firstIndex('stage_acquisition_orders')).toBeLessThan(
      firstIndex('stage_acquisition_lots')
    );
    expect(firstIndex('stage_acquisition_lots')).toBeLessThan(
      firstIndex('stage_acquisition_line_items')
    );
    expect(firstIndex('stage_acquisition_line_items')).toBeLessThan(
      firstIndex('stage_acquisition_cost_components')
    );

    // No staged batch exceeds the bound.
    for (const c of calls) {
      for (const arrArg of ['p_orders', 'p_lots', 'p_lines', 'p_components']) {
        const arr = c.args[arrArg];
        if (Array.isArray(arr)) expect(arr.length).toBeLessThanOrEqual(BATCH_SIZE);
      }
    }
  });

  it('sends all six finalize counts explicitly, even the zero one', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient();
    await commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001');
    const finalize = calls.find((c) => c.fn === 'finalize_acquisition_import_job');
    expect(finalize).toBeDefined();
    for (const k of [
      'p_expected_orders',
      'p_expected_lots',
      'p_expected_line_items',
      'p_expected_cost_components',
      'p_expected_unresolved_supplier_candidates',
      'p_expected_unresolved_cost_components',
    ]) {
      expect(finalize!.args[k]).not.toBeUndefined();
    }
    // The unresolved-cost count is genuinely zero and still sent.
    expect(finalize!.args.p_expected_unresolved_cost_components).toBe(0);
  });

  it('passes the expected line count to begin, resolved from the plan', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient();
    await commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001');
    const begin = calls.find((c) => c.fn === 'begin_acquisition_import_job');
    expect(begin!.args.p_expected_line_count).toBe(2149);
    expect(begin!.args.p_channel_id).toBe(CH);
    expect(begin!.args.p_source_import_job_id).toBe(SRCJOB);
  });
});

describe('commit-driver guards and failure handling', () => {
  it('refuses a short idempotency key before opening a job', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient();
    await expect(
      commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'short')
    ).rejects.toBeInstanceOf(AcquisitionCommitError);
    expect(calls.length).toBe(0);
  });

  it('a committed replay returns the existing committed outcome, not a 409', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient({}, 'committed');
    const outcome = await commitAcquisitionPlan(
      client as never,
      WS,
      CH,
      SRCJOB,
      plan,
      'acq-key-00001'
    );
    expect(outcome.status).toBe('committed');
    expect(outcome.importJobId).toBe('ajob-1');
    // No staging or finalize write is repeated; the counts come from the
    // governed summary read, not from the caller.
    expect(calls.some((c) => c.fn.startsWith('stage_'))).toBe(false);
    expect(calls.some((c) => c.fn === 'finalize_acquisition_import_job')).toBe(false);
    expect(calls.some((c) => c.fn === 'get_committed_acquisition_summary')).toBe(true);
  });

  it('carries resumed through when begin reports a resume', async () => {
    const plan = fixturePlan();
    const { client } = makeFakeClient({}, 'preview', true);
    const outcome = await commitAcquisitionPlan(
      client as never,
      WS,
      CH,
      SRCJOB,
      plan,
      'acq-key-00001'
    );
    expect(outcome.resumed).toBe(true);
  });

  it('does NOT auto-fail the job on an ordinary error; leaves it resumable', async () => {
    const plan = fixturePlan();
    const { client, calls, control } = makeFakeClient();
    control.failOnce = 'stage_acquisition_line_items';
    await expect(
      commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001')
    ).rejects.toMatchObject({ importJobId: 'ajob-1' });
    // The job is NOT marked failed, and finalize was not reached.
    expect(calls.some((c) => c.fn === 'fail_acquisition_import_job')).toBe(false);
    expect(calls.some((c) => c.fn === 'finalize_acquisition_import_job')).toBe(false);
  });
});

describe('an interrupted import resumes under the SAME key without duplicates', () => {
  // Each interruption point: the first run fails there; a second run with the
  // same key and client (state persisted) finishes the same job cleanly.
  for (const failAt of [
    'stage_acquisition_orders',
    'stage_acquisition_lots',
    'stage_acquisition_line_items',
    'stage_acquisition_cost_components',
    'finalize_acquisition_import_job',
  ]) {
    it(`recovers from an interruption at ${failAt}`, async () => {
      const plan = fixturePlan();
      const { client, calls, control, orders, lines } = makeFakeClient();

      // First run: interrupted at the chosen stage.
      control.failOnce = failAt;
      await expect(
        commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001')
      ).rejects.toMatchObject({ importJobId: 'ajob-1' });
      expect(calls.some((c) => c.fn === 'fail_acquisition_import_job')).toBe(false);

      // Second run under the SAME key resumes the SAME job and completes.
      const outcome = await commitAcquisitionPlan(
        client as never,
        WS,
        CH,
        SRCJOB,
        plan,
        'acq-key-00001'
      );
      expect(outcome.status).toBe('committed');
      expect(outcome.resumed).toBe(true);
      expect(outcome.orders).toBe(2149);
      expect(outcome.lineItems).toBe(2149);
      // Idempotent re-staging created no duplicate rows in the fake store.
      expect(orders.size).toBe(2149);
      expect(lines.size).toBe(2149);
      // The job was never failed and never adopted by a new key.
      expect(calls.some((c) => c.fn === 'fail_acquisition_import_job')).toBe(false);
      const beginKeys = calls
        .filter((c) => c.fn === 'begin_acquisition_import_job')
        .map((c) => c.args.p_idempotency_key);
      expect(new Set(beginKeys)).toEqual(new Set(['acq-key-00001']));
    });
  }
});

describe('a committed response that was lost replays safely', () => {
  it('a retried request after a committed-but-lost response returns the same outcome', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient();

    // 1. Finalization actually commits.
    const first = await commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001');
    expect(first.status).toBe('committed');
    const stageCount = calls.filter((c) => c.fn.startsWith('stage_')).length;
    expect(calls.filter((c) => c.fn === 'finalize_acquisition_import_job')).toHaveLength(1);

    // 2. The response is lost. 3. The same request and key are retried.
    const replay = await commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001');

    // 4. The retry returns a successful committed outcome for the SAME job.
    expect(replay.status).toBe('committed');
    expect(replay.importJobId).toBe(first.importJobId);
    expect(replay.orders).toBe(first.orders);
    expect(replay.lineItems).toBe(first.lineItems);
    expect(replay.costComponents).toBe(first.costComponents);

    // 5. No stage or finalize write is repeated; the outcome came from the
    // governed summary read.
    expect(calls.filter((c) => c.fn.startsWith('stage_'))).toHaveLength(stageCount);
    expect(calls.filter((c) => c.fn === 'finalize_acquisition_import_job')).toHaveLength(1);
    expect(calls.some((c) => c.fn === 'get_committed_acquisition_summary')).toBe(true);
  });

  it('passes the full binding to the governed summary read', async () => {
    const plan = fixturePlan();
    const { client, calls } = makeFakeClient({}, 'committed');
    await commitAcquisitionPlan(client as never, WS, CH, SRCJOB, plan, 'acq-key-00001');
    const summary = calls.find((c) => c.fn === 'get_committed_acquisition_summary');
    expect(summary!.args.p_idempotency_key).toBe('acq-key-00001');
    expect(summary!.args.p_channel_id).toBe(CH);
    expect(summary!.args.p_source_import_job_id).toBe(SRCJOB);
    expect(summary!.args.p_expected_line_count).toBe(plan.expectedLineItems);
  });
});

describe('explicit abandonment is a separate, deliberate action', () => {
  it('abandonAcquisitionJob marks the job failed via the governed RPC', async () => {
    const { client, calls } = makeFakeClient();
    const id = await abandonAcquisitionJob(client as never, 'ajob-1', 'operator_abandoned', 'done with it');
    expect(id).toBe('ajob-1');
    const fail = calls.find((c) => c.fn === 'fail_acquisition_import_job');
    expect(fail).toBeDefined();
    expect(fail!.args.p_failure_code).toBe('operator_abandoned');
  });
});

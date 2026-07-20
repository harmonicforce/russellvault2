// Phase 3 import-review UI tests.
//
// Exercises the real review flow through the controller the React page renders:
// safe default, viewer read-only, operator commit, duplicate-commit refusal,
// failed commit, review actions, and displayed append-only audit history.
//
// The controller is framework-agnostic (matching the Phase 2 auth shell), so
// these drive the actual UI logic — permission gating, idempotency-key
// derivation, refresh-after-action — without a DOM.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ImportReviewController,
  capabilitiesFor,
  makeIdempotencyKey,
  type CommitOutcome,
  type ProvenanceTransport,
} from './importReview';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const PREVIEW = {
  sourceLabel: 'whatnot_purchases.json',
  fileSha256: '71c55d607191c8f0a4e3d6858ef6bbe1217880602ba96f92757e9dabca8367cd',
  contentSha256: 'cf7b72dd59bed0ec1f441423537a1ec8e022530a14fa6bd110952584d67c097f',
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
  sourceRowCount: 2149,
  acceptedRowCount: 2149,
  issueRowCount: 0,
  sourceTotals: { row_count: 2149, total_paid: 33283.76 },
  crosswalkCandidateCount: 3,
  issueCount: 1,
};

const COMMITTED: CommitOutcome = {
  importJobId: 'job-1',
  status: 'committed',
  sourceRows: 2149,
  acceptedRows: 2149,
  issueRows: 0,
  issues: 1,
  crosswalks: 3,
  externalIdentifiers: 2149,
  resumed: false,
};

interface FakeOptions {
  commitImpl?: () => Promise<CommitOutcome>;
}

function makeTransport(opts: FakeOptions = {}) {
  const calls: string[] = [];
  let auditEvents: Array<Record<string, unknown>> = [];
  let crosswalks: Array<Record<string, unknown>> = [
    { id: 'cw-1', review_state: 'candidate', proposed_entity_key: 'ACME' },
  ];
  let jobs: Array<Record<string, unknown>> = [];

  const transport: ProvenanceTransport = {
    async listFixtures() {
      calls.push('listFixtures');
      return [
        { filename: 'whatnot_purchases.json', shape: 'whatnot_purchase', description: 'x' },
        { filename: 'checks.json', shape: 'check', description: 'y' },
      ];
    },
    async listSourceSystems() {
      calls.push('listSourceSystems');
      return [
        {
          id: 'sys-1',
          public_id: 'REPO',
          kind: 'repository_fixture',
          instance_label: 'repo seed',
          active: true,
        },
      ];
    },
    async preview() {
      calls.push('preview');
      return PREVIEW;
    },
    async commit() {
      calls.push('commit');
      if (opts.commitImpl) return opts.commitImpl();
      jobs = [{ id: 'job-1', status: 'committed', source_row_count: 2149 }];
      auditEvents = [
        { id: 'a2', event_type: 'import_committed', event_seq: 2 },
        { id: 'a1', event_type: 'import_started', event_seq: 1 },
      ];
      return COMMITTED;
    },
    async listJobs() {
      calls.push('listJobs');
      return jobs as never;
    },
    async getJob() {
      calls.push('getJob');
      return { id: 'job-1', status: 'committed', source_row_count: 2149 } as never;
    },
    async listRecords(_ws, _job, limit, offset) {
      calls.push(`listRecords:${offset}`);
      return {
        total: 2149,
        records: Array.from({ length: Math.min(limit, 2149 - offset) }, (_, i) => ({
          id: `r-${offset + i}`,
          source_row_index: offset + i,
        })) as never,
      };
    },
    async listIssues() {
      calls.push('listIssues');
      return [{ id: 'iss-1', status: 'open', issue_type: 'duplicate_candidate' }] as never;
    },
    async listCrosswalks() {
      calls.push('listCrosswalks');
      return crosswalks as never;
    },
    async listAuditEvents() {
      calls.push('listAuditEvents');
      return auditEvents as never;
    },
    async confirmCrosswalk(_ws, id) {
      calls.push('confirmCrosswalk');
      crosswalks = crosswalks.map((c) =>
        c.id === id ? { ...c, review_state: 'confirmed' } : c
      );
      auditEvents = [{ id: 'a3', event_type: 'crosswalk_confirmed', event_seq: 3 }];
    },
    async rejectCrosswalk(_ws, id) {
      calls.push('rejectCrosswalk');
      crosswalks = crosswalks.map((c) =>
        c.id === id ? { ...c, review_state: 'rejected' } : c
      );
      auditEvents = [{ id: 'a4', event_type: 'crosswalk_rejected', event_seq: 4 }];
    },
    async supersedeCrosswalk() {
      calls.push('supersedeCrosswalk');
      auditEvents = [{ id: 'a5', event_type: 'crosswalk_superseded', event_seq: 5 }];
    },
    async resolveIssue() {
      calls.push('resolveIssue');
      auditEvents = [{ id: 'a6', event_type: 'issue_resolved', event_seq: 6 }];
    },
  };

  return { transport, calls };
}

describe('safe default: unconfigured', () => {
  it('reports unconfigured and performs no network work', async () => {
    const controller = new ImportReviewController(null, false);
    expect(controller.getState().status).toBe('unconfigured');

    await controller.open(WS, 'owner');
    // Still unconfigured; opening did nothing.
    expect(controller.getState().status).toBe('unconfigured');
    expect(controller.getState().fixtures).toHaveLength(0);
  });

  it('grants no capability when unconfigured', () => {
    const controller = new ImportReviewController(null, false);
    expect(controller.getState().capabilities.readOnly).toBe(true);
    expect(controller.getState().capabilities.canCommit).toBe(false);
  });
});

describe('capabilities by role', () => {
  it('makes a viewer read-only', () => {
    const c = capabilitiesFor('viewer');
    expect(c.readOnly).toBe(true);
    expect(c.canPreview).toBe(false);
    expect(c.canCommit).toBe(false);
    expect(c.canReviewCrosswalks).toBe(false);
    expect(c.canResolveIssues).toBe(false);
    expect(c.canRegisterSourceSystem).toBe(false);
  });

  it('gives an operator preview, commit, and review', () => {
    const c = capabilitiesFor('operator');
    expect(c.readOnly).toBe(false);
    expect(c.canCommit).toBe(true);
    expect(c.canReviewCrosswalks).toBe(true);
    expect(c.canResolveIssues).toBe(true);
    // Registry administration stays owner-only.
    expect(c.canRegisterSourceSystem).toBe(false);
  });

  it('gives an owner everything including the registry', () => {
    const c = capabilitiesFor('owner');
    expect(c.readOnly).toBe(false);
    expect(c.canRegisterSourceSystem).toBe(true);
  });

  it('treats an absent role as read-only', () => {
    expect(capabilitiesFor(null).readOnly).toBe(true);
  });
});

describe('viewer', () => {
  let controller: ImportReviewController;
  let calls: string[];

  beforeEach(async () => {
    const fake = makeTransport();
    calls = fake.calls;
    controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'viewer');
  });

  it('loads the read-only review surface', () => {
    const s = controller.getState();
    expect(s.status).toBe('ready');
    expect(s.capabilities.readOnly).toBe(true);
    expect(s.jobs).toBeDefined();
    expect(s.crosswalks.length).toBeGreaterThan(0);
  });

  it('can page stored source records', async () => {
    await controller.openJob('job-1');
    expect(controller.getState().records).toHaveLength(25);
    expect(controller.getState().recordTotal).toBe(2149);

    await controller.nextRecordPage();
    expect(controller.getState().recordOffset).toBe(25);
    expect(controller.getState().records[0].source_row_index).toBe(25);

    await controller.previousRecordPage();
    expect(controller.getState().recordOffset).toBe(0);
  });

  it('cannot preview', async () => {
    const result = await controller.preview();
    expect(result).toBeNull();
    expect(controller.getState().error).toMatch(/cannot preview/i);
    expect(calls).not.toContain('preview');
  });

  it('cannot commit', async () => {
    const result = await controller.commit('run-1');
    expect(result).toBeNull();
    expect(controller.getState().error).toMatch(/cannot commit/i);
    expect(calls).not.toContain('commit');
  });

  it('cannot confirm, reject, supersede, or resolve', async () => {
    expect(await controller.confirmCrosswalk('cw-1')).toBe(false);
    expect(controller.getState().error).toMatch(/cannot confirm/i);

    expect(await controller.rejectCrosswalk('cw-1')).toBe(false);
    expect(controller.getState().error).toMatch(/cannot reject/i);

    expect(await controller.supersedeCrosswalk('cw-1', 'cw-2')).toBe(false);
    expect(controller.getState().error).toMatch(/cannot supersede/i);

    expect(await controller.resolveIssue('iss-1', 'resolved')).toBe(false);
    expect(controller.getState().error).toMatch(/cannot resolve/i);

    // None of it reached the network.
    expect(calls).not.toContain('confirmCrosswalk');
    expect(calls).not.toContain('rejectCrosswalk');
    expect(calls).not.toContain('supersedeCrosswalk');
    expect(calls).not.toContain('resolveIssue');
  });
});

describe('operator commit flow', () => {
  let controller: ImportReviewController;
  let calls: string[];

  beforeEach(async () => {
    const fake = makeTransport();
    calls = fake.calls;
    controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'operator');
  });

  it('loads fixtures and selects a registered source system', () => {
    const s = controller.getState();
    expect(s.status).toBe('ready');
    expect(s.fixtures).toHaveLength(2);
    expect(s.selectedFixture).toBe('whatnot_purchases.json');
    expect(s.selectedSourceSystemId).toBe('sys-1');
  });

  it('requires a preview before committing', async () => {
    const result = await controller.commit('run-1');
    expect(result).toBeNull();
    expect(controller.getState().error).toMatch(/preview the import/i);
    expect(calls).not.toContain('commit');
  });

  it('previews the fixture with its counts and hashes', async () => {
    const preview = await controller.preview();
    expect(preview!.sourceRowCount).toBe(2149);
    expect(controller.getState().preview!.fileSha256).toBe(PREVIEW.fileSha256);
  });

  it('requires a run label of reasonable length', async () => {
    await controller.preview();
    expect(await controller.commit('')).toBeNull();
    expect(controller.getState().error).toMatch(/run label/i);
    expect(await controller.commit('ab')).toBeNull();
    expect(calls).not.toContain('commit');
  });

  it('derives and retains a stable idempotency key', async () => {
    await controller.preview();
    const key = controller.previewIdempotencyKey('run-1');
    expect(key).toBe(
      makeIdempotencyKey(PREVIEW.sourceLabel, PREVIEW.contentSha256, 'run-1')
    );
    // Same run label => same key, so a retry resumes rather than duplicating.
    expect(controller.previewIdempotencyKey('run-1')).toBe(key);
    // A different run label => a different key.
    expect(controller.previewIdempotencyKey('run-2')).not.toBe(key);
  });

  it('commits successfully and refreshes the stored surfaces', async () => {
    await controller.preview();
    const outcome = await controller.commit('run-1');

    expect(outcome!.status).toBe('committed');
    expect(outcome!.sourceRows).toBe(2149);
    expect(outcome!.externalIdentifiers).toBe(2149);

    const s = controller.getState();
    expect(s.lastCommit!.importJobId).toBe('job-1');
    expect(s.error).toBeNull();
    // The committed job and its audit trail were reloaded.
    expect(s.jobs).toHaveLength(1);
    expect(s.auditEvents.map((e) => e.event_type)).toContain('import_committed');
  });

  it('displays real append-only audit events after a commit', async () => {
    await controller.preview();
    await controller.commit('run-1');
    const types = controller.getState().auditEvents.map((e) => e.event_type);
    expect(types).toEqual(['import_committed', 'import_started']);
  });
});

describe('duplicate commit refusal', () => {
  it('surfaces the database refusal and commits nothing further', async () => {
    const fake = makeTransport({
      commitImpl: async () => {
        throw new Error('an identical import is already committed');
      },
    });
    const controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'operator');
    await controller.preview();

    const outcome = await controller.commit('run-1');

    expect(outcome).toBeNull();
    expect(controller.getState().error).toMatch(/already committed/i);
    expect(controller.getState().lastCommit).toBeNull();
  });
});

describe('failed commit', () => {
  it('reports the failure and records no committed outcome', async () => {
    const fake = makeTransport({
      commitImpl: async () => {
        throw new Error('incomplete import: 10 of 2149 declared source rows are staged');
      },
    });
    const controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'operator');
    await controller.preview();

    const outcome = await controller.commit('run-1');

    expect(outcome).toBeNull();
    expect(controller.getState().error).toMatch(/incomplete import/i);
    expect(controller.getState().lastCommit).toBeNull();
    expect(controller.getState().busy).toBe(false);
  });

  it('lets the operator retry after clearing the error', async () => {
    let attempt = 0;
    const fake = makeTransport({
      commitImpl: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('network dropped');
        return COMMITTED;
      },
    });
    const controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'operator');
    await controller.preview();

    expect(await controller.commit('run-1')).toBeNull();
    controller.clearError();
    const outcome = await controller.commit('run-1');

    expect(outcome!.status).toBe('committed');
    expect(controller.getState().error).toBeNull();
  });
});

describe('operator review actions', () => {
  let controller: ImportReviewController;

  beforeEach(async () => {
    const fake = makeTransport();
    controller = new ImportReviewController(fake.transport, true);
    await controller.open(WS, 'operator');
  });

  it('confirms a candidate and refreshes state and audit history', async () => {
    expect(await controller.confirmCrosswalk('cw-1', 'looks right')).toBe(true);
    const s = controller.getState();
    expect(s.crosswalks.find((c) => c.id === 'cw-1')!.review_state).toBe('confirmed');
    expect(s.auditEvents.map((e) => e.event_type)).toContain('crosswalk_confirmed');
  });

  it('rejects a candidate', async () => {
    expect(await controller.rejectCrosswalk('cw-1', 'different entity')).toBe(true);
    expect(controller.getState().crosswalks[0].review_state).toBe('rejected');
    expect(controller.getState().auditEvents[0].event_type).toBe('crosswalk_rejected');
  });

  it('supersedes a crosswalk', async () => {
    expect(await controller.supersedeCrosswalk('cw-1', 'cw-2', 'corrected')).toBe(true);
    expect(controller.getState().auditEvents[0].event_type).toBe('crosswalk_superseded');
  });

  it('resolves an issue', async () => {
    expect(await controller.resolveIssue('iss-1', 'resolved', 'kept both')).toBe(true);
    expect(controller.getState().auditEvents[0].event_type).toBe('issue_resolved');
  });

  it('surfaces a server refusal of a review action', async () => {
    const fake = makeTransport();
    fake.transport.confirmCrosswalk = async () => {
      throw new Error('crosswalk is already superseded and cannot be reviewed again');
    };
    const c = new ImportReviewController(fake.transport, true);
    await c.open(WS, 'operator');

    expect(await c.confirmCrosswalk('cw-1')).toBe(false);
    expect(c.getState().error).toMatch(/already superseded/i);
  });
});

describe('state notification', () => {
  it('notifies subscribers on every transition', async () => {
    const fake = makeTransport();
    const controller = new ImportReviewController(fake.transport, true);
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((s) => seen.push(s.status));

    await controller.open(WS, 'operator');

    expect(seen).toContain('loading');
    expect(seen).toContain('ready');
    unsubscribe();

    const before = seen.length;
    await controller.preview();
    expect(seen.length).toBe(before);
  });
});

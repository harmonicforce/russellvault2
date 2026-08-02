import { describe, expect, it } from 'vitest';
import { priorityScore, rankWorkCandidates } from './operationsDashboard.js';
import {
  FORBIDDEN_IN_CLIENT_PAYLOAD, classifyDependencyFailure, panelFailure,
  parsePageWindow, parseReadinessStatuses,
} from '../operationsDashboard/contract.js';

describe('operational priority definition', () => {
  it('is deterministic, bounded, and explainable', () => {
    expect(priorityScore(80, 90)).toEqual({ score: 110, explanation: '80 rule weight + 30 age points' });
    expect(priorityScore(50, -2)).toEqual({ score: 50, explanation: '50 rule weight + 0 age points' });
  });
});

const row = (id: string, age: number) => ({ subject_kind: 'item', subject_id: id,
  subject_public_id: `RV-${id}`, display_name: id, created_at: new Date(Date.UTC(2026, 0, 31 - age)).toISOString() });

describe('operational candidate ranking', () => {
  const now = Date.UTC(2026, 0, 31);

  it('returns the global top 20 from independently bounded rule sets', () => {
    const photos = Array.from({ length: 20 }, (_, i) => row(`photo-${i}`, 30));
    const tasks = rankWorkCandidates([row('location', 20)], photos, now);
    expect(tasks).toHaveLength(20);
    expect(tasks[0]).toMatchObject({ subjectId: 'location', score: 100, destination: '/inventory/current?needsLocation=1' });
    expect(tasks.filter(task => task.taskType === 'missing_media')).toHaveLength(19);
  });

  it('keeps both tasks for a dual exception without hiding a higher priority candidate', () => {
    const dual = row('dual', 10);
    const tasks = rankWorkCandidates([dual, row('older-location', 30)], [dual], now);
    expect(tasks.map(task => `${task.taskType}:${task.subjectId}`)).toEqual([
      'missing_location:older-location', 'missing_location:dual', 'missing_media:dual',
    ]);
    expect(tasks[2].destination).toBe('/inventory/current?needsPhotos=1');
  });
});

describe('panel failure contract', () => {
  // Production was showing the operator this exact sentence, which names an
  // internal function, an internal argument, and the fact that PostgREST is in
  // the path. None of it is actionable and all of it is schema disclosure.
  const REAL_PRODUCTION_MESSAGE =
    'Could not find the function public.get_operations_inventory_health(p_workspace_id) in the schema cache';

  it('turns a missing hosted migration into an actionable instruction', () => {
    const failure = classifyDependencyFailure(REAL_PRODUCTION_MESSAGE);
    expect(failure.status).toBe(503);
    expect(failure.body.code).toBe('dashboard_contract_missing');
    expect(failure.body.message).toMatch(/database update has not been applied/);
  });

  it('never leaks database internals to the browser', () => {
    for (const raw of [
      REAL_PRODUCTION_MESSAGE,
      'PGRST202: function public.get_listing_prep_summary(p_workspace_id) does not exist',
      'relation "public.inventory_work_queue" does not exist',
      'connection to server at "10.0.0.4", port 5432 failed',
    ]) {
      const payload = JSON.stringify(classifyDependencyFailure(raw).body);
      for (const forbidden of FORBIDDEN_IN_CLIENT_PAYLOAD) {
        expect(payload).not.toContain(forbidden);
      }
      expect(payload).not.toContain(raw);
    }
  });

  it('tells an authorization refusal apart from a broken dependency', () => {
    expect(classifyDependencyFailure('not a member of this workspace')).toMatchObject({
      status: 403, body: { code: 'unauthorized_workspace' },
    });
    expect(classifyDependencyFailure('permission denied for view inventory_work_queue')).toMatchObject({
      status: 403, body: { code: 'unauthorized_workspace' },
    });
  });

  it('falls back to a generic dependency failure rather than guessing', () => {
    expect(classifyDependencyFailure('canceling statement due to statement timeout')).toMatchObject({
      status: 503, body: { code: 'dependency_failed' },
    });
  });

  // A failure must never be representable as data, or the dashboard could
  // render it as a legitimate zero.
  it('carries no numeric payload a panel could mistake for a count', () => {
    const body = classifyDependencyFailure(REAL_PRODUCTION_MESSAGE).body as Record<string, unknown>;
    expect(Object.values(body).some((v) => typeof v === 'number')).toBe(false);
    expect(body.error).toBe('panel_unavailable');
  });

  it('keeps the disabled-deployment answer distinct', () => {
    expect(panelFailure('feature_unavailable', 404)).toMatchObject({
      status: 404, body: { code: 'feature_unavailable' },
    });
  });
});

describe('deterministic candidate selection', () => {
  const now = Date.UTC(2026, 0, 31);
  /** Batch intake shares one transaction timestamp across every row it writes. */
  const sameInstant = new Date(Date.UTC(2026, 0, 1)).toISOString();
  const batch = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({
    subject_kind: 'item', subject_id: `${prefix}-${String(i).padStart(3, '0')}`,
    subject_public_id: `RV-${prefix}-${i}`, display_name: `${prefix} ${i}`, created_at: sameInstant,
  }));

  it('returns an identical top 20 every time when 30 candidates share one timestamp', () => {
    const photos = batch('photo', 30);
    const first = rankWorkCandidates([], photos, now).map((t) => t.subjectId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Re-shuffled arrival order must not change the answer.
      const shuffled = [...photos].reverse();
      expect(rankWorkCandidates([], shuffled, now).map((t) => t.subjectId)).toEqual(first);
    }
    expect(first).toHaveLength(20);
  });

  it('still keeps both tasks for a record carrying two independent exceptions', () => {
    const dual = batch('dual', 1);
    const tasks = rankWorkCandidates(dual, dual, now);
    expect(tasks.map((t) => t.taskType)).toEqual(['missing_location', 'missing_media']);
  });
});

describe('work candidate query ordering', () => {
  /**
   * The ranking above can only be deterministic if the database handed back a
   * deterministic 20 in the first place. `created_at` alone is not a total
   * order, so every order column must be applied BEFORE `.limit`.
   */
  it('applies a complete tie-breaker before limiting, on every rule query', async () => {
    const calls: Array<{ order: string[]; limitedAfter: number }> = [];
    const builder = () => {
      const order: string[] = [];
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        order: (column: string) => { order.push(column); return q; },
        limit: () => { calls.push({ order: [...order], limitedAfter: order.length }); return Promise.resolve({ data: [], error: null }); },
      });
      return q;
    };
    const client = { from: () => builder() };

    const { default: router } = await import('./operationsDashboard.js');
    const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
      .stack.find((l) => l.route?.path === '/work');
    const handler = layer!.route!.stack.at(-1)!.handle;
    await new Promise<void>((resolve) => {
      handler(
        { caller: { client, workspaceId: 'ws' } } as never,
        { json: () => resolve() } as never,
        () => resolve(),
      );
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.order).toEqual(['created_at', 'subject_kind', 'subject_id']);
      expect(call.limitedAfter).toBe(3);
    }
  });
});

// The readiness drill-down is paged. The dashboard tile reports an exact total,
// so a backlog above one page has to be reachable — and the parameters that
// reach it have to be checked, because an unrecognised status matches no rows
// and would answer "nothing outstanding" for a question never asked.
describe('readiness filter and page window', () => {
  it('accepts the statuses the database actually stores', () => {
    expect(parseReadinessStatuses('missing_required_angle'))
      .toEqual({ statuses: ['missing_required_angle'], invalid: [] });
    expect(parseReadinessStatuses('missing_required_angle,upload_incomplete'))
      .toEqual({ statuses: ['missing_required_angle', 'upload_incomplete'], invalid: [] });
    expect(parseReadinessStatuses(' missing_defect_photo , complete '))
      .toEqual({ statuses: ['missing_defect_photo', 'complete'], invalid: [] });
  });

  it('treats an absent or empty filter as no filter', () => {
    for (const raw of [undefined, '', ',,', 42, null]) {
      expect(parseReadinessStatuses(raw)).toEqual({ statuses: null, invalid: [] });
    }
  });

  // THE REGRESSION. Passing this through returns zero rows and a zero total,
  // which reads exactly like a cleared backlog.
  it('refuses an unrecognised status instead of reporting an empty backlog', () => {
    expect(parseReadinessStatuses('not_a_real_status'))
      .toEqual({ statuses: null, invalid: ['not_a_real_status'] });
    // One bad value poisons the whole filter — a partially-applied filter would
    // report a total for a different question than the one asked.
    expect(parseReadinessStatuses('missing_required_angle,nonsense'))
      .toEqual({ statuses: null, invalid: ['nonsense'] });
  });

  it('rejects an attempt to smuggle SQL through the filter', () => {
    const { statuses, invalid } = parseReadinessStatuses("complete'; drop table listing_prep; --");
    expect(statuses).toBeNull();
    expect(invalid).toHaveLength(1);
  });

  it('carries an invalid filter as a stable client contract', () => {
    const failure = panelFailure('invalid_status', 400);
    expect(failure.status).toBe(400);
    expect(failure.body.code).toBe('invalid_status');
    for (const forbidden of FORBIDDEN_IN_CLIENT_PAYLOAD) {
      expect(JSON.stringify(failure.body)).not.toContain(forbidden);
    }
  });

  it('bounds the page window and falls back rather than throwing', () => {
    expect(parsePageWindow('50', '100')).toEqual({ limit: 50, offset: 100 });
    expect(parsePageWindow(undefined, undefined)).toEqual({ limit: 50, offset: 0 });
    expect(parsePageWindow('abc', 'abc')).toEqual({ limit: 50, offset: 0 });
    // A negative offset would page backwards past the start.
    expect(parsePageWindow('10', '-5')).toEqual({ limit: 10, offset: 0 });
    // An unbounded limit is a denial-of-service shaped like a query.
    expect(parsePageWindow('100000', '0')).toEqual({ limit: 200, offset: 0 });
    expect(parsePageWindow('0', '0')).toEqual({ limit: 50, offset: 0 });
  });
});

// The Workbench data layer.
//
// This is the ONLY place in the Workbench that talks to a transport. The
// registry describes widgets, the layout stores preferences, the frames render
// — and this module turns the existing governed transports into typed facts.
//
// THE DEFECT THIS FIXES
//
// The previous Daily Workbench initialised every count to `0` and then loaded
// them together. Between mount and response, and after any failure that landed
// in the shared `catch`, the page displayed a confident zero for facts it had
// not established. "Nothing needs a location" and "we could not find out
// whether anything needs a location" rendered identically, and the first is the
// one an operator acts on.
//
// So every source here resolves INDEPENDENTLY into its own `TruthState`:
//
//   - nothing starts at zero; everything starts at `loading`;
//   - a failure becomes `error`, never `0`;
//   - an unconfigured transport becomes `notConfigured`, never `0`;
//   - a proven zero becomes `empty`, which is a different render again;
//   - one source failing leaves every other source exactly as it was.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { empty, failed, loading, notConfigured, ready, type TruthState } from '../../design-system';
import type { InventoryData, RecordOverviewRow } from '../../lib/inventoryData';
import type { PrepSummary } from '../../lib/listingPrepApi';
import type { IntakeSessionListItem } from '../../lib/intakeApi';

/** A record waiting in a queue, in the one shape the widgets render. */
export interface QueueRecord {
  readonly kind: 'item' | 'lot';
  readonly id: string;
  readonly publicId: string;
  readonly displayName: string;
}

/** A count plus the first few records behind it. */
export interface QueueFacts {
  readonly count: number;
  readonly records: readonly QueueRecord[];
}

export interface IntakeFacts {
  readonly total: number;
  readonly sessions: readonly IntakeSessionListItem[];
}

/**
 * Every fact the Workbench widgets can render, each with its own truth.
 *
 * Keyed by widget definition id so a renderer asks for exactly the fact its
 * definition declares, and a widget with no matching entry simply is not
 * rendered rather than being handed the wrong data.
 */
export interface WorkbenchFacts {
  readonly 'inventory.needs-location': TruthState<QueueFacts>;
  readonly 'inventory.needs-photos': TruthState<QueueFacts>;
  readonly 'inventory.unclassified-category': TruthState<QueueFacts>;
  readonly 'inventory.needs-condition-details': TruthState<QueueFacts>;
  readonly 'governance.open-corrections': TruthState<{ readonly count: number }>;
  readonly 'inventory.record-count': TruthState<{ readonly count: number }>;
  readonly 'sell.listing-prep-backlog': TruthState<PrepSummary>;
  readonly 'intake.open-sessions': TruthState<IntakeFacts>;
}

export type WorkbenchFactKey = keyof WorkbenchFacts;

const ALL_LOADING: WorkbenchFacts = {
  'inventory.needs-location': loading(),
  'inventory.needs-photos': loading(),
  'inventory.unclassified-category': loading(),
  'inventory.needs-condition-details': loading(),
  'governance.open-corrections': loading(),
  'inventory.record-count': loading(),
  'sell.listing-prep-backlog': loading(),
  'intake.open-sessions': loading(),
};

/**
 * A proven count becomes `empty` at zero and `ready` above it.
 *
 * This is the ONE place a zero is allowed to be created, and it is reachable
 * only from a resolved response. There is no path from a rejection to this
 * function.
 */
function countState<T>(count: number, value: T): TruthState<T> {
  return count === 0 ? empty() : ready(value);
}

function queueRecord(row: {
  subject_kind: 'item' | 'lot';
  subject_id: string;
  subject_public_id: string;
  display_name: string;
}): QueueRecord {
  return {
    kind: row.subject_kind,
    id: row.subject_id,
    publicId: row.subject_public_id,
    displayName: row.display_name,
  };
}

function overviewRecord(row: RecordOverviewRow): QueueRecord {
  // The record stream and the work queue name their columns differently. This
  // is the one place that difference is reconciled — as it was before.
  return {
    kind: row.record_kind,
    id: row.record_id,
    publicId: row.record_public_id,
    displayName: row.product_display_name,
  };
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export interface WorkbenchDataSources {
  readonly inventory: InventoryData | null;
  readonly listingPrep: { summary(): Promise<PrepSummary> } | null;
  readonly intake: {
    listSessions(
      workspaceId: string,
      limit: number,
      offset: number,
      state: 'open',
    ): Promise<{ total: number; sessions: readonly IntakeSessionListItem[] }>;
  } | null;
  readonly workspaceId: string | null;
}

/**
 * Read every Workbench fact, each independently.
 *
 * Deliberately NOT one `Promise.all`. A single rejected promise there rejects
 * the whole batch, and the old page's shared `catch` is precisely how one
 * failing query blanked seven working ones. Each source below settles on its
 * own and writes only its own key.
 */
export function useWorkbenchFacts(sources: WorkbenchDataSources): {
  readonly facts: WorkbenchFacts;
  readonly refresh: () => void;
} {
  const [facts, setFacts] = useState<WorkbenchFacts>(ALL_LOADING);
  const [nonce, setNonce] = useState(0);
  // Guards against a late response from a previous workspace overwriting the
  // current one — the behaviour the existing Workbench test pins.
  const requestId = useRef(0);

  const { inventory, listingPrep, intake, workspaceId } = sources;

  const run = useCallback(() => {
    const activeRequest = ++requestId.current;
    setFacts(ALL_LOADING);

    const isStale = () => activeRequest !== requestId.current;
    const put = <K extends WorkbenchFactKey>(key: K, state: WorkbenchFacts[K]) => {
      if (isStale()) return;
      setFacts((previous) => ({ ...previous, [key]: state }));
    };

    if (!inventory || !workspaceId) {
      // No workspace is a configuration fact about the session, not a proof
      // that the workspace holds nothing.
      const reason = 'No workspace is selected, so governed facts cannot be read.';
      put('inventory.needs-location', notConfigured(reason));
      put('inventory.needs-photos', notConfigured(reason));
      put('inventory.unclassified-category', notConfigured(reason));
      put('inventory.needs-condition-details', notConfigured(reason));
      put('governance.open-corrections', notConfigured(reason));
      put('inventory.record-count', notConfigured(reason));
      put('sell.listing-prep-backlog', notConfigured(reason));
      put('intake.open-sessions', notConfigured(reason));
      return;
    }

    // --- work queue counts feed three widgets, so one read serves them all ---
    void Promise.all([
      inventory.workQueueCounts(),
      inventory.workQueue('needs_location'),
      inventory.workQueue('needs_photos'),
    ]).then(
      ([counts, locationRows, photoRows]) => {
        put('inventory.record-count', countState(counts.total, { count: counts.total }));
        put(
          'inventory.needs-location',
          countState(counts.needsLocation, { count: counts.needsLocation, records: locationRows.map(queueRecord) }),
        );
        put(
          'inventory.needs-photos',
          countState(counts.needsPhotos, { count: counts.needsPhotos, records: photoRows.map(queueRecord) }),
        );
      },
      (reason) => {
        const state = failed('WORK_QUEUE_READ_FAILED', message(reason));
        put('inventory.record-count', state);
        put('inventory.needs-location', state);
        put('inventory.needs-photos', state);
      },
    );

    // --- operations queues ---
    void Promise.all([
      inventory.operationsQueueCounts(),
      inventory.operationsQueueRows('unclassified'),
      inventory.operationsQueueRows('needs_condition_details'),
    ]).then(
      ([counts, unclassifiedRows, conditionRows]) => {
        put(
          'inventory.unclassified-category',
          countState(counts.unclassified, {
            count: counts.unclassified,
            records: unclassifiedRows.map(overviewRecord),
          }),
        );
        put(
          'inventory.needs-condition-details',
          countState(counts.needsConditionDetails, {
            count: counts.needsConditionDetails,
            records: conditionRows.map(overviewRecord),
          }),
        );
      },
      (reason) => {
        const state = failed('OPERATIONS_QUEUE_READ_FAILED', message(reason));
        put('inventory.unclassified-category', state);
        put('inventory.needs-condition-details', state);
      },
    );

    // --- corrections ---
    void inventory.openCorrectionCount().then(
      (count) => put('governance.open-corrections', countState(count, { count })),
      (reason) => put('governance.open-corrections', failed('CORRECTION_COUNT_FAILED', message(reason))),
    );

    // --- listing preparation ---
    if (!listingPrep) {
      put('sell.listing-prep-backlog', notConfigured('Listing preparation is not configured in this build.'));
    } else {
      void listingPrep.summary().then(
        (summary) => put('sell.listing-prep-backlog', ready(summary)),
        (reason) => put('sell.listing-prep-backlog', failed('LISTING_PREP_SUMMARY_FAILED', message(reason))),
      );
    }

    // --- intake sessions ---
    if (!intake) {
      // A disabled transport is an unavailable source, not evidence that the
      // workspace has zero open sessions. The old page got this one right and
      // the behaviour is preserved exactly.
      put('intake.open-sessions', notConfigured('The intake surface is not enabled in this build.'));
    } else {
      void intake.listSessions(workspaceId, 10, 0, 'open').then(
        (page) => put('intake.open-sessions', countState(page.total, { total: page.total, sessions: page.sessions })),
        (reason) => put('intake.open-sessions', failed('INTAKE_SESSIONS_READ_FAILED', message(reason))),
      );
    }
  }, [inventory, listingPrep, intake, workspaceId]);

  useEffect(() => {
    run();
    return () => {
      requestId.current += 1;
    };
  }, [run, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(() => ({ facts, refresh }), [facts, refresh]);
}

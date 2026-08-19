// The governed Cost Allocation landing page — S2.5 Batch 1.
//
// It answers one question: for every governed acquisition cost, is it a cost
// basis yet, and if not, why not.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM
//
// There is NO headline total anywhere on this page. Not "total unallocated
// cost", not "total cost this month", not a single summed figure. Three
// independent reasons, any one of which is sufficient:
//
//   1. components in a workspace may be in DIFFERENT CURRENCIES, and adding
//      them would produce a number that is true in no currency;
//   2. some components have NO KNOWN AMOUNT, and any total would have to treat
//      those as zero, which is the fabrication this whole application is built
//      to prevent;
//   3. the queue is assembled from bounded reads, so it may be a SUBSET, and a
//      total over a subset reads exactly like a total over everything.
//
// The page therefore states counts of components by attribution state — which
// the database proved — and shows each amount individually, with its currency
// and its state attached. An owner can draw their own conclusion; the page does
// not draw one for them and present it as arithmetic.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  CoverageNotice,
  DataTable,
  ResponsiveRecordList,
  hasValue,
  ready,
  type TruthState,
} from '../design-system';
import {
  costQueueKey,
  createCostTransport,
  unresolvedCostKey,
  type AllocationWorkflowState,
  type CostComponentSummary,
} from '../lib/costApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { COST_COVERAGE, costQueueState, unresolvedCostState } from './cost/costTruth';
import { UnresolvedCostPanel } from './cost/UnresolvedCostPanel';
import { WORKFLOW_LABEL, costColumns, costRecords } from './cost/costPresentation';

/**
 * The states worth counting on the landing page, in workflow order.
 *
 * Every state is counted, including the ones that need no action, because a
 * list of only the problems makes a workspace look broken and a list of only
 * the successes makes it look finished.
 */
/**
 * The empty answer, written once and used by both renderings.
 *
 * "This is an answer, not a failure to look" is the whole point of the
 * sentence: an empty cost queue and an unreadable one must never share a
 * phrasing, and the failure states are rendered by the truth contract instead.
 */
const EMPTY_QUEUE = {
  title: 'No governed cost components',
  description:
    'The governed backend answered and returned no acquisition cost components for this workspace.',
} as const;

const COUNTED_STATES: readonly AllocationWorkflowState[] = [
  'awaiting_proposal',
  'proposed_awaiting_confirmation',
  'allocated',
  'directly_attributed',
  'amount_not_known',
  'component_reversed',
];

export default function Cost() {
  const { workspace } = useWorkspace();

  const api = useMemo(
    () =>
      createCostTransport(
        tokenProviderFromClient(
          createShadowClient(import.meta.env as unknown as Record<string, string | undefined>),
        ),
      ),
    [],
  );

  const enabled = Boolean(workspace);
  const queue = useQuery({
    queryKey: costQueueKey(workspace?.id),
    queryFn: () => api.queue(workspace!.id),
    enabled,
  });

  /*
   * A SEPARATE governed read from the component queue, on purpose.
   *
   * The two answer different questions from different surfaces. Sharing one
   * query would mean a failure in either blanks both — and an owner who can
   * still see the component list while triage is unavailable is strictly better
   * off than one staring at a page that lost everything.
   */
  const unresolved = useQuery({
    queryKey: unresolvedCostKey(workspace?.id),
    queryFn: () => api.unresolved(workspace!.id),
    enabled,
  });

  const rowsTruth = costQueueState(queue, enabled);
  const rows = hasValue(rowsTruth) ? rowsTruth.value : [];
  const unresolvedTruth = unresolvedCostState(unresolved, enabled);

  /**
   * Counts, computed only from rows we actually hold.
   *
   * When the answer is a SUBSET these are counts of the subset, and the page
   * says so beside them rather than letting them read as counts of everything.
   *
   * Deliberately NOT memoised. `rows` falls back to a fresh `[]` whenever the
   * truth state carries no value, so a `useMemo` keyed on it would recompute
   * every render anyway — a memo that never memoises is worse than none,
   * because it claims a guarantee it does not provide. This is one pass over a
   * bounded list.
   */
  const counts = countByState(rows);
  const countsAreOfSubset = rowsTruth.kind === 'partial' || rowsTruth.kind === 'stale';

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <header className="grid gap-1">
        <h1 className="font-display text-xl font-semibold text-ink">Cost allocation</h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          Every governed acquisition cost, and whether it has become a cost basis. A shared cost —
          shipping, a fee, a tax charged once for a whole order — is not a cost basis for any line
          until a split has been proposed and confirmed. Nothing on this page changes what a source
          reported; it records how a real charge is attributed.
        </p>
      </header>

      <CoverageNotice coverage={COST_COVERAGE} />

      {/*
        TRIAGE FIRST. The question "what needs attention" is the one an owner
        arrives with; the full component record answers "what is the picture"
        and sits beneath it.
      */}
      <UnresolvedCostPanel
        state={unresolvedTruth}
        meta={unresolved.data}
        onRetry={() => void unresolved.refetch()}
        onRefresh={() => void unresolved.refetch()}
      />

      {/*
        A deliberate, prominent statement of what is NOT here. An owner looking
        at a cost page expects a total, and its absence would otherwise read as
        an oversight rather than as the refusal it is.
      */}
      <Alert tone="information" title="There is no total on this page, on purpose">
        Cost components in this workspace can be in different currencies, and some have no amount the
        source ever reported. Adding them together would produce a figure that is true in no currency
        and that silently counts an unknown amount as zero. Each amount is shown on its own, with its
        currency and whether it is known.
      </Alert>

      <section aria-label="Attribution counts" className="grid gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          Components by attribution
        </h2>
        {countsAreOfSubset && (
          <p className="text-xs text-ink-secondary">
            These count only the components below, which are not the whole picture.
          </p>
        )}
        <ul
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          data-cost-counts
        >
          {COUNTED_STATES.map((state) => (
            <li
              key={state}
              className="rounded-instrument border border-subtle bg-surface-raised px-3 py-2"
              data-cost-count={state}
            >
              <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                {WORKFLOW_LABEL[state]}
              </span>
              <span className="mt-0.5 block text-lg tabular-nums text-ink">{counts[state]}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
        Two renderings of ONE model, handed over by `DataTable`'s own responsive
        slot rather than by two independently mounted copies.

        The record list takes a truth state of RECORDS, not of rows: it derives
        what it renders from `state.value`, so the domain rows have to be mapped
        before they are handed over. An earlier version of this page passed the
        raw summaries and a separate `records` prop, which rendered a list of
        empty cards on every phone-width viewport — the desktop table was fine,
        so nothing in jsdom noticed. The browser gate did.
      */}
      <DataTable
        caption="Governed cost components"
        state={rowsTruth}
        columns={costColumns()}
        rowKey={(row: CostComponentSummary) => row.componentPublicId}
        empty={EMPTY_QUEUE}
        onRetry={() => void queue.refetch()}
        // Six columns is a sideways scroll on a tablet in portrait, so the
        // table hands over to records at `lg`, matching Receiving.
        responsiveBreakpoint="lg"
        responsive={
          <ResponsiveRecordList
            label="Governed cost components"
            state={hasValue(rowsTruth) ? ready(costRecords(rows)) : (rowsTruth as TruthState<never>)}
            empty={EMPTY_QUEUE}
            onRetry={() => void queue.refetch()}
            onRefresh={() => void queue.refetch()}
          />
        }
      />
    </div>
  );
}

function countByState(
  rows: readonly CostComponentSummary[],
): Record<AllocationWorkflowState, number> {
  const counts: Record<AllocationWorkflowState, number> = {
    directly_attributed: 0,
    awaiting_proposal: 0,
    proposed_awaiting_confirmation: 0,
    allocated: 0,
    amount_not_known: 0,
    component_reversed: 0,
  };
  for (const row of rows) counts[row.workflowState] += 1;
  return counts;
}

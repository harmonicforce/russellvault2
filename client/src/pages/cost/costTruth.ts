// Cost allocation in the S1.6 truth vocabulary.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: A FAILED RETRIEVAL IS NEVER A ZERO.
//
// The failure is sharper here than anywhere else in the application, because
// cost is the one domain where a wrong zero is INDISTINGUISHABLE FROM A REAL
// ANSWER. "There are no unallocated costs" and "we could not find out whether
// there are unallocated costs" render identically as an empty table, and they
// demand opposite actions: one means the books are attributed, the other means
// nobody knows what anything cost. An owner acting on the wrong one prices
// inventory against a basis that was never established.
//
// So every failure mode is derived here, once, and nothing below can turn a
// rejection into a record, a count, a total, or an empty list.

import {
  empty,
  failed,
  loading,
  notConfigured,
  partial,
  ready,
  stale,
  unauthorized,
  unavailable,
  type CoverageGap,
  type TruthState,
} from '../../design-system';
import {
  CostError,
  type CostComponentSummary,
  type CostComponentView,
  type CostQueue,
} from '../../lib/costApi';

export interface QueryLike<T> {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

/**
 * The coverage of the cost surface.
 *
 * `safeToAggregate: false` is load-bearing, and for two independent reasons.
 *
 * First, the same reason it is false for receiving: governed acquisition cost
 * components and the legacy application's purchase history describe different
 * populations, so a combined figure is true of neither.
 *
 * Second, and specific to cost: components in this workspace may be in ANY
 * currency, and some have no known amount at all. A single headline total would
 * have to either add different currencies together or silently treat an unknown
 * amount as zero. Both are fabrications, so no such total is offered anywhere.
 */
export const COST_COVERAGE: CoverageGap = {
  included: 'Committed governed-native acquisition cost components and their allocations.',
  missing: 'Historical legacy purchase costs, which have not been imported.',
  safeToAggregate: false,
};

export function errorCode(error: unknown): string {
  return error instanceof CostError ? error.code : 'cost_unavailable';
}

function errorStatus(error: unknown): number | null {
  return error instanceof CostError ? error.status : null;
}

/**
 * The shared failure ladder.
 *
 * Every cost read answers the same questions in the same order, so they are
 * asked in one place rather than duplicated per surface and allowed to drift.
 */
function failureState<T>(error: unknown, subject: string): TruthState<T> {
  const code = errorCode(error);
  const status = errorStatus(error);

  if (code === 'signed_out' || status === 401) {
    return unauthorized(`Your session is no longer signed in, so ${subject} cannot be read.`);
  }
  if (status === 403 || code === 'unauthorized_workspace') {
    return unauthorized(`You are not permitted to read ${subject} in this workspace.`);
  }
  if (code.endsWith('_contract_missing')) {
    return notConfigured(
      'The governed cost contract is not deployed here. A database update has not been applied to this environment.',
    );
  }
  if (status !== null && status >= 500) {
    return unavailable(`The governed cost service did not answer, so ${subject} is unknown.`);
  }
  return failed(code, `The request for ${subject} was refused.`);
}

/**
 * What the landing page knows about the cost queue.
 *
 * `partial` is a real outcome, not a nicety: the queue is assembled from
 * bounded reads, and a workspace large enough to reach a ceiling gets a subset.
 * Rendering that subset as if it were the whole picture would let an owner
 * conclude every cost is attributed when the answer was simply cut short.
 */
export function costQueueState(
  query: QueryLike<CostQueue>,
  workspaceSelected: boolean,
): TruthState<readonly CostComponentSummary[]> {
  if (!workspaceSelected) {
    return notConfigured('No workspace is selected, so no governed cost components can be read.');
  }

  if (query.isError) {
    // A failed RE-READ of a queue we already hold is stale, not gone. The owner
    // keeps the list in front of them and is told it may have moved, rather
    // than losing the page mid-review.
    if (query.data) {
      return stale(query.data.rows, {
        label: 'The cost queue could not be re-read, so what is shown may no longer be current.',
        canRefresh: true,
      });
    }
    return failureState(query.error, 'the cost queue');
  }

  if (query.isLoading || !query.data) return loading();

  const { rows, complete } = query.data;
  if (!complete) {
    return partial(rows, {
      included: 'Part of the governed cost components for this workspace.',
      missing:
        'Further cost components. The governed read reached its size limit, so components may be absent from this list.',
      // A subset must never be summed into a headline figure.
      safeToAggregate: false,
    });
  }
  // An authoritative answer that PROVED there are no governed cost components.
  if (rows.length === 0) return empty();
  return ready(rows);
}

/**
 * What the component workspace knows about one cost component.
 *
 * A 404 is `empty`, not a failure: the governed backend answered and proved
 * there is no such component in this workspace.
 */
export function costComponentState(
  query: QueryLike<CostComponentView>,
  workspaceSelected: boolean,
): TruthState<CostComponentView> {
  if (!workspaceSelected) {
    return notConfigured('No workspace is selected, so no governed cost component can be read.');
  }

  if (query.isError) {
    // Load-bearing during proposal recovery: an owner resolving an unconfirmed
    // proposal needs the component and its controls on screen. A full-page
    // error would remove both at the moment they are needed most.
    if (query.data) {
      return stale(query.data, {
        label: 'The governed cost component could not be re-read, so what is shown may no longer be current.',
        canRefresh: true,
      });
    }

    const code = errorCode(query.error);
    const status = errorStatus(query.error);
    if (status === 404 || code === 'cost_component_not_found') return empty();
    return failureState(query.error, 'this cost component');
  }

  if (query.isLoading || !query.data) return loading();
  return ready(query.data);
}

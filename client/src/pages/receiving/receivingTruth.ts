// Receiving in the S1.6 truth vocabulary.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: A FAILED RETRIEVAL IS NEVER A ZERO.
//
// "There is no receiving work" and "we could not find out whether there is
// receiving work" look identical on a screen that renders both as an empty
// table, and they demand opposite actions — one means go home, the other means
// escalate. A receiving operator acting on the wrong one either walks away from
// a full pallet or chases a delivery that was already filed.
//
// So every failure mode is derived here, once, and nothing below can turn a
// rejection into a record, a count, or an empty list.

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
  ReceivingError,
  type ReceivingQueue,
  type ReceivingQueueRow,
  type ReceivingReceiptDetail,
} from '../../lib/receivingApi';

export interface QueryLike<T> {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

/**
 * The coverage of the receiving surface.
 *
 * `safeToAggregate: false` is load-bearing. Governed receiving evidence and the
 * legacy application's purchase history describe different populations; a
 * combined figure would be true of neither.
 */
export const RECEIVING_COVERAGE: CoverageGap = {
  included: 'Committed governed-native acquisition orders and their receiving evidence.',
  missing: 'Historical legacy Whatnot purchases, which have not been imported.',
  safeToAggregate: false,
};

export function errorCode(error: unknown): string {
  return error instanceof ReceivingError ? error.code : 'receiving_unavailable';
}

function errorStatus(error: unknown): number | null {
  return error instanceof ReceivingError ? error.status : null;
}

/**
 * The shared failure ladder.
 *
 * Every receiving read answers the same five questions in the same order, so
 * they are asked in one place rather than duplicated per surface and allowed to
 * drift apart.
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
      'The governed receiving contract is not deployed here. A database update has not been applied to this environment.',
    );
  }
  if (status !== null && status >= 500) {
    return unavailable(`The governed receiving service did not answer, so ${subject} is unknown.`);
  }
  return failed(code, `The request for ${subject} was refused.`);
}

/**
 * What the landing page knows about the receiving queue.
 *
 * `partial` is a real outcome here, not a nicety: the queue is assembled from
 * bounded reads, and a workspace large enough to reach a ceiling gets a subset.
 * Rendering that subset as if it were the whole queue would let an operator
 * conclude there is no outstanding work when the answer was simply cut short.
 */
export function queueState(
  query: QueryLike<ReceivingQueue>,
  workspaceSelected: boolean,
): TruthState<readonly ReceivingQueueRow[]> {
  if (!workspaceSelected) {
    return notConfigured('No workspace is selected, so no governed receiving work can be read.');
  }

  if (query.isError) {
    // A failed RE-READ of a queue we already hold is stale, not gone. The
    // operator keeps the work list in front of them and is told it may have
    // moved, rather than losing the page mid-shift.
    if (query.data) {
      return stale(query.data.rows, {
        label: 'The receiving queue could not be re-read, so what is shown may no longer be current.',
        canRefresh: true,
      });
    }
    return failureState(query.error, 'the receiving queue');
  }

  if (query.isLoading || !query.data) return loading();

  const { rows, complete } = query.data;
  if (!complete) {
    return partial(rows, {
      included: 'Part of the governed receiving queue for this workspace.',
      missing:
        'Further acquisition orders. The governed read reached its size limit, so orders may be absent from this list.',
      // A subset must never be summed into a headline figure: a total derived
      // from part of the queue is true of neither the part nor the whole.
      safeToAggregate: false,
    });
  }
  // An authoritative answer that PROVED there is nothing to receive.
  if (rows.length === 0) return empty();
  return ready(rows);
}

/**
 * What the receipt workspace knows about one receipt.
 *
 * A 404 is `empty`, not a failure: the governed backend answered and proved
 * there is no such receipt.
 */
export function receiptState(
  query: QueryLike<ReceivingReceiptDetail>,
  workspaceSelected: boolean,
): TruthState<ReceivingReceiptDetail> {
  if (!workspaceSelected) {
    return notConfigured('No workspace is selected, so no governed receipt can be read.');
  }

  if (query.isError) {
    // Load-bearing during mutation recovery: an operator resolving an
    // unconfirmed correction needs the receipt and its controls on screen. A
    // full-page error would remove both at the moment they are needed.
    if (query.data) {
      return stale(query.data, {
        label: 'The governed receipt could not be re-read, so what is shown may no longer be current.',
        canRefresh: true,
      });
    }

    const code = errorCode(query.error);
    const status = errorStatus(query.error);
    if (status === 404 || code === 'receipt_not_found') return empty();
    return failureState(query.error, 'this receipt');
  }

  if (query.isLoading || !query.data) return loading();
  return ready(query.data);
}

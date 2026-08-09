// Translating the acquisition detail request into the S1.6 truth vocabulary.
//
// WHY EACH FAILURE IS A DIFFERENT ANSWER
//
// The previous page had three outcomes: a loading line, one red box whose
// heading was chosen by an inline ternary on `status`, and the record. That is
// not enough vocabulary for the questions an operator actually has. "This
// acquisition line does not exist", "you may not read this one", "your session
// ended", "the dependency did not answer", and "this deployment does not carry
// the read contract" demand five different next actions, and collapsing them
// into one red box means the operator takes the wrong one.
//
// So each is derived here, once, and rendered by the shared truth-state
// presentation. This module is pure: it reads query state and returns truth. It
// does not fetch, and no branch below can turn a rejection into a record, a
// zero, or an assumption about what exists.

import {
  empty,
  failed,
  loading,
  notConfigured,
  ready,
  stale,
  unauthorized,
  unavailable,
  type CoverageGap,
  type TruthState,
} from '../../design-system';
import { AcquisitionDetailError, type AcquisitionDetail } from '../../lib/acquisitionDetailApi';

/** The shape of a TanStack query, reduced to what truth derivation needs. */
export interface QueryLike<T> {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

/**
 * The bounded code the governed backend named.
 *
 * `AcquisitionDetailError` already carries a closed code from the server, so it
 * is surfaced verbatim rather than flattened — an operator reporting a problem
 * can name the same thing the server logged.
 */
export function errorCode(error: unknown): string {
  if (error instanceof AcquisitionDetailError) return error.code;
  return 'acquisition_detail_unavailable';
}

function errorStatus(error: unknown): number | null {
  return error instanceof AcquisitionDetailError ? error.status : null;
}

/**
 * The governed coverage of this surface.
 *
 * Constant because it is a property of the DEPLOYMENT, not of the record: the
 * detail transport states `coverage: 'governed_native_committed'` and
 * `historicalLegacyImported: false` on every response. It is declared here so
 * the page cannot drift into implying a reconciliation that has not happened.
 *
 * `safeToAggregate` is false, and that is the load-bearing field: governed and
 * legacy figures must never be added together, and a partial subset that gets
 * silently summed becomes a confident wrong total.
 */
export const ACQUISITION_COVERAGE: CoverageGap = {
  included: 'Committed governed-native acquisition evidence for this workspace.',
  missing: 'Historical legacy Whatnot acquisition history, which has not been imported.',
  safeToAggregate: false,
};

/**
 * What the page knows about the acquisition line.
 *
 * A 404 is `empty`, not a failure: the governed backend answered, and it proved
 * there is no such line. That distinction is the whole point of the contract —
 * "no such record" and "we could not find out" send the operator in opposite
 * directions, and only one of them is worth retrying.
 */
export function detailState(
  query: QueryLike<AcquisitionDetail>,
  workspaceSelected: boolean,
): TruthState<AcquisitionDetail> {
  if (!workspaceSelected) {
    // Nothing has been asked yet. Not a zero, and nothing has failed.
    return notConfigured('No workspace is selected, so no governed acquisition detail can be read.');
  }

  if (query.isError) {
    // A failed RE-READ of a record we already hold is stale, not gone.
    //
    // This matters most during mutation recovery: an operator resolving an
    // unconfirmed payment needs the record in front of them, and replacing it
    // with a full-page error would take away both the evidence and the recovery
    // controls at the exact moment they are needed. So the record stays, and
    // the page says plainly that it may no longer be current.
    if (query.data) {
      return stale(query.data, {
        label: 'The governed acquisition detail could not be re-read, so what is shown may no longer be current.',
        canRefresh: true,
      });
    }

    const code = errorCode(query.error);
    const status = errorStatus(query.error);

    if (status === 404 || code === 'acquisition_not_found' || code === 'acquisition_line_not_found') {
      // An authoritative answer that PROVED there is no such record.
      return empty();
    }

    if (code === 'signed_out' || status === 401) {
      return unauthorized('Your session is no longer signed in, so this governed acquisition cannot be read.');
    }

    if (status === 403 || code === 'unauthorized_workspace') {
      // Deliberately says nothing about whether the line exists: "there is no
      // such line" and "there is one you may not read" are both disclosures.
      return unauthorized('You are not permitted to read this acquisition line in this workspace.');
    }

    if (code.endsWith('_contract_missing')) {
      return notConfigured('The governed acquisition detail read contract is not deployed here.');
    }

    if (status !== null && status >= 500) {
      return unavailable('The governed acquisition service did not answer.');
    }

    return failed(code, 'The governed acquisition detail request was refused.');
  }

  if (query.isLoading || !query.data) return loading();
  return ready(query.data);
}

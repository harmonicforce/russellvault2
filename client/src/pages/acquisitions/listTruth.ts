// Translating TanStack Query state into the S1.6 TruthState vocabulary.
//
// LINES AND FACETS ARE SEPARATE DEPENDENCIES, AND THAT IS THE POINT.
//
// The previous page collapsed them: `lines.isError || facets.isError` rendered
// one "Acquisition data could not be loaded" screen, so a failed FACETS request
// — which only supplies filter suggestions and a classification summary —
// destroyed a perfectly good page of governed acquisition lines the operator
// could have worked from.
//
// So each dependency is derived independently here, and the page renders both.
// A facet failure costs the operator their suggestions and their summary. It
// does not cost them the list, the exact total, or the truthfulness of the
// filter they already have applied.
//
// This module is pure: it reads query state and returns truth. It does not
// fetch, and there is no path here from a rejection to a zero.

import { empty, failed, loading, ready, type TruthState } from '../../design-system';
import { AcquisitionLinesError, type AcquisitionFacets, type AcquisitionLine } from '../../lib/acquisitionLinesApi';

/** The shape of a TanStack query, reduced to what truth derivation needs. */
export interface QueryLike<T> {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly isFetching: boolean;
}

export interface LinesPayload {
  readonly total: number;
  readonly rows: AcquisitionLine[];
}

export interface FacetsPayload {
  readonly facets: AcquisitionFacets;
}

/**
 * A transport error's bounded code.
 *
 * `AcquisitionLinesError` already carries a closed `code` from the server
 * (`invalid_filter`, `dependency_failed`, `unauthorized_workspace`, …). It is
 * surfaced verbatim rather than flattened, so an operator reporting a problem
 * can name the same thing the server logged.
 */
export function errorCode(error: unknown): string {
  if (error instanceof AcquisitionLinesError) return error.code;
  return 'acquisition_read_unavailable';
}

function errorMessage(error: unknown): string {
  const code = errorCode(error);
  switch (code) {
    case 'signed_out':
      return 'Your session is no longer signed in.';
    case 'unauthorized_workspace':
      return 'You are not a member of this workspace.';
    case 'invalid_filter':
    case 'invalid_sort':
      return 'The governed backend refused one of these filters.';
    case 'acquisition_read_contract_missing':
      return 'The governed acquisition read contract is not deployed here.';
    default:
      return 'The governed acquisition service did not return a result.';
  }
}

/**
 * The rows for the current page.
 *
 * `empty` is reserved for a request that SUCCEEDED and returned nothing. A
 * rejection becomes `error`, and no branch below can produce `empty` from one.
 */
export function linesState(
  query: QueryLike<LinesPayload>,
  workspaceSelected: boolean,
): TruthState<readonly AcquisitionLine[]> {
  if (!workspaceSelected) {
    // Not a zero and not a failure: nothing has been asked yet.
    return { kind: 'notConfigured', reason: 'No workspace is selected, so no acquisition lines can be read.' };
  }
  if (query.isError) return failed(errorCode(query.error), errorMessage(query.error));
  if (query.isLoading || !query.data) return loading();
  return query.data.rows.length === 0 ? empty() : ready(query.data.rows);
}

/**
 * The exact filtered total, derived SEPARATELY from the rows.
 *
 * Separate because the header must be able to say "137 filtered lines" while
 * the table for this page is empty, and must never say "0" merely because the
 * rows have not arrived. `ready(0)` is a real, authoritative zero; `loading()`
 * is not a zero at all.
 *
 * It is read from the server payload and never from `rows.length`, which
 * pagination makes false the moment there is more than one page.
 */
export function totalState(query: QueryLike<LinesPayload>, workspaceSelected: boolean): TruthState<number> {
  if (!workspaceSelected) {
    return { kind: 'notConfigured', reason: 'No workspace is selected.' };
  }
  if (query.isError) return failed(errorCode(query.error), errorMessage(query.error));
  if (query.isLoading || !query.data) return loading();
  return ready(query.data.total);
}

/**
 * Filter suggestions and the classification summary.
 *
 * A failure here is genuinely less serious than a lines failure, and the page
 * renders it as its own smaller notice. What it must never do is manufacture
 * empty facet lists: "no sellers exist" and "we could not read which sellers
 * exist" are different facts, and the first one silently narrows what the
 * operator believes they can filter by.
 */
export function facetsState(
  query: QueryLike<FacetsPayload>,
  workspaceSelected: boolean,
): TruthState<AcquisitionFacets> {
  if (!workspaceSelected) {
    return { kind: 'notConfigured', reason: 'No workspace is selected, so filter suggestions cannot be read.' };
  }
  if (query.isError) return failed(errorCode(query.error), errorMessage(query.error));
  if (query.isLoading || !query.data) return loading();
  return ready(query.data.facets);
}

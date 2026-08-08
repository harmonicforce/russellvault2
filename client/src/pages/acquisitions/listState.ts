// The Acquisitions list URL contract.
//
// THE URL IS THE LIST STATE. There is no parallel component state for query,
// filters, sort, order or page — an operator who copies the address bar, hits
// back, or reloads gets exactly the list they were looking at, because the
// address bar IS the list they were looking at.
//
// FAIL CLOSED
//
// Every filter below is a CLOSED vocabulary that the server also enforces
// (`server/src/routes/acquisition.ts`). A value outside it is an unsupported
// filter, not a no-op: it never reaches the transport, it is stripped from the
// URL, and the operator is told. The failure this prevents is the quiet one —
// an unfiltered page displayed while the address bar still claims a filter is
// applied, which an operator reads as "there are none of those".
//
// This module is pure. It parses, validates and rewrites; it does not fetch and
// it does not render.

import type {
  AcquisitionExclusionState,
  AcquisitionOrder,
  AcquisitionSort,
  LineParams,
} from '../../lib/acquisitionLinesApi';

export const PAGE_SIZE = 50;

// --- closed vocabularies, mirrored from the server ---------------------------
// Each list is the SAME set the route validates. A client vocabulary that
// disagreed with the backend would either hide a supported filter or send one
// the server rejects with `invalid_filter`.

export const SORT_KEYS = [
  'occurred_at',
  'created_at',
  'seller',
  'title',
  'quantity',
  'classification',
] as const satisfies readonly AcquisitionSort[];

export const ORDERS = ['asc', 'desc'] as const satisfies readonly AcquisitionOrder[];

export const CLASSIFICATION_STATES = ['classified', 'needs_review', 'unclassified'] as const;

export const EXCLUSION_STATES = ['included', 'excluded'] as const satisfies readonly AcquisitionExclusionState[];

/**
 * Classification methods.
 *
 * Verified against `server/src/routes/acquisition.ts`, which validates
 * `req.query.method` against exactly this set and answers `invalid_filter`
 * (400) for anything else. The transport already carried `method` and the
 * facets already expose method counts — this slice surfaces an existing
 * backend capability rather than inventing a business rule.
 */
export const CLASSIFICATION_METHODS = [
  'rule',
  'owner_override',
  'seller_specialization',
  'explicit_evidence',
  'system_fallback',
] as const;

export type ClassificationMethod = (typeof CLASSIFICATION_METHODS)[number];

/** Operator-facing wording for a method key. Presentation only. */
export const METHOD_LABELS: Record<ClassificationMethod, string> = {
  rule: 'Rule',
  owner_override: 'Owner override',
  seller_specialization: 'Seller specialization',
  explicit_evidence: 'Explicit evidence',
  system_fallback: 'System fallback',
};

export const SORT_LABELS: Record<AcquisitionSort, string> = {
  occurred_at: 'Date',
  created_at: 'Recorded',
  seller: 'Seller',
  title: 'Product / title',
  quantity: 'Quantity',
  classification: 'Classification',
};

/** Which direction a freshly chosen column should start in. */
const INITIAL_ORDER: Record<AcquisitionSort, AcquisitionOrder> = {
  occurred_at: 'desc',
  created_at: 'desc',
  quantity: 'desc',
  seller: 'asc',
  title: 'asc',
  classification: 'asc',
};

const has = <T extends string>(values: readonly T[], candidate: string | null): candidate is T =>
  candidate !== null && (values as readonly string[]).includes(candidate);

// --- the free-text filters ---------------------------------------------------
// `query`, `classification`, `seller` and `businessVertical` are open-valued:
// the server passes them to the governed function as text and the facets supply
// suggestions. They are NOT validated against a client list, because inventing
// one would reject a seller the database legitimately holds.

export const OPEN_FILTER_KEYS = ['query', 'classification', 'seller', 'businessVertical'] as const;
export type OpenFilterKey = (typeof OPEN_FILTER_KEYS)[number];

export interface AcquisitionsListState {
  readonly query: string | null;
  readonly classification: string | null;
  readonly seller: string | null;
  readonly businessVertical: string | null;
  readonly method: ClassificationMethod | null;
  readonly classificationState: (typeof CLASSIFICATION_STATES)[number] | null;
  readonly exclusionState: AcquisitionExclusionState | null;
  readonly sort: AcquisitionSort;
  readonly order: AcquisitionOrder;
  readonly page: number;
}

/**
 * Read the list state from the URL, substituting defaults for anything
 * unsupported. `unsupported` names the parameters that must be removed.
 */
export function readListState(url: URLSearchParams): {
  readonly state: AcquisitionsListState;
  readonly unsupported: readonly string[];
} {
  const unsupported: string[] = [];

  const rawSort = url.get('sort');
  const sort: AcquisitionSort = has(SORT_KEYS, rawSort) ? rawSort : 'occurred_at';
  if (rawSort !== null && rawSort !== sort) unsupported.push('sort');

  const rawOrder = url.get('order');
  const order: AcquisitionOrder = has(ORDERS, rawOrder) ? rawOrder : 'desc';
  if (rawOrder !== null && rawOrder !== order) unsupported.push('order');

  const rawState = url.get('classificationState');
  const classificationState = has(CLASSIFICATION_STATES, rawState) ? rawState : null;
  if (rawState !== null && classificationState === null) unsupported.push('classificationState');

  const rawExclusion = url.get('exclusionState');
  const exclusionState = has(EXCLUSION_STATES, rawExclusion) ? rawExclusion : null;
  if (rawExclusion !== null && exclusionState === null) unsupported.push('exclusionState');

  const rawMethod = url.get('method');
  const method = has(CLASSIFICATION_METHODS, rawMethod) ? rawMethod : null;
  if (rawMethod !== null && method === null) unsupported.push('method');

  const rawPage = url.get('page');
  const page = Math.max(1, Number(rawPage) || 1);
  // `?page=0`, `?page=-3` and `?page=banana` all claim a page that does not
  // exist. The claim is removed rather than quietly rounded.
  if (rawPage !== null && String(page) !== rawPage) unsupported.push('page');

  return {
    state: {
      query: url.get('query') || null,
      classification: url.get('classification') || null,
      seller: url.get('seller') || null,
      businessVertical: url.get('businessVertical') || null,
      method,
      classificationState,
      exclusionState,
      sort,
      order,
      page,
    },
    unsupported,
  };
}

/** Remove the named parameters, leaving every supported one untouched. */
export function stripUnsupported(url: URLSearchParams, unsupported: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(url);
  for (const key of unsupported) next.delete(key);
  return next;
}

/** The transport parameters for a validated state. */
export function toLineParams(state: AcquisitionsListState): LineParams {
  return {
    query: state.query ?? undefined,
    classification: state.classification ?? undefined,
    seller: state.seller ?? undefined,
    businessVertical: state.businessVertical ?? undefined,
    method: state.method ?? undefined,
    classificationState: state.classificationState ?? undefined,
    exclusionState: state.exclusionState ?? undefined,
    sort: state.sort,
    order: state.order,
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
  };
}

/**
 * Set one parameter.
 *
 * Changing anything except the page resets to page 1, because page 4 of the
 * previous filter is not page 4 of this one — and an operator who lands on an
 * empty page 4 reads it as "there are none".
 */
export function setParam(url: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(url);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== 'page') next.delete('page');
  return next;
}

/**
 * Apply a sort column press.
 *
 * Pressing the active column flips the direction; pressing a new one starts it
 * in whichever direction is useful for that column — newest-first for dates and
 * largest-first for quantity, A–Z for the text columns.
 */
export function applySort(url: URLSearchParams, state: AcquisitionsListState, key: AcquisitionSort): URLSearchParams {
  const order: AcquisitionOrder =
    state.sort === key ? (state.order === 'asc' ? 'desc' : 'asc') : INITIAL_ORDER[key];
  const next = new URLSearchParams(url);
  next.set('sort', key);
  next.set('order', order);
  next.delete('page');
  return next;
}

/** Which filters are currently narrowing the list. Search is counted too. */
export function activeFilters(state: AcquisitionsListState): readonly string[] {
  const active: string[] = [];
  if (state.query) active.push('query');
  if (state.classification) active.push('classification');
  if (state.seller) active.push('seller');
  if (state.businessVertical) active.push('businessVertical');
  if (state.method) active.push('method');
  if (state.classificationState) active.push('classificationState');
  if (state.exclusionState) active.push('exclusionState');
  return active;
}

/**
 * Clear the filters, deliberately KEEPING the search term.
 *
 * The control is labelled "Clear filters", so it clears filters. A control that
 * also silently dropped what the operator typed would be lying about its own
 * name, and the search field has its own way to be emptied.
 */
export function clearFilters(url: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(url);
  for (const key of ['classification', 'seller', 'businessVertical', 'method', 'classificationState', 'exclusionState', 'page']) {
    next.delete(key);
  }
  return next;
}

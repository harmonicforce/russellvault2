// The truth-state contract.
//
// Every governed asynchronous surface has to be able to say exactly what it
// knows, and the type system is where that is enforced. The single most
// important property here:
//
//     A FAILED RETRIEVAL IS NEVER A ZERO.
//
// `empty` means an authoritative request succeeded and proved there are no
// results. `unavailable` means we could not find out. They render differently
// because they mean different things, and there is deliberately no helper
// anywhere in this module that turns a failure into a count, a total, or a
// zero — a dashboard reading "0 excluded lines" because the request failed is
// worse than one reading "unavailable", because the operator believes it.
//
// This module defines types and constructors. It does not fetch, and it does
// not rewrite domain query logic.

/** Currency-qualified money. There is no bare number for an amount. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** Why a surface can only show part of the picture. */
export interface CoverageGap {
  /** What IS included, in the operator's words. */
  readonly included: string;
  /** What is missing, when that is actually known. `null` means unknown. */
  readonly missing: string | null;
  /**
   * Whether the included subset may be aggregated. When false, a caller must
   * not sum, total, or average it — partial data that is summed silently
   * becomes a wrong number with no warning attached.
   */
  readonly safeToAggregate: boolean;
  /** An action the operator can take to complete coverage, when one exists. */
  readonly action?: { readonly label: string; readonly href?: string };
}

export type TruthState<T> =
  /** The authoritative answer has not arrived yet. */
  | { readonly kind: 'loading' }
  /** An authoritative answer arrived and has content. */
  | { readonly kind: 'ready'; readonly value: T }
  /** An authoritative answer arrived and PROVED there is nothing. */
  | { readonly kind: 'empty' }
  /** An authoritative answer arrived but covers only part of the question. */
  | { readonly kind: 'partial'; readonly value: T; readonly coverage: CoverageGap }
  /** A previously authoritative answer that may no longer be current. */
  | {
      readonly kind: 'stale';
      readonly value: T;
      /** When the value was last confirmed, where that is known. */
      readonly lastRefreshedAt: string | null;
      /** Operator-facing reason the value is stale. */
      readonly label: string;
      /** Whether a safe refresh is available from here. */
      readonly canRefresh: boolean;
    }
  /** The dependency could not answer. NOT zero, NOT empty. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  /** The caller is authenticated but not permitted to know. */
  | { readonly kind: 'unauthorized'; readonly reason: string }
  /** The surface cannot run because the deployment is not configured for it. */
  | { readonly kind: 'notConfigured'; readonly reason: string }
  /** The request failed in a bounded, named way. */
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

export type TruthStateKind = TruthState<unknown>['kind'];

/** One named member of the union, e.g. `TruthStateOf<'unavailable'>`. */
export type TruthStateOf<K extends TruthStateKind> = Extract<TruthState<never>, { kind: K }>;

/**
 * The states in which a surface could not establish the truth at all.
 *
 * `empty` is deliberately NOT one of them: it is a successful answer. `loading`
 * is not one either — the answer has not arrived, which is not the same as
 * having failed to arrive.
 */
export type IndeterminateTruthState =
  | TruthStateOf<'unavailable'>
  | TruthStateOf<'unauthorized'>
  | TruthStateOf<'notConfigured'>
  | TruthStateOf<'error'>;

/** Every state, for exhaustiveness checks and tests. */
export const TRUTH_STATE_KINDS = [
  'loading',
  'ready',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'unauthorized',
  'notConfigured',
  'error',
] as const satisfies ReadonlyArray<TruthStateKind>;

// --- Constructors -----------------------------------------------------------
// Named so the calling code has to state which of these it means. There is no
// `fromResponse(data, error)` convenience that could quietly pick `empty` when
// it should have picked `unavailable`.

// Each constructor returns its OWN member of the union rather than the whole
// union. Every narrowed member is still assignable to `TruthState<T>`, so no
// caller is constrained by this — but a component that accepts only some of the
// kinds (a dependency notice takes the four indeterminate ones, never
// `loading`) can now be handed `unavailable(...)` directly, without a cast that
// would let the wrong state through unchecked.
export const loading = (): TruthStateOf<'loading'> => ({ kind: 'loading' });
export const ready = <T>(value: T): Extract<TruthState<T>, { kind: 'ready' }> => ({ kind: 'ready', value });
export const empty = (): TruthStateOf<'empty'> => ({ kind: 'empty' });
export const partial = <T>(value: T, coverage: CoverageGap): Extract<TruthState<T>, { kind: 'partial' }> => ({
  kind: 'partial',
  value,
  coverage,
});
export const stale = <T>(
  value: T,
  options: { lastRefreshedAt?: string | null; label: string; canRefresh?: boolean },
): Extract<TruthState<T>, { kind: 'stale' }> => ({
  kind: 'stale',
  value,
  lastRefreshedAt: options.lastRefreshedAt ?? null,
  label: options.label,
  canRefresh: options.canRefresh ?? false,
});
export const unavailable = (reason: string): TruthStateOf<'unavailable'> => ({ kind: 'unavailable', reason });
export const unauthorized = (reason: string): TruthStateOf<'unauthorized'> => ({ kind: 'unauthorized', reason });
export const notConfigured = (reason: string): TruthStateOf<'notConfigured'> => ({ kind: 'notConfigured', reason });
export const failed = (code: string, message: string): TruthStateOf<'error'> => ({ kind: 'error', code, message });

// --- Inspection -------------------------------------------------------------

/** True only for states carrying a value the operator may act on. */
export function hasValue<T>(state: TruthState<T>): state is Extract<TruthState<T>, { value: T }> {
  return state.kind === 'ready' || state.kind === 'partial' || state.kind === 'stale';
}

/**
 * True when the surface could not establish the truth at all.
 *
 * `empty` is deliberately NOT in this set: it is a successful answer.
 */
export function isIndeterminate<T>(state: TruthState<T>): state is IndeterminateTruthState {
  return (
    state.kind === 'unavailable' ||
    state.kind === 'unauthorized' ||
    state.kind === 'notConfigured' ||
    state.kind === 'error'
  );
}

/**
 * Whether a value may be aggregated — summed, totalled, averaged, counted into
 * a headline figure.
 *
 * Only a fully `ready` value qualifies. `partial` qualifies solely when the
 * coverage gap explicitly says so, and no indeterminate state ever does. This
 * is the guard that stops a partial answer becoming a confident wrong total.
 */
export function isAggregationSafe<T>(state: TruthState<T>): boolean {
  if (state.kind === 'ready') return true;
  if (state.kind === 'partial') return state.coverage.safeToAggregate;
  return false;
}

/**
 * Sum money that is already known to be aggregation-safe.
 *
 * Refuses mixed currencies rather than returning a meaningless number: there
 * is no exchange rate here and inventing one would fabricate a financial fact.
 * Returns `null` when there is nothing to total, which the caller must render
 * as "no comparable total", never as 0.
 */
export function sumSameCurrency(amounts: ReadonlyArray<Money>): Money | null {
  if (amounts.length === 0) return null;
  const currency = amounts[0].currency;
  if (amounts.some((a) => a.currency !== currency)) return null;
  return { amountMinor: amounts.reduce((total, a) => total + a.amountMinor, 0), currency };
}

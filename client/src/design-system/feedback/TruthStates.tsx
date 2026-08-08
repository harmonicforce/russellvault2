import type { ReactNode } from 'react';
import type { IndeterminateTruthState, TruthState } from '../foundations/truthState';
import { Alert } from './Alert';
import { Button } from '../controls/Button';
import { CoverageNotice } from './CoverageNotice';

/**
 * Presentation for the truth-state contract.
 *
 * These components render what a surface KNOWS. They do not fetch, they do not
 * decide which state applies, and there is deliberately no component here that
 * accepts a `(data, error)` pair and picks a state for you — that choice is the
 * domain's, and a helper that made it would be the exact place a failure
 * quietly became a zero.
 *
 * The load-bearing rule, restated because this file is where it becomes
 * visible: A FAILED RETRIEVAL IS NEVER A ZERO. `EmptyState` is the only
 * component in this file that says there is nothing, and it may only be
 * rendered for `empty` — an authoritative answer that proved it.
 */

// --- loading ----------------------------------------------------------------

export interface LoadingStateProps {
  /** What is being established, in the operator's words. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * The authoritative answer has not arrived.
 *
 * `aria-busy` plus a polite live region, so a screen-reader operator is told
 * that the surface is working rather than being handed a silent blank region
 * that is indistinguishable from "there is nothing here".
 */
export function LoadingState({ label = 'Loading…', className = '' }: LoadingStateProps) {
  return (
    <p
      data-truth-state="loading"
      role="status"
      aria-busy="true"
      className={`px-3 py-8 text-center text-sm text-ink-muted ${className}`}
    >
      {label}
    </p>
  );
}

// --- empty ------------------------------------------------------------------

export interface EmptyStateProps {
  /** Short statement of the authoritative zero, e.g. "No lots recorded". */
  readonly title: string;
  /** Why that might be, or what to do next. Optional. */
  readonly description?: string;
  /** An action that would create the first record, when one exists. */
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * An authoritative request succeeded and PROVED there is nothing.
 *
 * This is the only "nothing here" presentation in the system, and it is the
 * only one that may be rendered for a successful zero. Anything that could not
 * establish the truth uses `DependencyState` instead, which looks and reads
 * differently on purpose.
 */
export function EmptyState({ title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      data-truth-state="empty"
      role="status"
      className={`flex flex-col items-center gap-2 px-3 py-8 text-center ${className}`}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-prose text-sm text-ink-secondary">{description}</p>}
      {/* Stated every time. An operator who cannot tell "there are none" from
          "we could not find out" will act on the wrong one eventually. */}
      <p className="text-xs text-ink-muted">This is a confirmed result, not a failed request.</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// --- indeterminate ----------------------------------------------------------

export interface DependencyStateProps {
  readonly state: IndeterminateTruthState;
  /** A safe retry, where the caller has one. Never offered for `unauthorized`. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly className?: string;
}

/**
 * The surface could not find out.
 *
 * Each kind reads differently because each MEANS something different, and the
 * operator's next action differs: retry, ask for access, configure the
 * deployment, or report a named failure. None of them renders a count, a total,
 * or the word "no results".
 *
 * `unauthorized` renders the caller's reason and nothing else. It never shows
 * the protected content, a count of it, or a hint about its size — leaking "23
 * records you may not see" is still leaking.
 */
export function DependencyState({ state, onRetry, retryLabel = 'Try again', className = '' }: DependencyStateProps) {
  const presentation = describeIndeterminate(state);

  return (
    <Alert
      tone={presentation.tone}
      title={presentation.title}
      className={className}
      // A retry is a safe action for a dependency that failed. It is not
      // offered for `unauthorized`, where repeating the request cannot change
      // the answer and only teaches the operator to hammer a locked door.
      action={
        onRetry && state.kind !== 'unauthorized' ? (
          <Button onClick={onRetry} size="small">
            {retryLabel}
          </Button>
        ) : undefined
      }
    >
      <div data-truth-state={state.kind} className="grid gap-1">
        <p>{presentation.reason}</p>
        <p className="text-xs text-ink-muted">{presentation.consequence}</p>
      </div>
    </Alert>
  );
}

function describeIndeterminate(state: IndeterminateTruthState): {
  readonly tone: 'warning' | 'serious' | 'critical' | 'information';
  readonly title: string;
  readonly reason: string;
  readonly consequence: string;
} {
  switch (state.kind) {
    case 'unavailable':
      return {
        tone: 'serious',
        title: 'Could not be loaded',
        reason: state.reason,
        consequence: 'Nothing is being claimed about how many records exist. This is not a result of zero.',
      };
    case 'unauthorized':
      return {
        tone: 'warning',
        title: 'You do not have access to this',
        reason: state.reason,
        // Deliberately says nothing about whether records exist: "there are
        // none" and "there are some you may not see" are both disclosures.
        consequence: 'No part of the protected record is shown here.',
      };
    case 'notConfigured':
      return {
        tone: 'information',
        title: 'Not configured in this deployment',
        reason: state.reason,
        // A configuration gap is not a fault. Reporting it as one sends the
        // operator hunting for a breakage that does not exist.
        consequence: 'Nothing has failed. This deployment is not set up for this surface.',
      };
    case 'error':
      return {
        tone: 'critical',
        title: 'The request failed',
        reason: state.message,
        consequence: `Reference: ${state.code}. No records have been shown and no count has been assumed.`,
      };
  }
}

// --- partial ----------------------------------------------------------------

export interface PartialStateProps {
  readonly coverage: Extract<TruthState<unknown>, { kind: 'partial' }>['coverage'];
  readonly dependencyUnavailable?: string;
  readonly timeBasis?: 'current' | 'historical';
  readonly className?: string;
}

/**
 * Part of the answer arrived.
 *
 * The value itself stays with the caller — partial data is still data and is
 * still worth showing. What this adds is the boundary of what was shown and,
 * when the coverage says so, the instruction not to total it.
 */
export function PartialState({ coverage, dependencyUnavailable, timeBasis, className = '' }: PartialStateProps) {
  return (
    <div data-truth-state="partial" className={className}>
      <CoverageNotice coverage={coverage} dependencyUnavailable={dependencyUnavailable} timeBasis={timeBasis} />
    </div>
  );
}

// --- stale ------------------------------------------------------------------

export interface StaleStateProps {
  /** The operator-facing reason the value may no longer be current. */
  readonly label: string;
  /** When the value was last confirmed. `null` when that is not known. */
  readonly lastRefreshedAt: string | null;
  /** Whether refreshing from here is safe. */
  readonly canRefresh: boolean;
  readonly onRefresh?: () => void;
  readonly className?: string;
}

/**
 * A previously authoritative answer that may no longer be current.
 *
 * Stale data is shown, not hidden — an operator with an hour-old figure and a
 * label saying so is better served than one with a blank panel. What must never
 * happen is showing it silently.
 */
export function StaleState({ label, lastRefreshedAt, canRefresh, onRefresh, className = '' }: StaleStateProps) {
  return (
    <Alert
      tone="warning"
      title="Showing data that may be out of date"
      className={className}
      action={
        canRefresh && onRefresh ? (
          <Button onClick={onRefresh} size="small">
            Refresh
          </Button>
        ) : undefined
      }
    >
      <div data-truth-state="stale" className="grid gap-1">
        <p>{label}</p>
        <p className="text-xs text-ink-muted">
          {/* "Not known" is the honest answer when no refresh timestamp was
              recorded. Inventing "just now" would be fabricating a fact about
              the data's age. */}
          Last confirmed: {lastRefreshedAt ?? 'not known'}
        </p>
        {!canRefresh && <p className="text-xs text-ink-muted">A safe refresh is not available from here.</p>}
      </div>
    </Alert>
  );
}

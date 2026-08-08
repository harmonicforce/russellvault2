import type { ReactNode } from 'react';
import type { CoverageGap } from '../foundations/truthState';
import { Alert } from './Alert';

/**
 * A statement of how much of the question a surface actually answered.
 *
 * CoverageNotice NEVER COMPUTES COVERAGE. It has no idea which sources exist,
 * which of them replied, or how many rows were dropped — all of that is domain
 * knowledge. It renders a `CoverageGap` the caller already established, and the
 * one thing it adds is that the aggregation warning cannot be forgotten: when
 * `safeToAggregate` is false the notice says so in words, every time, because
 * partial data that is silently summed becomes a confident wrong total and the
 * operator has no way to tell.
 *
 * The optional flags exist for the questions a caller may be able to answer but
 * often cannot. Each is `undefined` when unknown, and an unknown flag renders
 * NOTHING — a surface that does not know whether it is showing current or
 * historical data must not claim either.
 */
export interface CoverageNoticeProps {
  readonly coverage: CoverageGap;
  /**
   * Whether a governed dependency failed to answer. `true` is a stronger claim
   * than "partial": it says a source is down, not merely excluded.
   */
  readonly dependencyUnavailable?: string;
  /** Whether the figures describe the present or a point in the past. */
  readonly timeBasis?: 'current' | 'historical';
  /** Rendered beneath the coverage facts, e.g. a caller-supplied control. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function CoverageNotice({
  coverage,
  dependencyUnavailable,
  timeBasis,
  action,
  className = '',
}: CoverageNoticeProps) {
  // An unsafe total is the more serious of the two conditions, and a failed
  // dependency is more serious still. Neither raises the decoration — only the
  // status semantics.
  const tone = dependencyUnavailable ? 'serious' : coverage.safeToAggregate ? 'information' : 'warning';

  const linkedAction = coverage.action;

  return (
    <Alert
      tone={tone}
      title="Coverage is partial"
      className={className}
      action={
        action ??
        (linkedAction?.href ? (
          <a
            href={linkedAction.href}
            className="text-sm font-semibold text-accent-strong underline underline-offset-2"
          >
            {linkedAction.label}
          </a>
        ) : linkedAction ? (
          <span className="text-sm font-semibold text-ink-secondary">{linkedAction.label}</span>
        ) : undefined)
      }
    >
      <dl className="grid gap-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">Included</dt>
          <dd>{coverage.included}</dd>
        </div>

        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">Missing</dt>
          {/* "Not known" is a real answer and a different one from "nothing is
              missing". Rendering it is what stops the absence of a value being
              read as completeness. */}
          <dd>{coverage.missing ?? 'Not known'}</dd>
        </div>

        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">Totals</dt>
          <dd>
            {coverage.safeToAggregate
              ? 'The included subset may be totalled.'
              : 'Do not total these figures — the subset shown is incomplete.'}
          </dd>
        </div>

        {dependencyUnavailable && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Dependency</dt>
            <dd>{dependencyUnavailable}</dd>
          </div>
        )}

        {timeBasis && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Basis</dt>
            <dd>{timeBasis === 'current' ? 'Current records' : 'Historical records'}</dd>
          </div>
        )}
      </dl>
    </Alert>
  );
}

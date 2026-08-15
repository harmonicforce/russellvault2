import { Alert } from '../../design-system';
import type { BasisImpact, BasisMethodOption } from '../../lib/costApi';
import {
  BASIS_METHOD_LABEL, BasisMethodPill, BasisTotal, Count, PublicId, UNKNOWN, instant,
} from './costPresentation';

/**
 * What the governed recompute CONCLUDED, shown beside — never merged into —
 * what the owner DECIDED.
 *
 * THE DISTINCTION THIS PANEL EXISTS TO MAKE VISIBLE
 *
 * Everything else on the component workspace is EVIDENCE: a source charged an
 * amount, and an owner attributed it. This panel is DERIVED: S2.4's
 * `recompute_inventory_cost_basis` read that evidence and published, under a
 * named and versioned algorithm, what it concluded about individual inventory
 * units.
 *
 * They are different in kind, and the difference matters at exactly the moment
 * someone prices something. A confirmed allocation says "this charge belongs to
 * that line". A cost basis says "this unit cost that much". The second does not
 * follow from the first on its own — it also needs a reconciled receipt, an
 * inventory link, and no unresolved evidence anywhere in scope.
 *
 * SO THIS PANEL COMPUTES NOTHING. It reports what the derivation published,
 * including — especially including — that the derivation could not establish a
 * figure.
 *
 * THREE STATES, NOT TWO
 *
 *   not derived   No recompute has ever published a row for these lines.
 *   unresolved    A recompute ran and concluded it could NOT establish a cost.
 *   established   A recompute ran and published a figure.
 *
 * Rendering the first two as an empty table, a dash, or a zero would collapse
 * three different answers into one, and the one it would collapse them into is
 * the only one that is actively false.
 */
export function BasisImpactPanel({
  impact, basisMethods,
}: {
  readonly impact: BasisImpact;
  readonly basisMethods: readonly BasisMethodOption[];
}) {
  const fifoDescription = basisMethods.find((entry) => entry.method === 'fifo')?.description;

  return (
    <section
      aria-label="Derived inventory cost basis"
      className="rounded-instrument border border-subtle bg-surface-raised"
      data-basis-impact={impact.derived ? 'derived' : 'not-derived'}
    >
      <div className="border-b border-subtle px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          Derived inventory cost basis
        </h2>
        <p className="mt-1 max-w-prose text-xs text-ink-secondary">
          What the governed recompute concluded about individual inventory units from this
          component’s evidence. It is DERIVED, not decided: nothing on this screen edits it, and it
          changes only when the recompute runs again. Read-only.
        </p>
      </div>

      <div className="grid gap-3 px-4 py-3">
        {!impact.derived ? (
          // NOT the same as "no cost". The derivation has not run for these
          // lines, so there is nothing to report — and reporting zeroes would
          // be inventing an answer the database never gave.
          <Alert tone="information" title="No cost basis has been derived for these lines yet">
            The governed recompute has not published a basis for the acquisition lines this component
            applies to. That is not a cost basis of zero, and it is not a statement that the cost is
            unresolved — it means the derivation has not produced a result for them.
          </Alert>
        ) : (
          <>
            {/*
              The FIFO caveat, stated once and prominently rather than only in a
              pill's tooltip. It is the single most misreadable thing here.
            */}
            {impact.lines.some((line) =>
              line.currencies.some((entry) => entry.methods.includes('fifo'))) && (
              <Alert tone="information" title="FIFO here is an accounting convention">
                {fifoDescription
                  ?? 'FIFO orders cost layers within a lot. It does not assert which physical unit '
                    + 'arrived first, and it is not evidence of item movement.'}
              </Alert>
            )}

            <ul className="grid gap-3">
              {impact.lines.map((line) => (
                <li
                  key={`${line.sourceSystemPublicId} ${line.acquisitionLinePublicId}`}
                  className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
                  data-basis-line={line.acquisitionLinePublicId}
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm text-ink">{line.title ?? UNKNOWN.title}</p>
                    <PublicId>{line.acquisitionLinePublicId}</PublicId>
                  </div>

                  {line.subjects.length > 0 && (
                    <p className="mt-1 text-xs text-ink-secondary">
                      Inventory subjects:{' '}
                      {line.subjects.map((subject) => `${subject.publicId} (${subject.subjectKind})`).join(', ')}
                    </p>
                  )}

                  {line.currencies.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-secondary">
                      No basis rows were published for this line.
                    </p>
                  ) : (
                    // ONE BLOCK PER CURRENCY, and no total across them. A
                    // combined figure would be true in no currency, and it is
                    // exactly the number someone would later reuse.
                    <ul className="mt-2 grid gap-2">
                      {line.currencies.map((entry) => (
                        <li
                          key={entry.currency}
                          className="rounded-instrument border border-subtle px-2 py-1.5"
                          data-basis-currency={entry.currency}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                              {entry.currency}
                            </span>
                            <BasisTotal minor={entry.knownTotalMinor} currency={entry.currency} />
                          </div>
                          <p className="mt-1 text-xs text-ink-secondary">
                            <Count value={entry.resolvedUnitCount} /> units with an established basis,{' '}
                            <Count value={entry.unresolvedUnitCount} /> without.
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.methods.map((method) => (
                              <BasisMethodPill key={method} method={method} />
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {line.unresolved && (
                    <div className="mt-2 rounded-instrument border border-subtle px-2 py-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                        Why this line is not fully resolved
                      </p>
                      <ul className="mt-1 grid gap-0.5 text-xs text-ink-secondary">
                        <li>
                          Expected <Count value={line.unresolved.expectedQuantity} />, reconciled{' '}
                          <Count value={line.unresolved.reconciledQuantity} />.
                        </li>
                        {line.unresolved.pendingExpectedQuantity > 0 && (
                          <li>
                            <Count value={line.unresolved.pendingExpectedQuantity} /> expected units
                            have not been received into a reconciled receipt.
                          </li>
                        )}
                        {line.unresolved.overageQuantity > 0 && (
                          <li>
                            <Count value={line.unresolved.overageQuantity} /> units arrived beyond
                            what the acquisition expected, and the source reported no cost for them.
                          </li>
                        )}
                        {line.unresolved.hasUnresolvedCostEvidence && (
                          <li>
                            Cost evidence on this line is still unresolved — an amount the source
                            never reported, or a shared cost not yet allocated.
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {line.algorithmVersion && (
                    <p className="mt-2 text-xs text-ink-secondary">
                      Derived by algorithm {line.algorithmVersion} at {instant(line.derivedAt)}.
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <details className="text-xs text-ink-secondary">
              <summary className="cursor-pointer">What each attribution method claims</summary>
              <dl className="mt-2 grid gap-1">
                {basisMethods.map((entry) => (
                  <div key={entry.method}>
                    <dt className="font-medium text-ink">{BASIS_METHOD_LABEL[entry.method]}</dt>
                    <dd>{entry.description}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
      </div>
    </section>
  );
}

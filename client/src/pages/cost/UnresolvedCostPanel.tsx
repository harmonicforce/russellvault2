import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  DependencyState,
  EmptyState,
  LoadingState,
  PartialState,
  StaleState,
  hasValue,
  isIndeterminate,
  type TruthState,
} from '../../design-system';
import type {
  ReasonDescriptor, UnresolvedCostQueue, UnresolvedReason, UnresolvedRow,
} from '../../lib/costApi';
import {
  AmountValue, Count, MinorAmount, PublicId, componentPath, instant,
  BASIS_METHOD_LABEL,
} from './costPresentation';

/**
 * The governed unresolved-cost queue — S2.6.
 *
 * WHAT IT IS: triage and navigation. It answers "what cost truth still needs
 * attention, why, and where do I go to resolve it", and then it gets out of the
 * way. Allocation editing is NOT duplicated here — every actionable row links
 * into the existing S2.5 component workspace, which already owns the propose /
 * confirm / reverse / withdraw workflow and its recovery semantics.
 *
 * WHY IT LIVES ON `/cost` RATHER THAN BEHIND ITS OWN NAVIGATION ENTRY: it is
 * the same subject as the component list beneath it, seen from the other end.
 * A separate destination would make an owner choose between "the costs" and
 * "the cost problems" before knowing which they needed.
 *
 * WHAT IT REFUSES TO SAY
 *
 * "Nothing needs attention" only after a COMPLETE authoritative read. A failed
 * read renders as unavailable, a capped read as partial, and neither is ever
 * allowed to look like a clean desk — because an owner acts on an empty queue
 * by going home.
 *
 * There is no combined figure anywhere: currencies stay in their own rows, and
 * a count of problems is never presented as an amount of money.
 */
export function UnresolvedCostPanel({
  state, meta, onRetry, onRefresh,
}: {
  readonly state: TruthState<readonly UnresolvedRow[]>;
  /** The vocabulary and derivation facts, when a read has produced them. */
  readonly meta: UnresolvedCostQueue | undefined;
  readonly onRetry: () => void;
  readonly onRefresh: () => void;
}) {
  const rows = hasValue(state) ? state.value : [];
  const descriptors = useMemo(
    () => new Map((meta?.reasons ?? []).map((entry) => [entry.reason, entry])),
    [meta],
  );

  const [reasonFilter, setReasonFilter] = useState<UnresolvedReason | 'all'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  /*
   * Filtering NARROWS a complete list. It never hides truth:
   *
   *   * the unfiltered total is always stated;
   *   * every option carries its own count, so choosing one cannot conceal that
   *     another has entries;
   *   * a filter that matches nothing says so explicitly rather than rendering
   *     the same empty table an authoritative zero would.
   */
  // Deliberately NOT memoised. `rows` falls back to a fresh `[]` whenever the
  // truth state carries no value, so a memo keyed on it would recompute every
  // render anyway — and a memo that never memoises is worse than none, because
  // it claims a guarantee it does not provide. These are single passes over a
  // bounded list. (`descriptors` above IS memoised: it is keyed on the query
  // object, whose identity is stable between renders.)
  const reasonCounts = new Map<UnresolvedReason, number>();
  for (const row of rows) reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);

  const currencyCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.currency === null) continue;
    currencyCounts.set(row.currency, (currencyCounts.get(row.currency) ?? 0) + 1);
  }
  const currencies = [...currencyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const visible = rows.filter((row) =>
    (reasonFilter === 'all' || row.reason === reasonFilter)
    && (currencyFilter === 'all' || row.currency === currencyFilter));

  const filtered = reasonFilter !== 'all' || currencyFilter !== 'all';

  return (
    <section
      aria-label="Unresolved cost"
      className="rounded-instrument border border-subtle bg-surface-raised"
      data-unresolved-cost={state.kind}
    >
      <div className="border-b border-subtle px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          Unresolved cost
        </h2>
        <p className="mt-1 max-w-prose text-xs text-ink-secondary">
          What cost truth still needs attention, why, and where to resolve it. Each entry names one
          specific problem — there is no general “needs attention” bucket, because six different
          problems need six different actions. This is triage: the work itself happens on the cost
          component.
        </p>
      </div>

      <div className="grid gap-3 px-4 py-3">
        {state.kind === 'loading' && <LoadingState label="Reading unresolved cost…" />}

        {isIndeterminate(state) && <DependencyState state={state} onRetry={onRetry} />}

        {state.kind === 'stale' && (
          <StaleState
            label={state.label}
            lastRefreshedAt={state.lastRefreshedAt}
            canRefresh={state.canRefresh}
            onRefresh={onRefresh}
          />
        )}

        {state.kind === 'partial' && <PartialState coverage={state.coverage} />}

        {/*
          The ONLY place this component is allowed to say the desk is clean, and
          it is reachable only from `ready`-with-no-rows — which the truth model
          produces only after a complete authoritative read.
        */}
        {state.kind === 'empty' && (
          <EmptyState
            title="No unresolved cost"
            description={
              'The governed record was read in full and every cost component in this workspace is '
              + 'either attributed or documented. This is an answer, not a failure to look.'
            }
          />
        )}

        {hasValue(state) && rows.length > 0 && (
          <>
            <p className="text-sm text-ink" data-unresolved-total>
              <Count value={rows.length} /> {rows.length === 1 ? 'entry needs' : 'entries need'} attention
              {filtered && (
                <>
                  {' '}— showing <Count value={visible.length} /> after filtering.
                </>
              )}
            </p>

            <div className="flex flex-wrap gap-3">
              <label className="grid gap-1 text-xs">
                <span className="font-medium uppercase tracking-wide text-ink-secondary">Reason</span>
                <select
                  className="rounded-control border border-subtle bg-surface px-2 py-1 text-sm text-ink"
                  value={reasonFilter}
                  onChange={(event) => setReasonFilter(event.target.value as UnresolvedReason | 'all')}
                >
                  <option value="all">All reasons ({rows.length})</option>
                  {[...reasonCounts.entries()].map(([reason, count]) => (
                    <option key={reason} value={reason}>
                      {descriptors.get(reason)?.title ?? reason} ({count})
                    </option>
                  ))}
                </select>
              </label>

              {currencies.length > 0 && (
                <label className="grid gap-1 text-xs">
                  <span className="font-medium uppercase tracking-wide text-ink-secondary">
                    Currency
                  </span>
                  <select
                    className="rounded-control border border-subtle bg-surface px-2 py-1 text-sm text-ink"
                    value={currencyFilter}
                    onChange={(event) => setCurrencyFilter(event.target.value)}
                  >
                    <option value="all">All currencies</option>
                    {currencies.map(([currency, count]) => (
                      <option key={currency} value={currency}>{currency} ({count})</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/*
              Currencies are filterable but never combined. There is no total
              across them, and the note says so rather than leaving the absence
              to be read as an oversight.
            */}
            {currencies.length > 1 && (
              <p className="text-xs text-ink-secondary">
                Entries span {currencies.map(([currency]) => currency).join(', ')}. They are listed
                separately and never added together — a figure spanning currencies would be true in
                none of them.
              </p>
            )}

            {visible.length === 0 ? (
              // A filter matching nothing is NOT an authoritative zero, and must
              // not borrow the empty state's words.
              <Alert tone="information" title="No entries match this filter">
                The queue still holds {rows.length} {rows.length === 1 ? 'entry' : 'entries'}. Clear
                the filter to see them.
              </Alert>
            ) : (
              <ul className="grid gap-2">
                {visible.map((row) => (
                  <UnresolvedEntry
                    key={row.key}
                    row={row}
                    descriptor={descriptors.get(row.reason)}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {/*
          What the last derivation was — never whether it is still current.
          Nothing readable evidences staleness, so nothing here claims it.
        */}
        {meta && (
          <p className="text-xs text-ink-secondary" data-derivation-note>
            {meta.derivation.everRun
              ? `Cost basis last derived by algorithm ${meta.derivation.algorithmVersion ?? 'unknown'} at `
                + `${instant(meta.derivation.derivedAt)}. Whether that derivation still reflects `
                + 'current evidence is not something the governed record exposes, so it is not claimed here.'
              : 'No governed cost-basis derivation has ever run in this workspace.'}
          </p>
        )}
      </div>
    </section>
  );
}

/** One queue entry: what, why, where, and the one next step. */
function UnresolvedEntry({
  row, descriptor,
}: {
  readonly row: UnresolvedRow;
  readonly descriptor: ReasonDescriptor | undefined;
}) {
  return (
    <li
      className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
      data-unresolved-reason={row.reason}
      data-unresolved-key={row.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{descriptor?.title ?? row.reason}</p>
          <p className="mt-0.5 max-w-prose text-xs text-ink-secondary">{descriptor?.description}</p>
        </div>
        {row.currency && (
          <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
            {row.currency}
          </span>
        )}
      </div>

      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {row.componentPublicId && (
          <Fact label="Cost component">
            <PublicId>{row.componentPublicId}</PublicId>
          </Fact>
        )}
        {/*
          The amount is rendered by the same component the rest of the surface
          uses, so an unknown amount reads as words here exactly as it does
          everywhere else — never as a blank cell and never as zero.
        */}
        {row.amount && <Fact label="Amount"><AmountValue amount={row.amount} /></Fact>}
        {row.acquisitionLinePublicId && (
          <Fact label="Acquisition line">
            <PublicId>{row.acquisitionLinePublicId}</PublicId>
          </Fact>
        )}
        {row.orderPublicId && (
          <Fact label="Acquisition order"><PublicId>{row.orderPublicId}</PublicId></Fact>
        )}
        {row.lotPublicId && <Fact label="Lot"><PublicId>{row.lotPublicId}</PublicId></Fact>}
        {row.attributionState && <Fact label="Attribution">{row.attributionState}</Fact>}
        {row.candidateCount !== null && row.candidateCount > 0 && (
          <Fact label="Proposed rows awaiting review">
            <Count value={row.candidateCount} />
          </Fact>
        )}
        {row.basis && (
          <Fact label="Units without a basis">
            <Count value={row.basis.unresolvedUnitCount} />
            {' — '}
            {row.basis.methods.map((method) => BASIS_METHOD_LABEL[method]).join(', ')}
          </Fact>
        )}
        {row.quantities && (
          <Fact label="Quantities">
            Expected <Count value={row.quantities.expected} />, reconciled{' '}
            <Count value={row.quantities.reconciled} />, over by{' '}
            <Count value={row.quantities.overage} />
          </Fact>
        )}
        {row.netMinor !== null && row.currency && (
          <Fact label="Net cost evidence">
            <MinorAmount minor={row.netMinor} currency={row.currency} />
          </Fact>
        )}
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-xs text-ink-secondary">{descriptor?.nextAction}</p>
        {/*
          The link into the EXISTING workflow. Only for rows that name a
          component, because that is the only place this queue can honestly send
          someone — a line-scoped or workspace-scoped problem has no single
          component workspace to open, and inventing a destination would be
          worse than saying where the problem is and letting the owner navigate.
        */}
        {row.componentPublicId && (
          <Link
            className="text-sm underline"
            to={componentPath(row.componentPublicId)}
            data-unresolved-link={row.componentPublicId}
          >
            Open {row.componentPublicId}
          </Link>
        )}
      </div>
    </li>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

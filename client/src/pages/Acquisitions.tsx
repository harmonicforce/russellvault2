// The governed Acquisitions list — the S1.6.5 reference implementation.
//
// This is the pattern later governed list surfaces copy. What makes it the
// reference is not the table; it is four properties the previous page did not
// have:
//
//   1. THE URL IS THE LIST STATE. No parallel component state holds a filter,
//      a sort or a page, so back, forward, reload and a pasted link all recover
//      exactly the list the operator was looking at.
//
//   2. DEPENDENCIES ARE INDEPENDENT. Lines and facets fail separately. A failed
//      facets request costs the operator their filter suggestions and their
//      classification summary; it no longer destroys a working page of governed
//      acquisition lines.
//
//   3. THE EXACT TOTAL COMES FROM THE SERVER, and is derived separately from
//      the rows, so the header can say "137 filtered lines" while this page
//      happens to be short, and can never say "0" merely because nothing has
//      arrived yet.
//
//   4. EVERY LINK IS SOURCE-QUALIFIED. An acquisition line public id is unique
//      only within its source system.
//
// NO BUSINESS SEMANTICS CHANGED. Same transport, same closed vocabularies, same
// server contract, same page size, same search predicate. This slice changes
// how the page tells the truth, not what the truth is.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  CoverageNotice,
  DataTable,
  ResponsiveRecordList,
  StatusPill,
  hasValue,
  isIndeterminate,
  ready,
  type TruthState,
} from '../design-system';
import { createAcquisitionLinesTransport, type AcquisitionSort } from '../lib/acquisitionLinesApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import {
  PAGE_SIZE,
  applySort,
  clearFilters,
  readListState,
  setParam,
  stripUnsupported,
  toLineParams,
} from './acquisitions/listState';
import { facetsState, linesState, totalState } from './acquisitions/listTruth';
import { acquisitionColumns, acquisitionRecords } from './acquisitions/listPresentation';
import { AcquisitionsFilters } from './acquisitions/AcquisitionsFilters';

export default function Acquisitions() {
  const { workspace } = useWorkspace();
  const [url, setUrl] = useSearchParams();

  const api = useMemo(
    () =>
      createAcquisitionLinesTransport(
        tokenProviderFromClient(createShadowClient(import.meta.env as unknown as Record<string, string | undefined>)),
      ),
    [],
  );

  const { state, unsupported } = readListState(url);

  // Fail closed. An unsupported value never reaches the transport (it was
  // already replaced above), is removed from the address bar, and is reported —
  // because a silently ignored filter leaves the URL claiming a filter is
  // applied while an unfiltered page is on screen.
  //
  // The notice is STICKY. Stripping the parameter is what makes `unsupported`
  // empty again, so a notice derived from it would erase itself in the same
  // tick it appeared and the operator would never learn their filter was
  // dropped. It clears when the workspace changes, which is the one moment the
  // whole list state is rebuilt.
  const [removedFilters, setRemovedFilters] = useState(false);
  const unsupportedKey = unsupported.join(',');
  useEffect(() => {
    if (unsupported.length === 0) return;
    setRemovedFilters(true);
    setUrl(stripUnsupported(url, unsupported), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsupportedKey]);

  // A workspace switch clears the previous workspace's list state rather than
  // applying workspace A's filters to workspace B's records.
  const previousWorkspace = useRef(workspace?.id);
  useEffect(() => {
    if (previousWorkspace.current && previousWorkspace.current !== workspace?.id) {
      setUrl(new URLSearchParams(), { replace: true });
      setRemovedFilters(false);
    }
    previousWorkspace.current = workspace?.id;
  }, [workspace?.id, setUrl]);

  const params = toLineParams(state);
  const enabled = Boolean(workspace);
  const lines = useQuery({
    queryKey: ['acquisition-lines', workspace?.id, params],
    queryFn: () => api.lines(workspace!.id, params),
    enabled,
  });
  const facets = useQuery({
    queryKey: ['acquisition-facets', workspace?.id],
    queryFn: () => api.facets(workspace!.id),
    enabled,
  });

  const rowsTruth = linesState(lines, enabled);
  const totalTruth = totalState(lines, enabled);
  const facetsTruth = facetsState(facets, enabled);

  // The CURRENT list URL, so Acquisition Detail returns to this exact filtered,
  // searched, sorted page rather than to an unfiltered list.
  const returnTo = `/acquisitions${url.toString() ? `?${url}` : ''}`;

  const change = (key: string, value: string) => setUrl(setParam(url, key, value));
  const columns = useMemo(() => acquisitionColumns(returnTo), [returnTo]);
  const records = useMemo(
    () => (hasValue(rowsTruth) ? acquisitionRecords(rowsTruth.value, returnTo) : []),
    [rowsTruth, returnTo],
  );

  const total = hasValue(totalTruth) ? totalTruth.value : null;
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold text-ink">Acquisitions</h1>
        <ExactTotal state={totalTruth} />
        <CoverageNotice
          // The coverage the transport actually reports:
          // `governed_native_committed`, `historicalLegacyImported: false`.
          coverage={{
            included: 'Committed governed-native acquisition lines in this workspace.',
            missing: 'Historical legacy Whatnot purchases, which have not been imported yet.',
            // The load-bearing flag. Governed and legacy counts describe
            // different populations; added together they produce a total that
            // is true of neither.
            safeToAggregate: false,
          }}
          timeBasis="current"
        />
      </header>

      {removedFilters && (
        <Alert tone="warning" title="The address bar claimed a filter this list does not support">
          Unsupported URL filters were removed.
        </Alert>
      )}

      <AcquisitionsFilters
        state={state}
        facets={facetsTruth}
        onFilterChange={change}
        onSearchSubmit={(query) => change('query', query)}
        onClearFilters={() => setUrl(clearFilters(url))}
      />

      <ClassificationSummary state={facetsTruth} onRetry={() => void facets.refetch()} />

      <DataTable
        caption="Governed acquisition lines"
        columns={columns}
        state={rowsTruth}
        rowKey={(line) => `${line.source_system_public_id}:${line.acquisition_line_public_id}`}
        sort={{ key: state.sort, direction: state.order === 'asc' ? 'ascending' : 'descending' }}
        // Sorting is the SERVER's. The press writes `sort`/`order` to the URL,
        // the query re-runs, and the rows come back ordered. Nothing here
        // re-sorts what the server returned, which would silently disagree with
        // the ordering the next page was computed against.
        onSortChange={(key) => setUrl(applySort(url, state, key as AcquisitionSort))}
        empty={{
          title: 'No acquisitions match these filters.',
          description:
            total !== null && total > 0
              ? `The governed backend reports ${total.toLocaleString()} matching lines, but none on this page.`
              : 'The governed backend answered and returned no matching acquisition lines.',
        }}
        onRetry={() => void lines.refetch()}
        // Nine columns is a horizontally scrolling strip on a tablet held in
        // portrait, so this table hands over at `lg` rather than `md` — the
        // same breakpoint the previous page used, and the reason iPad portrait
        // gets records instead of a sideways scroll.
        responsiveBreakpoint="lg"
        responsive={
          <ResponsiveRecordList
            label="Governed acquisition lines"
            state={hasValue(rowsTruth) ? ready(records) : (rowsTruth as TruthState<never>)}
            empty={{ title: 'No acquisitions match these filters.' }}
            onRetry={() => void lines.refetch()}
          />
        }
      />

      <Pagination
        page={state.page}
        total={total}
        onChange={(page) => change('page', String(page))}
        lastPage={lastPage}
      />
    </div>
  );
}

/**
 * The exact filtered total.
 *
 * Four distinct answers, because they are four distinct facts. Loading is not
 * zero, a failure is not zero, and a genuine zero says that it is confirmed.
 */
function ExactTotal({ state }: { readonly state: TruthState<number> }) {
  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Loading exact line count…
      </p>
    );
  }
  if (isIndeterminate(state)) {
    return (
      <p className="text-sm text-ink-secondary">
        Exact line count unavailable. No total has been assumed.
      </p>
    );
  }
  if (!hasValue(state)) return null;
  return (
    <p className="text-sm text-ink-secondary">
      <span className="font-semibold tabular-nums text-ink">{state.value.toLocaleString()} filtered lines</span>
      {state.value === 0 ? ' — a confirmed zero from the governed backend.' : ' matching the current search and filters.'}
    </p>
  );
}

/**
 * The classification summary.
 *
 * These are CATEGORIES, not health states, so they render neutral. The one
 * exception is the review queue, which is genuinely work waiting to be done and
 * earns an attention treatment for that reason rather than for contrast.
 *
 * Counts come from facets and only from facets. When facets fail the summary
 * says so — it does not render zeroes, which would claim there are no sealed
 * acquisitions when the truth is that nobody counted them.
 */
function ClassificationSummary({
  state,
  onRetry,
}: {
  readonly state: TruthState<import('../lib/acquisitionLinesApi').AcquisitionFacets>;
  readonly onRetry: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-xs text-ink-muted">
        Loading the classification summary…
      </p>
    );
  }

  if (isIndeterminate(state)) {
    return (
      <Alert
        tone="warning"
        title="Filter suggestions and the classification summary are unavailable"
        action={
          <Button size="small" onClick={onRetry}>
            Retry summary
          </Button>
        }
      >
        <p>
          The acquisition lines below are unaffected and remain usable. No classification counts have been assumed, and
          any filter you already have applied is still applied.
        </p>
      </Alert>
    );
  }

  if (!hasValue(state)) return null;
  const facets = state.value;

  return (
    <section aria-label="Classification summary" className="flex flex-wrap gap-2">
      {facets.classificationOptions.map((option) => (
        <StatusPill key={option.key} tone={option.key === 'unreviewed' ? 'warning' : 'neutral'}>
          {option.label}: {option.count.toLocaleString()}
          {option.key === 'unreviewed' ? ' · review work' : ''}
        </StatusPill>
      ))}
      <StatusPill tone="neutral">Unclassified: {facets.unclassified.toLocaleString()}</StatusPill>
    </section>
  );
}

/**
 * Pagination against the EXACT server total.
 *
 * Next is disabled only when the authoritative total proves there is no next
 * page. Deriving that from `rows.length` would offer a next page that does not
 * exist whenever the last page happens to be full, and hide one that does
 * whenever a page comes back short.
 */
function Pagination({
  page,
  total,
  lastPage,
  onChange,
}: {
  readonly page: number;
  readonly total: number | null;
  readonly lastPage: number | null;
  readonly onChange: (page: number) => void;
}) {
  const atEnd = lastPage === null ? true : page >= lastPage;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2">
      <Button size="small" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <p className="text-sm tabular-nums text-ink-secondary">
        {lastPage === null ? `Page ${page}` : `Page ${page} of ${lastPage.toLocaleString()}`}
        {total !== null && total > 0 && (
          <span className="ml-2 text-ink-muted">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(total, page * PAGE_SIZE).toLocaleString()} of{' '}
            {total.toLocaleString()}
          </span>
        )}
      </p>
      <Button size="small" disabled={atEnd} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

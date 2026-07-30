// The cycle-count landing page: every count this workspace has run.
//
// Sessions are listed through the governed list function, which pages
// server-side and reports a total independently of the page — so this never
// drags a workspace across the wire to count rows in the browser.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Plus } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createCycleCountApi, type SessionListRow } from '../lib/cycleCountApi';
import { canonicalPath, type CycleCountStatus } from '../lib/cycleCount';
import { BlindChip, CycleStatusChip, ErrorNote, LoadingNote } from '../components/CycleCountPanels';

const PAGE_SIZE = 25;

const FILTERS: readonly { key: string; label: string; statuses: CycleCountStatus[] }[] = [
  { key: 'active', label: 'Active', statuses: ['draft', 'in_progress'] },
  { key: 'review', label: 'Awaiting review', statuses: ['review'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: [] },
];

export default function CycleCounts() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  // Query state lives in the URL, so a filtered list survives a refresh and can
  // be shared or bookmarked.
  const [params, setParams] = useSearchParams();

  const api = useMemo(
    () => (workspace ? createCycleCountApi(client as never, workspace.id) : null),
    [client, workspace]
  );

  const filterKey = params.get('view') ?? 'active';
  const locationCode = params.get('location') ?? '';
  const blindOnly = params.get('blind') === '1';
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);

  const [rows, setRows] = useState<readonly SessionListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    // Any change to the filters means page 0; keeping the old offset would show
    // an empty page and read as "nothing matches".
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
      const result = await api.listSessions({
        statuses: filter.statuses,
        locationCode: locationCode || null,
        blindOnly: blindOnly ? true : null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, filterKey, locationCode, blindOnly, page]);

  useEffect(() => { void load(); }, [load]);

  if (!workspace || !api) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to see its cycle counts.</div>;
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="max-w-5xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardCheck className="h-5 w-5 text-accent" aria-hidden /> Cycle Counts
          </h1>
          <p className="mt-1 text-xs text-ink-muted">
            Physical counts of {workspace.name}. Each count freezes what it expects to find the
            moment it starts, so its result stays meaningful afterwards.
          </p>
        </div>
        <Link
          to="/cycle-counts/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" aria-hidden /> Start a new count
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filterKey === f.key}
            onClick={() => setParam('view', f.key)}
            className={`min-h-10 rounded-lg px-3 text-sm font-medium ${
              filterKey === f.key ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
            }`}
          >
            {f.label}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={blindOnly}
            onChange={(e) => setParam('blind', e.target.checked ? '1' : null)}
            className="h-4 w-4"
          />
          Blind counts only
        </label>
      </div>

      <div>
        <label htmlFor="cc-location-filter" className="block text-xs font-medium text-ink-secondary">
          Root location
        </label>
        <input
          id="cc-location-filter"
          value={locationCode}
          onChange={(e) => setParam('location', e.target.value.trim().toUpperCase())}
          placeholder="Any location"
          className="mt-1 min-h-11 w-full max-w-xs rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
        />
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <LoadingNote what="cycle counts" />
      ) : error ? (
        // Deliberately no empty state here. "No counts" and "we could not read
        // the counts" must never look the same.
        null
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface-1 p-6 text-center">
          <p className="text-sm font-medium">
            {filterKey === 'active' ? 'No count is running.' : 'No counts match that filter.'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {filterKey === 'active'
              ? 'Start one when you are ready to walk a shelf.'
              : 'Try a different filter, or clear the location.'}
          </p>
          {filterKey === 'active' && (
            <Link
              to="/cycle-counts/new"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" aria-hidden /> Start a new count
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const countedItems = r.observed_item_count;
            const countedLots = r.observed_lot_count;
            const expected = r.expected_item_count + r.expected_lot_count;
            const counted = countedItems + countedLots;
            return (
              <li key={r.session_id}>
                <button
                  type="button"
                  onClick={() => navigate(canonicalPath(r.session_id, r.status))}
                  className="w-full rounded-xl border border-hairline bg-surface-1 p-4 text-left hover:bg-surface-2 focus:outline-2 focus:outline-accent"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{r.public_id}</span>
                    <CycleStatusChip status={r.status} />
                    <BlindChip blind={r.blind_count} />
                    {r.open_discrepancy_count > 0 && (
                      <span className="rounded-full bg-critical/15 px-2 py-0.5 text-xs font-medium text-critical">
                        {r.open_discrepancy_count} unresolved
                      </span>
                    )}
                  </div>

                  <div className="mt-2 text-sm">
                    <span className="font-medium">{r.root_location_code}</span>
                    {r.root_location_display_name && (
                      <span className="text-ink-secondary"> · {r.root_location_display_name}</span>
                    )}
                    <span className="text-ink-muted">
                      {' '}· {r.include_descendants ? 'and everything below it' : 'that location only'}
                      {' '}· {r.scope_location_count} location{r.scope_location_count === 1 ? '' : 's'}
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-ink-muted">Counted</dt>
                      <dd className="tabular-nums">{counted} of {expected}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Discrepancies</dt>
                      <dd className="tabular-nums">{r.total_discrepancy_count}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Created</dt>
                      <dd>{r.created_at}{r.created_by_email ? ` · ${r.created_by_email}` : ''}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">
                        {r.completed_at ? 'Completed' : r.cancelled_at ? 'Cancelled' : 'Started'}
                      </dt>
                      <dd>{r.completed_at ?? r.cancelled_at ?? r.started_at ?? 'not started'}</dd>
                    </div>
                  </dl>

                  {(r.subtype_filter || r.vertical_filter) && (
                    <p className="mt-2 text-xs text-ink-muted">
                      Narrowed to {[r.subtype_filter, r.vertical_filter].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setParam('page', String(page - 1))}
            className="min-h-11 rounded-lg border border-hairline px-4 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-ink-muted">
            Page {page + 1} of {lastPage + 1} · {total} count{total === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setParam('page', String(page + 1))}
            className="min-h-11 rounded-lg border border-hairline px-4 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

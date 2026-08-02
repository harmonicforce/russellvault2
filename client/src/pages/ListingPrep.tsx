// Listing Prep — the queue.
//
// Answers one question at a glance: what is stopping each record being listed?
// Every row carries the blockers the database computed live, so the queue can
// never say "ready" about something that stopped being ready five minutes ago.
//
// The URL holds the filters. The Workbench links here with a filter already
// applied, and Back has to restore the previous view, so nothing about the
// query lives only in component state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Search, Tags } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import {
  LIVE_PREP_STATUSES, READINESS_LABELS, STATUS_LABELS, createListingPrepTransport,
  formatMoney, type BulkAction, type PrepCandidatePage, type PrepPriority,
  type PrepQueuePage, type PrepQueueRow, type PrepReadiness, type PrepStatus,
} from '../lib/listingPrepApi';

const PAGE_SIZE = 25;

/** The four views the owner actually works in. */
const TABS = [
  { key: 'queue', label: 'To prepare', statuses: ['not_started', 'in_preparation', 'blocked', 'needs_review'] as PrepStatus[] },
  { key: 'ready', label: 'Ready to list', statuses: ['ready_to_list'] as PrepStatus[] },
  { key: 'listed', label: 'Listed', statuses: ['listed'] as PrepStatus[] },
  // Inventory with no preparation at all. Not backed by listing_prep rows, so
  // it reads the governed candidate view instead of the queue.
  { key: 'candidates', label: 'Not started', statuses: [] as PrepStatus[] },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PRIORITY_STYLE: Record<PrepPriority, string> = {
  urgent: 'border-bad/50 bg-bad/10 text-bad',
  high: 'border-warning/50 bg-warning/10 text-warning',
  normal: 'border-hairline text-ink-muted',
  low: 'border-hairline text-ink-muted',
};

function readinessTone(status: PrepReadiness): string {
  if (status === 'ready') return 'border-good/50 bg-good/10 text-good';
  if (status === 'blocked') return 'border-bad/50 bg-bad/10 text-bad';
  return 'border-warning/50 bg-warning/10 text-warning';
}

export default function ListingPrep() {
  const { workspace, userId } = useWorkspace();
  const navigate = useNavigate();
  // The id, not the object: an identity that changes on every render would put
  // the load effect into a loop.
  const workspaceId = workspace?.id ?? null;
  const [params, setParams] = useSearchParams();
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'operator';
  const isOwner = workspace?.role === 'owner';

  const transport = useMemo(() => {
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createListingPrepTransport(tokenProviderFromClient(shadow), () => workspace?.id ?? null);
  }, [workspace?.id]);

  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'queue') as TabKey;
  const readinessFilter = params.get('readiness') as PrepReadiness | null;
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const mine = params.get('assigned') === 'me';
  // A preparation still holding `ready_to_list` while a live blocker has
  // appeared. Its own destination, because such a record is genuinely neither
  // "ready" nor an ordinary queue item.
  const regressedOnly = params.get('regressed') === '1';

  const [searchDraft, setSearchDraft] = useState(search);
  const [data, setData] = useState<PrepQueuePage | null>(null);
  const [candidates, setCandidates] = useState<PrepCandidatePage | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { setSearchDraft(search); }, [search]);

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: !('page' in patch) });
  }, [params, setParams]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      if (tab === 'candidates') {
        setCandidates(await transport.candidates({
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }));
        setData(null);
      } else {
        // A readiness filter must span every live status. A `ready_to_list`
        // record that has since lost a photograph is counted by the dashboard
        // under its blocker, so restricting to the tab's statuses would hide
        // exactly the records the tile counted.
        const statuses = regressedOnly
          ? (['ready_to_list'] as PrepStatus[])
          : readinessFilter
            ? LIVE_PREP_STATUSES
            : TABS.find((t) => t.key === tab)!.statuses;
        // "Regressed" is every readiness EXCEPT ready, over ready_to_list rows.
        // The Ready tab shows only records whose live readiness still agrees
        // with their status, so the tab and the dashboard tile match.
        const readiness = regressedOnly
          ? (Object.keys(READINESS_LABELS) as PrepReadiness[]).filter((r) => r !== 'ready')
          : readinessFilter
            ? [readinessFilter]
            : tab === 'ready'
              ? (['ready'] as PrepReadiness[])
              : undefined;
        setData(await transport.queue({
          status: statuses,
          readiness,
          assignedTo: mine ? userId ?? undefined : undefined,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }));
        setCandidates(null);
      }
      setError(null);
    } catch (e) {
      // A failure is never rendered as an empty queue.
      setData(null);
      setCandidates(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [transport, workspaceId, userId, tab, readinessFilter, regressedOnly, mine, search, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [tab, readinessFilter, regressedOnly, search, page, mine]);

  const rows = data?.rows ?? [];
  const total = tab === 'candidates' ? (candidates?.total ?? 0) : (data?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const startPrep = async (kind: 'item' | 'lot', subjectId: string) => {
    setStarting(subjectId);
    setError(null);
    try {
      const created = await transport.start(kind, subjectId);
      navigate(`/listing-prep/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(null);
    }
  };

  const runBulk = async (action: BulkAction, extra: Record<string, unknown> = {}) => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transport.bulk(action, [...selected], extra);
      setNotice(result.failed === 0
        ? `Applied to ${result.applied} record${result.applied === 1 ? '' : 's'}.`
        : `Applied to ${result.applied}; ${result.failed} could not be changed. ` +
          (result.results.find((r) => r.outcome === 'failed')?.error ?? ''));
      setSelected(new Set());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Tags className="h-5 w-5 text-accent" /> Listing preparation
        </h1>
        <p className="text-xs text-ink-muted">
          What each record still needs before it can be listed. Marking something listed records
          where it went — it does not move or reserve any stock.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => update({ tab: t.key, readiness: null, page: null })}
            className={`rounded border px-3 py-1.5 text-sm ${
              tab === t.key ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); update({ q: searchDraft.trim() || null }); }}
        >
          <label className="sr-only" htmlFor="prep-search">Search preparations</label>
          <div className="flex flex-1 items-center gap-2 rounded border border-hairline px-2">
            <Search className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            <input
              id="prep-search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Item, lot, title or preparation id"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <button type="submit" className="rounded border border-hairline px-3 py-2 text-sm">Search</button>
        </form>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => update({ assigned: e.target.checked ? 'me' : null })}
          />
          Assigned to me
        </label>
      </div>

      {tab === 'queue' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => update({ readiness: null })}
            className={`rounded border px-2.5 py-1 text-xs ${readinessFilter ? 'border-hairline' : 'border-accent bg-accent/5 font-semibold'}`}
          >
            Everything
          </button>
          {(['blocked', 'needs_photos', 'needs_identity_review', 'needs_condition_review',
             'needs_package_details', 'needs_price', 'needs_content', 'needs_owner_review'] as PrepReadiness[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => update({ readiness: r })}
              className={`rounded border px-2.5 py-1 text-xs ${
                readinessFilter === r ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
              }`}
            >
              {READINESS_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {notice && <p role="status" className="rounded border border-hairline bg-surface-1 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-accent/40 bg-accent/5 p-3">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk('set_priority', { priority: 'urgent' })}
            className="rounded border border-hairline bg-surface-0 px-3 py-1.5 text-xs disabled:opacity-60"
          >
            Mark urgent
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk('request_review')}
            className="rounded border border-hairline bg-surface-0 px-3 py-1.5 text-xs disabled:opacity-60"
          >
            Send for review
          </button>
          {isOwner && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBulk('mark_ready')}
              className="rounded border border-good/50 bg-surface-0 px-3 py-1.5 text-xs font-semibold text-good disabled:opacity-60"
            >
              Mark ready to list
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Why are these blocked?');
              if (reason && reason.trim()) void runBulk('mark_blocked', { reason: reason.trim() });
            }}
            className="rounded border border-hairline bg-surface-0 px-3 py-1.5 text-xs disabled:opacity-60"
          >
            Block…
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tab === 'candidates' ? (
        (candidates?.rows.length ?? 0) === 0 && !error ? (
          <p className="rounded border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-muted">
            Every current record already has a preparation.
          </p>
        ) : (
          <ul className="space-y-2">
            {(candidates?.rows ?? []).map((row) => (
              <li key={`${row.subject_kind}-${row.subject_id}`} className="rounded-lg border border-hairline bg-surface-1 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(row.subject_kind === 'item'
                      ? `/inventory/current/${row.subject_id}`
                      : `/inventory/lots/${row.subject_id}`)}
                    className="min-w-0 text-left"
                  >
                    <span className="text-sm font-semibold">{row.display_name ?? row.public_id}</span>
                    <span className="ml-2 text-xs text-ink-muted">{row.public_id}</span>
                    {row.detail_line && <p className="truncate text-xs text-ink-muted">{row.detail_line}</p>}
                    {row.needs_photos && (
                      <p className="text-xs text-warning">No photograph yet</p>
                    )}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={starting === row.subject_id}
                      onClick={() => void startPrep(row.subject_kind, row.subject_id)}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {starting === row.subject_id ? 'Starting…' : 'Prepare for listing'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 && !error ? (
        <p className="rounded border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-muted">
          {tab === 'listed'
            ? 'Nothing has been recorded as listed yet.'
            : tab === 'ready'
              ? 'Nothing is ready to list yet.'
              : 'No preparations match. Open an item or lot to start one.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <QueueRow
              key={row.id}
              row={row}
              selectable={canEdit && tab !== 'listed'}
              selected={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
              onOpen={() => navigate(`/listing-prep/${row.id}`)}
            />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
            className="rounded border border-hairline px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-ink-muted">Page {page} of {pageCount} · {total} total</span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => update({ page: String(page + 1) })}
            className="rounded border border-hairline px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

function QueueRow({
  row, selectable, selected, onToggle, onOpen,
}: {
  row: PrepQueueRow;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const title = row.working_title ?? row.display_name ?? row.subject_public_id ?? row.public_id;
  return (
    <li className="rounded-lg border border-hairline bg-surface-1 p-3">
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${title}`}
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block text-left">
            <span className="text-sm font-semibold">{title}</span>
            <span className="ml-2 text-xs text-ink-muted">{row.subject_public_id ?? row.public_id}</span>
          </button>
          {row.detail_line && <p className="truncate text-xs text-ink-muted">{row.detail_line}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[11px] ${readinessTone(row.readiness_status)}`}>
              {READINESS_LABELS[row.readiness_status]}
            </span>
            <span className="rounded border border-hairline px-1.5 py-0.5 text-[11px] text-ink-muted">
              {STATUS_LABELS[row.status]}
            </span>
            {/* Status still says ready but a blocker has appeared since. The
                status is never silently rewritten to make the record fit a
                queue, so the regression is named instead. */}
            {row.status === 'ready_to_list' && row.blocker_count > 0 && (
              <span className="rounded border border-bad/50 bg-bad/10 px-1.5 py-0.5 text-[11px] font-semibold text-bad">
                Regressed from ready
              </span>
            )}
            {row.priority !== 'normal' && (
              <span className={`rounded border px-1.5 py-0.5 text-[11px] capitalize ${PRIORITY_STYLE[row.priority]}`}>
                {row.priority}
              </span>
            )}
            {row.asking_price_minor !== null && (
              <span className="text-[11px] text-ink-muted">
                {formatMoney(row.asking_price_minor, row.currency)}
              </span>
            )}
            {row.external_listing_ref && (
              <span className="text-[11px] text-ink-muted">Listed at {row.external_listing_ref}</span>
            )}
          </div>

          {row.blocked_reason && (
            <p className="mt-1 flex items-center gap-1 text-xs text-bad">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {row.blocked_reason}
            </p>
          )}

          {row.blockers.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {row.blockers.slice(0, 3).map((b) => (
                <li key={b.code} className="flex items-center gap-1 text-xs text-ink-muted">
                  <ClipboardList className="h-3 w-3" aria-hidden="true" /> {b.label}
                </li>
              ))}
              {row.blockers.length > 3 && (
                <li className="text-xs text-ink-muted">and {row.blockers.length - 3} more</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

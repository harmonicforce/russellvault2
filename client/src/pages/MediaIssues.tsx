// Media Issues — where storage and the database disagree.
//
// Nothing on this page deletes anything automatically. Reconciliation only
// reports; an operator decides what each disagreement means. That matters
// because the ambiguous cases (an object with no row, a row with no object)
// are exactly the ones where guessing destroys evidence.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileWarning, RefreshCw } from 'lucide-react';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import { createMediaTransport, type MediaIssue } from '../lib/mediaApi';
import { tokenProviderFromClient as tokenProvider } from '../lib/tokenProvider';
import {
  createOperationsDashboardTransport, isMediaReadinessStatus,
  type MediaReadinessRow, type MediaReadinessStatus,
} from '../lib/operationsDashboardApi';

/** One page of the readiness backlog. The exact total comes from the server. */
const READINESS_PAGE_SIZE = 50;

/** Plain language for each readiness state, and what the operator does next. */
const READINESS: Record<MediaReadinessStatus, { title: string; meaning: string }> = {
  missing_required_angle: {
    title: 'Missing a required angle',
    meaning: 'This record has at least one photograph but still owes an angle its category asks for.',
  },
  missing_defect_photo: {
    title: 'Missing a condition photograph',
    meaning: 'The category asks for a photograph of flaws or wear, and none has been taken.',
  },
  upload_incomplete: {
    title: 'Upload unfinished',
    meaning: 'An upload was started and never finished, so it does not count as a photograph.',
  },
  media_review_needed: {
    title: 'Photo issue open',
    meaning: 'Storage and the database disagree about this record\u2019s photographs.',
  },
  complete: {
    title: 'Complete',
    meaning: 'Every photograph this category asks for is present.',
  },
};

/** Plain language for each disagreement, plus what resolving it means. */
const KINDS: Record<string, { title: string; meaning: string }> = {
  storage_object_without_row: {
    title: 'Image with no record',
    meaning: 'A file is in storage that no inventory record points at. It may be a leftover from an interrupted upload, or evidence that was never attached.',
  },
  row_without_storage_object: {
    title: 'Record with no image',
    meaning: 'A photo record exists but its file is missing from storage. The photo cannot be displayed and should be re-taken.',
  },
  duplicate_content: {
    title: 'Duplicate image',
    meaning: 'The same image is held more than once in this workspace. That is allowed, but it is often an accidental double upload.',
  },
  interrupted_upload: {
    title: 'Unfinished upload',
    meaning: 'An upload was started and never completed, so it is not part of any record.',
  },
  invalid_path: {
    title: 'Unexpected storage location',
    meaning: 'A photo record points outside this workspace’s governed folder.',
  },
  retired_subject: {
    title: 'Photo on a retired record',
    meaning: 'Photos are still attached to inventory that has been voided or superseded.',
  },
  failed_deletion: {
    title: 'Deletion did not finish',
    meaning: 'The record was purged but the file is still in storage.',
  },
};

export default function MediaIssues() {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'operator';

  const transport = useMemo(() => {
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createMediaTransport(tokenProviderFromClient(shadow), () => workspace?.id ?? null);
  }, [workspace?.id]);

  // The readiness drill-down is a governed operations read, not a media
  // mutation, so it has its own transport.
  const operations = useMemo(
    () => createOperationsDashboardTransport(tokenProvider(
      createShadowClient(import.meta.env as unknown as Record<string, string | undefined>))),
    []);

  // The URL carries the tab and status so the dashboard tile can link straight
  // to the exact population it counted.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'readiness' ? 'readiness' : 'issues';

  // A status arriving from the URL is untrusted: a stale bookmark, a truncated
  // link, or a hand-edited query string. An unrecognised one is dropped rather
  // than cast — casting it would index the label table with `undefined` and
  // take the page down, and sending it on would report an empty backlog for a
  // filter that never existed.
  const rawStatus = params.get('status');
  const readinessStatus: MediaReadinessStatus | null =
    isMediaReadinessStatus(rawStatus) ? rawStatus : null;
  const statusRejected = rawStatus !== null && readinessStatus === null;

  const pageParam = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * READINESS_PAGE_SIZE;

  /** Rewrite the URL so a filtered page can be shared and Back restores it. */
  const setReadinessParams = (next: { status?: MediaReadinessStatus | null; page?: number }) => {
    const search = new URLSearchParams(params);
    search.set('tab', 'readiness');
    if ('status' in next) {
      if (next.status) search.set('status', next.status);
      else search.delete('status');
      // A different population starts at its own beginning; keeping page 3
      // would land the operator past the end of a shorter list.
      search.delete('page');
    }
    if (next.page !== undefined) {
      if (next.page <= 1) search.delete('page');
      else search.set('page', String(next.page));
    }
    setParams(search, { replace: true });
  };

  const [issues, setIssues] = useState<readonly MediaIssue[]>([]);
  const [readiness, setReadiness] = useState<{ total: number; rows: MediaReadinessRow[] } | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [state, setState] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setIssues(await transport.issues(state));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [transport, workspace, state]);

  const workspaceId = workspace?.id ?? null;
  useEffect(() => {
    if (!workspaceId || tab !== 'readiness') return;
    let cancelled = false;
    setReadinessError(null);
    // Clear first. Showing the previous workspace's, status's or page's rows
    // under a new heading is worse than showing nothing: the operator reads
    // them as the answer to the question they just asked.
    setReadiness(null);
    operations.mediaReadiness(
      workspaceId,
      readinessStatus ? [readinessStatus] : undefined,
      READINESS_PAGE_SIZE,
      offset,
    )
      .then((result) => { if (!cancelled) setReadiness({ total: result.total, rows: result.rows }); })
      // A failed read is a failure, never an empty backlog.
      .catch((e: Error) => { if (!cancelled) { setReadiness(null); setReadinessError(e.message); } });
    return () => { cancelled = true; };
  }, [operations, workspaceId, tab, readinessStatus, offset]);

  useEffect(() => { void load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await transport.reconcile() as { storage_listing_available?: boolean; truncated?: boolean };
      setNotice(
        result.storage_listing_available === false || result.truncated
          ? 'Checked the records. The storage listing could not be read in full, so file-level checks were skipped rather than reporting photos as missing on incomplete evidence.'
          : 'Checked every record against storage.'
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const close = async (issue: MediaIssue, next: 'resolved' | 'dismissed') => {
    const note = window.prompt(
      next === 'resolved' ? 'What was done to resolve this?' : 'Why is this being dismissed?'
    );
    if (note === null) return;
    try {
      await transport.resolveIssue(issue.id, next, note.trim() || null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FileWarning className="h-5 w-5 text-accent" /> Photo issues
          </h1>
          <p className="text-xs text-ink-muted">
            {tab === 'readiness'
              ? 'Current stock that still owes a photograph its category asks for.'
              : 'Disagreements between stored images and inventory records. Nothing here is deleted automatically.'}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Checking…' : 'Check now'}
          </button>
        )}
      </header>

      {notice && <p role="status" className="rounded border border-hairline bg-surface-1 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      <div className="flex gap-2" role="tablist">
        {([['issues', 'Storage issues'], ['readiness', 'Photo readiness']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (key === 'readiness') next.set('tab', 'readiness');
              else { next.delete('tab'); next.delete('status'); }
              setParams(next, { replace: true });
            }}
            className={`rounded border px-3 py-1.5 text-sm ${
              tab === key ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'readiness' ? (
        <ReadinessList
          data={readiness}
          error={readinessError}
          status={readinessStatus}
          statusRejected={statusRejected}
          page={page}
          pageSize={READINESS_PAGE_SIZE}
          onPage={(next) => setReadinessParams({ page: next })}
          onStatus={(next) => setReadinessParams({ status: next })}
          onOpen={(row) => navigate(row.subject_kind === 'item'
            ? `/inventory/current/${row.subject_id}`
            : `/inventory/lots/${row.subject_id}`)}
        />
      ) : (
      <>
      <div className="flex gap-2">
        {(['open', 'resolved', 'dismissed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={`rounded border px-3 py-1.5 text-sm capitalize ${
              state === s ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : issues.length === 0 ? (
        <p className="rounded border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-muted">
          {state === 'open' ? 'No photo issues. Storage and records agree.' : `No ${state} issues.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => {
            const meta = KINDS[issue.issue_kind] ?? { title: issue.issue_kind, meaning: '' };
            return (
              <li key={issue.id} className="rounded-lg border border-hairline bg-surface-1 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                  <h2 className="text-sm font-semibold">{meta.title}</h2>
                  <span className="text-xs text-ink-muted">
                    {new Date(issue.detected_at).toLocaleString()}
                  </span>
                </div>
                <p className="mb-2 text-xs text-ink-muted">{meta.meaning}</p>

                {issue.subject_id && issue.subject_kind && (
                  <button
                    type="button"
                    onClick={() => navigate(issue.subject_kind === 'item'
                      ? `/inventory/current/${issue.subject_id}`
                      : `/inventory/lots/${issue.subject_id}`)}
                    className="mb-2 block text-xs font-semibold text-accent"
                  >
                    Open the {issue.subject_kind === 'item' ? 'item' : 'lot'} this photo belongs to
                  </button>
                )}

                {issue.state === 'open' && canEdit && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void close(issue, 'resolved')}
                      className="rounded border border-accent px-3 py-1.5 text-xs font-semibold text-accent"
                    >
                      Mark resolved
                    </button>
                    <button
                      type="button"
                      onClick={() => void close(issue, 'dismissed')}
                      className="rounded border border-hairline px-3 py-1.5 text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {issue.state !== 'open' && issue.resolution_note && (
                  <p className="text-xs text-ink-muted">Note: {issue.resolution_note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}
    </div>
  );
}

/**
 * Current stock that still owes a photograph. This is a different population
 * from "no photo at all" — every record here may already have one — so it gets
 * its own destination rather than being folded into the inventory filter.
 */
function ReadinessList({
  data, error, status, statusRejected, page, pageSize, onPage, onStatus, onOpen,
}: {
  data: { total: number; rows: MediaReadinessRow[] } | null;
  error: string | null;
  status: MediaReadinessStatus | null;
  statusRejected: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onStatus: (status: MediaReadinessStatus | null) => void;
  onOpen: (row: MediaReadinessRow) => void;
}) {
  // The filter row is shown in every state, including failure, so an operator
  // whose filter produced an error can change it without going back.
  const filters = (
    <div className="flex flex-wrap gap-2" aria-label="Photo readiness filter">
      <button
        type="button"
        aria-pressed={status === null}
        onClick={() => onStatus(null)}
        className={`rounded border px-3 py-1.5 text-xs ${
          status === null ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
        }`}
      >
        Everything outstanding
      </button>
      {(Object.keys(READINESS) as MediaReadinessStatus[])
        .filter((key) => key !== 'complete')
        .map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={status === key}
            onClick={() => onStatus(key)}
            className={`rounded border px-3 py-1.5 text-xs ${
              status === key ? 'border-accent bg-accent/5 font-semibold' : 'border-hairline'
            }`}
          >
            {READINESS[key].title}
          </button>
        ))}
    </div>
  );

  const rejectedNotice = statusRejected && (
    <p role="status" className="rounded border border-hairline bg-surface-1 p-3 text-xs">
      That photo readiness filter is not one this system recognises, so it was
      ignored and everything outstanding is shown. Nothing has been reported as
      empty on the strength of it.
    </p>
  );

  if (error) {
    return (
      <>
        {filters}
        {rejectedNotice}
        <div role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          <p>{error}</p>
          <p className="mt-1 text-xs">No count has been substituted; this backlog is unknown, not zero.</p>
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {filters}
        {rejectedNotice}
        <p className="text-sm text-ink-muted">Loading photo readiness…</p>
      </>
    );
  }
  if (data.rows.length === 0) {
    return (
      <>
        {filters}
        {rejectedNotice}
        <p className="rounded border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-muted">
          {page > 1
            ? 'There is nothing on this page. The backlog may have shrunk since the link was made.'
            : status
              ? `No current stock is ${READINESS[status].title.toLowerCase()}.`
              : 'Every current record has the photographs its category asks for.'}
        </p>
        {page > 1 && (
          <button type="button" onClick={() => onPage(1)} className="rounded border border-hairline px-3 py-1.5 text-sm">
            Back to the first page
          </button>
        )}
      </>
    );
  }

  // The total is the exact governed count, not the length of this page, so a
  // backlog above one page is visibly reachable instead of silently truncated.
  const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = firstShown + data.rows.length - 1;

  return (
    <>
      {filters}
      {rejectedNotice}
      <p className="text-xs text-ink-muted">
        {data.total} current record{data.total === 1 ? '' : 's'}
        {data.total > data.rows.length ? ` · showing ${firstShown}–${lastShown}` : ''}
        {status ? ` · ${READINESS[status].meaning}` : ''}
      </p>
      <ul className="space-y-2">
        {data.rows.map((row) => (
          <li key={`${row.subject_kind}-${row.subject_id}`} className="rounded-lg border border-hairline bg-surface-1 p-3">
            <button type="button" onClick={() => onOpen(row)} className="block w-full text-left">
              <span className="text-sm font-semibold">{row.display_name ?? row.public_id}</span>
              <span className="ml-2 text-xs text-ink-muted">{row.public_id}</span>
              {row.detail_line && <p className="truncate text-xs text-ink-muted">{row.detail_line}</p>}
            </button>
            <p className="mt-1 text-xs">
              <AlertTriangle className="mr-1 inline h-3 w-3 text-warning" aria-hidden="true" />
              {READINESS[row.readiness_status]?.title ?? row.readiness_status}
            </p>
            {row.missing_required_angles.length > 0 && (
              <p className="text-xs text-ink-muted">Still needs: {row.missing_required_angles.join(', ')}</p>
            )}
            {row.missing_required_defect_photos.length > 0 && (
              <p className="text-xs text-ink-muted">
                Condition photo: {row.missing_required_defect_photos.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>

      {lastPage > 1 && (
        <nav aria-label="Photo readiness pages" className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-ink-muted">Page {page} of {lastPage}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => onPage(page + 1)}
            className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}

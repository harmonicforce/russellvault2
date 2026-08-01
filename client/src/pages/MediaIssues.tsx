// Media Issues — where storage and the database disagree.
//
// Nothing on this page deletes anything automatically. Reconciliation only
// reports; an operator decides what each disagreement means. That matters
// because the ambiguous cases (an object with no row, a row with no object)
// are exactly the ones where guessing destroys evidence.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileWarning, RefreshCw } from 'lucide-react';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import { createMediaTransport, type MediaIssue } from '../lib/mediaApi';

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

  const [issues, setIssues] = useState<readonly MediaIssue[]>([]);
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
            Disagreements between stored images and inventory records. Nothing here is deleted automatically.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Checking…' : 'Check now'}
          </button>
        )}
      </header>

      {notice && <p role="status" className="rounded border border-hairline bg-surface-1 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

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
    </div>
  );
}

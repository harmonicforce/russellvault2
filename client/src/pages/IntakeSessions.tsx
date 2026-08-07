// Intake Sessions — resume, review, or abandon an intake session without ever
// typing or seeing a session id. Each row shows a readable label, when it was
// opened/last active, its state, and how many drafts/commits it holds.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, PackagePlus } from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createIntakeTransport, type IntakeSessionListItem, type IntakeTransport } from '../lib/intakeApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function countsSummary(counts: Record<string, number>): string {
  const parts: string[] = [];
  if (counts.draft) parts.push(`${counts.draft} draft`);
  if (counts.ready_to_commit) parts.push(`${counts.ready_to_commit} ready`);
  if (counts.committed) parts.push(`${counts.committed} committed`);
  if (counts.abandoned) parts.push(`${counts.abandoned} abandoned`);
  return parts.length > 0 ? parts.join(', ') : 'No items yet';
}

export default function IntakeSessions() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const transport: IntakeTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(client));
  }, [config]);

  const [sessions, setSessions] = useState<readonly IntakeSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const PAGE = 25;

  const load = (nextOffset: number) => {
    if (!transport || !workspace) return;
    setLoading(true);
    setError(null);
    transport
      .listSessions(workspace.id, PAGE, nextOffset)
      .then((page) => {
        setSessions(page.sessions);
        setTotal(page.total);
        setOffset(nextOffset);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, workspace?.id]);

  if (!config || !transport) {
    return <div className="p-6 text-sm text-ink-muted">Intake sessions are not enabled in this build.</div>;
  }
  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view intake sessions.</div>;
  }

  const abandon = (session: IntakeSessionListItem) => {
    if (!window.confirm(`Abandon "${session.label || 'this session'}"? Open drafts in it will become read-only.`)) {
      return;
    }
    setBusyId(session.id);
    transport
      .abandonSession(workspace.id, session.id)
      .then(() => load(offset))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusyId(null));
  };

  const resume = (session: IntakeSessionListItem) => {
    navigate('/quick-add', { state: { resumeSessionId: session.id } });
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-accent" /> Intake Sessions
          </h1>
          <p className="mt-1 text-xs text-ink-muted">Every batch of items you've started adding, open or finished.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/quick-add')}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
        >
          <PackagePlus className="h-4 w-4" /> Start new session
        </button>
      </header>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">No intake sessions yet. Start one from Quick Add.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="rounded-lg border border-hairline bg-surface-1 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.label || 'Untitled session'}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        s.state === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-2 text-ink-muted'
                      }`}
                    >
                      {s.state === 'open' ? 'Open' : 'Abandoned'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Opened {formatWhen(s.opened_at)} · Last activity {formatWhen(s.updated_at)}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">{countsSummary(s.groupCounts)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {s.state === 'open' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => resume(s)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => abandon(s)}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      >
                        Abandon
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => resume(s)}
                      className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => load(Math.max(0, offset - PAGE))}
            className="rounded border border-hairline px-3 py-1.5 disabled:opacity-50"
          >
            Newer
          </button>
          <span className="text-ink-muted">
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE >= total}
            onClick={() => load(offset + PAGE)}
            className="rounded border border-hairline px-3 py-1.5 disabled:opacity-50"
          >
            Older
          </button>
        </div>
      )}
    </div>
  );
}

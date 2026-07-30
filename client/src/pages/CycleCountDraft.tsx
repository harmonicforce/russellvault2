// A draft count: created, scoped, not yet started.
//
// A draft has frozen nothing. It can be previewed, started, or cancelled without
// consequence, which is exactly why starting is kept as its own deliberate act.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, Snowflake } from 'lucide-react';
import { useCycleCountSession } from '../lib/useCycleCountSession';
import {
  previewWarnings, requiresEmptyScopeConfirmation, validateCancellation, type ScopePreview,
} from '../lib/cycleCount';
import { BlindChip, CycleStatusChip, ErrorNote, LoadingNote } from '../components/CycleCountPanels';
import { Modal } from '../components/Modal';

export default function CycleCountDraft() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { api, bundle, loading, error, reload, setError } =
    useCycleCountSession(sessionId, ['draft']);

  const [preview, setPreview] = useState<ScopePreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const loadPreview = useCallback(async () => {
    if (!api || !sessionId) return;
    try {
      setPreview(await api.previewScope(sessionId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, sessionId, setError]);

  useEffect(() => { if (bundle?.found) void loadPreview(); }, [bundle?.found, loadPreview]);

  if (loading && !bundle) return <div className="p-6"><LoadingNote what="the draft" /></div>;

  if (bundle && !bundle.found) {
    return (
      <div className="max-w-xl space-y-3 p-6">
        <p className="text-sm font-medium">That cycle count is not in this workspace.</p>
        <Link to="/cycle-counts" className="inline-block text-sm text-accent underline">
          Back to cycle counts
        </Link>
      </div>
    );
  }

  const session = bundle?.session;
  if (!session) return <div className="p-6"><ErrorNote message={error} /></div>;
  const canCount = bundle?.can_count ?? false;

  const start = async () => {
    if (!api || !sessionId || busy) return;
    setProblem(null);
    if (preview && requiresEmptyScopeConfirmation(preview) && !acknowledged) {
      setProblem('That scope holds nothing countable. Confirm you meant to start an empty count.');
      return;
    }
    setBusy(true);
    try {
      await api.startSession(sessionId);
      navigate(`/cycle-counts/${sessionId}/count`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!api || !sessionId || busy) return;
    const check = validateCancellation(cancelReason);
    if (!check.ok) { setProblem(check.problem); return; }
    setBusy(true);
    try {
      await api.cancel(sessionId, cancelReason.trim());
      setCancelOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const warnings = preview ? previewWarnings(preview) : [];

  return (
    <div className="max-w-2xl space-y-4 p-4 sm:p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/cycle-counts" className="text-xs text-accent underline">Cycle counts</Link>
          <span className="text-xs text-ink-muted">/</span>
          <span className="font-mono text-sm font-medium">{session.public_id}</span>
          <CycleStatusChip status={session.status} />
          <BlindChip blind={session.blind_count} />
        </div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardCheck className="h-5 w-5 text-accent" aria-hidden /> Draft count of {session.root_location_code}
        </h1>
        <p className="text-xs text-ink-muted">
          Created {session.created_at}{session.created_by_email ? ` by ${session.created_by_email}` : ''}
          {' · '}{session.include_descendants ? 'that location and everything below it' : 'that exact location only'}
        </p>
      </header>

      <ErrorNote message={error} />

      <section className="space-y-3 rounded-xl border border-hairline bg-surface-1 p-4">
        <h2 className="text-sm font-semibold">What this count will cover</h2>
        {preview === null ? (
          <LoadingNote what="the scope preview" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Locations</dt>
                <dd className="text-lg font-semibold tabular-nums">{preview.location_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Serialized units</dt>
                <dd className="text-lg font-semibold tabular-nums">{preview.expected_item_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Quantity lots</dt>
                <dd className="text-lg font-semibold tabular-nums">{preview.expected_lot_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Lot units</dt>
                <dd className="text-lg font-semibold tabular-nums">{preview.expected_unit_count ?? '—'}</dd>
              </div>
            </dl>

            {warnings.map((w) => (
              <p key={w} className="rounded border border-warning/50 bg-warning/8 px-3 py-2 text-xs text-[#8a5a00] dark:text-warning">
                {w}
              </p>
            ))}

            {requiresEmptyScopeConfirmation(preview) && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-5 w-5"
                />
                I meant to start a count over an empty scope.
              </label>
            )}

            {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}

            {canCount ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={start}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Snowflake className="h-4 w-4" aria-hidden />
                  {busy ? 'Starting…' : 'Start the count and freeze the snapshot'}
                </button>
                <button
                  type="button"
                  onClick={() => { setCancelOpen(true); setProblem(null); }}
                  className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
                >
                  Cancel this draft…
                </button>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                Starting a count is limited to owners and operators.
              </p>
            )}
          </>
        )}
      </section>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this draft">
        <div className="space-y-3 text-sm">
          <p className="text-ink-secondary">
            This draft has frozen nothing and counted nothing, so cancelling it changes no inventory.
            The cancelled draft is kept as a record that it existed.
          </p>
          <div>
            <label htmlFor="cc-draft-cancel" className="block text-xs font-medium text-ink-secondary">
              Reason (required)
            </label>
            <textarea
              id="cc-draft-cancel"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface-0 px-3 py-2 text-sm focus:outline-2 focus:outline-accent"
            />
          </div>
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="min-h-11 rounded-lg border border-danger/50 bg-danger/8 px-4 text-sm font-medium text-danger disabled:opacity-50"
            >
              Cancel the draft
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
            >
              Keep it
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

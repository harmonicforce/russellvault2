// Reviewing a count: deciding what each disagreement between the frozen
// expectation and the shelf actually means.
//
// Nothing here resolves itself. Activity that happened after the snapshot is
// shown against the discrepancy it might explain, but explaining is a decision a
// person records — the presence of a later movement never closes anything.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { useCycleCountSession } from '../lib/useCycleCountSession';
import type { DiscrepancyRow } from '../lib/cycleCountApi';
import {
  completionPercent, groupDiscrepancies, isStaleQuantityConflict,
  type Readiness, type ResolutionAction,
} from '../lib/cycleCount';
import {
  BlindChip, CompletionPanel, CycleStatusChip, DiscrepancyCard, ErrorNote, LoadingNote,
  ProgressPanel,
} from '../components/CycleCountPanels';

export default function CycleCountReview() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { api, bundle, loading, error, statusChange, dismissStatusChange, reload, setError } =
    useCycleCountSession(sessionId, ['review']);

  const [rows, setRows] = useState<readonly DiscrepancyRow[]>([]);
  // The server's word, not a guess. True while a blind count is mid-recount.
  const [quantitiesWithheld, setQuantitiesWithheld] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadReview = useCallback(async () => {
    if (!api || !sessionId) return;
    setLoadingRows(true);
    try {
      const [page, ready] = await Promise.all([
        api.review(sessionId, { limit: 200, offset: 0 }),
        api.readiness(sessionId),
      ]);
      setRows(page.rows);
      setQuantitiesWithheld(page.quantities_withheld);
      setReadiness(ready);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingRows(false);
    }
  }, [api, sessionId, setError]);

  useEffect(() => { if (bundle?.found) void loadReview(); }, [bundle?.found, loadReview]);

  if (loading && !bundle) return <div className="p-6"><LoadingNote what="the count" /></div>;

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
  const progress = bundle?.progress;
  if (!session || !progress) return <div className="p-6"><ErrorNote message={error} /></div>;

  const canReview = bundle?.can_count ?? false;
  const groups = groupDiscrepancies(rows);

  const resolve = async (
    row: DiscrepancyRow, action: ResolutionAction, note: string | null, toLocationCode: string | null
  ) => {
    if (!api) return;
    setBusyId(row.discrepancy_id);
    setError(null);
    try {
      await api.resolve(row.discrepancy_id, action, note, toLocationCode);
      await Promise.all([reload(), loadReview()]);
    } catch (e) {
      const message = (e as Error).message;
      // A stale-quantity conflict is not a bug to retry blindly: the lot moved
      // after the count, so the reviewer has to look again before applying.
      setError(isStaleQuantityConflict(message)
        ? `${message} — this lot changed after the count. Reload, check the current quantity, and decide again. The failed attempt has been kept.`
        : message);
      // The refusal is recorded by the database, so the history is re-read even
      // on failure; a failed attempt the reviewer cannot see is worse than the
      // failure itself.
      await loadReview();
    } finally {
      setBusyId(null);
    }
  };

  const recount = async (row: DiscrepancyRow, note: string | null) => {
    if (!api) return;
    setBusyId(row.discrepancy_id);
    setError(null);
    try {
      await api.requestRecount(row.discrepancy_id, note);
      // A recount reopens counting, so the operator belongs back on the floor.
      navigate(`/cycle-counts/${sessionId}/count`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      await loadReview();
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (allowDeferred: boolean, note: string | null) => {
    if (!api || !sessionId || completing) return;
    setCompleting(true);
    setError(null);
    try {
      await api.complete(sessionId, allowDeferred, note);
      navigate(`/cycle-counts/${sessionId}/audit`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      await Promise.all([reload(), loadReview()]);
    } finally {
      setCompleting(false);
    }
  };

  const cancel = async (reason: string) => {
    if (!api || !sessionId || completing) return;
    setCompleting(true);
    setError(null);
    try {
      await api.cancel(sessionId, reason);
      navigate(`/cycle-counts/${sessionId}/audit`, { replace: true });
    } catch (e) {
      // The database refuses to cancel a count that has already changed stock.
      // That refusal is shown as-is rather than being softened into a shrug.
      setError((e as Error).message);
      await Promise.all([reload(), loadReview()]);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/cycle-counts" className="text-xs text-accent underline">Cycle counts</Link>
          <span className="text-xs text-ink-muted">/</span>
          <span className="font-mono text-sm font-medium">{session.public_id}</span>
          <CycleStatusChip status={session.status} />
          <BlindChip blind={session.blind_count} />
        </div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5 text-accent" aria-hidden /> Review {session.root_location_code}
        </h1>
        <p className="text-xs text-ink-muted">
          Submitted {session.submitted_at ?? '—'}
          {session.submitted_by_email && ` by ${session.submitted_by_email}`}
          {session.blind_count && ' · expected quantities are now visible'}
        </p>
      </header>

      {statusChange && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-warning/50 bg-warning/8 px-3 py-2 text-sm text-[#8a5a00] dark:text-warning">
          <span>{statusChange}</span>
          <button type="button" onClick={dismissStatusChange} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {!canReview && (
        <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm">
          You can read this review but not resolve anything. Resolving is limited to owners and operators.
        </div>
      )}

      <ErrorNote message={error} />

      {/* A blind count sent back for a recount is blind again. Saying so is
          better than silently rendering blank figures, which reads as a bug. */}
      {quantitiesWithheld && (
        <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm">
          <span className="font-semibold">Figures withheld — this blind count is being recounted.</span>{' '}
          <span className="text-ink-secondary">
            Expected and counted quantities are hidden until the recount is submitted, so the second
            observation stays independent of the first.
          </span>
        </div>
      )}

      <ProgressPanel
        progress={progress}
        reviewTotals={bundle?.review_totals ?? null}
        round={bundle?.current_round ?? 1}
        percent={completionPercent(progress)}
      />

      {loadingRows ? (
        <LoadingNote what="discrepancies" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface-1 p-6 text-center">
          <p className="text-sm font-medium">No discrepancies.</p>
          <p className="mt-1 text-xs text-ink-muted">
            Everything in the frozen snapshot was found where it was expected, in the quantity
            expected.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`cc-group-${group.key}`}>
            <h2 id={`cc-group-${group.key}`} className="mb-2 text-sm font-semibold">
              {group.label}{' '}
              <span className="font-normal text-ink-muted">({group.rows.length})</span>
            </h2>
            <ul className="space-y-3">
              {group.rows.map((row) => (
                <DiscrepancyCard
                  key={row.discrepancy_id}
                  row={row}
                  busy={busyId === row.discrepancy_id}
                  readOnly={!canReview}
                  quantitiesWithheld={quantitiesWithheld}
                  onResolve={resolve}
                  onRecount={recount}
                  onOpenRecord={(r) => navigate(
                    r.subject_kind === 'item' && r.item_id
                      ? `/inventory/current/${r.item_id}`
                      : r.lot_id ? `/inventory/lots/${r.lot_id}` : '/inventory/current'
                  )}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {readiness && canReview && (
        <CompletionPanel
          readiness={readiness}
          busy={completing}
          onComplete={complete}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

// Counting. This is the page somebody uses standing at a shelf.
//
// Everything canonical is re-read from the database on load, so leaving the page,
// refreshing, or picking the count up on a different device loses nothing. The
// only thing kept locally is which tab and filter the operator was looking at.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ScanLine } from 'lucide-react';
import { useCycleCountSession } from '../lib/useCycleCountSession';
import type { ItemQueueRow, LotQueueRow, ObservationFeedRow } from '../lib/cycleCountApi';
import {
  completionPercent, friendlyCycleCountError, scanFeedback, submissionReadiness,
  type ScanFeedback,
} from '../lib/cycleCount';
import {
  BlindChip, CycleStatusChip, ErrorNote, ItemQueuePanel, LoadingNote, LotQueuePanel,
  ObservationFeedPanel, ProgressPanel, ScanPanel,
} from '../components/CycleCountPanels';
import { Modal } from '../components/Modal';

type Tab = 'scan' | 'lots' | 'units';
type LotFilter = 'all' | 'uncounted' | 'counted' | 'variances';

const EMPTY_SCOPE: readonly { location_id: string; location_code: string; location_display_name: string | null; depth: number }[] = [];

export default function CycleCountActive() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { api, bundle, loading, error, statusChange, dismissStatusChange, reload, setError } =
    useCycleCountSession(sessionId, ['in_progress']);

  const [tab, setTab] = useState<Tab>('scan');
  const [lotFilter, setLotFilter] = useState<LotFilter>('uncounted');
  const [locationCode, setLocationCode] = useState('');

  const [items, setItems] = useState<readonly ItemQueueRow[]>([]);
  const [lots, setLots] = useState<readonly LotQueueRow[]>([]);
  const [feed, setFeed] = useState<readonly ObservationFeedRow[]>([]);
  const [quantitiesWithheld, setQuantitiesWithheld] = useState(false);

  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savingLotId, setSavingLotId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [quantityFocused, setQuantityFocused] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitAck, setSubmitAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<string | null>(null);

  const scope = bundle?.scope ?? EMPTY_SCOPE;

  // Default the scan location to the first frozen scope location, once. Keyed on
  // the code rather than the array so a re-read of the same scope does not
  // reset a location the operator has since chosen.
  const firstScopeCode = scope.length > 0 ? scope[0].location_code : '';
  useEffect(() => {
    if (!locationCode && firstScopeCode) setLocationCode(firstScopeCode);
  }, [locationCode, firstScopeCode]);

  const loadQueues = useCallback(async () => {
    if (!api || !sessionId) return;
    try {
      const [itemPage, lotPage, feedResult] = await Promise.all([
        api.itemQueue(sessionId, 'all', 200, 0),
        api.lotQueue(sessionId, lotFilter, 200, 0),
        api.observationFeed(sessionId, 25, true),
      ]);
      setItems(itemPage.rows);
      setLots(lotPage.rows);
      setQuantitiesWithheld(lotPage.quantities_withheld);
      setFeed(feedResult.rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, sessionId, lotFilter, setError]);

  useEffect(() => { if (bundle?.found) void loadQueues(); }, [bundle?.found, loadQueues]);

  if (loading && !bundle) return <div className="p-6"><LoadingNote what="the count" /></div>;

  if (bundle && !bundle.found) {
    return (
      <div className="max-w-xl space-y-3 p-6">
        <p className="text-sm font-medium">That cycle count is not in this workspace.</p>
        <p className="text-xs text-ink-muted">
          It may belong to another workspace, or the link may be wrong.
        </p>
        <Link to="/cycle-counts" className="inline-block text-sm text-accent underline">
          Back to cycle counts
        </Link>
      </div>
    );
  }

  const session = bundle?.session;
  const progress = bundle?.progress;
  if (!session || !progress) return <div className="p-6"><ErrorNote message={error} /></div>;

  const readiness = submissionReadiness(progress);
  const canCount = bundle?.can_count ?? false;

  const scan = async (identifier: string, note: string | null) => {
    if (!api || !sessionId) return;
    setScanning(true);
    setFeedback(null);
    try {
      const result = await api.observeItem(sessionId, identifier, locationCode, note);
      const next = scanFeedback(result);
      setFeedback(next);
      // Only refresh when something actually changed. A duplicate scan or a
      // refusal has nothing to re-read.
      if (next.recorded) { await Promise.all([reload(), loadQueues()]); }
    } catch (e) {
      setFeedback(friendlyCycleCountError((e as Error).message));
    } finally {
      setScanning(false);
    }
  };

  const saveLot = async (row: LotQueueRow, observedQuantity: number, note: string | null) => {
    if (!api || !sessionId) return;
    setSavingLotId(row.lot_id);
    setError(null);
    try {
      await api.observeLot(sessionId, row.lot_public_id, observedQuantity, note);
      await Promise.all([reload(), loadQueues()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingLotId(null);
    }
  };

  const undo = async (row: ObservationFeedRow, reason: string | null) => {
    if (!api) return;
    setVoidingId(row.observation_id);
    setError(null);
    try {
      await api.voidObservation(row.observation_id, row.subject_kind, reason);
      await Promise.all([reload(), loadQueues()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVoidingId(null);
    }
  };

  const submit = async () => {
    if (!api || !sessionId || submitting) return;
    setSubmitProblem(null);
    if (readiness.convertsUncounted && !submitAck) {
      setSubmitProblem('Confirm you understand what happens to the records nobody counted.');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitForReview(sessionId, readiness.convertsUncounted);
      navigate(`/cycle-counts/${sessionId}/review`, { replace: true });
    } catch (e) {
      setSubmitProblem((e as Error).message);
    } finally {
      setSubmitting(false);
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
          <ScanLine className="h-5 w-5 text-accent" aria-hidden /> Counting {session.root_location_code}
        </h1>
        <p className="text-xs text-ink-muted">
          Frozen scope: {scope.map((s) => s.location_code).join(', ') || '—'}
          {session.snapshot_frozen_at && <> · snapshot frozen {session.snapshot_frozen_at}</>}
        </p>
      </header>

      {statusChange && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-warning/50 bg-warning/8 px-3 py-2 text-sm text-[#8a5a00] dark:text-warning">
          <span>{statusChange}</span>
          <button type="button" onClick={dismissStatusChange} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {!canCount && (
        <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm">
          You can see this count but not record against it. Counting is limited to owners and operators.
        </div>
      )}

      <ErrorNote message={error} />

      <ProgressPanel
        progress={progress}
        reviewTotals={bundle?.review_totals ?? null}
        round={bundle?.current_round ?? 1}
        percent={completionPercent(progress)}
      />

      <div role="tablist" aria-label="Counting views" className="flex flex-wrap gap-2">
        {([['scan', 'Scan units'], ['lots', 'Count lots'], ['units', 'Unit queue']] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-lg px-4 text-sm font-medium ${
              tab === key ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'scan' && canCount && (
        <ScanPanel
          locations={scope.map((s) => ({
            code: s.location_code,
            label: s.location_display_name ? `${s.location_code} — ${s.location_display_name}` : s.location_code,
          }))}
          locationCode={locationCode}
          onLocationChange={setLocationCode}
          onScan={scan}
          feedback={feedback}
          busy={scanning}
          dialogOpen={submitOpen || quantityFocused}
        />
      )}

      {tab === 'lots' && (
        <>
          <div className="flex flex-wrap gap-2">
            {(['uncounted', 'counted', 'variances', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={lotFilter === f}
                onClick={() => setLotFilter(f)}
                className={`min-h-10 rounded-lg px-3 text-sm ${
                  lotFilter === f ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
                }`}
              >
                {f === 'uncounted' ? 'Not counted' : f === 'variances' ? 'Variances' : f === 'counted' ? 'Counted' : 'All'}
              </button>
            ))}
          </div>
          <LotQueuePanel
            rows={lots}
            quantitiesWithheld={quantitiesWithheld}
            savingLotId={savingLotId}
            onSave={saveLot}
            onFocusChange={setQuantityFocused}
          />
        </>
      )}

      {tab === 'units' && (
        <ItemQueuePanel
          rows={items}
          title="Serialized units in this count"
          emptyMessage="This count covers no serialized units."
        />
      )}

      <ObservationFeedPanel
        rows={feed}
        onVoid={canCount ? undo : undefined}
        voidingId={voidingId}
        readOnly={!canCount}
      />

      {canCount && (
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => { setSubmitOpen(true); setSubmitAck(false); setSubmitProblem(null); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white"
          >
            Submit for review <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <Link
            to="/cycle-counts"
            className="inline-flex min-h-11 items-center rounded-lg border border-hairline px-4 text-sm font-medium"
          >
            Pause and come back later
          </Link>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Progress is stored in the database as you go. You can close this page and pick the count up
        on any device.
      </p>

      <Modal open={submitOpen} onClose={() => setSubmitOpen(false)} title="Submit this count for review">
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 text-xs">
            <div><dt className="text-ink-muted">Units not counted</dt><dd className="text-base font-semibold tabular-nums">{readiness.uncountedItems}</dd></div>
            <div><dt className="text-ink-muted">Lots not counted</dt><dd className="text-base font-semibold tabular-nums">{readiness.uncountedLots}</dd></div>
            <div><dt className="text-ink-muted">Lots counted as zero</dt><dd className="text-base font-semibold tabular-nums">{readiness.observedZeroLots}</dd></div>
            <div><dt className="text-ink-muted">Found in the wrong place</dt><dd className="text-base font-semibold tabular-nums">{readiness.wrongLocation}</dd></div>
            <div><dt className="text-ink-muted">Unexpected units</dt><dd className="text-base font-semibold tabular-nums">{readiness.unexpected}</dd></div>
            <div><dt className="text-ink-muted">Observations this round</dt><dd className="text-base font-semibold tabular-nums">{readiness.totalObservations}</dd></div>
          </dl>

          {readiness.convertsUncounted ? (
            <>
              <p className="rounded border border-warning/50 bg-warning/8 px-3 py-2 text-xs text-[#8a5a00] dark:text-warning">
                {readiness.uncountedItems + readiness.uncountedLots} record(s) in this count were never
                looked at. Submitting turns each of them into its own discrepancy — recorded as
                <span className="font-semibold"> never counted</span>, which is not the same as missing
                and not the same as zero. They will need a decision in review.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={submitAck}
                  onChange={(e) => setSubmitAck(e.target.checked)}
                  className="mt-0.5 h-5 w-5"
                />
                <span>I understand the uncounted records become discrepancies to resolve.</span>
              </label>
            </>
          ) : (
            <p className="text-xs text-ink-secondary">
              Every record in this count has been looked at.
            </p>
          )}

          <p className="text-xs text-ink-secondary">
            After submission the observations for this round are closed to ordinary editing. A
            recount can reopen counting for a specific discrepancy.
          </p>

          {submitProblem && <p role="alert" className="text-xs text-danger">{submitProblem}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
            <button
              type="button"
              onClick={() => setSubmitOpen(false)}
              className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
            >
              Keep counting
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

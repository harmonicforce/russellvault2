// Cycle count — the shared operational surfaces.
//
// This is a tool used standing up, on a phone or an iPad, often in a hurry.
// Three consequences run through everything below:
//
//   * Status is never carried by colour alone. Every state has a mark or a word
//     as well, because a warehouse light and colour blindness are both real.
//   * The scan field owns focus, but not aggressively: it takes focus back after
//     a scan resolves and never while a dialog or a quantity field is in use.
//   * A quantity field that has not been touched stays empty. It is never
//     seeded with the expected number, and blur does not turn it into a zero.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Check, CircleDashed, History, Info, Loader2, Undo2, X,
} from 'lucide-react';
import { Modal } from './Modal';
import {
  ACTION_LABEL, DISCREPANCY_LABEL, LOT_STATUS_LABEL, LOT_STATUS_MARK, STATUS_LABEL,
  availableActions, parseObservedQuantity, requiresConfirmation,
  requiresNote, validateDeferredCompletion,
  type CycleCountStatus, type Progress, type Readiness, type ResolutionAction,
  type ScanFeedback,
} from '../lib/cycleCount';
import type {
  ActivityRow, DiscrepancyRow, LotQueueRow, ObservationFeedRow, ReviewTotals,
} from '../lib/cycleCountApi';

const STATUS_TONE: Record<CycleCountStatus, string> = {
  draft: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  in_progress: 'bg-accent/15 text-accent-strong',
  review: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  completed: 'bg-good/15 text-good',
  cancelled: 'bg-ink-muted/15 text-ink-secondary',
};

export function CycleStatusChip({ status }: { status: CycleCountStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function BlindChip({ blind }: { blind: boolean }) {
  if (!blind) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink-secondary"
      title="The counter cannot see expected quantities until this count reaches review"
    >
      Blind count
    </span>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

/** A read-only session says so once, unmistakably, at the top. */
export function TerminalBanner({ status, reason }: { status: CycleCountStatus; reason?: string | null }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm">
      <span className="font-semibold">
        {status === 'completed' ? 'Completed count — read only.' : 'Cancelled count — read only.'}
      </span>{' '}
      <span className="text-ink-secondary">
        Nothing on this page can be changed. It is kept as the permanent record of what was counted.
      </span>
      {reason && <div className="mt-1 text-xs text-ink-muted">Reason: {reason}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function Figure({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const toneClass = {
    default: 'text-ink', warn: 'text-[#8a5a00] dark:text-warning',
    bad: 'text-critical', good: 'text-good',
  }[tone];
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

export function ProgressPanel({
  progress, reviewTotals, round, percent,
}: {
  progress: Progress;
  reviewTotals?: ReviewTotals | null;
  round: number;
  percent: number;
}) {
  return (
    <section aria-labelledby="cc-progress" className="rounded-xl border border-hairline bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cc-progress" className="text-sm font-semibold">Progress</h2>
        <span className="text-xs text-ink-muted">Round {round}</span>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Records counted"
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-secondary">{percent}% of the frozen snapshot has been counted this round.</p>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Units expected" value={progress.expected_item_count} />
        <Figure label="Units found" value={progress.found_item_count} tone="good" />
        <Figure label="Units not counted" value={progress.uncounted_item_count} tone={progress.uncounted_item_count ? 'warn' : 'default'} />
        <Figure label="Wrong location" value={progress.wrong_location_count} tone={progress.wrong_location_count ? 'warn' : 'default'} />
        <Figure label="Unexpected here" value={progress.unexpected_item_count} tone={progress.unexpected_item_count ? 'warn' : 'default'} />
        <Figure label="Lots expected" value={progress.expected_lot_count} />
        <Figure label="Lots counted" value={progress.counted_lot_count} tone="good" />
        <Figure label="Lots not counted" value={progress.uncounted_lot_count} tone={progress.uncounted_lot_count ? 'warn' : 'default'} />
        <Figure label="Lots with a variance" value={progress.variance_lot_count} tone={progress.variance_lot_count ? 'warn' : 'default'} />
      </dl>

      {reviewTotals && (
        <div className="mt-4 border-t border-hairline pt-3">
          <h3 className="text-sm font-semibold">Review totals</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Missing units" value={reviewTotals.missing_item_count} tone={reviewTotals.missing_item_count ? 'bad' : 'default'} />
            <Figure label="Shortage units" value={reviewTotals.shortage_units} tone={reviewTotals.shortage_units ? 'bad' : 'default'} />
            <Figure label="Overage units" value={reviewTotals.overage_units} tone={reviewTotals.overage_units ? 'warn' : 'default'} />
            <Figure
              label="Net variance"
              value={reviewTotals.overage_units - reviewTotals.shortage_units}
              tone={reviewTotals.overage_units - reviewTotals.shortage_units === 0 ? 'default' : 'warn'}
            />
            <Figure label="Unresolved" value={reviewTotals.open_count + reviewTotals.recount_requested_count} tone={reviewTotals.open_count + reviewTotals.recount_requested_count ? 'bad' : 'good'} />
            <Figure label="Deferred" value={reviewTotals.deferred_count} tone={reviewTotals.deferred_count ? 'warn' : 'default'} />
          </dl>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Serialized scanning
// ---------------------------------------------------------------------------

const FEEDBACK_TONE = {
  good: 'border-good/40 bg-good/8 text-good',
  warn: 'border-warning/50 bg-warning/10 text-[#8a5a00] dark:text-warning',
  bad: 'border-danger/40 bg-danger/8 text-danger',
  neutral: 'border-hairline bg-surface-2 text-ink-secondary',
};

const FEEDBACK_ICON = {
  good: <Check className="h-4 w-4 shrink-0" aria-hidden />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />,
  bad: <X className="h-4 w-4 shrink-0" aria-hidden />,
  neutral: <Info className="h-4 w-4 shrink-0" aria-hidden />,
};

export function ScanPanel({
  locations, locationCode, onLocationChange, onScan, feedback, busy, dialogOpen,
}: {
  locations: readonly { code: string; label: string }[];
  locationCode: string;
  onLocationChange: (code: string) => void;
  onScan: (identifier: string, note: string | null) => Promise<void>;
  feedback: ScanFeedback | null;
  busy: boolean;
  /** Focus is not taken back while a dialog owns the screen. */
  dialogOpen: boolean;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // The field owns focus on arrival, and takes it back once a scan resolves —
  // never mid-dialog, and never while a request is still in flight.
  useEffect(() => {
    if (!busy && !dialogOpen) inputRef.current?.focus();
  }, [busy, dialogOpen, feedback]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const identifier = value.trim();
    // A scan is refused while the previous one is unresolved: two in flight
    // would race, and the second would report against stale state.
    if (!identifier || busy) return;
    await onScan(identifier, note.trim() || null);
    setValue('');
  };

  return (
    <section aria-labelledby="cc-scan" className="rounded-xl border border-hairline bg-surface-1 p-4">
      <h2 id="cc-scan" className="text-sm font-semibold">Scan a unit</h2>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label htmlFor="cc-scan-location" className="block text-xs font-medium text-ink-secondary">
            Where you are counting
          </label>
          <select
            id="cc-scan-location"
            value={locationCode}
            onChange={(e) => onLocationChange(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-base focus:outline-2 focus:outline-accent"
          >
            {locations.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cc-scan-input" className="block text-xs font-medium text-ink-secondary">
            Scan or type an identifier
          </label>
          <input
            id="cc-scan-input"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            placeholder="Certificate, serial, SKU or unit ID"
            aria-describedby="cc-scan-feedback"
            className="mt-1 min-h-12 w-full rounded-lg border border-hairline bg-surface-0 px-3 font-mono text-base focus:outline-2 focus:outline-accent"
          />
        </div>

        <div>
          <label htmlFor="cc-scan-note" className="block text-xs font-medium text-ink-secondary">
            Note (optional)
          </label>
          <input
            id="cc-scan-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-medium text-white disabled:opacity-50 sm:w-auto"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {busy ? 'Recording…' : 'Record this unit'}
        </button>
      </form>

      {/* Announced once per scan. Polite, so it never interrupts typing. */}
      <div id="cc-scan-feedback" aria-live="polite" className="mt-3 min-h-6">
        {feedback && (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${FEEDBACK_TONE[feedback.tone]}`}>
            {FEEDBACK_ICON[feedback.tone]}
            <div className="min-w-0">
              <div className="font-semibold">{feedback.headline}</div>
              {feedback.detail && <div className="mt-0.5 break-words text-xs opacity-90">{feedback.detail}</div>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lot counting
// ---------------------------------------------------------------------------

export function LotQueuePanel({
  rows, quantitiesWithheld, savingLotId, onSave, onFocusChange,
}: {
  rows: readonly LotQueueRow[];
  quantitiesWithheld: boolean;
  savingLotId: string | null;
  onSave: (row: LotQueueRow, observedQuantity: number, note: string | null) => Promise<void>;
  onFocusChange?: (focused: boolean) => void;
}) {
  // Drafts are held per lot, and deliberately start absent rather than seeded
  // with the expected quantity: a pre-filled field is a count nobody made.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-hairline bg-surface-1 p-4">
        <h2 className="text-sm font-semibold">Quantity lots</h2>
        <p className="mt-2 text-sm text-ink-muted">No lots match that filter.</p>
      </section>
    );
  }

  const save = async (row: LotQueueRow) => {
    const entry = parseObservedQuantity(drafts[row.lot_id]);
    if (entry.kind === 'untouched') {
      setProblems((p) => ({
        ...p,
        [row.lot_id]: 'Enter the number you counted. Leaving it blank keeps this lot uncounted — it does not record a zero.',
      }));
      return;
    }
    if (entry.kind === 'invalid') {
      setProblems((p) => ({ ...p, [row.lot_id]: entry.problem }));
      return;
    }
    setProblems((p) => ({ ...p, [row.lot_id]: '' }));
    await onSave(row, entry.value, notes[row.lot_id]?.trim() || null);
  };

  return (
    <section aria-labelledby="cc-lots" className="rounded-xl border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-3">
        <h2 id="cc-lots" className="text-sm font-semibold">Quantity lots</h2>
        {quantitiesWithheld && (
          <p className="mt-1 text-xs text-ink-muted">
            This is a blind count. Expected quantities are withheld until it reaches review.
          </p>
        )}
      </div>

      <ul className="divide-y divide-hairline">
        {rows.map((row) => {
          const saving = savingLotId === row.lot_id;
          const problem = problems[row.lot_id];
          const showExpected = !quantitiesWithheld && row.expected_quantity !== null;
          return (
            <li key={row.lot_id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.display_name}</div>
                  <div className="mt-0.5 font-mono text-xs text-ink-muted">{row.lot_public_id}</div>
                  <div className="mt-0.5 text-xs text-ink-secondary">{row.expected_location_code}</div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
                  <span aria-hidden>{LOT_STATUS_MARK[row.count_status]}</span>
                  {LOT_STATUS_LABEL[row.count_status]}
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
                <div>
                  <label htmlFor={`cc-qty-${row.lot_id}`} className="block text-xs font-medium text-ink-secondary">
                    Counted quantity
                  </label>
                  <input
                    id={`cc-qty-${row.lot_id}`}
                    value={drafts[row.lot_id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.lot_id]: e.target.value }))}
                    onFocus={() => onFocusChange?.(true)}
                    onBlur={() => onFocusChange?.(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(row); } }}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="—"
                    aria-describedby={problem ? `cc-qty-problem-${row.lot_id}` : undefined}
                    className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 font-mono text-base tabular-nums focus:outline-2 focus:outline-accent"
                  />
                </div>
                <div>
                  <label htmlFor={`cc-note-${row.lot_id}`} className="block text-xs font-medium text-ink-secondary">
                    Note (optional)
                  </label>
                  <input
                    id={`cc-note-${row.lot_id}`}
                    value={notes[row.lot_id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [row.lot_id]: e.target.value }))}
                    onFocus={() => onFocusChange?.(true)}
                    onBlur={() => onFocusChange?.(false)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void save(row)}
                  disabled={saving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-2 px-4 text-sm font-medium hover:bg-surface-1 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {row.observation_id ? 'Update' : 'Save'}
                </button>
              </div>

              {showExpected && (
                <p className="mt-2 text-xs text-ink-secondary tabular-nums">
                  Expected {row.expected_quantity}
                  {row.observed_quantity !== null && (
                    <> · counted {row.observed_quantity} · variance {row.variance !== null && row.variance > 0 ? '+' : ''}{row.variance}</>
                  )}
                </p>
              )}
              {!showExpected && row.observed_quantity !== null && (
                <p className="mt-2 text-xs text-ink-secondary tabular-nums">Counted {row.observed_quantity}.</p>
              )}
              {problem && (
                <p id={`cc-qty-problem-${row.lot_id}`} role="alert" className="mt-2 text-xs text-danger">{problem}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Uncounted serialized queue
// ---------------------------------------------------------------------------

export function ItemQueuePanel({
  rows, title, emptyMessage,
}: {
  rows: readonly { expected_item_id: string; item_public_id: string; display_name: string; expected_location_code: string; observation_id: string | null }[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <section aria-labelledby="cc-items" className="rounded-xl border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-3">
        <h2 id="cc-items" className="text-sm font-semibold">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.expected_item_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.display_name}</div>
                <div className="font-mono text-xs text-ink-muted">{r.item_public_id}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-ink-secondary">{r.expected_location_code}</div>
                <div className="text-xs text-ink-muted">
                  {r.observation_id ? <><span aria-hidden>✓ </span>counted</> : <><span aria-hidden>○ </span>not counted</>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Observation feed
// ---------------------------------------------------------------------------

export function ObservationFeedPanel({
  rows, onVoid, voidingId, readOnly,
}: {
  rows: readonly ObservationFeedRow[];
  onVoid?: (row: ObservationFeedRow, reason: string | null) => Promise<void>;
  voidingId?: string | null;
  readOnly?: boolean;
}) {
  const [target, setTarget] = useState<ObservationFeedRow | null>(null);
  const [reason, setReason] = useState('');

  return (
    <section aria-labelledby="cc-feed" className="rounded-xl border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-3">
        <h2 id="cc-feed" className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-ink-muted" aria-hidden /> Recent observations
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">Nothing has been counted yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.observation_id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{r.display_name ?? r.subject_public_id ?? 'Unknown record'}</span>
                  <span className="ml-2 font-mono text-xs text-ink-muted">{r.subject_public_id}</span>
                </div>
                <span className="text-xs text-ink-secondary">
                  {r.outcome}
                  {r.observed_quantity !== null && <> · {r.observed_quantity} counted</>}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span>{r.observed_at}</span>
                {r.observed_by_email && <span>· {r.observed_by_email}</span>}
                {!r.is_current_round && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5">Round {r.count_round} — earlier count</span>
                )}
                {r.voided_at && <span className="text-danger">· voided{r.void_reason ? `: ${r.void_reason}` : ''}</span>}
              </div>
              {r.note && <div className="mt-0.5 text-xs text-ink-secondary">{r.note}</div>}
              {!readOnly && !r.voided_at && r.is_current_round && onVoid && (
                <button
                  type="button"
                  onClick={() => { setTarget(r); setReason(''); }}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline"
                >
                  <Undo2 className="h-3 w-3" aria-hidden /> Undo this observation
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={target !== null} onClose={() => setTarget(null)} title="Undo this observation">
        <p className="text-sm text-ink-secondary">
          The original observation is kept and marked as voided — it is not deleted. The record it
          refers to goes back to being uncounted for this round.
        </p>
        <label htmlFor="cc-void-reason" className="mt-3 block text-xs font-medium text-ink-secondary">
          Why (optional)
        </label>
        <input
          id="cc-void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={voidingId === target?.observation_id}
            onClick={async () => {
              if (!target || !onVoid) return;
              await onVoid(target, reason.trim() || null);
              setTarget(null);
            }}
            className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Undo the observation
          </button>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
          >
            Keep it
          </button>
        </div>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Post-snapshot activity
// ---------------------------------------------------------------------------

const ACTIVITY_LABEL: Record<string, string> = {
  movement: 'Moved',
  quantity_adjustment: 'Quantity adjusted',
  item_loss: 'Written off as lost',
  correction_requested: 'Correction raised',
  correction_reviewed: 'Correction decided',
  lot_split: 'Lot split',
  lot_merge: 'Lot merged',
};

export function ActivityPanel({ rows }: { rows: readonly ActivityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning/8 p-3">
      <p className="text-xs font-semibold text-[#8a5a00] dark:text-warning">
        Activity after snapshot may explain this discrepancy. Review the timeline before resolving.
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((a, i) => (
          <li key={`${a.activity_public_id ?? a.activity_kind}-${i}`} className="text-xs">
            <span className="font-medium">{ACTIVITY_LABEL[a.activity_kind] ?? a.activity_kind}</span>
            <span className="text-ink-muted"> · {a.occurred_at}</span>
            {a.activity_public_id && <span className="ml-1 font-mono text-ink-muted">{a.activity_public_id}</span>}
            {(a.from_value || a.to_value) && (
              <span className="text-ink-secondary"> · {a.from_value ?? '—'} → {a.to_value ?? '—'}</span>
            )}
            {a.detail && <div className="text-ink-secondary">{a.detail}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discrepancies
// ---------------------------------------------------------------------------

function ResolutionHistory({ rows }: { rows: readonly DiscrepancyRow['resolutions'][number][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold text-ink-secondary">Resolution attempts</h4>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li
            key={r.resolution_id}
            className={`rounded px-2 py-1.5 text-xs ${r.succeeded ? 'bg-surface-2' : 'border border-danger/40 bg-danger/8'}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span>
              <span className={r.succeeded ? 'text-good' : 'text-danger'}>
                {r.succeeded ? 'applied' : 'failed'}
              </span>
              <span className="text-ink-muted">{r.resolved_at}</span>
              {r.resolved_by_email && <span className="text-ink-muted">{r.resolved_by_email}</span>}
            </div>
            {r.note && <div className="mt-0.5 text-ink-secondary">{r.note}</div>}
            {/* A failure is never folded away. The reviewer has to see what the
                database said, or a retry is guesswork. */}
            {!r.succeeded && r.failure_detail && (
              <div className="mt-0.5 font-mono text-[11px] text-danger">{r.failure_detail}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiscrepancyCard({
  row, busy, readOnly, onResolve, onRecount, onOpenRecord,
}: {
  row: DiscrepancyRow;
  busy: boolean;
  readOnly: boolean;
  onResolve: (row: DiscrepancyRow, action: ResolutionAction, note: string | null, toLocationCode: string | null) => Promise<void>;
  onRecount: (row: DiscrepancyRow, note: string | null) => Promise<void>;
  onOpenRecord?: (row: DiscrepancyRow) => void;
}) {
  const [action, setAction] = useState<ResolutionAction | ''>('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const failed = row.resolutions.some((r) => !r.succeeded) && !row.resolutions.some((r) => r.succeeded);
  const settled = row.status === 'resolved';
  const actions = availableActions(row.discrepancy_kind);

  const begin = () => {
    setProblem(null);
    if (!action) { setProblem('Choose what to do about this.'); return; }
    if (requiresNote(action) && note.trim() === '') {
      setProblem(action === 'deferred' ? 'A deferral needs a reason.' : 'Say why this unit is being written off.');
      return;
    }
    if (requiresConfirmation(action)) { setConfirming(true); return; }
    void apply();
  };

  const apply = async () => {
    setConfirming(false);
    if (!action) return;
    if (action === 'recount_requested') {
      await onRecount(row, note.trim() || null);
    } else {
      await onResolve(row, action, note.trim() || null, null);
    }
  };

  return (
    <li className={`rounded-xl border p-4 ${failed ? 'border-danger/40 bg-danger/4' : 'border-hairline bg-surface-1'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
              {DISCREPANCY_LABEL[row.discrepancy_kind]}
            </span>
            <span className="font-mono text-xs text-ink-muted">{row.public_id}</span>
            {row.status === 'recount_requested' && (
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-[#8a5a00] dark:text-warning">
                Recount requested
              </span>
            )}
            {row.status === 'deferred' && (
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-[#8a5a00] dark:text-warning">Deferred</span>
            )}
            {settled && <span className="rounded-full bg-good/15 px-2 py-0.5 text-xs text-good">Resolved</span>}
            {failed && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">Last attempt failed</span>}
          </div>
          <div className="mt-1.5 font-medium">{row.subject_display_name}</div>
          <div className="font-mono text-xs text-ink-muted">{row.subject_public_id}</div>
        </div>
        {onOpenRecord && (
          <button type="button" onClick={() => onOpenRecord(row)} className="text-xs text-accent underline">
            Open the record
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {row.certificate_number && (
          <div><dt className="text-ink-muted">Certificate</dt><dd className="font-mono">{row.certificate_number}</dd></div>
        )}
        {row.serial_number && (
          <div><dt className="text-ink-muted">Serial</dt><dd className="font-mono">{row.serial_number}</dd></div>
        )}
        <div><dt className="text-ink-muted">Recorded location</dt><dd>{row.expected_location_code ?? '—'}</dd></div>
        <div><dt className="text-ink-muted">Found at</dt><dd>{row.observed_location_code ?? '—'}</dd></div>
        {row.expected_quantity !== null && (
          <div><dt className="text-ink-muted">Expected</dt><dd className="tabular-nums">{row.expected_quantity}</dd></div>
        )}
        {row.observed_quantity !== null && (
          <div><dt className="text-ink-muted">Counted</dt><dd className="tabular-nums">{row.observed_quantity}</dd></div>
        )}
        {row.expected_quantity !== null && row.observed_quantity !== null && (
          <div>
            <dt className="text-ink-muted">Variance</dt>
            <dd className="tabular-nums font-medium">{row.variance > 0 ? '+' : ''}{row.variance}</dd>
          </div>
        )}
      </dl>

      {row.observations.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-ink-secondary">Observations</h4>
          <ul className="mt-1 space-y-1">
            {row.observations.map((o) => (
              <li key={o.observation_id} className="rounded bg-surface-2 px-2 py-1.5 text-xs">
                <span className="font-medium">Round {o.count_round}</span>
                <span className="ml-2">{o.outcome}</span>
                {o.observed_quantity !== undefined && o.observed_quantity !== null && (
                  <span className="ml-2 tabular-nums">counted {o.observed_quantity}</span>
                )}
                <span className="ml-2 text-ink-muted">{o.observed_at}</span>
                {o.observed_by_email && <span className="ml-2 text-ink-muted">{o.observed_by_email}</span>}
                {o.voided_at && <span className="ml-2 text-danger">voided</span>}
                {o.note && <div className="text-ink-secondary">{o.note}</div>}
              </li>
            ))}
          </ul>
          {row.observations.filter((o) => !o.voided_at).length > 1 && (
            <p className="mt-1 text-xs text-ink-muted">
              {new Set(row.observations.filter((o) => !o.voided_at).map((o) => o.observed_quantity ?? o.outcome)).size === 1
                ? 'The rounds agree.'
                : 'The rounds disagree — both are kept.'}
            </p>
          )}
        </div>
      )}

      <ActivityPanel rows={row.post_snapshot_activity} />
      <ResolutionHistory rows={row.resolutions} />

      {row.deferral_reason && (
        <p className="mt-2 text-xs text-ink-secondary">Deferred: {row.deferral_reason}</p>
      )}

      {!readOnly && !settled && (
        <div className="mt-3 border-t border-hairline pt-3">
          <label htmlFor={`cc-action-${row.discrepancy_id}`} className="block text-xs font-medium text-ink-secondary">
            {failed ? 'Try again' : 'What to do about this'}
          </label>
          <select
            id={`cc-action-${row.discrepancy_id}`}
            value={action}
            onChange={(e) => setAction(e.target.value as ResolutionAction | '')}
            className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
          >
            <option value="">Choose an action…</option>
            {actions.map((a) => (
              <option key={a} value={a}>{ACTION_LABEL[a]}</option>
            ))}
          </select>

          <label htmlFor={`cc-note-${row.discrepancy_id}`} className="mt-2 block text-xs font-medium text-ink-secondary">
            {action && requiresNote(action) ? 'Reason (required)' : 'Note (optional)'}
          </label>
          <input
            id={`cc-note-${row.discrepancy_id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
          />

          {action === 'routed_to_intake' && (
            <p className="mt-2 text-xs text-ink-secondary">
              This records that the unit needs receiving properly through Intake. It does not create
              an inventory record — that is a separate, explicit act.
            </p>
          )}

          {problem && <p role="alert" className="mt-2 text-xs text-danger">{problem}</p>}

          <button
            type="button"
            onClick={begin}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Apply
          </button>
        </div>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Confirm this change to inventory">
        {action && (
          <div className="space-y-3 text-sm">
            <p className="text-ink-secondary">
              This changes inventory. Check the three states before it is applied.
            </p>
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-3 text-xs">
              <div>
                <dt className="text-ink-muted">Frozen expectation</dt>
                <dd className="tabular-nums">{row.expected_quantity ?? row.expected_location_code ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Counted</dt>
                <dd className="tabular-nums">{row.observed_quantity ?? row.observed_location_code ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">After this action</dt>
                <dd className="tabular-nums">
                  {action === 'lot_quantity_adjusted' ? row.observed_quantity
                    : action === 'item_moved_to_counted_location' ? row.observed_location_code
                    : action === 'item_loss_recorded' ? 'Lost' : '—'}
                </dd>
              </div>
            </dl>
            <p className="font-medium">{ACTION_LABEL[action]}</p>
            {action === 'item_loss_recorded' && (
              <p className="text-xs text-ink-secondary">
                The unit stays in the record with all of its identifiers and history. It stops being
                countable stock, and the write-off is recorded permanently against it — who, when,
                why, and from which count. It is not deleted and it is not marked as never having existed.
              </p>
            )}
            {note.trim() && <p className="text-xs text-ink-secondary">Reason: {note.trim()}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                Yes, apply it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Completion and cancellation
// ---------------------------------------------------------------------------

export function CompletionPanel({
  readiness, busy, onComplete, onCancel,
}: {
  readiness: Readiness;
  busy: boolean;
  onComplete: (allowDeferred: boolean, note: string | null) => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [deferredOpen, setDeferredOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deferredReason, setDeferredReason] = useState('');
  const [deferredProblem, setDeferredProblem] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelProblem, setCancelProblem] = useState<string | null>(null);

  return (
    <section aria-labelledby="cc-complete" className="rounded-xl border border-hairline bg-surface-1 p-4">
      <h2 id="cc-complete" className="text-sm font-semibold">Completion</h2>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Open" value={readiness.open_count} tone={readiness.open_count ? 'bad' : 'good'} />
        <Figure label="Awaiting recount" value={readiness.recount_requested_count} tone={readiness.recount_requested_count ? 'warn' : 'default'} />
        <Figure label="Resolved" value={readiness.resolved_count} tone="good" />
        <Figure label="Deferred" value={readiness.deferred_count} tone={readiness.deferred_count ? 'warn' : 'default'} />
        <Figure label="Failed operations" value={readiness.failed_resolution_count} tone={readiness.failed_resolution_count ? 'bad' : 'default'} />
        <Figure label="Inventory changed" value={readiness.inventory_changing_resolution_count} />
      </dl>

      {readiness.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 p-3 text-xs text-ink-secondary">
          {readiness.blockers.map((b) => <li key={b}>· {b}</li>)}
        </ul>
      )}

      <div className="mt-3">
        <label htmlFor="cc-complete-note" className="block text-xs font-medium text-ink-secondary">
          Completion note (optional)
        </label>
        <input
          id="cc-complete-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!readiness.can_complete || busy}
          onClick={() => void onComplete(false, note.trim() || null)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Complete this count
        </button>

        {/* Deliberately separate, and never the default. */}
        {readiness.can_complete_with_deferrals && (
          <button
            type="button"
            onClick={() => { setDeferredOpen(true); setDeferredProblem(null); }}
            className="min-h-11 rounded-lg border border-warning/60 bg-warning/8 px-4 text-sm font-medium text-[#8a5a00] dark:text-warning"
          >
            Complete with {readiness.deferred_count} deferred…
          </button>
        )}

        {readiness.status !== 'completed' && readiness.status !== 'cancelled' && (
          <button
            type="button"
            onClick={() => { setCancelOpen(true); setCancelProblem(null); }}
            className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
          >
            Cancel this count…
          </button>
        )}
      </div>

      {!readiness.can_complete && !readiness.can_complete_with_deferrals && (
        <p className="mt-2 text-xs text-ink-muted">
          Completion stays disabled until every discrepancy has been resolved, recounted, or
          explicitly deferred with a reason.
        </p>
      )}

      <Modal open={deferredOpen} onClose={() => setDeferredOpen(false)} title="Complete with deferred discrepancies">
        <div className="space-y-3 text-sm">
          <p className="text-ink-secondary">
            This count has <span className="font-semibold text-ink">{readiness.deferred_count}</span> deferred
            discrepancy(s). Completing now closes the count with that work still outstanding. The
            deferrals and this reason are recorded permanently in the audit record.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span className="text-sm">
              I am completing this count with {readiness.deferred_count} deferred discrepancy(s) and
              understand the follow-up work remains.
            </span>
          </label>
          <div>
            <label htmlFor="cc-deferred-reason" className="block text-xs font-medium text-ink-secondary">
              Why complete now (required)
            </label>
            <textarea
              id="cc-deferred-reason"
              value={deferredReason}
              onChange={(e) => setDeferredReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface-0 px-3 py-2 text-sm focus:outline-2 focus:outline-accent"
            />
          </div>
          {deferredProblem && <p role="alert" className="text-xs text-danger">{deferredProblem}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const check = validateDeferredCompletion({
                  acknowledged, reason: deferredReason, deferredCount: readiness.deferred_count,
                });
                if (!check.ok) { setDeferredProblem(check.problem); return; }
                await onComplete(true, deferredReason.trim());
                setDeferredOpen(false);
              }}
              className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Complete with deferrals
            </button>
            <button
              type="button"
              onClick={() => setDeferredOpen(false)}
              className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
            >
              Go back
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this count">
        <div className="space-y-3 text-sm">
          <p className="text-ink-secondary">
            Cancelling closes the count without applying anything. Every observation stays in the
            record as history, and no inventory changes on account of the cancellation itself.
          </p>
          {readiness.inventory_changing_resolution_count > 0 && (
            <p className="rounded border border-warning/50 bg-warning/8 px-3 py-2 text-xs text-[#8a5a00] dark:text-warning">
              This count has already applied {readiness.inventory_changing_resolution_count} change(s)
              to inventory. The database refuses to cancel a count that has changed stock — it would
              leave those changes with no explanation. Expect the cancellation to be rejected.
            </p>
          )}
          <div>
            <label htmlFor="cc-cancel-reason" className="block text-xs font-medium text-ink-secondary">
              Reason (required)
            </label>
            <textarea
              id="cc-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface-0 px-3 py-2 text-sm focus:outline-2 focus:outline-accent"
            />
          </div>
          {cancelProblem && <p role="alert" className="text-xs text-danger">{cancelProblem}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (cancelReason.trim() === '') { setCancelProblem('Say why this count is being cancelled.'); return; }
                await onCancel(cancelReason.trim());
                setCancelOpen(false);
              }}
              className="min-h-11 rounded-lg border border-danger/50 bg-danger/8 px-4 text-sm font-medium text-danger disabled:opacity-50"
            >
              Cancel the count
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
            >
              Keep it open
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

export function LoadingNote({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-muted">
      <CircleDashed className="h-4 w-4 animate-spin" aria-hidden /> Loading {what}…
    </p>
  );
}

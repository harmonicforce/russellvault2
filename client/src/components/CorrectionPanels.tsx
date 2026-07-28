// Reporting and reviewing an error in a committed record.
//
// The shape of this UI follows the rule the database enforces: raising a
// correction is a CLAIM, approving it is AGREEMENT, and fixing it is a
// separate, explicit act. Nothing here edits a committed fact — the closest it
// comes is retiring a wrong record in favour of one the operator re-entered
// through normal intake, and even that keeps the original readable forever.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, FileWarning, X } from 'lucide-react';
import {
  CORRECTION_ISSUE_LABELS, CORRECTION_ISSUE_TYPES, CORRECTION_STATE_LABELS,
  type CorrectionIssueType, type CorrectionRow,
} from '../lib/inventoryData';

interface CorrectionTransport {
  requestCorrection(input: {
    subjectKind: 'item' | 'lot';
    subjectId: string;
    issueType: CorrectionIssueType;
    explanation: string;
    proposedValues?: Record<string, string>;
  }): Promise<void>;
  correctionsForRecord(kind: 'item' | 'lot', id: string): Promise<CorrectionRow[]>;
}

const field =
  'w-full rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm outline-none focus:border-accent';

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function RequestCorrectionDialog({
  subjectKind, subjectId, subjectLabel, data, onClose, onRaised,
}: {
  subjectKind: 'item' | 'lot';
  subjectId: string;
  subjectLabel: string;
  data: CorrectionTransport;
  onClose: () => void;
  onRaised: () => void;
}) {
  const [issueType, setIssueType] = useState<CorrectionIssueType>('wrong_condition');
  const [explanation, setExplanation] = useState('');
  const [proposed, setProposed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = explanation.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await data.requestCorrection({
        subjectKind,
        subjectId,
        issueType,
        explanation: explanation.trim(),
        // Stored as a claim awaiting review, never applied to anything.
        proposedValues: proposed.trim() ? { proposed_value: proposed.trim() } : {},
      });
      onRaised();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-hairline bg-surface-0 p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileWarning className="h-4 w-4 text-accent" /> Report a problem
            </h2>
            <p className="mt-1 text-xs text-ink-muted">{subjectLabel}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="rounded border border-hairline bg-surface-1 px-3 py-2 text-xs text-ink-muted">
          This records what you believe is wrong. It does not change the record — an owner or
          operator reviews it first, and correcting an identity fact means re-entering the item and
          retiring this one, so both stay on file.
        </p>

        <label className="block text-sm font-medium">
          What is wrong
          <select
            className={`mt-1 ${field}`}
            value={issueType}
            onChange={(e) => setIssueType(e.target.value as CorrectionIssueType)}
            aria-label="Issue type"
          >
            {CORRECTION_ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>{CORRECTION_ISSUE_LABELS[t]}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          What did you see
          <textarea
            className={`mt-1 ${field}`}
            rows={3}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="e.g. The slab reads PSA 10 but this was entered as a 9."
            aria-label="Explanation"
          />
        </label>

        <label className="block text-sm font-medium">
          What it should be (optional)
          <input
            className={`mt-1 ${field}`}
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            placeholder="Your best reading of the correct value"
            aria-label="Proposed value"
          />
        </label>

        {error && (
          <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-hairline px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!ready || busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Report problem'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The correction chain on a record's own page — both what has been reported
 * about it and, if it was retired, what replaced it.
 */
export function CorrectionHistory({
  subjectKind, subjectId, data, refreshKey,
}: {
  subjectKind: 'item' | 'lot';
  subjectId: string;
  data: CorrectionTransport;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await data.correctionsForRecord(subjectKind, subjectId));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [data, subjectKind, subjectId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing has been reported about this record.</p>;
  }

  return (
    <ul className="divide-y divide-hairline text-sm">
      {rows.map((c) => (
        <li key={c.id} className="py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{CORRECTION_ISSUE_LABELS[c.issue_type] ?? c.issue_type}</span>
            <StateBadge state={c.state} />
          </div>
          <p className="mt-0.5 text-ink-secondary">{c.explanation}</p>
          {c.proposed_values?.proposed_value && (
            <p className="mt-0.5 text-xs text-ink-muted">
              Reported correct value: {c.proposed_values.proposed_value}
            </p>
          )}
          {c.replacement_public_id && (
            <p className="mt-0.5 text-xs text-ink-muted">
              Replaced by {c.replacement_public_id}
            </p>
          )}
          {c.resolution_note && (
            <p className="mt-0.5 text-xs text-ink-muted">Reviewer: {c.resolution_note}</p>
          )}
          <p className="mt-0.5 text-xs text-ink-muted">{when(c.requested_at)}</p>
        </li>
      ))}
    </ul>
  );
}

export function StateBadge({ state }: { state: CorrectionRow['state'] }) {
  const tone =
    state === 'open' ? 'bg-amber-100 text-amber-900'
    : state === 'approved' ? 'bg-accent/12 text-accent-strong'
    : state === 'rejected' ? 'bg-surface-2 text-ink-muted'
    : 'bg-success/12 text-success';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {state === 'open' ? 'Open'
        : state === 'approved' ? 'Approved'
        : state === 'rejected' ? 'Rejected'
        : 'Resolved'}
    </span>
  );
}

/** A single correction awaiting a decision, in the review queue. */
export function CorrectionReviewCard({
  correction, onDecide, busy,
}: {
  correction: CorrectionRow;
  onDecide: (decision: 'approve' | 'reject', note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState('');
  const c = correction;

  return (
    <li className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{CORRECTION_ISSUE_LABELS[c.issue_type] ?? c.issue_type}</span>
        <StateBadge state={c.state} />
        <span className="font-mono text-xs text-ink-muted">{c.subject_public_id}</span>
      </div>

      {c.subject_display_name && (
        <p className="text-sm">{c.subject_display_name}</p>
      )}
      <p className="text-sm text-ink-secondary">{c.explanation}</p>
      {c.proposed_values?.proposed_value && (
        <p className="text-xs text-ink-muted">
          Reported correct value: {c.proposed_values.proposed_value}
        </p>
      )}
      <p className="text-xs text-ink-muted">Reported {when(c.requested_at)}</p>

      {c.state === 'open' ? (
        <>
          <input
            className={field}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reviewer note (required to reject)"
            aria-label={`Reviewer note for ${c.subject_public_id}`}
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onDecide('approve', note)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Agree there is a problem
            </button>
            <button
              onClick={() => onDecide('reject', note)}
              disabled={busy || note.trim() === ''}
              title={note.trim() === '' ? 'Say why this is being rejected' : undefined}
              className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        </>
      ) : c.state === 'approved' ? (
        <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Agreed. To finish this: add the record again with the correct details, then use
          <strong> Retire this record</strong> on the wrong one and point it at the new one. Both
          stay on file.
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          {CORRECTION_STATE_LABELS[c.state]}
          {c.resolution_note ? ` — ${c.resolution_note}` : ''}
          {c.replacement_public_id ? ` Replaced by ${c.replacement_public_id}.` : ''}
        </p>
      )}
    </li>
  );
}

// Category-aware photo checklist.
//
// This is workflow guidance, not evidence: it says which recommended angles
// are still uncovered, and never asserts anything about the goods themselves.

import { AlertTriangle, Camera, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import type { MediaReadiness, ReadinessStatus } from '../lib/mediaApi';

const STATUS: Record<ReadinessStatus, { label: string; className: string; icon: typeof Camera }> = {
  complete: { label: 'Photos complete', className: 'bg-good/15 text-good', icon: CheckCircle2 },
  missing_required_angle: { label: 'Missing photos', className: 'bg-warning/20 text-[#8a5a00] dark:text-warning', icon: Camera },
  missing_defect_photo: { label: 'Needs a condition photo', className: 'bg-warning/20 text-[#8a5a00] dark:text-warning', icon: Camera },
  media_review_needed: { label: 'Photo review needed', className: 'bg-bad/15 text-bad', icon: AlertTriangle },
  upload_incomplete: { label: 'Upload unfinished', className: 'bg-warning/20 text-[#8a5a00] dark:text-warning', icon: Loader2 },
};

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const meta = STATUS[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function RequiredPhotoChecklist({
  readiness, onPick,
}: {
  readiness: MediaReadiness;
  onPick?: (slotKey: string, slotLabel: string) => void;
}) {
  return (
    <section aria-label="Required photo checklist" className="rounded-lg border border-hairline bg-surface-1 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Photo checklist</h3>
        <ReadinessBadge status={readiness.readiness_status} />
      </div>

      {readiness.slots.length === 0 ? (
        <p className="text-xs text-ink-muted">
          This record has no category yet, so there is no recommended photo set. Classify it first.
        </p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {readiness.slots.map((slot) => (
            <li key={slot.slot_key}>
              <button
                type="button"
                disabled={!onPick}
                onClick={() => onPick?.(slot.slot_key, slot.slot_label)}
                className={`flex w-full items-center gap-2 rounded border border-hairline px-2 py-1.5 text-left text-xs ${
                  onPick ? 'hover:border-accent' : 'cursor-default'
                }`}
              >
                {slot.covered
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good" aria-hidden="true" />
                  : <CircleDashed className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                <span className={slot.covered ? 'text-ink-muted line-through' : ''}>{slot.slot_label}</span>
                {slot.is_required && !slot.covered && (
                  <span className="ml-auto rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a5a00] dark:text-warning">
                    Required
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {readiness.open_issue_count > 0 && (
        <p className="mt-2 text-xs text-bad">
          {readiness.open_issue_count} photo {readiness.open_issue_count === 1 ? 'issue needs' : 'issues need'} review.
        </p>
      )}
      {readiness.recoverable_count > 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          {readiness.recoverable_count} recently deleted {readiness.recoverable_count === 1 ? 'photo can' : 'photos can'} still be restored.
        </p>
      )}
    </section>
  );
}

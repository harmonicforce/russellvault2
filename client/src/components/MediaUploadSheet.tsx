// Mobile-first capture and upload sheet.
//
// Designed for one hand on an iPad next to the shelf: a big camera button, a
// library picker for photos already taken, and a per-file list that says
// exactly what happened to each one. A failed file is retried on its own; the
// batch is never restarted.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCw, X } from 'lucide-react';
import type { MediaTransport, MediaSlot, SubjectKind } from '../lib/mediaApi';
import {
  createSubtleHasher, createUploadManager, createXhrUploader,
  type UploadManager, type UploadTask,
} from '../lib/uploadManager';

const STAGE_LABEL: Record<UploadTask['stage'], string> = {
  queued: 'Waiting', hashing: 'Checking', reserving: 'Preparing', uploading: 'Sending',
  committing: 'Saving', done: 'Added', failed: 'Failed', cancelled: 'Cancelled',
};

/** The operator is told which half failed, because the recovery differs. */
function failureHint(task: UploadTask): string | null {
  if (task.stage !== 'failed') return null;
  switch (task.failureKind) {
    case 'bytes': return 'Saved the details, but the photo did not arrive. Retry sends it again.';
    case 'commit': return 'The photo arrived but was not added yet. Retry finishes it without resending.';
    case 'metadata': return 'Could not start this upload.';
    case 'validation': return null;
    default: return null;
  }
}

export function MediaUploadSheet({
  open, onClose, transport, subjectKind, subjectId, slots, initialSlot, onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  transport: MediaTransport;
  subjectKind: SubjectKind;
  subjectId: string;
  slots: readonly MediaSlot[];
  initialSlot?: { slotKey: string; slotLabel: string } | null;
  onUploaded: () => void;
}) {
  const [tasks, setTasks] = useState<readonly UploadTask[]>([]);
  const [slotKey, setSlotKey] = useState<string>('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<UploadManager | null>(null);

  useEffect(() => { if (initialSlot) setSlotKey(initialSlot.slotKey); }, [initialSlot]);

  const manager = useMemo(() => {
    if (!open) return null;
    const m = createUploadManager({
      transport, subjectKind, subjectId,
      uploadBytes: createXhrUploader(),
      hashFile: createSubtleHasher(),
      onChange: setTasks,
      onCommitted: onUploaded,
    });
    managerRef.current = m;
    return m;
    // A fresh manager per opening keeps one session's files together.
  }, [open, transport, subjectKind, subjectId, onUploaded]);

  if (!open) return null;

  const chosen = slots.find((s) => s.slot_key === slotKey) ?? null;
  const add = (list: FileList | null) => {
    if (!list || list.length === 0 || !manager) return;
    manager.enqueue(Array.from(list), {
      slotKey: chosen?.slot_key ?? null,
      slotLabel: chosen?.slot_label ?? null,
    });
    if (cameraRef.current) cameraRef.current.value = '';
    if (libraryRef.current) libraryRef.current.value = '';
  };

  const failed = tasks.filter((t) => t.stage === 'failed' && t.failureKind !== 'validation');
  const busy = tasks.some((t) => !['done', 'failed', 'cancelled'].includes(t.stage));

  return (
    <div role="dialog" aria-label="Add photos" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-surface-1 p-4 sm:max-w-xl sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add photos</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        {slots.length > 0 && (
          <label className="mb-3 block text-xs">
            <span className="mb-1 block text-ink-muted">Photo slot (optional)</span>
            <select
              aria-label="Photo slot"
              value={slotKey}
              onChange={(e) => setSlotKey(e.target.value)}
              className="w-full rounded border border-hairline bg-surface-1 p-2 text-sm"
            >
              <option value="">Unlabelled</option>
              {slots.map((s) => (
                <option key={s.slot_key} value={s.slot_key}>
                  {s.slot_label}{s.is_required ? ' (required)' : ''}{s.covered ? ' — already have one' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-4 text-sm font-semibold text-on-accent"
          >
            <Camera className="h-5 w-5" /> Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-lg border border-hairline px-3 py-4 text-sm font-semibold"
          >
            <ImagePlus className="h-5 w-5" /> Choose files
          </button>
        </div>
        <input
          ref={cameraRef} type="file" accept="image/*" capture="environment" multiple
          aria-label="Take photo" className="hidden" onChange={(e) => add(e.target.files)}
        />
        <input
          ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple
          aria-label="Choose photos" className="hidden" onChange={(e) => add(e.target.files)}
        />

        {tasks.length > 0 && (
          <ul className="mb-3 space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="rounded border border-hairline p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{task.source.name}</span>
                  <span className={task.stage === 'failed' ? 'text-bad' : task.stage === 'done' ? 'text-good' : 'text-ink-muted'}>
                    {STAGE_LABEL[task.stage]}
                  </span>
                </div>
                {task.stage === 'uploading' && (
                  <div
                    role="progressbar"
                    aria-label={`Sending ${task.source.name}`}
                    aria-valuenow={Math.round(task.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface-2"
                  >
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(task.progress * 100)}%` }} />
                  </div>
                )}
                {task.error && <p className="mt-1 text-bad">{task.error}</p>}
                {failureHint(task) && <p className="mt-0.5 text-ink-muted">{failureHint(task)}</p>}
                {task.duplicateOf && task.stage === 'done' && (
                  <p className="mt-0.5 text-ink-muted">This looks like a photo already on file.</p>
                )}
                <div className="mt-1 flex gap-2">
                  {task.stage === 'failed' && task.failureKind !== 'validation' && (
                    <button type="button" onClick={() => manager?.retry(task.id)} className="text-accent">Retry</button>
                  )}
                  {!['done', 'failed', 'cancelled'].includes(task.stage) && (
                    <button type="button" onClick={() => manager?.cancel(task.id)} className="text-ink-muted">Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {failed.length > 0 && (
            <button
              type="button"
              onClick={() => manager?.retryFailed()}
              className="flex items-center gap-1 rounded border border-accent px-3 py-2 text-sm font-semibold text-accent"
            >
              <RefreshCw className="h-4 w-4" /> Retry {failed.length} failed
            </button>
          )}
          {tasks.length > 0 && (
            <button type="button" onClick={() => manager?.clearFinished()} className="rounded border border-hairline px-3 py-2 text-sm">
              Clear finished
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent">
            {busy ? 'Keep uploading in background' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

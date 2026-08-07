// Inventory photo gallery.
//
// Works the same for a serialized Item and a quantity-managed Lot. Every
// mutation goes through the governed transport, so ordering and primary
// selection stay consistent even when two devices are looking at the same
// record. Rotation is display-only: the stored original is never rewritten.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Camera, RotateCw, Star, Trash2, Undo2,
} from 'lucide-react';
import type { MediaReadiness, MediaRecord, MediaTransport, SubjectKind } from '../lib/mediaApi';
import { MediaUploadSheet } from './MediaUploadSheet';
import { RequiredPhotoChecklist } from './RequiredPhotoChecklist';

export function MediaGallery({
  transport, subjectKind, subjectId, canEdit, onChanged,
}: {
  transport: MediaTransport;
  subjectKind: SubjectKind;
  subjectId: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const [media, setMedia] = useState<readonly MediaRecord[]>([]);
  const [readiness, setReadiness] = useState<MediaReadiness | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [initialSlot, setInitialSlot] = useState<{ slotKey: string; slotLabel: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, status] = await Promise.all([
        transport.list(subjectKind, subjectId, true),
        transport.readiness(subjectKind, subjectId),
      ]);
      setMedia(rows);
      setReadiness(status);
      // One batched request for the whole gallery rather than one per thumbnail.
      const paths = rows.filter((m) => m.lifecycle !== 'reserved').map((m) => m.storage_path);
      setUrls(paths.length > 0 ? await transport.signedUrls(paths) : {});
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [transport, subjectKind, subjectId]);

  useEffect(() => { void load(); }, [load]);

  const live = useMemo(() => media.filter((m) => m.lifecycle === 'active'), [media]);
  const deleted = useMemo(() => media.filter((m) => m.lifecycle === 'deleted' && !m.purged_at), [media]);
  const pending = useMemo(() => media.filter((m) => m.lifecycle === 'reserved'), [media]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const reorderTo = (from: number, to: number) => {
    if (to < 0 || to >= live.length || from === to) return;
    const next = [...live];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void act(moved.id, () => transport.reorder(subjectKind, subjectId, next.map((m) => m.id)));
  };

  const remove = (m: MediaRecord) => {
    if (!window.confirm('Delete this photo? You can restore it for 30 days.')) return;
    void act(m.id, () => transport.remove(m.id, null));
  };

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Photos</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setInitialSlot(null); setSheetOpen(true); }}
            className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          >
            <Camera className="h-4 w-4" /> Add photos
          </button>
        )}
      </div>

      {error && <p role="alert" className="mb-3 rounded border border-bad/40 bg-bad/10 p-2 text-xs text-bad">{error}</p>}

      {readiness && (
        <div className="mb-3">
          <RequiredPhotoChecklist
            readiness={readiness}
            onPick={canEdit ? (slotKey, slotLabel) => { setInitialSlot({ slotKey, slotLabel }); setSheetOpen(true); } : undefined}
          />
        </div>
      )}

      {pending.length > 0 && (
        <p className="mb-3 rounded border border-hairline p-2 text-xs text-ink-muted">
          {pending.length} {pending.length === 1 ? 'photo is' : 'photos are'} still uploading or did not finish.
          They are not part of this record yet.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading photos…</p>
      ) : live.length === 0 ? (
        <p className="text-sm text-ink-muted">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {live.map((m, index) => (
            <li
              key={m.id}
              draggable={canEdit}
              onDragStart={() => setDragId(m.id)}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={() => {
                if (!dragId) return;
                const from = live.findIndex((x) => x.id === dragId);
                if (from >= 0) reorderTo(from, index);
                setDragId(null);
              }}
              className={`rounded border p-2 ${m.is_primary ? 'border-accent' : 'border-hairline'} ${busyId === m.id ? 'opacity-60' : ''}`}
            >
              <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded bg-surface-2">
                {urls[m.storage_path] ? (
                  <img
                    src={urls[m.storage_path]}
                    alt={m.slot_label ?? m.original_filename ?? 'Inventory photo'}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={m.rotation_degrees ? { transform: `rotate(${m.rotation_degrees}deg)` } : undefined}
                  />
                ) : (
                  <span className="text-[10px] text-ink-muted">Preview unavailable</span>
                )}
              </div>

              <div className="mb-1 flex items-center gap-1 text-[11px]">
                {m.is_primary && (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">Primary</span>
                )}
                <span className="truncate text-ink-muted">{m.slot_label ?? 'Unlabelled'}</span>
              </div>

              {canEdit && (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button" aria-label={`Move ${m.slot_label ?? 'photo'} earlier`}
                    disabled={index === 0} onClick={() => reorderTo(index, index - 1)}
                    className="rounded border border-hairline p-1.5 disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button" aria-label={`Move ${m.slot_label ?? 'photo'} later`}
                    disabled={index === live.length - 1} onClick={() => reorderTo(index, index + 1)}
                    className="rounded border border-hairline p-1.5 disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button" aria-label={`Rotate ${m.slot_label ?? 'photo'}`}
                    onClick={() => void act(m.id, () => transport.rotate(m.id, 90))}
                    className="rounded border border-hairline p-1.5"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  {!m.is_primary && (
                    <button
                      type="button" aria-label={`Make ${m.slot_label ?? 'photo'} the primary image`}
                      onClick={() => void act(m.id, () => transport.setPrimary(m.id))}
                      className="rounded border border-hairline p-1.5"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button" aria-label={`Delete ${m.slot_label ?? 'photo'}`}
                    onClick={() => remove(m)}
                    className="rounded border border-hairline p-1.5 text-bad"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleted.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <h3 className="mb-2 text-xs font-semibold">Recently deleted</h3>
          <ul className="space-y-1">
            {deleted.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink-muted">
                  {m.slot_label ?? m.original_filename ?? 'Photo'}
                  {m.purge_after && ` · removable after ${new Date(m.purge_after).toLocaleDateString()}`}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void act(m.id, () => transport.restore(m.id))}
                    className="flex items-center gap-1 text-accent"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <MediaUploadSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); void load(); onChanged?.(); }}
        transport={transport}
        subjectKind={subjectKind}
        subjectId={subjectId}
        slots={readiness?.slots ?? []}
        initialSlot={initialSlot}
        onUploaded={() => { void load(); onChanged?.(); }}
      />
    </section>
  );
}

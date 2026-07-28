// Shared panels used by Item Detail, Lot Detail and the scan result: photos,
// movement, movement history and printable labels.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Loader2, MapPin, Printer, Star, Trash2, X } from 'lucide-react';
import type { InventoryData, MediaRow, MovementRow } from '../lib/inventoryData';
import type { StorageLocation } from '../lib/locationsApi';
import { LABEL_SIZES, code128BBars, type LabelSize, type LabelView } from '../lib/labels';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// ---- Photos ---------------------------------------------------------------
export function MediaPanel({
  data, subjectKind, subjectId, userId, slots, onChanged,
}: {
  data: InventoryData;
  subjectKind: 'item' | 'lot';
  subjectId: string;
  userId: string | null;
  slots: readonly string[];
  onChanged?: () => void;
}) {
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await data.listMedia(subjectKind, subjectId);
      setMedia(rows);
      // Private bucket: each thumbnail needs its own short-lived signed URL.
      const entries = await Promise.all(
        rows.map(async (m) => [m.id, await data.signedUrl(m.storage_path)] as const)
      );
      const next: Record<string, string> = {};
      for (const [id, url] of entries) if (url) next[id] = url;
      setUrls(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, subjectKind, subjectId]);

  useEffect(() => { load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!userId) {
      setError('Sign in again before uploading photos.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await data.uploadMedia(subjectKind, subjectId, file, slot || null, userId);
      }
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (libraryRef.current) libraryRef.current.value = '';
    }
  };

  const remove = async (m: MediaRow) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;
    try {
      await data.deleteMedia(m);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const makePrimary = async (m: MediaRow) => {
    try {
      await data.setPrimaryMedia(subjectKind, subjectId, m.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4 text-accent" /> Photos
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            aria-label="Photo type"
          >
            <option value="">Unlabelled</option>
            {slots.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Choose photo
          </button>
        </div>
      </div>

      {/* capture="environment" opens the rear camera directly on iPad/phone. */}
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <input
        ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => upload(e.target.files)}
      />

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {uploading && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading photos…</p>
      ) : media.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No photos yet. Suggested: {slots.join(', ')}.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded border border-hairline bg-surface-0">
              {urls[m.id] ? (
                <button type="button" onClick={() => setPreview(urls[m.id])} className="block w-full">
                  <img src={urls[m.id]} alt={m.slot_label ?? 'Inventory photo'} className="aspect-square w-full object-cover" />
                </button>
              ) : (
                <div className="flex aspect-square w-full items-center justify-center text-xs text-ink-muted">
                  Unavailable
                </div>
              )}
              {m.is_primary && (
                <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Primary
                </span>
              )}
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="truncate text-[10px] text-ink-muted">{m.slot_label ?? '—'}</span>
                <span className="flex gap-1">
                  {!m.is_primary && (
                    <button type="button" onClick={() => makePrimary(m)} title="Set as primary">
                      <Star className="h-3 w-3 text-ink-muted hover:text-accent" />
                    </button>
                  )}
                  <button type="button" onClick={() => remove(m)} title="Delete photo">
                    <Trash2 className="h-3 w-3 text-ink-muted hover:text-danger" />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-label="Photo preview"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="Inventory photo" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}

// ---- Movement -------------------------------------------------------------
export function MoveDialog({
  data, subjectKind, subjectId, currentLocationCode, currentLocationName, locations, onDone, onClose,
}: {
  data: InventoryData;
  subjectKind: 'item' | 'lot';
  subjectId: string;
  currentLocationCode: string | null;
  currentLocationName: string | null;
  locations: readonly StorageLocation[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A retired or identical destination is refused by the database too; this
  // just avoids offering a choice that cannot succeed.
  const options = locations.filter(
    (l) => l.retired_at === null && l.location_code !== currentLocationCode
  );

  const submit = async () => {
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      if (subjectKind === 'item') await data.moveItem(subjectId, destination, note.trim() || null);
      else await data.moveLot(subjectId, destination, note.trim() || null);
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = options.find((l) => l.location_code === destination) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="Move inventory">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-accent" />
          {subjectKind === 'lot' ? 'Move entire lot' : 'Move item'}
        </h2>

        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">Currently in</dt>
          <dd>{currentLocationName ?? 'No location'}</dd>
        </dl>

        <label className="block text-sm">
          <span className="text-ink-muted">Move to</span>
          <select
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            aria-label="Destination location"
          >
            <option value="">Choose a location…</option>
            {options.map((l) => (
              <option key={l.id} value={l.location_code}>
                {l.display_name ? `${l.display_name} (${l.location_code})` : l.location_code}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 block text-sm">
          <span className="text-ink-muted">Note (optional)</span>
          <input
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Movement note"
          />
        </label>

        {chosen && (
          <p className="mt-3 rounded border border-hairline bg-surface-0 px-3 py-2 text-xs text-ink-muted">
            {subjectKind === 'lot'
              ? 'The whole lot moves, including its full quantity.'
              : 'Only this item moves. Others in the same lot stay where they are.'}
          </p>
        )}

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-hairline px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!destination || busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Moving…' : 'Confirm move'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MovementHistory({
  movements, locationName,
}: {
  movements: readonly MovementRow[];
  locationName: (id: string | null) => string;
}) {
  if (movements.length === 0) {
    return <p className="text-sm text-ink-muted">No movements recorded yet.</p>;
  }
  return (
    <ol className="space-y-2 text-sm">
      {movements.map((m) => (
        <li key={m.id} className="rounded border border-hairline bg-surface-0 px-3 py-2">
          <div>
            {locationName(m.from_location_id)} → <strong>{locationName(m.to_location_id)}</strong>
          </div>
          <div className="text-xs text-ink-muted">{formatWhen(m.moved_at)}</div>
          {m.note && <div className="mt-1 text-xs text-ink-secondary">{m.note}</div>}
        </li>
      ))}
    </ol>
  );
}

// ---- Labels ---------------------------------------------------------------
export function Barcode({ value, heightPx = 44 }: { value: string; heightPx?: number }) {
  const encoded = code128BBars(value);
  if (!encoded) return null;
  // A viewBox in module units lets the printed size be set purely in CSS.
  return (
    <svg
      viewBox={`0 0 ${encoded.totalModules} 10`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: heightPx }}
      role="img"
      aria-label={`Barcode for ${value}`}
    >
      {encoded.bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.width} height={10} fill="#000" />
      ))}
    </svg>
  );
}

export function LabelPreview({
  labels, onClose,
}: {
  labels: readonly LabelView[];
  onClose: () => void;
}) {
  const [size, setSize] = useState<LabelSize>('compact');
  const sizeDef = LABEL_SIZES.find((s) => s.key === size) ?? LABEL_SIZES[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:static print:bg-transparent print:p-0">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-hairline bg-surface-1 p-4 print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:bg-white print:p-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Printer className="h-4 w-4 text-accent" /> Label preview
          </h2>
          <div className="flex items-center gap-2">
            <select
              className="rounded border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
              value={size}
              onChange={(e) => setSize(e.target.value as LabelSize)}
              aria-label="Label size"
            >
              {LABEL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
            >
              Print
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-hairline px-3 py-1.5 text-xs">
              Close
            </button>
          </div>
        </div>

        {/* Print CSS: one label per physical size, nothing else on the page. */}
        <style>{`
          @media print {
            @page { size: ${sizeDef.widthMm}mm ${sizeDef.heightMm}mm; margin: 2mm; }
            body * { visibility: hidden; }
            .rv-label-sheet, .rv-label-sheet * { visibility: visible; }
            .rv-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
            .rv-label { page-break-after: always; break-after: page; border: 0 !important; }
            .rv-label:last-child { page-break-after: auto; break-after: auto; }
          }
        `}</style>

        <div className="rv-label-sheet space-y-3">
          {labels.map((label, i) => (
            <div
              key={`${label.code}-${i}`}
              className="rv-label rounded border border-hairline bg-white p-3 text-black"
              style={{ width: `${sizeDef.widthMm}mm`, minHeight: `${sizeDef.heightMm}mm` }}
            >
              <div className="text-[9px] font-semibold uppercase tracking-wide">{label.brand}</div>
              <div className="truncate text-[11px] font-bold leading-tight">{label.title}</div>
              <div className="flex items-baseline justify-between text-[8px]">
                <span>{label.locationLine ?? ''}</span>
                <span>{label.quantityLine ?? label.subtitle ?? ''}</span>
              </div>
              <Barcode value={label.code} heightPx={34} />
              <div className="text-center font-mono text-[9px] tracking-wide">{label.code}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

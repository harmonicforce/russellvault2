// Shared panels used by Item Detail, Lot Detail and the scan result:
// movement, movement history and printable labels.
//
// Photos moved to MediaGallery, which drives the governed media functions.

import { useState } from 'react';
import { MapPin, Printer } from 'lucide-react';
import type { InventoryData, MovementRow } from '../lib/inventoryData';
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
              <div className="text-right text-[8px]">{label.quantityLine ?? label.subtitle}</div>
              <Barcode value={label.code} heightPx={34} />
              <div className="text-center font-mono text-[9px] tracking-wide">{label.code}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

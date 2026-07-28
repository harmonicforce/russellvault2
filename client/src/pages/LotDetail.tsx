// Lot Detail — quantity-tracked inventory: what it is, how many, where it is,
// its photos, movement history and label.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Boxes, MapPin, PackagePlus, Printer } from 'lucide-react';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type LotOverviewRow, type MovementRow } from '../lib/inventoryData';
import { labelForLot } from '../lib/labels';
import { LabelPreview, MediaPanel, MoveDialog, MovementHistory } from '../components/InventoryPanels';
import { CATEGORIES } from '../lib/intakeCategories';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="contents">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="break-words">{value ?? '—'}</dd>
    </div>
  );
}

function slotsFor(vertical: string, format: string | null): readonly string[] {
  if (vertical === 'tcg') {
    return format
      ? CATEGORIES.find((c) => c.key === 'sealed_tcg')!.photoSlots
      : CATEGORIES.find((c) => c.key === 'raw_card')!.photoSlots;
  }
  if (vertical === 'footwear') return CATEGORIES.find((c) => c.key === 'footwear')!.photoSlots;
  return CATEGORIES.find((c) => c.key === 'other_collectible')!.photoSlots;
}

export default function LotDetail() {
  const { workspace, client, userId } = useWorkspace();
  const { lotId } = useParams<{ lotId: string }>();
  const navigate = useNavigate();

  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );
  const locationsTransport = useMemo(
    () => createLocationsTransport(client as never, () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  const [row, setRow] = useState<LotOverviewRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!data || !lotId) return;
    setLoading(true);
    setError(null);
    try {
      const [overview, history, locs] = await Promise.all([
        data.getLot(lotId),
        data.movementHistory('lot', lotId),
        locationsTransport.list(true).catch(() => [] as StorageLocation[]),
      ]);
      setRow(overview);
      setMovements(history);
      setLocations(locs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, lotId, locationsTransport]);

  useEffect(() => { load(); }, [load]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view this lot.</div>;
  }
  if (loading) return <div className="p-6 text-sm text-ink-muted">Loading…</div>;
  if (error || !row) {
    return (
      <div className="space-y-3 p-6">
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
          {error ?? 'Lot not found.'}
        </div>
        <button onClick={() => navigate('/inventory/current')} className="text-sm text-accent underline">
          Back to Inventory
        </button>
      </div>
    );
  }

  const locationName = (id: string | null): string => {
    if (!id) return 'No location';
    const found = locations.find((l) => l.id === id);
    return found ? (found.display_name || found.location_code) : 'Unknown location';
  };
  const currentLocation = row.location_display_name || row.location_code;
  const serialized = row.tracking_mode === 'serialized';

  return (
    <div className="max-w-4xl space-y-5 p-6">
      <button
        onClick={() => navigate('/inventory/current')}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Inventory
      </button>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Boxes className="h-5 w-5 text-accent" /> {row.product_display_name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Lot {row.lot_public_id} · {row.quantity} on hand</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {!serialized && (
          <button
            onClick={() => setMoving(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
          >
            <MapPin className="h-4 w-4" /> Move entire lot
          </button>
        )}
        <button
          onClick={() => setPrinting(true)}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <Printer className="h-4 w-4" /> Print lot label
        </button>
        <button
          onClick={() => navigate('/quick-add')}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <PackagePlus className="h-4 w-4" /> Add more of this
        </button>
      </div>

      {serialized && (
        <p className="rounded border border-hairline bg-surface-0 px-3 py-2 text-xs text-ink-muted">
          This lot holds individually tracked units. Move them one at a time from each item's page, so
          unrelated units are never relocated by accident.
        </p>
      )}

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold">Details</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Row label="Category" value={row.business_vertical === 'tcg' ? 'Trading cards' : row.business_vertical === 'footwear' ? 'Footwear' : 'Other'} />
          <Row label="Quantity" value={String(row.quantity)} />
          <Row label="Tracking" value={serialized ? 'Individually tracked units' : 'Tracked by quantity'} />
          <Row label="Condition" value={row.condition_or_quality} />
          <Row label="Product format" value={row.product_format} />
          <Row label="Packaging condition" value={row.seal_or_packaging_condition} />
          <Row label="Size" value={row.shoe_size ?? row.size_label} />
          <Row label="Lot ID" value={row.lot_public_id} />
          <Row
            label="Storage location"
            value={currentLocation ? (row.location_retired_at ? `${currentLocation} (retired)` : currentLocation) : null}
          />
          <Row label="Date added" value={formatWhen(row.lot_created_at)} />
        </dl>
      </section>

      <MediaPanel
        data={data}
        subjectKind="lot"
        subjectId={row.lot_id}
        userId={userId}
        slots={slotsFor(row.business_vertical, row.product_format)}
        onChanged={load}
      />

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold">Movement history</h2>
        <MovementHistory movements={movements} locationName={locationName} />
      </section>

      {moving && (
        <MoveDialog
          data={data}
          subjectKind="lot"
          subjectId={row.lot_id}
          currentLocationCode={row.location_code}
          currentLocationName={currentLocation}
          locations={locations}
          onDone={load}
          onClose={() => setMoving(false)}
        />
      )}

      {printing && <LabelPreview labels={[labelForLot(row)]} onClose={() => setPrinting(false)} />}
    </div>
  );
}

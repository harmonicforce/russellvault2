// Item Detail — one serialized inventory unit: its facts, photos, current
// location, movement history and label.
//
// Identity-defining facts (public ids, scan SKU, certificate, serial) are
// immutable after commit and are shown read-only. Location is the one governed
// thing that can change, and it changes through the movement function so the
// history can never be rewritten.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, MapPin, PackagePlus, Printer, ScanLine } from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createInventoryIdentityTransport, type ItemDetail as ItemChain } from '../lib/inventoryIdentityApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type ItemOverviewRow, type MovementRow } from '../lib/inventoryData';
import { prefillFromItem } from '../lib/intakePrefill';
import { subtypeLabel } from '../lib/inventoryQuery';
import { labelForItem } from '../lib/labels';
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

/** Photo slots follow the item's vertical; a graded slab and a sneaker do not
 * want the same prompts. Guidance only — never fabricated evidence. */
function slotsForVertical(vertical: string, gradingCompany: string | null): readonly string[] {
  if (vertical === 'footwear') return CATEGORIES.find((c) => c.key === 'footwear')!.photoSlots;
  if (vertical === 'tcg') {
    return gradingCompany
      ? CATEGORIES.find((c) => c.key === 'graded_card')!.photoSlots
      : CATEGORIES.find((c) => c.key === 'raw_card')!.photoSlots;
  }
  return CATEGORIES.find((c) => c.key === 'other_collectible')!.photoSlots;
}

export default function ItemDetail() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { workspace, client, userId } = useWorkspace();
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );
  const chainTransport = useMemo(() => {
    if (!config) return null;
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createInventoryIdentityTransport(tokenProviderFromClient(shadow));
  }, [config]);
  const locationsTransport = useMemo(
    () => createLocationsTransport(client as never, () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  const [row, setRow] = useState<ItemOverviewRow | null>(null);
  const [chain, setChain] = useState<ItemChain | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [moving, setMoving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!data || !itemId) return;
    setLoading(true);
    setError(null);
    try {
      const [overview, history, locs] = await Promise.all([
        data.getItem(itemId),
        data.movementHistory('item', itemId),
        locationsTransport.list(true).catch(() => [] as StorageLocation[]),
      ]);
      setRow(overview);
      setMovements(history);
      setLocations(locs);
      if (workspace && chainTransport) {
        // The intake-session link comes from the identity chain endpoint.
        chainTransport.itemDetail(workspace.id, itemId).then(setChain).catch(() => setChain(null));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, itemId, locationsTransport, workspace, chainTransport]);

  useEffect(() => { load(); }, [load]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view this item.</div>;
  }
  if (loading) return <div className="p-6 text-sm text-ink-muted">Loading…</div>;
  if (error || !row) {
    return (
      <div className="space-y-3 p-6">
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
          {error ?? 'Item not found.'}
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
  const grade = [row.numeric_grade, row.grade_designation].filter(Boolean).join(' ');

  const copyScan = () => {
    navigator.clipboard?.writeText(row.scan_sku).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
          <ScanLine className="h-5 w-5 text-accent" /> {row.product_display_name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Item {row.item_public_id}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setMoving(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
        >
          <MapPin className="h-4 w-4" /> Move item
        </button>
        <button
          onClick={() => setPrinting(true)}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <Printer className="h-4 w-4" /> Print label
        </button>
        <button
          onClick={copyScan}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy scan SKU'}
        </button>
        <button
          // Carries what two copies genuinely share and nothing that names
          // THIS object — no certificate number, no serial, no scan SKU.
          onClick={() => navigate('/quick-add', { state: { prefill: prefillFromItem(row) } })}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <PackagePlus className="h-4 w-4" /> Add another like this
        </button>
        {chain?.session && (
          <button
            onClick={() => navigate('/quick-add', { state: { resumeSessionId: chain.session!.sessionId } })}
            className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Open intake session
          </button>
        )}
      </div>

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold">Details</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Row label="Category" value={subtypeLabel(row.inventory_subtype)} />
          <Row label="Grading company" value={row.grading_company} />
          <Row label="Grade" value={grade || null} />
          <Row label="Certificate number" value={row.certificate_number} />
          <Row label="Serial number" value={row.serial_number} />
          <Row label="Condition" value={row.condition_or_quality} />
          <Row label="Size" value={row.shoe_size ? `${row.shoe_size}${row.size_system ? ` ${row.size_system}` : ''}` : row.size_label} />
          <Row label="Scan SKU" value={row.scan_sku} />
          <Row label="Item ID" value={row.item_public_id} />
          <Row label="Lot ID" value={row.lot_public_id} />
          <Row
            label="Storage location"
            value={currentLocation ? (row.location_retired_at ? `${currentLocation} (retired)` : currentLocation) : null}
          />
          <Row label="Date added" value={formatWhen(row.item_created_at)} />
          <Row
            label="Intake session"
            value={chain?.session ? (chain.session.sessionLabel || 'Untitled session') : 'Not tracked by an intake session'}
          />
        </dl>
      </section>

      <MediaPanel
        data={data}
        subjectKind="item"
        subjectId={row.item_id}
        userId={userId}
        slots={slotsForVertical(row.business_vertical, row.grading_company)}
        onChanged={load}
      />

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold">Movement history</h2>
        <MovementHistory movements={movements} locationName={locationName} />
      </section>

      {moving && (
        <MoveDialog
          data={data}
          subjectKind="item"
          subjectId={row.item_id}
          currentLocationCode={row.location_code}
          currentLocationName={currentLocation}
          locations={locations}
          onDone={load}
          onClose={() => setMoving(false)}
        />
      )}

      {printing && (
        <LabelPreview labels={[labelForItem(row)]} onClose={() => setPrinting(false)} />
      )}
    </div>
  );
}

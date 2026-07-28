// Current Inventory — one surface for everything the app tracks.
//
// Individually tracked units and quantity-managed lots are different grains of
// the same inventory, so they appear together here. A serialized lot is
// deliberately NOT listed alongside its own units: it is represented by them,
// and showing both would count the same physical inventory twice.
//
// Distinct from Legacy Inventory, which reads the older SQLite system.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Camera, MapPin, Package, Printer, Search, X } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import {
  createInventoryData, type ItemOverviewRow, type LotOverviewRow,
} from '../lib/inventoryData';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { useDebounce } from '../lib/useDebounce';
import { LabelPreview } from '../components/InventoryPanels';
import { labelForItem, labelForLot, type LabelView } from '../lib/labels';

type Tab = 'all' | 'items' | 'lots';

const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'AGS'];
const VERTICALS = [
  { value: 'tcg', label: 'Trading cards' },
  { value: 'footwear', label: 'Footwear' },
  { value: 'other', label: 'Other' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

/** One row of either grain, flattened for a single table. */
interface UnifiedRow {
  key: string;
  kind: 'item' | 'lot';
  id: string;
  name: string;
  vertical: string;
  quantity: number;
  conditionOrGrade: string | null;
  location: string | null;
  locationRetired: boolean;
  scanIdentifier: string;
  createdAt: string;
  mediaCount: number;
  mediaPath: string | null;
  detail: string | null;
}

function itemToRow(r: ItemOverviewRow): UnifiedRow {
  const grade = [r.numeric_grade, r.grade_designation].filter(Boolean).join(' ');
  return {
    key: `item-${r.item_id}`,
    kind: 'item',
    id: r.item_id,
    name: r.product_display_name,
    vertical: r.business_vertical,
    quantity: 1,
    conditionOrGrade: grade || r.condition_or_quality,
    location: r.location_display_name || r.location_code,
    locationRetired: r.location_retired_at !== null,
    scanIdentifier: r.scan_sku,
    createdAt: r.item_created_at,
    mediaCount: r.media_count,
    mediaPath: r.primary_media_path,
    detail: [r.grading_company, r.certificate_number, r.serial_number, r.shoe_size, r.size_label]
      .filter(Boolean).join(' · ') || null,
  };
}

function lotToRow(r: LotOverviewRow): UnifiedRow {
  return {
    key: `lot-${r.lot_id}`,
    kind: 'lot',
    id: r.lot_id,
    name: r.product_display_name,
    vertical: r.business_vertical,
    quantity: r.quantity,
    conditionOrGrade: r.condition_or_quality,
    location: r.location_display_name || r.location_code,
    locationRetired: r.location_retired_at !== null,
    scanIdentifier: r.lot_public_id,
    createdAt: r.lot_created_at,
    mediaCount: r.media_count,
    mediaPath: r.primary_media_path,
    detail: [r.product_format, r.seal_or_packaging_condition, r.size_label, r.shoe_size]
      .filter(Boolean).join(' · ') || null,
  };
}

function verticalLabel(v: string): string {
  return VERTICALS.find((x) => x.value === v)?.label ?? 'Other';
}

/** A private-bucket thumbnail, or a neutral placeholder when there is none. */
function Thumb({ path, signedUrl }: { path: string | null; signedUrl: string | null }) {
  if (path && signedUrl) {
    return <img src={signedUrl} alt="" className="h-10 w-10 rounded object-cover" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-2 text-ink-muted">
      <Camera className="h-4 w-4" />
    </div>
  );
}

export default function CurrentInventory() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );
  const locationsTransport = useMemo(
    () => createLocationsTransport(client as never, () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  // The Workbench links here with a filter already applied, so the URL — not
  // local state — is the source of truth for what is being shown.
  const tab = (params.get('tab') as Tab) || 'all';
  const needsPhotos = params.get('needsPhotos') === '1';
  const needsLocation = params.get('needsLocation') === '1';
  const locationId = params.get('location') ?? '';
  const gradingCompany = params.get('grader') ?? '';
  const vertical = params.get('category') ?? '';

  const [query, setQuery] = useState(params.get('q') ?? '');
  const debouncedQuery = useDebounce(query, 300);
  const [items, setItems] = useState<ItemOverviewRow[]>([]);
  const [lots, setLots] = useState<LotOverviewRow[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelView[] | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!workspace) return;
    locationsTransport.list(true).then(setLocations).catch(() => setLocations([]));
  }, [locationsTransport, workspace]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = {
      q: debouncedQuery || undefined,
      locationId: locationId || undefined,
      businessVertical: vertical || undefined,
      needsPhotos: needsPhotos || undefined,
      needsLocation: needsLocation || undefined,
      limit: 100,
    };
    Promise.all([
      tab === 'lots'
        ? Promise.resolve({ rows: [] as ItemOverviewRow[], total: 0 })
        : data.listItems({ ...filters, gradingCompany: gradingCompany || undefined }),
      tab === 'items'
        ? Promise.resolve({ rows: [] as LotOverviewRow[], total: 0 })
        : data.listLots(filters),
    ])
      .then(async ([itemPage, lotPage]) => {
        if (cancelled) return;
        setItems(itemPage.rows);
        setLots(lotPage.rows);
        // Private bucket: each thumbnail needs its own signed URL.
        const paths = [...itemPage.rows, ...lotPage.rows]
          .map((r) => ('primary_media_path' in r ? r.primary_media_path : null))
          .filter((p): p is string => Boolean(p));
        const signed = await Promise.all(
          paths.map(async (p) => [p, await data.signedUrl(p, 600)] as const)
        );
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [p, url] of signed) if (url) map[p] = url;
        setThumbs(map);
      })
      .catch((e: unknown) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data, tab, debouncedQuery, locationId, vertical, gradingCompany, needsPhotos, needsLocation]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view inventory.</div>;
  }

  // needsLocation is applied by the query above, over the whole workspace, so
  // this list is not silently narrowed to whatever fell inside one page.
  const rows: UnifiedRow[] = [...items.map(itemToRow), ...lots.map(lotToRow)];
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.key));
  // Whole-record movement is only offered when every selected row supports it.
  // A serialized unit and a quantity lot move through different governed
  // functions, so a mixed selection is not a single safe operation.
  const canMoveSelection =
    selectedRows.length > 0 && selectedRows.every((r) => r.kind === selectedRows[0].kind);

  const printSelected = () => {
    const labels: LabelView[] = [];
    for (const row of selectedRows) {
      if (row.kind === 'item') {
        const src = items.find((i) => i.item_id === row.id);
        if (src) labels.push(labelForItem(src));
      } else {
        const src = lots.find((l) => l.lot_id === row.id);
        if (src) labels.push(labelForLot(src));
      }
    }
    if (labels.length > 0) setPrinting(labels);
  };

  const activeFilters = [needsPhotos, needsLocation, locationId, gradingCompany, vertical].filter(Boolean).length;

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-5 w-5 text-accent" /> Current Inventory
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Everything tracked in {workspace.name}. The older spreadsheet-imported records live under
          Legacy Inventory.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'items', 'lots'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setParam('tab', t === 'all' ? '' : t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
            }`}
          >
            {t === 'all' ? 'All Inventory' : t === 'items' ? 'Individual Items' : 'Quantity Lots'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            className="w-full rounded-lg border border-hairline bg-surface-1 py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
            placeholder="Search name, scan SKU, item ID, lot ID, certificate or serial…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setParam('q', e.target.value); }}
            aria-label="Search inventory"
          />
        </label>
        <select
          className="rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm"
          value={vertical}
          onChange={(e) => setParam('category', e.target.value)}
          aria-label="Category"
        >
          <option value="">Any category</option>
          {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <select
          className="rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm"
          value={locationId}
          onChange={(e) => setParam('location', e.target.value)}
          aria-label="Location"
        >
          <option value="">Any location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.display_name || l.location_code}</option>
          ))}
        </select>
        {tab !== 'lots' && (
          <select
            className="rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm"
            value={gradingCompany}
            onChange={(e) => setParam('grader', e.target.value)}
            aria-label="Grading company"
          >
            <option value="">Any grader</option>
            {GRADING_COMPANIES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={() => setParam('needsPhotos', needsPhotos ? '' : '1')}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            needsPhotos ? 'border-accent bg-accent/12 text-accent-strong' : 'border-hairline'
          }`}
        >
          Needs photos
        </button>
        <button
          type="button"
          onClick={() => setParam('needsLocation', needsLocation ? '' : '1')}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            needsLocation ? 'border-accent bg-accent/12 text-accent-strong' : 'border-hairline'
          }`}
        >
          Needs location
        </button>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => setParams(query ? new URLSearchParams({ q: query }) : new URLSearchParams(), { replace: true })}
            className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      {error && <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button onClick={printSelected} className="flex items-center gap-1.5 rounded border border-hairline px-2.5 py-1.5 text-xs font-medium">
            <Printer className="h-3.5 w-3.5" /> Print labels
          </button>
          <button
            onClick={() => navigate(selectedRows[0].kind === 'item'
              ? `/inventory/current/${selectedRows[0].id}`
              : `/inventory/lots/${selectedRows[0].id}`)}
            disabled={!canMoveSelection}
            title={canMoveSelection
              ? 'Open the first selected record to move it'
              : 'Select only individual items, or only quantity lots — they move differently'}
            className="flex items-center gap-1.5 rounded border border-hairline px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            <MapPin className="h-3.5 w-3.5" /> Move
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-ink-muted underline">
            Clear selection
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {query || activeFilters > 0
            ? 'Nothing matches those filters.'
            : 'No inventory yet. Add your first item from Add Inventory.'}
        </p>
      ) : (
        <>
          {/* Table for desktop, cards below the iPad breakpoint. */}
          <div className="hidden overflow-x-auto rounded-lg border border-hairline md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Condition / grade</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Scan ID</th>
                  <th className="px-3 py-2">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => navigate(r.kind === 'item'
                      ? `/inventory/current/${r.id}` : `/inventory/lots/${r.id}`)}
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.key)}
                        onChange={() => toggle(r.key)}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Thumb path={r.mediaPath} signedUrl={r.mediaPath ? thumbs[r.mediaPath] ?? null : null} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          {r.detail && <div className="truncate text-xs text-ink-muted">{r.detail}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      <span className="flex items-center gap-1 whitespace-nowrap text-xs">
                        {r.kind === 'item'
                          ? <><Package className="h-3 w-3" /> Individual</>
                          : <><Boxes className="h-3 w-3" /> Quantity lot</>}
                      </span>
                      <span className="text-xs text-ink-muted">{verticalLabel(r.vertical)}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.conditionOrGrade ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {r.location ?? <span className="text-amber-600">Needs location</span>}
                      {r.locationRetired && <span className="ml-1 text-xs text-amber-600">(retired)</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-muted">{r.scanIdentifier}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => navigate(r.kind === 'item'
                  ? `/inventory/current/${r.id}` : `/inventory/lots/${r.id}`)}
                className="flex w-full items-start gap-3 rounded-lg border border-hairline bg-surface-1 p-3 text-left"
              >
                <Thumb path={r.mediaPath} signedUrl={r.mediaPath ? thumbs[r.mediaPath] ?? null : null} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {r.kind === 'item' ? 'Individual' : `Quantity lot · ${r.quantity}`}
                    {r.conditionOrGrade ? ` · ${r.conditionOrGrade}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {r.location ?? 'Needs location'} · {formatDate(r.createdAt)}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-muted">{r.scanIdentifier}</div>
                </div>
              </button>
            ))}
          </div>

          <p className="text-xs text-ink-muted">
            Showing {rows.length} record{rows.length === 1 ? '' : 's'}
            {rows.length >= 100 ? ' (first 100 — narrow your search to see more)' : ''}.
          </p>
        </>
      )}

      {printing && <LabelPreview labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

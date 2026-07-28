// Current Inventory — one surface for everything the app tracks.
//
// Individually tracked units and quantity-managed lots are different grains of
// the same inventory, so they appear together here. A serialized lot is
// deliberately NOT listed alongside its own units: it is represented by them,
// and showing both would count the same physical inventory twice.
//
// Every filter, the sort, and the page window are answered by the database
// over the whole workspace. Nothing on this page narrows or re-sorts a list
// that was already fetched — that is what made the old version disagree with
// the Workbench counts that link into it, and what made "newest first" mean
// "newest of the hundred rows that happened to load".
//
// The whole query lives in the URL, so a filtered view can be bookmarked or
// sent to someone, and the browser Back button restores exactly what was on
// screen — page number included.
//
// Distinct from Legacy Inventory, which reads the older SQLite system.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Camera, ChevronLeft, ChevronRight, MapPin, Package, Printer, Search, Target, X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type RecordOverviewRow } from '../lib/inventoryData';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { useDebounce } from '../lib/useDebounce';
import { LabelPreview } from '../components/InventoryPanels';
import { labelForRecord, type LabelView } from '../lib/labels';
import {
  BUSINESS_VERTICALS, INVENTORY_SUBTYPES, PAGE_SIZES, SORT_KEYS, SORT_LABELS,
  VERTICAL_LABELS, describeRange, pageCount, queryFromSearchParams, rangeForPage,
  searchParamsFromQuery, subtypeLabel, type InventoryQuery,
} from '../lib/inventoryQuery';

const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'AGS'];

/** Toggle filters, in the order an operator reaches for them. */
const FLAG_FILTERS: readonly { key: keyof InventoryQuery; label: string }[] = [
  { key: 'needsPhotos', label: 'Needs photos' },
  { key: 'hasPhotos', label: 'Has photos' },
  { key: 'needsLocation', label: 'Needs location' },
  { key: 'needsConditionDetails', label: 'Needs condition details' },
  { key: 'recentlyAdded', label: 'Recently added' },
  { key: 'recentlyMoved', label: 'Recently moved' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function detailPath(row: RecordOverviewRow): string {
  return row.record_kind === 'item'
    ? `/inventory/current/${row.record_id}`
    : `/inventory/lots/${row.record_id}`;
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

  // The URL is the single source of truth for what is being shown. The
  // Workbench links here with filters already applied, and Back must restore a
  // previous page, so nothing about the query is held in component state.
  const query = useMemo(() => queryFromSearchParams(params), [params]);

  // The search box is the one exception: it echoes keystrokes locally and is
  // written to the URL on a debounce, so typing does not push a history entry
  // per character.
  const [searchDraft, setSearchDraft] = useState(query.q);
  const debouncedSearch = useDebounce(searchDraft, 300);

  const [rows, setRows] = useState<RecordOverviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [lotCount, setLotCount] = useState(0);
  const [exact, setExact] = useState<RecordOverviewRow | null>(null);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelView[] | null>(null);

  /**
   * Write a new query to the URL. Any change other than the page itself means
   * the operator is looking at a different set of records, so the result
   * returns to page one rather than stranding them on a page number that may
   * no longer exist.
   */
  const updateQuery = useCallback(
    (patch: Partial<InventoryQuery>, opts: { replace?: boolean } = {}) => {
      const pageOnly = Object.keys(patch).length === 1 && 'page' in patch;
      const next: InventoryQuery = { ...query, ...patch, ...(pageOnly ? {} : { page: 1 }) };
      // Page changes are real navigation — Back should return to the previous
      // page. Filter edits replace, so Back leaves the filtered view entirely
      // instead of stepping through every keystroke.
      setParams(searchParamsFromQuery(next), { replace: opts.replace ?? !pageOnly });
    },
    [query, setParams]
  );

  // Push the debounced search term into the URL when it settles.
  const lastPushedSearch = useRef(query.q);
  useEffect(() => {
    if (debouncedSearch === lastPushedSearch.current) return;
    lastPushedSearch.current = debouncedSearch;
    updateQuery({ q: debouncedSearch });
  }, [debouncedSearch, updateQuery]);

  // A Back navigation changes the URL underneath us; the box must follow it.
  useEffect(() => {
    if (query.q !== lastPushedSearch.current) {
      lastPushedSearch.current = query.q;
      setSearchDraft(query.q);
    }
  }, [query.q]);

  useEffect(() => {
    if (!workspace) return;
    locationsTransport.list(true).then(setLocations).catch(() => setLocations([]));
  }, [locationsTransport, workspace]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());

    const { from } = rangeForPage(query.page, query.pageSize);
    const filters = {
      scope: query.scope,
      q: query.q || undefined,
      subtype: query.subtype || undefined,
      businessVertical: query.businessVertical || undefined,
      locationId: query.locationId || undefined,
      condition: query.condition || undefined,
      gradingCompany: query.gradingCompany || undefined,
      trackingMode: query.trackingMode || undefined,
      hasPhotos: query.hasPhotos || undefined,
      needsPhotos: query.needsPhotos || undefined,
      needsLocation: query.needsLocation || undefined,
      needsConditionDetails: query.needsConditionDetails || undefined,
      recentlyAdded: query.recentlyAdded || undefined,
      recentlyMoved: query.recentlyMoved || undefined,
      addedFrom: query.addedFrom || undefined,
      addedTo: query.addedTo || undefined,
      sort: query.sort,
      limit: query.pageSize,
      offset: from,
    };

    data.listRecords(filters)
      .then(async (page) => {
        if (cancelled) return;
        setRows(page.rows);
        setTotal(page.total);
        setItemCount(page.itemCount);
        setLotCount(page.lotCount);

        // Private bucket: each thumbnail needs its own signed URL.
        const paths = page.rows
          .map((r) => r.primary_media_path)
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
  }, [data, query]);

  // An identifier the operator scanned or pasted resolves to its own record,
  // above the substring results. Ranked separately rather than folded into the
  // list so a certificate number can never lose to a product name that happens
  // to contain the same digits.
  useEffect(() => {
    if (!data || !query.q.trim()) { setExact(null); return; }
    let cancelled = false;
    data.findExactRecord(query.q)
      .then((hit) => !cancelled && setExact(hit))
      .catch(() => !cancelled && setExact(null));
    return () => { cancelled = true; };
  }, [data, query.q]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view inventory.</div>;
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.record_id));
  const pages = pageCount(total, query.pageSize);

  const printSelected = () => {
    const labels = selectedRows.map(labelForRecord);
    if (labels.length > 0) setPrinting(labels);
  };

  const activeFilterCount = [
    query.subtype, query.businessVertical, query.locationId, query.condition,
    query.gradingCompany, query.trackingMode, query.addedFrom, query.addedTo,
    query.hasPhotos, query.needsPhotos, query.needsLocation,
    query.needsConditionDetails, query.recentlyAdded, query.recentlyMoved,
  ].filter(Boolean).length;

  const inputClass =
    'rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm outline-none focus:border-accent';

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
        {(['all', 'items', 'lots'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => updateQuery({ scope: t })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              query.scope === t ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
            }`}
          >
            {t === 'all' ? 'All Inventory' : t === 'items' ? 'Individual Items' : 'Quantity Lots'}
          </button>
        ))}
        {!loading && (
          // Two grains, two counts. "277 records" would hide that 240 of them
          // are individual units and 37 are quantity lots.
          <span className="text-xs text-ink-muted">
            {itemCount.toLocaleString()} individual · {lotCount.toLocaleString()} quantity lot
            {lotCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            className="w-full rounded-lg border border-hairline bg-surface-1 py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
            placeholder="Search name, set, card number, style code, colorway, size, scan SKU, certificate, serial…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Search inventory"
          />
        </label>
        <select
          className={inputClass}
          value={query.subtype}
          onChange={(e) => updateQuery({ subtype: e.target.value as InventoryQuery['subtype'] })}
          aria-label="Category"
        >
          <option value="">Any category</option>
          {INVENTORY_SUBTYPES.map((s) => (
            <option key={s} value={s}>{subtypeLabel(s)}</option>
          ))}
        </select>
        <select
          className={inputClass}
          value={query.businessVertical}
          onChange={(e) => updateQuery({ businessVertical: e.target.value })}
          aria-label="Business vertical"
        >
          <option value="">Any vertical</option>
          {BUSINESS_VERTICALS.map((v) => (
            <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>
          ))}
        </select>
        <select
          className={inputClass}
          value={query.locationId}
          onChange={(e) => updateQuery({ locationId: e.target.value })}
          aria-label="Location"
        >
          <option value="">Any location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.display_name || l.location_code}</option>
          ))}
        </select>
        <select
          className={inputClass}
          value={query.gradingCompany}
          onChange={(e) => updateQuery({ gradingCompany: e.target.value })}
          aria-label="Grading company"
        >
          <option value="">Any grader</option>
          {GRADING_COMPANIES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select
          className={inputClass}
          value={query.trackingMode}
          onChange={(e) => updateQuery({ trackingMode: e.target.value as InventoryQuery['trackingMode'] })}
          aria-label="Tracking mode"
        >
          <option value="">Any tracking</option>
          <option value="serialized">Individually tracked</option>
          <option value="lot_managed">Quantity managed</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Added from
          <input
            type="date"
            className={inputClass}
            value={query.addedFrom}
            onChange={(e) => updateQuery({ addedFrom: e.target.value })}
            aria-label="Added from"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          to
          <input
            type="date"
            className={inputClass}
            value={query.addedTo}
            onChange={(e) => updateQuery({ addedTo: e.target.value })}
            aria-label="Added to"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {FLAG_FILTERS.map((f) => (
          <button
            key={String(f.key)}
            type="button"
            onClick={() => updateQuery({ [f.key]: !query[f.key] } as Partial<InventoryQuery>)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              query[f.key] ? 'border-accent bg-accent/12 text-accent-strong' : 'border-hairline'
            }`}
          >
            {f.label}
          </button>
        ))}
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => updateQuery({
              subtype: '', businessVertical: '', locationId: '', condition: '',
              gradingCompany: '', trackingMode: '', addedFrom: '', addedTo: '',
              hasPhotos: false, needsPhotos: false, needsLocation: false,
              needsConditionDetails: false, recentlyAdded: false, recentlyMoved: false,
            })}
            className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Sort
          <select
            className={inputClass}
            value={query.sort}
            onChange={(e) => updateQuery({ sort: e.target.value as InventoryQuery['sort'] })}
            aria-label="Sort inventory"
          >
            {SORT_KEYS.map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Per page
          <select
            className={inputClass}
            value={query.pageSize}
            onChange={(e) => updateQuery({ pageSize: Number(e.target.value) as InventoryQuery['pageSize'] })}
            aria-label="Records per page"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {!loading && (
          <span className="text-xs text-ink-muted">
            {describeRange(query.page, query.pageSize, total, rows.length)}
          </span>
        )}
      </div>

      {error && <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>}

      {exact && (
        <button
          type="button"
          onClick={() => navigate(detailPath(exact))}
          className="flex w-full items-center gap-2 rounded-lg border border-accent bg-accent/8 px-3 py-2 text-left text-sm"
        >
          <Target className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">Exact match:</span> {exact.product_display_name}
          </span>
          <span className="font-mono text-xs text-ink-muted">{exact.scan_identifier}</span>
        </button>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button onClick={printSelected} className="flex items-center gap-1.5 rounded border border-hairline px-2.5 py-1.5 text-xs font-medium">
            <Printer className="h-3.5 w-3.5" /> Print labels
          </button>
          <button
            onClick={() => navigate('/inventory/move', {
              state: { records: selectedRows.map((r) => ({ kind: r.record_kind, id: r.record_id })) },
            })}
            className="flex items-center gap-1.5 rounded border border-hairline px-2.5 py-1.5 text-xs font-medium"
          >
            <MapPin className="h-3.5 w-3.5" /> Move selected
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
          {query.q || activeFilterCount > 0
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
                    key={r.record_id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => navigate(detailPath(r))}
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.record_id)}
                        onChange={() => toggle(r.record_id)}
                        aria-label={`Select ${r.product_display_name}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Thumb
                          path={r.primary_media_path}
                          signedUrl={r.primary_media_path ? thumbs[r.primary_media_path] ?? null : null}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.product_display_name}</div>
                          {r.detail_line && (
                            <div className="truncate text-xs text-ink-muted">{r.detail_line}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      <span className="flex items-center gap-1 whitespace-nowrap text-xs">
                        {r.record_kind === 'item'
                          ? <><Package className="h-3 w-3" /> Individual</>
                          : <><Boxes className="h-3 w-3" /> Quantity lot</>}
                      </span>
                      <span className="text-xs text-ink-muted">{subtypeLabel(r.inventory_subtype)}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.condition_or_grade ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {r.location_display_name || r.location_code || (
                        <span className="text-amber-600">Needs location</span>
                      )}
                      {r.location_retired_at && <span className="ml-1 text-xs text-amber-600">(retired)</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-muted">{r.scan_identifier}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <button
                key={r.record_id}
                type="button"
                onClick={() => navigate(detailPath(r))}
                className="flex w-full items-start gap-3 rounded-lg border border-hairline bg-surface-1 p-3 text-left"
              >
                <Thumb
                  path={r.primary_media_path}
                  signedUrl={r.primary_media_path ? thumbs[r.primary_media_path] ?? null : null}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.product_display_name}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {r.record_kind === 'item' ? 'Individual' : `Quantity lot · ${r.quantity}`}
                    {r.condition_or_grade ? ` · ${r.condition_or_grade}` : ''}
                    {` · ${subtypeLabel(r.inventory_subtype)}`}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {r.location_display_name || r.location_code || 'Needs location'} · {formatDate(r.created_at)}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-muted">{r.scan_identifier}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">
              {describeRange(query.page, query.pageSize, total, rows.length)}
              {pages > 1 && ` · page ${query.page} of ${pages}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateQuery({ page: query.page - 1 })}
                disabled={query.page <= 1}
                className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <button
                type="button"
                onClick={() => updateQuery({ page: query.page + 1 })}
                disabled={query.page >= pages}
                className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {printing && <LabelPreview labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

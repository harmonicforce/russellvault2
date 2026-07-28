// Current Inventory — the Supabase-sourced inventory view. Distinct from the
// legacy SQLite Inventory page (still available under Legacy Inventory): this
// shows what has actually been committed through Quick Add / the intake
// kernel, in plain Product -> SKU -> Lot -> Item language, searchable and
// filterable, with no raw id anywhere.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Search } from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import {
  createInventoryIdentityTransport,
  type InventoryIdentityTransport,
  type InventoryOverviewRow,
} from '../lib/inventoryIdentityApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import { useDebounce } from '../lib/useDebounce';
import { Select } from '../components/Select';

const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'AGS'];
const TRACKING_MODES = [
  { value: 'serialized', label: 'Serialized (one row per item)' },
  { value: 'lot_managed', label: 'Lot-managed (tracked by quantity)' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function CurrentInventory() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const transport: InventoryIdentityTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createInventoryIdentityTransport(tokenProviderFromClient(client));
  }, [config]);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [gradingCompany, setGradingCompany] = useState('');
  const [trackingMode, setTrackingMode] = useState('');
  const [rows, setRows] = useState<readonly InventoryOverviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transport || !workspace) return;
    setLoading(true);
    setError(null);
    transport
      .overview(workspace.id, {
        q: debouncedQuery || undefined,
        gradingCompany: gradingCompany || undefined,
        trackingMode: trackingMode || undefined,
        limit: 100,
      })
      .then((page) => {
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [transport, workspace, debouncedQuery, gradingCompany, trackingMode]);

  if (!config || !transport) {
    return <div className="p-6 text-sm text-ink-muted">Current Inventory is not enabled in this build.</div>;
  }
  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view inventory.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-5 w-5 text-accent" /> Current Inventory
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Items added through Quick Add in {workspace.name}. For the older spreadsheet-imported inventory, see
          Legacy Inventory.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            className="w-full rounded-lg border border-hairline bg-surface-1 py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
            placeholder="Search by card name, scan SKU, item ID, or certificate…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search inventory"
          />
        </label>
        <Select value={gradingCompany} onChange={setGradingCompany} options={GRADING_COMPANIES.map((c) => ({ value: c, label: c }))} placeholder="Any grading company" />
        <Select value={trackingMode} onChange={setTrackingMode} options={TRACKING_MODES} placeholder="Any tracking type" />
      </div>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {query || gradingCompany || trackingMode ? 'No items match your search.' : 'No inventory yet. Add your first item with Quick Add.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Grader</th>
                <th className="px-3 py-2">Certificate</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Scan SKU</th>
                <th className="px-3 py-2">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r) => (
                <tr
                  key={r.item_id}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => navigate(`/inventory/current/${r.item_id}`)}
                >
                  <td className="px-3 py-2 font-medium">{r.product_display_name}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.grading_company ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-muted">{r.certificate_number ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {r.location_display_name || r.location_code || '—'}
                    {r.location_retired_at && <span className="ml-1 text-xs text-amber-600">(retired)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-muted">{r.scan_sku}</td>
                  <td className="px-3 py-2 text-ink-muted">{formatDate(r.item_created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <p className="text-xs text-ink-muted">
          Showing {rows.length} of {total} item{total === 1 ? '' : 's'}.
        </p>
      )}
    </div>
  );
}

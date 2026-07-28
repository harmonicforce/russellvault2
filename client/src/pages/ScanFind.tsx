// Scan / Find — the fastest path from a barcode or typed identifier to the
// right record.
//
// A hardware scanner behaves as a keyboard that types the value and presses
// Enter, so the field takes focus immediately and submits on Enter. An exact
// identifier opens its record directly; anything else falls back to a short
// result list. Every query is workspace-scoped, so a scan can never resolve
// into another workspace's inventory.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanLine, Search } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type ItemOverviewRow, type LotOverviewRow } from '../lib/inventoryData';

export type ScanTarget =
  | { kind: 'item'; id: string }
  | { kind: 'lot'; id: string }
  | { kind: 'none' };

/**
 * Decide where an exact match should go. Serialized units win over lots when
 * both somehow match, because a scan SKU is the more specific identifier.
 */
export function resolveExactTarget(
  term: string,
  items: readonly ItemOverviewRow[],
  lots: readonly LotOverviewRow[]
): ScanTarget {
  const needle = term.trim().toUpperCase();
  if (!needle) return { kind: 'none' };
  const item = items.find(
    (r) =>
      r.scan_sku.toUpperCase() === needle ||
      r.item_public_id.toUpperCase() === needle ||
      (r.certificate_number ?? '').toUpperCase() === needle ||
      (r.serial_number ?? '').toUpperCase() === needle
  );
  if (item) return { kind: 'item', id: item.item_id };
  const lot = lots.find((r) => r.lot_public_id.toUpperCase() === needle);
  if (lot) return { kind: 'lot', id: lot.lot_id };
  return { kind: 'none' };
}

export default function ScanFind() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );

  const [term, setTerm] = useState('');
  const [items, setItems] = useState<ItemOverviewRow[]>([]);
  const [lots, setLots] = useState<LotOverviewRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = async () => {
    if (!data) return;
    const value = term.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const [itemPage, lotPage] = await Promise.all([
        data.listItems({ q: value, limit: 25 }),
        data.listLots({ q: value, limit: 25 }),
      ]);
      setItems(itemPage.rows);
      setLots(lotPage.rows);
      setSearched(true);
      setRecent((prev) => [value, ...prev.filter((v) => v !== value)].slice(0, 8));

      const target = resolveExactTarget(value, itemPage.rows, lotPage.rows);
      if (target.kind === 'item') navigate(`/inventory/current/${target.id}`);
      else if (target.kind === 'lot') navigate(`/inventory/lots/${target.id}`);
      else setTerm('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to scan inventory.</div>;
  }

  return (
    <div className="max-w-3xl space-y-5 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ScanLine className="h-5 w-5 text-accent" /> Scan or Find
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Scan a label, or type a scan SKU, item ID, lot ID, certificate or serial number.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); search(); }}
        className="flex gap-2"
      >
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={inputRef}
            className="w-full rounded-lg border border-hairline bg-surface-1 py-3 pl-9 pr-3 text-base outline-none focus:border-accent"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Scan or type an identifier…"
            aria-label="Scan or search"
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Finding…' : 'Find'}
        </button>
      </form>

      {error && <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>}

      {searched && items.length === 0 && lots.length === 0 && (
        <p className="text-sm text-ink-muted">Nothing in {workspace.name} matches that.</p>
      )}

      {(items.length > 0 || lots.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Matches</h2>
          {items.map((r) => (
            <button
              key={r.item_id}
              type="button"
              onClick={() => navigate(`/inventory/current/${r.item_id}`)}
              className="block w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-left hover:bg-surface-2"
            >
              <div className="text-sm font-medium">{r.product_display_name}</div>
              <div className="text-xs text-ink-muted">
                Item · {r.scan_sku} · {r.location_display_name || r.location_code || 'No location'}
              </div>
            </button>
          ))}
          {lots.map((r) => (
            <button
              key={r.lot_id}
              type="button"
              onClick={() => navigate(`/inventory/lots/${r.lot_id}`)}
              className="block w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-left hover:bg-surface-2"
            >
              <div className="text-sm font-medium">{r.product_display_name}</div>
              <div className="text-xs text-ink-muted">
                Lot · {r.lot_public_id} · qty {r.quantity} · {r.location_display_name || r.location_code || 'No location'}
              </div>
            </button>
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent scans</h2>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTerm(value)}
                className="rounded border border-hairline px-2 py-1 font-mono text-xs hover:bg-surface-2"
              >
                {value}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

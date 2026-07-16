import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Search, Check, X as XIcon } from 'lucide-react';
import { get, patch, post, type CostLink, type InventoryLot, type Page, type WhatnotPurchase } from '../lib/api';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { money, num, shortDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';

export default function CostLinks() {
  const qc = useQueryClient();
  const [lotQuery, setLotQuery] = useState('');
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const debouncedLot = useDebounce(lotQuery);
  const debouncedPurchase = useDebounce(purchaseQuery);
  const [selectedLot, setSelectedLot] = useState<InventoryLot | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<WhatnotPurchase | null>(null);
  const [allocQty, setAllocQty] = useState('');
  const [allocCost, setAllocCost] = useState('');
  const [asConfirmed, setAsConfirmed] = useState(true);

  const { data: lotResults } = useQuery({
    queryKey: ['link-lot-search', debouncedLot],
    queryFn: () => get<Page<InventoryLot>>('/inventory', { q: debouncedLot, pageSize: 500 }),
    enabled: debouncedLot.length > 1,
  });

  const { data: purchaseResults } = useQuery({
    queryKey: ['link-purchase-search', debouncedPurchase],
    queryFn: () => get<Page<WhatnotPurchase>>('/purchases', { q: debouncedPurchase, pageSize: 500 }),
    enabled: debouncedPurchase.length > 1,
  });

  const createLink = useMutation({
    mutationFn: () =>
      post<CostLink>('/cost-links', {
        inventory_lot_id: selectedLot!.inventory_lot_id,
        acquisition_line_id: selectedPurchase!.acquisition_line_id,
        allocated_quantity: allocQty === '' ? undefined : Number(allocQty),
        allocated_cost: allocCost === '' ? undefined : Number(allocCost),
        allocation_status: asConfirmed ? 'Confirmed' : 'Candidate',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-links'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedLot(null);
      setSelectedPurchase(null);
      setAllocQty('');
      setAllocCost('');
      setLotQuery('');
      setPurchaseQuery('');
    },
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cost Basis Links</h1>
        <p className="text-ink-secondary text-sm mt-1">
          Connect one inventory lot to one or more Whatnot purchases. Confirm only after physical evidence supports the link.
        </p>
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-accent" /> Link builder
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <input
                value={lotQuery}
                onChange={(e) => setLotQuery(e.target.value)}
                placeholder="Find inventory by product name…"
                className="w-full rounded-lg border border-hairline bg-surface-2 pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            {selectedLot ? (
              <SelectedCard
                title={selectedLot.product_name || selectedLot.inventory_lot_id}
                sub={`${selectedLot.inventory_lot_id} · ${selectedLot.cost_status} · avail ${selectedLot.available_quantity}`}
                onClear={() => setSelectedLot(null)}
              />
            ) : (
              <>
                <MatchCount total={lotResults?.total} shown={lotResults?.rows.length} show={debouncedLot.length > 1} />
                <div className="flex flex-col gap-1 max-h-[26rem] overflow-y-auto pr-1">
                  {(lotResults?.rows ?? []).map((r) => (
                    <button
                      key={r.inventory_lot_id}
                      onClick={() => { setSelectedLot(r); setAllocQty(String(r.available_quantity ?? '')); }}
                      className="text-left rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-surface-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.product_name || r.inventory_lot_id}</span>
                        <StatusBadge status={r.cost_status} />
                      </div>
                      <div className="text-xs text-ink-muted">{r.inventory_lot_id} · avail {r.available_quantity} · {money(r.recorded_unit_value)}</div>
                    </button>
                  ))}
                  {debouncedLot.length > 1 && (lotResults?.rows.length ?? 0) === 0 && (
                    <p className="text-xs text-ink-muted px-1">No matches.</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <input
                value={purchaseQuery}
                onChange={(e) => setPurchaseQuery(e.target.value)}
                placeholder="Find a Whatnot purchase by product or seller…"
                className="w-full rounded-lg border border-hairline bg-surface-2 pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            {selectedPurchase ? (
              <SelectedCard
                title={selectedPurchase.product_name || selectedPurchase.acquisition_line_id}
                sub={`${selectedPurchase.acquisition_line_id} · ${selectedPurchase.seller} · ${money(selectedPurchase.remaining_cost)} remaining`}
                onClear={() => setSelectedPurchase(null)}
              />
            ) : (
              <>
                <MatchCount total={purchaseResults?.total} shown={purchaseResults?.rows.length} show={debouncedPurchase.length > 1} />
                <div className="flex flex-col gap-1 max-h-[26rem] overflow-y-auto pr-1">
                  {(purchaseResults?.rows ?? []).map((r) => (
                    <button
                      key={r.acquisition_line_id}
                      onClick={() => { setSelectedPurchase(r); setAllocCost(String(r.remaining_cost ?? r.total_paid ?? '')); }}
                      className="text-left rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-surface-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.product_name}</span>
                        <StatusBadge status={r.reconciliation_status} />
                      </div>
                      <div className="text-xs text-ink-muted">{r.acquisition_line_id} · {r.seller} · {money(r.total_paid)}</div>
                    </button>
                  ))}
                  {debouncedPurchase.length > 1 && (purchaseResults?.rows.length ?? 0) === 0 && (
                    <p className="text-xs text-ink-muted px-1">No matches.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {selectedLot && selectedPurchase && (
          <div className="mt-4 pt-4 border-t border-hairline flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-secondary font-medium">Allocated quantity</label>
              <input type="number" value={allocQty} onChange={(e) => setAllocQty(e.target.value)}
                className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm w-32" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-secondary font-medium">Allocated cost</label>
              <input type="number" step="0.01" value={allocCost} onChange={(e) => setAllocCost(e.target.value)}
                className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm w-32" />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={asConfirmed} onChange={(e) => setAsConfirmed(e.target.checked)} />
              Confirm immediately
            </label>
            <button
              onClick={() => createLink.mutate()}
              disabled={createLink.isPending}
              className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-accent-strong disabled:opacity-50"
            >
              {createLink.isPending ? 'Linking…' : 'Create link'}
            </button>
            {createLink.isError && <p className="text-sm text-critical">{(createLink.error as Error).message}</p>}
          </div>
        )}
      </div>

      <CostLinksTable />
    </div>
  );
}

function MatchCount({ total, shown, show }: { total?: number; shown?: number; show: boolean }) {
  if (!show || !total) return null;
  return (
    <div className="text-xs text-ink-muted px-1 pb-1.5">
      {total} match{total === 1 ? '' : 'es'}
      {shown != null && shown < total ? ` — showing first ${shown}, keep typing to narrow` : ''}
      {(shown ?? 0) > 6 ? ' · scroll to see all' : ''}
    </div>
  );
}

function SelectedCard({ title, sub, onClear }: { title: string; sub: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/8 px-3 py-2.5 text-sm flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-ink-muted truncate">{sub}</div>
      </div>
      <button onClick={onClear} className="shrink-0 text-ink-muted hover:text-ink"><XIcon className="h-4 w-4" /></button>
    </div>
  );
}

function CostLinksTable() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('Candidate');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['cost-links', status, page],
    queryFn: () => get<Page<CostLink>>('/cost-links', { status, page, pageSize }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, allocation_status }: { id: string; allocation_status: string }) =>
      patch(`/cost-links/${id}`, { allocation_status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-links'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const columns: Column<CostLink>[] = [
    { key: 'inventory_product', header: 'Inventory lot', render: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.inventory_product}</div>
          <div className="text-xs text-ink-muted font-mono">{r.inventory_lot_id}</div>
        </div>
      ) },
    { key: 'purchase_product', header: 'Whatnot purchase', render: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.purchase_product}</div>
          <div className="text-xs text-ink-muted">{r.seller} · {shortDate(r.purchase_date)}</div>
        </div>
      ) },
    { key: 'allocated_quantity', header: 'Qty', align: 'right', render: (r) => <span className="tabular-nums">{num(r.allocated_quantity)}</span> },
    { key: 'allocated_cost', header: 'Cost', align: 'right', render: (r) => <span className="tabular-nums">{money(r.allocated_cost)}</span> },
    { key: 'match_confidence', header: 'Confidence', render: (r) => <span className="text-xs text-ink-muted">{r.match_confidence}</span> },
    { key: 'allocation_status', header: 'Status', render: (r) => <StatusBadge status={r.allocation_status} /> },
    {
      key: 'actions', header: '', width: '110px', render: (r) =>
        r.allocation_status === 'Candidate' ? (
          <div className="flex gap-1">
            <button
              title="Confirm"
              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: r.allocation_id, allocation_status: 'Confirmed' }); }}
              className="rounded-md p-1.5 bg-good/15 text-good hover:bg-good/25"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              title="Reject"
              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: r.allocation_id, allocation_status: 'Rejected' }); }}
              className="rounded-md p-1.5 bg-critical/15 text-critical hover:bg-critical/25"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">All cost links</h2>
      </div>
      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.allocation_id}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        filters={
          <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder="All statuses"
            options={[
              { value: 'Candidate', label: 'Candidate (needs review)' },
              { value: 'Confirmed', label: 'Confirmed' },
              { value: 'Rejected', label: 'Rejected' },
            ]} />
        }
      />
    </div>
  );
}

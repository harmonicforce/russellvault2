import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, type Page, type ProductType, type TypeSummary, type WhatnotPurchase } from '../lib/api';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { Drawer } from '../components/Drawer';
import { money, num, shortDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';

interface Facets {
  seller: { value: string; n: number }[];
  reconciliation_status: { value: string; n: number }[];
  business_vertical: { value: string; n: number }[];
}

const TYPE_ORDER: ProductType[] = [
  'Slab', 'Single', 'Sealed',
  'Sneakers', 'Apparel', 'Accessories', 'Electronics', 'Collectibles', 'Other',
  'Unreviewed',
];
const TYPE_STYLES: Record<string, string> = {
  Slab: 'bg-accent/15 text-accent',
  Single: 'bg-good/15 text-good',
  Sealed: 'bg-warn/15 text-warn',
  Sneakers: 'bg-surface-2 text-ink-secondary',
  Apparel: 'bg-surface-2 text-ink-secondary',
  Accessories: 'bg-surface-2 text-ink-secondary',
  Electronics: 'bg-surface-2 text-ink-secondary',
  Collectibles: 'bg-surface-2 text-ink-secondary',
  Other: 'bg-surface-2 text-ink-secondary',
  Unreviewed: 'bg-critical/12 text-critical',
};

function TypePill({ type }: { type: string | null }) {
  const t = type || 'Unreviewed';
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[t] ?? TYPE_STYLES.Unreviewed}`}>{t}</span>;
}

export default function Purchases() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [seller, setSeller] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [productType, setProductType] = useState('');
  const [sortKey, setSortKey] = useState('processed_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 50;

  const { data: facets } = useQuery({ queryKey: ['purchases-facets'], queryFn: () => get<Facets>('/purchases/facets') });
  const { data: typeSummary } = useQuery({ queryKey: ['purchases-type-summary'], queryFn: () => get<TypeSummary>('/purchases/type-summary') });

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', debouncedSearch, seller, reconciliationStatus, productType, sortKey, sortOrder, page],
    queryFn: () =>
      get<Page<WhatnotPurchase>>('/purchases', {
        q: debouncedSearch, seller, reconciliationStatus, productType, sort: sortKey, order: sortOrder, page, pageSize,
      }),
  });

  function handleSort(key: string) {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortOrder('desc'); }
  }

  const columns: Column<WhatnotPurchase>[] = [
    { key: 'product_type', header: 'Type', width: '96px', render: (r) => <TypePill type={r.product_type} /> },
    { key: 'processed_date', header: 'Date', sortable: true, render: (r) => <span className="text-xs">{shortDate(r.processed_date)}</span> },
    { key: 'seller', header: 'Seller', sortable: true },
    { key: 'product_name', header: 'Product', render: (r) => <div className="truncate max-w-md">{r.product_name}</div> },
    { key: 'quantity_purchased', header: 'Qty', sortable: true, align: 'right', render: (r) => <span className="tabular-nums">{num(r.quantity_purchased)}</span> },
    { key: 'total_paid', header: 'Total paid', sortable: true, align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_paid)}</span> },
    { key: 'remaining_cost', header: 'Remaining', sortable: true, align: 'right', render: (r) => <span className="tabular-nums">{money(r.remaining_cost)}</span> },
    { key: 'reconciliation_status', header: 'Status', sortable: true, render: (r) => <StatusBadge status={r.reconciliation_status} /> },
  ];

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Whatnot Purchases</h1>
        <p className="text-ink-secondary text-sm mt-1">{data ? `${data.total.toLocaleString()} purchase lines · source of truth for acquisition cost` : '—'}</p>
      </div>

      {typeSummary && (
        <div className="rounded-xl border border-hairline bg-surface-1 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">Cost by type</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {TYPE_ORDER.map((t) => {
              const s = typeSummary.byType[t] ?? { lines: 0, total: 0 };
              const active = productType === t;
              return (
                <button
                  key={t}
                  onClick={() => { setProductType(active ? '' : t); setPage(1); }}
                  className={`text-left rounded-lg border px-3 py-2 transition ${active ? 'border-accent bg-accent/8' : 'border-hairline hover:bg-surface-2'}`}
                >
                  <div className="flex items-center gap-1.5"><TypePill type={t} /></div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">{money(s.total)}</div>
                  <div className="text-xs text-ink-muted tabular-nums">{s.lines.toLocaleString()} lines</div>
                </button>
              );
            })}
            <div className="rounded-lg border border-hairline px-3 py-2">
              <div className="text-xs text-ink-muted">All purchases</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{money(typeSummary.grandTotal)}</div>
              <div className="text-xs text-ink-muted tabular-nums">{typeSummary.grandLines.toLocaleString()} lines</div>
            </div>
          </div>
          {productType && (
            <button onClick={() => { setProductType(''); setPage(1); }} className="mt-2 text-xs text-accent hover:underline">
              ← clear type filter ({productType})
            </button>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.acquisition_line_id}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSortChange={handleSort}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search product, seller, order ID…"
        onRowClick={(r) => setSelectedId(r.acquisition_line_id)}
        filters={
          <>
            <Select value={productType} onChange={(v) => { setProductType(v); setPage(1); }} placeholder="All types"
              options={TYPE_ORDER.map((t) => ({ value: t, label: t }))} />
            <Select value={seller} onChange={(v) => { setSeller(v); setPage(1); }} placeholder="All sellers"
              options={(facets?.seller ?? []).slice(0, 100).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
            <Select value={reconciliationStatus} onChange={(v) => { setReconciliationStatus(v); setPage(1); }} placeholder="All statuses"
              options={(facets?.reconciliation_status ?? []).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
          </>
        }
      />

      {selectedId && <PurchaseDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function PurchaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['purchase-detail', id], queryFn: () => get<any>(`/purchases/${id}`) });

  const setType = useMutation({
    mutationFn: (product_type: ProductType) => patch(`/purchases/${id}`, { product_type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-detail', id] });
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['purchases-type-summary'] });
    },
  });

  if (!data) return <Drawer open onClose={onClose} title="Loading…"><div /></Drawer>;

  return (
    <Drawer open onClose={onClose} title={data.acquisition_line_id}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-lg font-semibold">{data.product_name}</div>
          <div className="text-sm text-ink-secondary mt-0.5">{data.seller} · {shortDate(data.processed_date)}</div>
        </div>
        <StatusBadge status={data.reconciliation_status} />

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Type</div>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => setType.mutate(t)}
                disabled={setType.isPending}
                className={`rounded-md px-2.5 py-1 text-xs font-medium border transition disabled:opacity-50 ${
                  (data.product_type || 'Unreviewed') === t ? 'border-accent bg-accent/10 text-accent' : 'border-hairline text-ink-secondary hover:bg-surface-2'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted mt-1.5">Set by the title classifier — change it here if it's wrong; your choice sticks.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Order ID" value={data.order_id} />
          <Field label="Order status" value={data.order_status} />
          <Field label="Quantity purchased" value={num(data.quantity_purchased)} />
          <Field label="Total paid" value={money(data.total_paid)} />
          <Field label="Unit cost" value={money(data.unit_cost)} />
          <Field label="Confirmed allocated qty" value={num(data.confirmed_allocated_quantity)} />
          <Field label="Remaining quantity" value={num(data.remaining_quantity)} />
          <Field label="Remaining cost" value={money(data.remaining_cost)} />
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Cost links ({data.links.length})</div>
          {data.links.length === 0 ? (
            <p className="text-sm text-ink-muted">Not linked to inventory yet — link it from the Cost Basis Links page.</p>
          ) : (
            data.links.map((l: any) => (
              <div key={l.allocation_id} className="flex items-center justify-between py-1.5 border-b border-hairline last:border-0 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{l.inventory_product}</div>
                  <div className="text-xs text-ink-muted">{l.inventory_lot_id} · {money(l.allocated_cost)} for {num(l.allocated_quantity)}</div>
                </div>
                <StatusBadge status={l.allocation_status} />
              </div>
            ))
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div>{value ?? '—'}</div>
    </div>
  );
}

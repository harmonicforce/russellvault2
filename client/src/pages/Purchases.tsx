import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type Page, type WhatnotPurchase } from '../lib/api';
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

export default function Purchases() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [seller, setSeller] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [sortKey, setSortKey] = useState('processed_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 50;

  const { data: facets } = useQuery({ queryKey: ['purchases-facets'], queryFn: () => get<Facets>('/purchases/facets') });

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', debouncedSearch, seller, reconciliationStatus, sortKey, sortOrder, page],
    queryFn: () =>
      get<Page<WhatnotPurchase>>('/purchases', {
        q: debouncedSearch, seller, reconciliationStatus, sort: sortKey, order: sortOrder, page, pageSize,
      }),
  });

  function handleSort(key: string) {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortOrder('desc'); }
  }

  const columns: Column<WhatnotPurchase>[] = [
    { key: 'acquisition_line_id', header: 'Line ID', width: '110px', render: (r) => <span className="font-mono text-xs">{r.acquisition_line_id}</span> },
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
  const { data } = useQuery({ queryKey: ['purchase-detail', id], queryFn: () => get<any>(`/purchases/${id}`) });
  if (!data) return <Drawer open onClose={onClose} title="Loading…"><div /></Drawer>;

  return (
    <Drawer open onClose={onClose} title={data.acquisition_line_id}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-lg font-semibold">{data.product_name}</div>
          <div className="text-sm text-ink-secondary mt-0.5">{data.seller} · {shortDate(data.processed_date)}</div>
        </div>
        <StatusBadge status={data.reconciliation_status} />
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

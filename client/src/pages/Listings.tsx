import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Tag, X as XIcon } from 'lucide-react';
import { get, patch, post, type EbayListing, type InventoryLot, type Page } from '../lib/api';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { Drawer } from '../components/Drawer';
import { FormField, inputCls } from '../components/Modal';
import { money, num, shortDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';

const LISTING_STATUSES = ['Draft', 'Ready to List', 'Active', 'Ended', 'Sold', 'Hold'];

export default function Listings() {
  const qc = useQueryClient();
  const [lotQuery, setLotQuery] = useState('');
  const debouncedLot = useDebounce(lotQuery);
  const [selectedLot, setSelectedLot] = useState<InventoryLot | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [condition, setCondition] = useState('');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const pageSize = 50;

  const { data: lotResults } = useQuery({
    queryKey: ['listing-lot-search', debouncedLot],
    queryFn: () => get<Page<InventoryLot>>('/inventory', { q: debouncedLot, pageSize: 8 }),
    enabled: debouncedLot.length > 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['listings', debouncedSearch, status, page],
    queryFn: () => get<Page<EbayListing>>('/listings', { q: debouncedSearch, status, page, pageSize }),
  });

  const createListing = useMutation({
    mutationFn: () =>
      post<EbayListing>('/listings', {
        inventory_lot_id: selectedLot!.inventory_lot_id,
        listing_title: title || undefined,
        list_price: price === '' ? undefined : Number(price),
        minimum_acceptable_price: minPrice === '' ? undefined : Number(minPrice),
        condition_or_item_state: condition || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedLot(null); setTitle(''); setPrice(''); setMinPrice(''); setCondition(''); setLotQuery('');
    },
  });

  const columns: Column<EbayListing>[] = [
    { key: 'listing_id', header: 'Listing ID', width: '110px', render: (r) => <span className="font-mono text-xs">{r.listing_id}</span> },
    { key: 'product_name', header: 'Product', render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.listing_title || r.product_name}</div>
          <div className="text-xs text-ink-muted font-mono">{r.inventory_lot_id}</div>
        </div>
      ) },
    { key: 'quantity_to_list', header: 'Qty', align: 'right', render: (r) => <span className="tabular-nums">{num(r.quantity_to_list)}</span> },
    { key: 'list_price', header: 'List price', align: 'right', render: (r) => <span className="tabular-nums">{money(r.list_price)}</span> },
    { key: 'listing_format', header: 'Format' },
    { key: 'listed_date', header: 'Listed', render: (r) => <span className="text-xs">{shortDate(r.listed_date)}</span> },
    { key: 'listing_status', header: 'Status', render: (r) => <StatusBadge status={r.listing_status} /> },
  ];

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">eBay Listings</h1>
        <p className="text-ink-secondary text-sm mt-1">Create, publish, and track listings from costed inventory.</p>
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <Tag className="h-4 w-4 text-accent" /> Quick list from inventory
        </div>
        <div className="relative mb-2 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <input
            value={lotQuery}
            onChange={(e) => setLotQuery(e.target.value)}
            placeholder="Search inventory by product…"
            className="w-full rounded-lg border border-hairline bg-surface-2 pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        {selectedLot ? (
          <div className="rounded-lg border border-accent/40 bg-accent/8 px-3 py-2.5 text-sm flex items-start justify-between gap-2 max-w-md mb-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{selectedLot.product_name}</div>
              <div className="text-xs text-ink-muted truncate">
                {selectedLot.inventory_lot_id} · {selectedLot.cost_status} · avail {selectedLot.available_quantity} · rec. value {money(selectedLot.recorded_unit_value)}
              </div>
            </div>
            <button onClick={() => setSelectedLot(null)} className="shrink-0 text-ink-muted hover:text-ink"><XIcon className="h-4 w-4" /></button>
          </div>
        ) : (
          debouncedLot.length > 1 && (
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto max-w-md mb-3">
              {(lotResults?.rows ?? []).map((r) => (
                <button
                  key={r.inventory_lot_id}
                  onClick={() => {
                    setSelectedLot(r);
                    setTitle(`${r.business_vertical || ''} ${r.product_name || ''}`.trim());
                    setPrice(r.recorded_unit_value != null ? String(r.recorded_unit_value) : '');
                  }}
                  className="text-left rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.product_name}</span>
                    <StatusBadge status={r.cost_status} />
                  </div>
                  <div className="text-xs text-ink-muted">{r.inventory_lot_id} · avail {r.available_quantity}</div>
                </button>
              ))}
              {(lotResults?.rows.length ?? 0) === 0 && <p className="text-xs text-ink-muted px-1">No matches.</p>}
            </div>
          )
        )}

        {selectedLot && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-hairline">
            <FormField label="Listing title">
              <input className={`${inputCls} w-72`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField label="List price">
              <input type="number" step="0.01" className={`${inputCls} w-28`} value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
            <FormField label="Minimum price">
              <input type="number" step="0.01" className={`${inputCls} w-28`} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
            </FormField>
            <FormField label="Condition">
              <input className={`${inputCls} w-40`} value={condition} onChange={(e) => setCondition(e.target.value)} />
            </FormField>
            <button
              onClick={() => createListing.mutate()}
              disabled={createListing.isPending}
              className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-accent-strong disabled:opacity-50"
            >
              {createListing.isPending ? 'Creating…' : 'Create draft listing'}
            </button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.listing_id}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search listings…"
        onRowClick={(r) => setSelectedListingId(r.listing_id)}
        filters={
          <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder="All statuses"
            options={LISTING_STATUSES.map((s) => ({ value: s, label: s }))} />
        }
      />

      {selectedListingId && <ListingDetail id={selectedListingId} onClose={() => setSelectedListingId(null)} />}
    </div>
  );
}

function ListingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: listing } = useQuery({ queryKey: ['listing-detail', id], queryFn: () => get<EbayListing>(`/listings/${id}`) });

  const updateListing = useMutation({
    mutationFn: (body: any) => patch(`/listings/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['listing-detail', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (!listing) return <Drawer open onClose={onClose} title="Loading…"><div /></Drawer>;

  return (
    <Drawer open onClose={onClose} title={listing.listing_id}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-lg font-semibold">{listing.listing_title || listing.product_name}</div>
          <div className="text-sm text-ink-secondary mt-0.5 font-mono">{listing.inventory_lot_id}</div>
        </div>

        <FormField label="Listing status">
          <select
            className={inputCls}
            value={listing.listing_status}
            onChange={(e) => updateListing.mutate({ listing_status: e.target.value })}
          >
            {LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="List price">
            <input type="number" step="0.01" className={inputCls} defaultValue={listing.list_price ?? ''}
              onBlur={(e) => updateListing.mutate({ list_price: e.target.value === '' ? null : Number(e.target.value) })} />
          </FormField>
          <FormField label="Minimum price">
            <input type="number" step="0.01" className={inputCls} defaultValue={listing.minimum_acceptable_price ?? ''}
              onBlur={(e) => updateListing.mutate({ minimum_acceptable_price: e.target.value === '' ? null : Number(e.target.value) })} />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Quantity to list" value={num(listing.quantity_to_list)} />
          <Field label="Available at lot" value={num(listing.available_quantity)} />
          <Field label="Condition" value={listing.condition_or_item_state} />
          <Field label="Format" value={listing.listing_format} />
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

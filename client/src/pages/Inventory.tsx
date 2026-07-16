import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { get, patch, post, type InventoryLot, type Lookups, type Page } from '../lib/api';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { Drawer } from '../components/Drawer';
import { Modal, FormField, inputCls } from '../components/Modal';
import { money, num, shortDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';

interface Facets {
  business_vertical: { value: string; n: number }[];
  category: { value: string; n: number }[];
  cost_status: { value: string; n: number }[];
  listing_status: { value: string; n: number }[];
}

export default function Inventory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [vertical, setVertical] = useState('');
  const [category, setCategory] = useState('');
  const [costStatus, setCostStatus] = useState('');
  const [listingStatus, setListingStatus] = useState('');
  const [sortKey, setSortKey] = useState('inventory_lot_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const pageSize = 50;

  const { data: facets } = useQuery({ queryKey: ['inventory-facets'], queryFn: () => get<Facets>('/inventory/facets') });
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => get<Lookups>('/lookups') });

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', debouncedSearch, vertical, category, costStatus, listingStatus, sortKey, sortOrder, page],
    queryFn: () =>
      get<Page<InventoryLot>>('/inventory', {
        q: debouncedSearch, vertical, category, costStatus, listingStatus,
        sort: sortKey, order: sortOrder, page, pageSize,
      }),
  });

  function handleSort(key: string) {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortOrder('asc'); }
  }

  const columns: Column<InventoryLot>[] = [
    { key: 'inventory_lot_id', header: 'Lot ID', sortable: true, width: '110px', render: (r) => <span className="font-mono text-xs">{r.inventory_lot_id}</span> },
    {
      key: 'product_name', header: 'Product', sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.product_name || '—'}</div>
          <div className="text-xs text-ink-muted truncate">{[r.variant_model_set, r.featured_subject].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { key: 'business_vertical', header: 'Vertical / Category', sortable: true, render: (r) => (
        <div className="text-xs">
          <div>{r.business_vertical || '—'}</div>
          <div className="text-ink-muted">{r.category}</div>
        </div>
      ) },
    { key: 'available_quantity', header: 'Avail / Qty', sortable: true, align: 'right', render: (r) => (
        <span className="tabular-nums">{num(r.available_quantity)} / {num(r.quantity)}</span>
      ) },
    { key: 'recorded_unit_value', header: 'Value', sortable: true, align: 'right', render: (r) => <span className="tabular-nums">{money(r.recorded_unit_value)}</span> },
    { key: 'cost_status', header: 'Cost', sortable: true, render: (r) => <StatusBadge status={r.cost_status} /> },
    { key: 'listing_status', header: 'Listing', sortable: true, render: (r) => <StatusBadge status={r.listing_status} /> },
    { key: 'location_code', header: 'Location', render: (r) => <span className="text-xs text-ink-muted">{r.location_code || '—'}</span> },
  ];

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-ink-secondary text-sm mt-1">{data ? `${data.total.toLocaleString()} lots` : '—'}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-accent-strong"
        >
          <Plus className="h-4 w-4" /> Add inventory
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.inventory_lot_id}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSortChange={(k) => { handleSort(k); }}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search product, lot ID, SKU, location…"
        onRowClick={(r) => setSelectedId(r.inventory_lot_id)}
        filters={
          <>
            <Select value={vertical} onChange={(v) => { setVertical(v); setPage(1); }} placeholder="All verticals"
              options={(facets?.business_vertical ?? []).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
            <Select value={category} onChange={(v) => { setCategory(v); setPage(1); }} placeholder="All categories"
              options={(facets?.category ?? []).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
            <Select value={costStatus} onChange={(v) => { setCostStatus(v); setPage(1); }} placeholder="All cost status"
              options={(facets?.cost_status ?? []).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
            <Select value={listingStatus} onChange={(v) => { setListingStatus(v); setPage(1); }} placeholder="All listing status"
              options={(facets?.listing_status ?? []).map((f) => ({ value: f.value, label: `${f.value} (${f.n})` }))} />
          </>
        }
      />

      {selectedId && (
        <InventoryDetail id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => {
          qc.invalidateQueries({ queryKey: ['inventory'] });
          qc.invalidateQueries({ queryKey: ['inventory-facets'] });
        }} />
      )}

      {showAdd && (
        <AddInventoryModal
          lookups={lookups}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ['inventory'] });
            qc.invalidateQueries({ queryKey: ['inventory-facets'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function InventoryDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['inventory-detail', id], queryFn: () => get<any>(`/inventory/${id}`) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const mutation = useMutation({
    mutationFn: (body: any) => patch(`/inventory/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-detail', id] });
      onChanged();
      setEditing(false);
    },
  });

  if (!data) return <Drawer open onClose={onClose} title="Loading…"><div /></Drawer>;

  function startEdit() {
    setForm({
      product_name: data.product_name ?? '', quantity: data.quantity ?? 0,
      recorded_unit_value: data.recorded_unit_value ?? '', location_code: data.location_code ?? '',
      condition_or_quality: data.condition_or_quality ?? '', owner_notes: data.owner_notes ?? '',
    });
    setEditing(true);
  }

  return (
    <Drawer open onClose={onClose} title={data.inventory_lot_id}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <StatusBadge status={data.cost_status} />
            <StatusBadge status={data.listing_status} />
          </div>
          {!editing && (
            <button onClick={startEdit} className="text-sm text-accent-strong hover:underline">Edit</button>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-3">
            <FormField label="Product name">
              <input className={inputCls} value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Quantity">
                <input type="number" className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </FormField>
              <FormField label="Recorded unit value">
                <input type="number" step="0.01" className={inputCls} value={form.recorded_unit_value} onChange={(e) => setForm({ ...form, recorded_unit_value: e.target.value })} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Location code">
                <input className={inputCls} value={form.location_code} onChange={(e) => setForm({ ...form, location_code: e.target.value })} />
              </FormField>
              <FormField label="Condition">
                <input className={inputCls} value={form.condition_or_quality} onChange={(e) => setForm({ ...form, condition_or_quality: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Owner notes">
              <textarea className={inputCls} rows={2} value={form.owner_notes} onChange={(e) => setForm({ ...form, owner_notes: e.target.value })} />
            </FormField>
            <div className="flex gap-2">
              <button
                onClick={() => mutation.mutate({
                  ...form,
                  quantity: Number(form.quantity),
                  recorded_unit_value: form.recorded_unit_value === '' ? null : Number(form.recorded_unit_value),
                })}
                disabled={mutation.isPending}
                className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-accent-strong disabled:opacity-50"
              >
                Save changes
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-hairline px-3.5 py-2 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-lg font-semibold">{data.product_name || 'Untitled lot'}</div>
            <div className="text-sm text-ink-secondary mt-0.5">
              {[data.variant_model_set, data.featured_subject, data.card_number].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="SKU" value={data.sellable_sku} mono />
          <Field label="Vertical" value={data.business_vertical} />
          <Field label="Category" value={data.category} />
          <Field label="Tracking mode" value={data.tracking_mode} />
          <Field label="Quantity" value={`${num(data.available_quantity)} available / ${num(data.quantity)} total`} />
          <Field label="Recorded value" value={money(data.recorded_unit_value)} />
          <Field label="Confirmed cost basis" value={money(data.confirmed_cost_basis)} />
          <Field label="Location" value={data.location_code} />
          <Field label="Date received" value={shortDate(data.date_received)} />
          <Field label="Record origin" value={data.record_origin} />
        </div>

        <Section title={`Cost basis links (${data.links.length})`}>
          {data.links.length === 0 ? (
            <EmptyNote text="Not linked to a Whatnot purchase yet." />
          ) : (
            data.links.map((l: any) => (
              <div key={l.allocation_id} className="flex items-center justify-between py-1.5 border-b border-hairline last:border-0 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{l.purchase_product}</div>
                  <div className="text-xs text-ink-muted">{l.seller} · {money(l.allocated_cost)} for {num(l.allocated_quantity)}</div>
                </div>
                <StatusBadge status={l.allocation_status} />
              </div>
            ))
          )}
        </Section>

        <Section title={`eBay listings (${data.listings.length})`}>
          {data.listings.length === 0 ? (
            <EmptyNote text="No eBay listing created yet." />
          ) : (
            data.listings.map((l: any) => (
              <div key={l.listing_id} className="flex items-center justify-between py-1.5 border-b border-hairline last:border-0 text-sm">
                <div className="min-w-0 truncate">{l.listing_title || l.product_name}</div>
                <StatusBadge status={l.listing_status} />
              </div>
            ))
          )}
        </Section>

        <Section title={`Sales (${data.sales.length})`}>
          {data.sales.length === 0 ? (
            <EmptyNote text="Not sold yet." />
          ) : (
            data.sales.map((s: any) => (
              <div key={s.sale_id} className="flex items-center justify-between py-1.5 border-b border-hairline last:border-0 text-sm">
                <div>{shortDate(s.sold_date)} · qty {s.quantity_sold}</div>
                <div className="tabular-nums">{money(s.net_proceeds)}</div>
              </div>
            ))
          )}
        </Section>

        {data.owner_notes && !editing && (
          <Section title="Owner notes">
            <p className="text-sm text-ink-secondary">{data.owner_notes}</p>
          </Section>
        )}
      </div>
    </Drawer>
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={mono ? 'font-mono text-xs' : ''}>{value || '—'}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-ink-muted">{text}</p>;
}

function AddInventoryModal({ lookups, onClose, onCreated }: { lookups?: Lookups; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    product_name: '', business_vertical: '', category: '', variant_model_set: '', featured_subject: '',
    quantity: 1, tracking_mode: 'Lot-managed', condition_or_quality: '', location_code: '',
    recorded_unit_value: '', date_received: new Date().toISOString().slice(0, 10), owner_notes: '',
  });

  const mutation = useMutation({
    mutationFn: () => post('/inventory', { ...form, recorded_unit_value: form.recorded_unit_value === '' ? null : Number(form.recorded_unit_value) }),
    onSuccess: onCreated,
  });

  return (
    <Modal open onClose={onClose} title="Add inventory" width="max-w-xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      >
        <FormField label="Product name">
          <input required className={inputCls} value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Business vertical">
            <input list="verticals" className={inputCls} value={form.business_vertical} onChange={(e) => setForm({ ...form, business_vertical: e.target.value })} />
            <datalist id="verticals">{(lookups?.['Business Vertical'] ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </FormField>
          <FormField label="Category">
            <input list="categories" className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="categories">{(lookups?.['Category'] ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Variant / set">
            <input className={inputCls} value={form.variant_model_set} onChange={(e) => setForm({ ...form, variant_model_set: e.target.value })} />
          </FormField>
          <FormField label="Featured subject">
            <input className={inputCls} value={form.featured_subject} onChange={(e) => setForm({ ...form, featured_subject: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Quantity">
            <input type="number" min={1} className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </FormField>
          <FormField label="Tracking mode">
            <select className={inputCls} value={form.tracking_mode} onChange={(e) => setForm({ ...form, tracking_mode: e.target.value })}>
              {(lookups?.['Tracking Mode'] ?? ['Lot-managed', 'Serialized']).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </FormField>
          <FormField label="Recorded unit value">
            <input type="number" step="0.01" className={inputCls} value={form.recorded_unit_value} onChange={(e) => setForm({ ...form, recorded_unit_value: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Condition / quality">
            <input className={inputCls} value={form.condition_or_quality} onChange={(e) => setForm({ ...form, condition_or_quality: e.target.value })} />
          </FormField>
          <FormField label="Location code">
            <input className={inputCls} value={form.location_code} onChange={(e) => setForm({ ...form, location_code: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Date received">
          <input type="date" className={inputCls} value={form.date_received} onChange={(e) => setForm({ ...form, date_received: e.target.value })} />
        </FormField>
        <FormField label="Owner notes">
          <textarea rows={2} className={inputCls} value={form.owner_notes} onChange={(e) => setForm({ ...form, owner_notes: e.target.value })} />
        </FormField>
        {mutation.isError && <p className="text-sm text-critical">{(mutation.error as Error).message}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={mutation.isPending} className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-accent-strong disabled:opacity-50">
            {mutation.isPending ? 'Adding…' : 'Add lot'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-hairline px-3.5 py-2 text-sm">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

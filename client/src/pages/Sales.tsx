import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Search, X as XIcon } from 'lucide-react';
import { get, patch, post, type InventoryLot, type Page, type Sale } from '../lib/api';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Drawer } from '../components/Drawer';
import { FormField, inputCls } from '../components/Modal';
import { money, num, shortDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';

const PAYMENT_STATUSES = ['Not Paid', 'Paid', 'Partially Refunded', 'Refunded'];
const FULFILLMENT_STATUSES = ['Not Packed', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'];

const emptySaleForm = {
  quantity_sold: 1, gross_item_price: '', shipping_charged: '', sales_tax_collected: '',
  ebay_fees: '', promotion_fees: '', shipping_label_cost: '', refund_amount: '', other_expense: '',
  sold_date: new Date().toISOString().slice(0, 10), ebay_order_id: '',
};

export default function Sales() {
  const qc = useQueryClient();
  const [lotQuery, setLotQuery] = useState('');
  const debouncedLot = useDebounce(lotQuery);
  const [selectedLot, setSelectedLot] = useState<InventoryLot | null>(null);
  const [form, setForm] = useState(emptySaleForm);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const pageSize = 50;

  const { data: lotResults } = useQuery({
    queryKey: ['sale-lot-search', debouncedLot],
    queryFn: () => get<Page<InventoryLot>>('/inventory', { q: debouncedLot, pageSize: 8 }),
    enabled: debouncedLot.length > 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sales', debouncedSearch, page],
    queryFn: () => get<Page<Sale>>('/sales', { q: debouncedSearch, page, pageSize }),
  });

  const num2 = (v: string) => (v === '' ? 0 : Number(v));
  const netPreview =
    num2(form.gross_item_price) + num2(form.shipping_charged) + num2(form.sales_tax_collected) -
    num2(form.ebay_fees) - num2(form.promotion_fees) - num2(form.shipping_label_cost) -
    num2(form.refund_amount) - num2(form.other_expense);

  const createSale = useMutation({
    mutationFn: () =>
      post<Sale>('/sales', {
        inventory_lot_id: selectedLot!.inventory_lot_id,
        quantity_sold: Number(form.quantity_sold),
        gross_item_price: num2(form.gross_item_price),
        shipping_charged: num2(form.shipping_charged),
        sales_tax_collected: num2(form.sales_tax_collected),
        ebay_fees: num2(form.ebay_fees),
        promotion_fees: num2(form.promotion_fees),
        shipping_label_cost: num2(form.shipping_label_cost),
        refund_amount: num2(form.refund_amount),
        other_expense: num2(form.other_expense),
        sold_date: form.sold_date,
        ebay_order_id: form.ebay_order_id || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedLot(null); setForm(emptySaleForm); setLotQuery('');
    },
  });

  const columns: Column<Sale>[] = [
    { key: 'sale_id', header: 'Sale ID', width: '110px', render: (r) => <span className="font-mono text-xs">{r.sale_id}</span> },
    { key: 'product_name', header: 'Product', render: (r) => <div className="truncate max-w-xs">{r.product_name}</div> },
    { key: 'sold_date', header: 'Sold', render: (r) => <span className="text-xs">{shortDate(r.sold_date)}</span> },
    { key: 'quantity_sold', header: 'Qty', align: 'right', render: (r) => <span className="tabular-nums">{num(r.quantity_sold)}</span> },
    { key: 'gross_item_price', header: 'Gross', align: 'right', render: (r) => <span className="tabular-nums">{money(r.gross_item_price)}</span> },
    { key: 'net_proceeds', header: 'Net proceeds', align: 'right', render: (r) => <span className="tabular-nums">{money(r.net_proceeds)}</span> },
    { key: 'profit_after_known_costs', header: 'Profit', align: 'right', render: (r) => <span className="tabular-nums">{money(r.profit_after_known_costs)}</span> },
    { key: 'profit_status', header: 'Profit status', render: (r) => <StatusBadge status={r.profit_status} /> },
    { key: 'payment_status', header: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> },
    { key: 'fulfillment_status', header: 'Fulfillment', render: (r) => <StatusBadge status={r.fulfillment_status} /> },
  ];

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="text-ink-secondary text-sm mt-1">Record proceeds, fees, and fulfillment. Profit is provisional until cost basis is confirmed.</p>
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <DollarSign className="h-4 w-4 text-accent" /> Record a sale
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
                {selectedLot.inventory_lot_id} · avail {selectedLot.available_quantity} · {selectedLot.cost_status}
              </div>
            </div>
            <button onClick={() => setSelectedLot(null)} className="shrink-0 text-ink-muted hover:text-ink"><XIcon className="h-4 w-4" /></button>
          </div>
        ) : (
          debouncedLot.length > 1 && (
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto max-w-md mb-3">
              {(lotResults?.rows ?? []).filter((r) => r.available_quantity > 0).map((r) => (
                <button
                  key={r.inventory_lot_id}
                  onClick={() => setSelectedLot(r)}
                  className="text-left rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.product_name}</span>
                    <StatusBadge status={r.cost_status} />
                  </div>
                  <div className="text-xs text-ink-muted">{r.inventory_lot_id} · avail {r.available_quantity}</div>
                </button>
              ))}
              {(lotResults?.rows ?? []).filter((r) => r.available_quantity > 0).length === 0 && (
                <p className="text-xs text-ink-muted px-1">No available matches.</p>
              )}
            </div>
          )
        )}

        {selectedLot && (
          <div className="flex flex-col gap-3 pt-3 border-t border-hairline">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FormField label="Quantity sold">
                <input type="number" min={1} max={selectedLot.available_quantity} className={inputCls}
                  value={form.quantity_sold} onChange={(e) => setForm({ ...form, quantity_sold: Number(e.target.value) })} />
              </FormField>
              <FormField label="Sold date">
                <input type="date" className={inputCls} value={form.sold_date} onChange={(e) => setForm({ ...form, sold_date: e.target.value })} />
              </FormField>
              <FormField label="eBay order ID">
                <input className={inputCls} value={form.ebay_order_id} onChange={(e) => setForm({ ...form, ebay_order_id: e.target.value })} />
              </FormField>
              <FormField label="Gross item price">
                <input type="number" step="0.01" className={inputCls} value={form.gross_item_price} onChange={(e) => setForm({ ...form, gross_item_price: e.target.value })} />
              </FormField>
              <FormField label="Shipping charged">
                <input type="number" step="0.01" className={inputCls} value={form.shipping_charged} onChange={(e) => setForm({ ...form, shipping_charged: e.target.value })} />
              </FormField>
              <FormField label="Sales tax collected">
                <input type="number" step="0.01" className={inputCls} value={form.sales_tax_collected} onChange={(e) => setForm({ ...form, sales_tax_collected: e.target.value })} />
              </FormField>
              <FormField label="eBay fees">
                <input type="number" step="0.01" className={inputCls} value={form.ebay_fees} onChange={(e) => setForm({ ...form, ebay_fees: e.target.value })} />
              </FormField>
              <FormField label="Promotion fees">
                <input type="number" step="0.01" className={inputCls} value={form.promotion_fees} onChange={(e) => setForm({ ...form, promotion_fees: e.target.value })} />
              </FormField>
              <FormField label="Shipping label cost">
                <input type="number" step="0.01" className={inputCls} value={form.shipping_label_cost} onChange={(e) => setForm({ ...form, shipping_label_cost: e.target.value })} />
              </FormField>
              <FormField label="Refund amount">
                <input type="number" step="0.01" className={inputCls} value={form.refund_amount} onChange={(e) => setForm({ ...form, refund_amount: e.target.value })} />
              </FormField>
              <FormField label="Other expense">
                <input type="number" step="0.01" className={inputCls} value={form.other_expense} onChange={(e) => setForm({ ...form, other_expense: e.target.value })} />
              </FormField>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <div className="text-sm">
                Net proceeds preview: <span className="font-semibold tabular-nums">{money(netPreview)}</span>
              </div>
              <button
                onClick={() => createSale.mutate()}
                disabled={createSale.isPending}
                className="rounded-lg bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:bg-accent-strong disabled:opacity-50"
              >
                {createSale.isPending ? 'Recording…' : 'Record sale'}
              </button>
              {createSale.isError && <p className="text-sm text-critical">{(createSale.error as Error).message}</p>}
            </div>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.sale_id}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search sales…"
        onRowClick={(r) => setSelectedSaleId(r.sale_id)}
        emptyLabel="No sales recorded yet."
      />

      {selectedSaleId && <SaleDetail id={selectedSaleId} onClose={() => setSelectedSaleId(null)} />}
    </div>
  );
}

function SaleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: sale } = useQuery({ queryKey: ['sale-detail', id], queryFn: () => get<Sale>(`/sales/${id}`) });

  const updateSale = useMutation({
    mutationFn: (body: any) => patch(`/sales/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sale-detail', id] });
    },
  });

  if (!sale) return <Drawer open onClose={onClose} title="Loading…"><div /></Drawer>;

  return (
    <Drawer open onClose={onClose} title={sale.sale_id}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-lg font-semibold">{sale.product_name}</div>
          <div className="text-sm text-ink-secondary mt-0.5">{shortDate(sale.sold_date)} · qty {sale.quantity_sold}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Gross item price" value={money(sale.gross_item_price)} />
          <Field label="Net proceeds" value={money(sale.net_proceeds)} />
          <Field label="Known cost basis applied" value={money(sale.known_cost_basis_applied)} />
          <Field label="Profit" value={money(sale.profit_after_known_costs)} />
        </div>
        <StatusBadge status={sale.profit_status} />

        <FormField label="Payment status">
          <select className={inputCls} value={sale.payment_status} onChange={(e) => updateSale.mutate({ payment_status: e.target.value })}>
            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Fulfillment status">
          <select className={inputCls} value={sale.fulfillment_status} onChange={(e) => updateSale.mutate({ fulfillment_status: e.target.value })}>
            {FULFILLMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Tracking number">
          <input className={inputCls} defaultValue={sale.tracking_number ?? ''} onBlur={(e) => updateSale.mutate({ tracking_number: e.target.value })} />
        </FormField>
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

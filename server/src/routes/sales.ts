import { Router } from 'express';
import { db } from '../db.js';
import { nextId } from '../ids.js';
import { ValidationError, requirePositiveInteger, sendValidationError } from '../validation.js';

const router = Router();

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.get('/', (req, res) => {
  const { q, status, page = '1', pageSize = '50', sort = 'sold_date', order = 'desc' } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: Record<string, any> = {};
  if (q) {
    where.push('(product_name LIKE @q OR sale_id LIKE @q OR sellable_sku LIKE @q OR ebay_order_id LIKE @q)');
    params.q = `%${q}%`;
  }
  if (status) { where.push('profit_status = @status'); params.status = status; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTABLE = new Set(['sold_date', 'created_at', 'gross_item_price', 'profit_after_known_costs', 'product_name']);
  const sortCol = SORTABLE.has(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) as n FROM sales ${whereSql}`).get(params) as any).n;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pg - 1) * ps;
  const rows = db.prepare(`SELECT * FROM sales ${whereSql} ORDER BY ${sortCol} ${sortOrder} LIMIT @limit OFFSET @offset`).all({ ...params, limit: ps, offset });
  res.json({ rows, total, page: pg, pageSize: ps });
});

// Core creation logic, exported so regression tests can exercise it directly.
export function createSale(body: any) {
  const b = body || {};
  if (!b.inventory_lot_id) throw new ValidationError('inventory_lot_id is required');

  return db.transaction(() => {
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(b.inventory_lot_id) as any;
    if (!lot) throw new ValidationError('inventory lot not found', 404);

    // Previously `Number(b.quantity_sold) || 1`: a zero or missing value fell
    // back to 1 silently, and a negative value (e.g. -5) is truthy in JS so it
    // passed straight through unrejected, corrupting sold/available totals.
    const quantitySold = requirePositiveInteger(b.quantity_sold ?? 1, 'quantity_sold');
    const available = Number(lot.available_quantity) || 0;
    if (quantitySold > available) {
      throw new ValidationError(`only ${available} unit(s) available for this lot`, 409);
    }

    const grossItemPrice = Number(b.gross_item_price) || 0;
    const shippingCharged = Number(b.shipping_charged) || 0;
    const salesTax = Number(b.sales_tax_collected) || 0;
    const ebayFees = Number(b.ebay_fees) || 0;
    const promotionFees = Number(b.promotion_fees) || 0;
    const shippingLabelCost = Number(b.shipping_label_cost) || 0;
    const refundAmount = Number(b.refund_amount) || 0;
    const otherExpense = Number(b.other_expense) || 0;

    const netProceeds = grossItemPrice + shippingCharged + salesTax - ebayFees - promotionFees - shippingLabelCost - refundAmount - otherExpense;

    const lotQty = Number(lot.quantity) || 0;
    const costBasis = Number(lot.confirmed_cost_basis) || 0;
    const isCosted = lot.cost_status === 'Costed';
    const isPartial = lot.cost_status === 'Partially Costed';
    const knownCostBasisApplied = lotQty > 0 && (isCosted || isPartial) ? (costBasis / lotQty) * quantitySold : 0;
    const profitStatus = isCosted ? 'Confirmed' : isPartial ? 'Provisional' : 'Unavailable';
    const profitAfterKnownCosts = profitStatus === 'Unavailable' ? null : netProceeds - knownCostBasisApplied;

    const saleId = nextId('sales', 'sale_id', 'RV-SALE-');

    db.prepare(`
      INSERT INTO sales (
        sale_id, listing_id, inventory_lot_id, sellable_sku, product_name, ebay_order_id, sold_date,
        quantity_sold, gross_item_price, shipping_charged, sales_tax_collected, ebay_fees, promotion_fees,
        shipping_label_cost, refund_amount, other_expense, net_proceeds, known_cost_basis_applied,
        profit_after_known_costs, profit_status, payment_status, fulfillment_status, tracking_number,
        delivered_date, return_status, owner_notes, row_status
      ) VALUES (
        @sale_id, @listing_id, @inventory_lot_id, @sellable_sku, @product_name, @ebay_order_id, @sold_date,
        @quantity_sold, @gross_item_price, @shipping_charged, @sales_tax_collected, @ebay_fees, @promotion_fees,
        @shipping_label_cost, @refund_amount, @other_expense, @net_proceeds, @known_cost_basis_applied,
        @profit_after_known_costs, @profit_status, @payment_status, @fulfillment_status, @tracking_number,
        @delivered_date, @return_status, @owner_notes, 'RECORDED'
      )
    `).run({
      sale_id: saleId,
      listing_id: b.listing_id ?? null,
      inventory_lot_id: b.inventory_lot_id,
      sellable_sku: lot.sellable_sku,
      product_name: lot.product_name,
      ebay_order_id: b.ebay_order_id ?? null,
      sold_date: b.sold_date || new Date().toISOString().slice(0, 10),
      quantity_sold: quantitySold,
      gross_item_price: grossItemPrice,
      shipping_charged: shippingCharged,
      sales_tax_collected: salesTax,
      ebay_fees: ebayFees,
      promotion_fees: promotionFees,
      shipping_label_cost: shippingLabelCost,
      refund_amount: refundAmount,
      other_expense: otherExpense,
      net_proceeds: netProceeds,
      known_cost_basis_applied: knownCostBasisApplied,
      profit_after_known_costs: profitAfterKnownCosts,
      profit_status: profitStatus,
      payment_status: b.payment_status ?? 'Not Paid',
      fulfillment_status: b.fulfillment_status ?? 'Not Packed',
      tracking_number: b.tracking_number ?? null,
      delivered_date: b.delivered_date ?? null,
      return_status: b.return_status ?? null,
      owner_notes: b.owner_notes ?? null,
    });

    const newSold = (Number(lot.sold_quantity) || 0) + quantitySold;
    const newAvailable = Math.max(0, lotQty - newSold);
    const newListingStatus = newAvailable <= 0 ? 'Sold' : lot.listing_status;
    db.prepare(`UPDATE inventory_lots SET sold_quantity = ?, available_quantity = ?, listing_status = ?, updated_at = datetime('now') WHERE inventory_lot_id = ?`)
      .run(newSold, newAvailable, newListingStatus, b.inventory_lot_id);

    if (b.listing_id) {
      db.prepare(`UPDATE ebay_listings SET listing_status = CASE WHEN @avail <= 0 THEN 'Sold' ELSE listing_status END, updated_at = datetime('now') WHERE listing_id = @listingId`)
        .run({ avail: newAvailable, listingId: b.listing_id });
    }

    return db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(saleId);
  })();
}

router.post('/', (req, res) => {
  try {
    const row = createSale(req.body);
    res.status(201).json(row);
  } catch (err) {
    if (sendValidationError(res, err)) return;
    throw err;
  }
});

const EDITABLE = ['payment_status', 'fulfillment_status', 'tracking_number', 'delivered_date', 'return_status', 'owner_notes', 'ebay_order_id'];

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const updates: Record<string, any> = {};
  for (const f of EDITABLE) if (f in req.body) updates[f] = req.body[f];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no editable fields provided' });
  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE sales SET ${setSql}, updated_at = datetime('now') WHERE sale_id = @id`).run({ ...updates, id: req.params.id });
  const row = db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(req.params.id);
  res.json(row);
});

export default router;

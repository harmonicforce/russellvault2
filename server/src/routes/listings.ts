import { Router } from 'express';
import { db } from '../db.js';
import { nextId } from '../ids.js';
import { ValidationError, requirePositiveInteger, sendValidationError } from '../validation.js';

const router = Router();

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ebay_listings WHERE listing_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.get('/', (req, res) => {
  const { q, status, page = '1', pageSize = '50', sort = 'created_at', order = 'desc' } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: Record<string, any> = {};
  if (q) {
    where.push('(product_name LIKE @q OR listing_id LIKE @q OR sellable_sku LIKE @q OR listing_title LIKE @q)');
    params.q = `%${q}%`;
  }
  if (status) { where.push('listing_status = @status'); params.status = status; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTABLE = new Set(['created_at', 'listed_date', 'list_price', 'product_name', 'listing_status']);
  const sortCol = SORTABLE.has(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) as n FROM ebay_listings ${whereSql}`).get(params) as any).n;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pg - 1) * ps;
  const rows = db.prepare(`SELECT * FROM ebay_listings ${whereSql} ORDER BY ${sortCol} ${sortOrder} LIMIT @limit OFFSET @offset`).all({ ...params, limit: ps, offset });
  res.json({ rows, total, page: pg, pageSize: ps });
});

// Core creation logic, exported so regression tests can exercise it directly.
export function createListing(body: any) {
  const b = body || {};
  if (!b.inventory_lot_id) throw new ValidationError('inventory_lot_id is required');
  const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(b.inventory_lot_id) as any;
  if (!lot) throw new ValidationError('inventory lot not found', 404);

  const qtyToList = requirePositiveInteger(
    b.quantity_to_list != null ? b.quantity_to_list : (Number(lot.available_quantity) || 1),
    'quantity_to_list',
  );

  const listingId = nextId('ebay_listings', 'listing_id', 'RV-LST-');

  db.prepare(`
    INSERT INTO ebay_listings (
      listing_id, inventory_lot_id, sellable_sku, product_name, available_quantity, quantity_to_list,
      listing_title, condition_or_item_state, list_price, minimum_acceptable_price, photos_complete,
      shipping_policy, return_policy, listing_format, best_offer, promotion_rate_percent,
      ebay_category_id, listing_status, owner_notes, row_status
    ) VALUES (
      @listing_id, @inventory_lot_id, @sellable_sku, @product_name, @available_quantity, @quantity_to_list,
      @listing_title, @condition_or_item_state, @list_price, @minimum_acceptable_price, @photos_complete,
      @shipping_policy, @return_policy, @listing_format, @best_offer, @promotion_rate_percent,
      @ebay_category_id, 'Draft', @owner_notes, 'NEXT — CONDITION'
    )
  `).run({
    listing_id: listingId,
    inventory_lot_id: b.inventory_lot_id,
    sellable_sku: lot.sellable_sku,
    product_name: lot.product_name,
    available_quantity: lot.available_quantity,
    quantity_to_list: qtyToList,
    listing_title: b.listing_title || `${lot.business_vertical || ''} ${lot.product_name || ''}`.trim(),
    condition_or_item_state: b.condition_or_item_state ?? null,
    list_price: b.list_price != null ? Number(b.list_price) : null,
    minimum_acceptable_price: b.minimum_acceptable_price != null ? Number(b.minimum_acceptable_price) : null,
    photos_complete: b.photos_complete ?? 'No',
    shipping_policy: b.shipping_policy ?? null,
    return_policy: b.return_policy ?? null,
    listing_format: b.listing_format ?? 'Fixed Price',
    best_offer: b.best_offer ?? null,
    promotion_rate_percent: b.promotion_rate_percent != null ? Number(b.promotion_rate_percent) : null,
    ebay_category_id: b.ebay_category_id ?? null,
    owner_notes: b.owner_notes ?? null,
  });

  db.prepare(`UPDATE inventory_lots SET listing_status = 'Has draft', updated_at = datetime('now') WHERE inventory_lot_id = ?`).run(b.inventory_lot_id);

  return db.prepare('SELECT * FROM ebay_listings WHERE listing_id = ?').get(listingId);
}

router.post('/', (req, res) => {
  try {
    const row = createListing(req.body);
    res.status(201).json(row);
  } catch (err) {
    if (sendValidationError(res, err)) return;
    throw err;
  }
});

const EDITABLE = [
  'listing_title', 'condition_or_item_state', 'list_price', 'minimum_acceptable_price', 'photos_complete',
  'photo_reference', 'shipping_policy', 'return_policy', 'listing_format', 'best_offer',
  'promotion_rate_percent', 'ebay_category_id', 'ebay_item_id', 'listing_url', 'listed_date',
  'listing_status', 'owner_notes', 'quantity_to_list',
];

export function updateListing(id: string, body: any) {
  const existing = db.prepare('SELECT * FROM ebay_listings WHERE listing_id = ?').get(id) as any;
  if (!existing) throw new ValidationError('not found', 404);
  const updates: Record<string, any> = {};
  for (const f of EDITABLE) if (f in body) updates[f] = body[f];
  if (Object.keys(updates).length === 0) throw new ValidationError('no editable fields provided');

  if ('quantity_to_list' in updates) {
    updates.quantity_to_list = requirePositiveInteger(updates.quantity_to_list, 'quantity_to_list');
  }

  if (updates.listing_status === 'Active' && !updates.listed_date && !existing.listed_date) {
    updates.listed_date = new Date().toISOString().slice(0, 10);
  }

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE ebay_listings SET ${setSql}, updated_at = datetime('now') WHERE listing_id = @id`).run({ ...updates, id });

  if (updates.listing_status) {
    db.prepare(`UPDATE inventory_lots SET listing_status = @status, updated_at = datetime('now') WHERE inventory_lot_id = @lotId`)
      .run({ status: updates.listing_status, lotId: existing.inventory_lot_id });
  }

  return db.prepare('SELECT * FROM ebay_listings WHERE listing_id = ?').get(id);
}

router.patch('/:id', (req, res) => {
  try {
    const row = updateListing(req.params.id, req.body);
    res.json(row);
  } catch (err) {
    if (sendValidationError(res, err)) return;
    throw err;
  }
});

export default router;

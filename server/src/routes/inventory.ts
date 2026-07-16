import { Router } from 'express';
import { db } from '../db.js';
import { nextId } from '../ids.js';

const router = Router();

const SORTABLE = new Set([
  'inventory_lot_id', 'product_name', 'business_vertical', 'category', 'quantity',
  'available_quantity', 'recorded_unit_value', 'confirmed_cost_basis', 'cost_status',
  'listing_status', 'date_received', 'location_code',
]);

router.get('/', (req, res) => {
  const {
    q, vertical, category, costStatus, listingStatus, trackingMode, recordOrigin,
    sort = 'inventory_lot_id', order = 'asc', page = '1', pageSize = '50',
  } = req.query as Record<string, string>;

  const where: string[] = [];
  const params: Record<string, any> = {};

  if (q) {
    where.push(`(product_name LIKE @q OR inventory_lot_id LIKE @q OR sellable_sku LIKE @q OR variant_model_set LIKE @q OR featured_subject LIKE @q OR location_code LIKE @q OR card_number LIKE @q)`);
    params.q = `%${q}%`;
  }
  if (vertical) { where.push('business_vertical = @vertical'); params.vertical = vertical; }
  if (category) { where.push('category = @category'); params.category = category; }
  if (costStatus) { where.push('cost_status = @costStatus'); params.costStatus = costStatus; }
  if (listingStatus) { where.push('listing_status = @listingStatus'); params.listingStatus = listingStatus; }
  if (trackingMode) { where.push('tracking_mode = @trackingMode'); params.trackingMode = trackingMode; }
  if (recordOrigin) { where.push('record_origin = @recordOrigin'); params.recordOrigin = recordOrigin; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTABLE.has(sort) ? sort : 'inventory_lot_id';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

  const total = (db.prepare(`SELECT COUNT(*) as n FROM inventory_lots ${whereSql}`).get(params) as any).n;

  const pg = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pg - 1) * ps;

  const rows = db
    .prepare(`SELECT * FROM inventory_lots ${whereSql} ORDER BY ${sortCol} ${sortOrder}, inventory_lot_id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: ps, offset });

  res.json({ rows, total, page: pg, pageSize: ps });
});

router.get('/facets', (_req, res) => {
  const facet = (col: string) =>
    (db.prepare(`SELECT ${col} as value, COUNT(*) as n FROM inventory_lots WHERE ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY n DESC`).all() as any[]);
  res.json({
    business_vertical: facet('business_vertical'),
    category: facet('category'),
    cost_status: facet('cost_status'),
    listing_status: facet('listing_status'),
    tracking_mode: facet('tracking_mode'),
    record_origin: facet('record_origin'),
  });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const links = db.prepare('SELECT * FROM cost_links WHERE inventory_lot_id = ? ORDER BY created_at DESC').all(req.params.id);
  const listings = db.prepare('SELECT * FROM ebay_listings WHERE inventory_lot_id = ? ORDER BY created_at DESC').all(req.params.id);
  const sales = db.prepare('SELECT * FROM sales WHERE inventory_lot_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...row, links, listings, sales });
});

router.post('/', (req, res) => {
  const lotId = nextId('inventory_lots', 'inventory_lot_id', 'RV-N-');
  const sku = `T${lotId}`;
  const childId = lotId.replace('RV-N-', 'RV-ITEM-N-');
  const b = req.body || {};
  const quantity = Number(b.quantity) || 0;

  db.prepare(`
    INSERT INTO inventory_lots (
      inventory_lot_id, sellable_sku, reserved_child_id, record_origin, intake_status,
      date_received, acquisition_source, business_vertical, category, product_name,
      variant_model_set, featured_subject, card_number, language, quantity, tracking_mode,
      condition_or_quality, condition_reviewed, grading_company, numeric_grade, grade_designation,
      certification_number, shoe_size, apparel_size, color, serial_number, product_format,
      seal_or_packaging_condition, physical_reference, location_code, recorded_unit_value,
      owner_notes, cost_status, listing_status, available_quantity, sold_quantity, row_readiness
    ) VALUES (
      @inventory_lot_id, @sellable_sku, @reserved_child_id, 'Owner Entry', 'Active Inventory',
      @date_received, @acquisition_source, @business_vertical, @category, @product_name,
      @variant_model_set, @featured_subject, @card_number, @language, @quantity, @tracking_mode,
      @condition_or_quality, @condition_reviewed, @grading_company, @numeric_grade, @grade_designation,
      @certification_number, @shoe_size, @apparel_size, @color, @serial_number, @product_format,
      @seal_or_packaging_condition, @physical_reference, @location_code, @recorded_unit_value,
      @owner_notes, 'Uncosted', 'Not listed', @available_quantity, 0, 'READY'
    )
  `).run({
    inventory_lot_id: lotId,
    sellable_sku: sku,
    reserved_child_id: childId,
    date_received: b.date_received || new Date().toISOString().slice(0, 10),
    acquisition_source: b.acquisition_source ?? null,
    business_vertical: b.business_vertical ?? null,
    category: b.category ?? null,
    product_name: b.product_name ?? null,
    variant_model_set: b.variant_model_set ?? null,
    featured_subject: b.featured_subject ?? null,
    card_number: b.card_number ?? null,
    language: b.language ?? null,
    quantity,
    tracking_mode: b.tracking_mode ?? 'Lot-managed',
    condition_or_quality: b.condition_or_quality ?? null,
    condition_reviewed: b.condition_reviewed ?? 'No',
    grading_company: b.grading_company ?? null,
    numeric_grade: b.numeric_grade ?? null,
    grade_designation: b.grade_designation ?? null,
    certification_number: b.certification_number ?? null,
    shoe_size: b.shoe_size ?? null,
    apparel_size: b.apparel_size ?? null,
    color: b.color ?? null,
    serial_number: b.serial_number ?? null,
    product_format: b.product_format ?? null,
    seal_or_packaging_condition: b.seal_or_packaging_condition ?? null,
    physical_reference: b.physical_reference ?? null,
    location_code: b.location_code ?? null,
    recorded_unit_value: b.recorded_unit_value != null ? Number(b.recorded_unit_value) : null,
    owner_notes: b.owner_notes ?? null,
    available_quantity: quantity,
  });

  const row = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(lotId);
  res.status(201).json(row);
});

const EDITABLE_FIELDS = [
  'intake_status', 'date_received', 'acquisition_source', 'business_vertical', 'category',
  'product_name', 'variant_model_set', 'featured_subject', 'card_number', 'language', 'quantity',
  'tracking_mode', 'condition_or_quality', 'condition_reviewed', 'grading_company', 'numeric_grade',
  'grade_designation', 'certification_number', 'shoe_size', 'apparel_size', 'color', 'serial_number',
  'product_format', 'seal_or_packaging_condition', 'physical_reference', 'location_code',
  'recorded_unit_value', 'owner_notes',
];

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });

  const updates: Record<string, any> = {};
  for (const f of EDITABLE_FIELDS) {
    if (f in req.body) updates[f] = req.body[f];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no editable fields provided' });

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE inventory_lots SET ${setSql}, updated_at = datetime('now') WHERE inventory_lot_id = @id`).run({ ...updates, id: req.params.id });

  if ('quantity' in updates) {
    const row = db.prepare('SELECT quantity, sold_quantity FROM inventory_lots WHERE inventory_lot_id = ?').get(req.params.id) as any;
    const avail = Math.max(0, (Number(row.quantity) || 0) - (Number(row.sold_quantity) || 0));
    db.prepare('UPDATE inventory_lots SET available_quantity = ? WHERE inventory_lot_id = ?').run(avail, req.params.id);
  }

  const row = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(req.params.id);
  res.json(row);
});

export default router;

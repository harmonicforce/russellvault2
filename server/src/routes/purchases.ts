import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const SORTABLE = new Set([
  'acquisition_line_id', 'processed_date', 'seller', 'product_name', 'quantity_purchased',
  'total_paid', 'unit_cost', 'remaining_quantity', 'remaining_cost', 'reconciliation_status',
]);

router.get('/', (req, res) => {
  const {
    q, seller, reconciliationStatus, businessVertical,
    sort = 'processed_date', order = 'desc', page = '1', pageSize = '50',
  } = req.query as Record<string, string>;

  const where: string[] = [];
  const params: Record<string, any> = {};

  if (q) {
    where.push(`(product_name LIKE @q OR acquisition_line_id LIKE @q OR seller LIKE @q OR order_id LIKE @q OR reference_number LIKE @q)`);
    params.q = `%${q}%`;
  }
  if (seller) { where.push('seller = @seller'); params.seller = seller; }
  if (reconciliationStatus) { where.push('reconciliation_status = @reconciliationStatus'); params.reconciliationStatus = reconciliationStatus; }
  if (businessVertical) { where.push('business_vertical = @businessVertical'); params.businessVertical = businessVertical; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTABLE.has(sort) ? sort : 'processed_date';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = (db.prepare(`SELECT COUNT(*) as n FROM whatnot_purchases ${whereSql}`).get(params) as any).n;

  const pg = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pg - 1) * ps;

  const rows = db
    .prepare(`SELECT * FROM whatnot_purchases ${whereSql} ORDER BY ${sortCol} ${sortOrder}, acquisition_line_id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: ps, offset });

  res.json({ rows, total, page: pg, pageSize: ps });
});

router.get('/facets', (_req, res) => {
  const facet = (col: string) =>
    (db.prepare(`SELECT ${col} as value, COUNT(*) as n FROM whatnot_purchases WHERE ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY n DESC LIMIT 200`).all() as any[]);
  res.json({
    seller: facet('seller'),
    reconciliation_status: facet('reconciliation_status'),
    business_vertical: facet('business_vertical'),
  });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const links = db.prepare('SELECT * FROM cost_links WHERE acquisition_line_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...row, links });
});

export default router;

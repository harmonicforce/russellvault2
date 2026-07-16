import { Router } from 'express';
import { db } from '../db.js';
import { nextId } from '../ids.js';

const router = Router();

function recomputeInventoryRollup(inventoryLotId: string) {
  const agg = db
    .prepare(`SELECT COALESCE(SUM(allocated_quantity),0) as qty, COALESCE(SUM(allocated_cost),0) as cost
               FROM cost_links WHERE inventory_lot_id = ? AND allocation_status = 'Confirmed'`)
    .get(inventoryLotId) as any;
  const lot = db.prepare('SELECT quantity FROM inventory_lots WHERE inventory_lot_id = ?').get(inventoryLotId) as any;
  if (!lot) return;
  const qty = Number(lot.quantity) || 0;
  const status = agg.qty <= 0 ? 'Uncosted' : agg.qty >= qty ? 'Costed' : 'Partially Costed';
  db.prepare(`UPDATE inventory_lots SET confirmed_cost_basis = ?, confirmed_allocated_quantity = ?, cost_status = ?, updated_at = datetime('now') WHERE inventory_lot_id = ?`)
    .run(agg.cost, agg.qty, status, inventoryLotId);
}

function recomputePurchaseRollup(acquisitionLineId: string) {
  const agg = db
    .prepare(`SELECT COALESCE(SUM(allocated_quantity),0) as qty, COALESCE(SUM(allocated_cost),0) as cost
               FROM cost_links WHERE acquisition_line_id = ? AND allocation_status = 'Confirmed'`)
    .get(acquisitionLineId) as any;
  const purchase = db.prepare('SELECT quantity_purchased, total_paid FROM whatnot_purchases WHERE acquisition_line_id = ?').get(acquisitionLineId) as any;
  if (!purchase) return;
  const qty = Number(purchase.quantity_purchased) || 0;
  const paid = Number(purchase.total_paid) || 0;
  const remainingQty = Math.max(0, qty - agg.qty);
  const remainingCost = Math.max(0, paid - agg.cost);
  const status = agg.qty <= 0 ? 'Unmatched' : remainingQty <= 0 ? 'Fully Matched' : 'Partially Matched';
  db.prepare(`UPDATE whatnot_purchases SET confirmed_allocated_quantity = ?, remaining_quantity = ?, confirmed_allocated_cost = ?, remaining_cost = ?, reconciliation_status = ? WHERE acquisition_line_id = ?`)
    .run(agg.qty, remainingQty, agg.cost, remainingCost, status, acquisitionLineId);
}

router.get('/', (req, res) => {
  const { status, inventoryLotId, acquisitionLineId, q, page = '1', pageSize = '50' } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: Record<string, any> = {};
  if (status) { where.push('allocation_status = @status'); params.status = status; }
  if (inventoryLotId) { where.push('inventory_lot_id = @inventoryLotId'); params.inventoryLotId = inventoryLotId; }
  if (acquisitionLineId) { where.push('acquisition_line_id = @acquisitionLineId'); params.acquisitionLineId = acquisitionLineId; }
  if (q) {
    where.push('(inventory_product LIKE @q OR purchase_product LIKE @q OR allocation_id LIKE @q OR seller LIKE @q)');
    params.q = `%${q}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as n FROM cost_links ${whereSql}`).get(params) as any).n;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pg - 1) * ps;
  const rows = db.prepare(`SELECT * FROM cost_links ${whereSql} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: ps, offset });
  res.json({ rows, total, page: pg, pageSize: ps });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.inventory_lot_id || !b.acquisition_line_id) {
    return res.status(400).json({ error: 'inventory_lot_id and acquisition_line_id are required' });
  }
  const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(b.inventory_lot_id) as any;
  const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get(b.acquisition_line_id) as any;
  if (!lot) return res.status(404).json({ error: 'inventory lot not found' });
  if (!purchase) return res.status(404).json({ error: 'purchase line not found' });

  const allocationId = nextId('cost_links', 'allocation_id', 'RV-ALLOC-');
  const allocatedQuantity = b.allocated_quantity != null ? Number(b.allocated_quantity) : Number(purchase.quantity_purchased) || 0;
  const allocatedCost = b.allocated_cost != null ? Number(b.allocated_cost) : Number(purchase.total_paid) || 0;
  const status = b.allocation_status === 'Confirmed' ? 'Confirmed' : 'Candidate';

  db.prepare(`
    INSERT INTO cost_links (
      allocation_id, inventory_lot_id, inventory_product, inventory_quantity, acquisition_line_id,
      purchase_product, seller, purchase_date, purchase_quantity, purchase_total, allocated_quantity,
      allocated_cost, allocation_status, match_confidence, match_method, physical_reference,
      supporting_evidence, owner_notes, row_status
    ) VALUES (
      @allocation_id, @inventory_lot_id, @inventory_product, @inventory_quantity, @acquisition_line_id,
      @purchase_product, @seller, @purchase_date, @purchase_quantity, @purchase_total, @allocated_quantity,
      @allocated_cost, @allocation_status, @match_confidence, @match_method, @physical_reference,
      @supporting_evidence, @owner_notes, @row_status
    )
  `).run({
    allocation_id: allocationId,
    inventory_lot_id: b.inventory_lot_id,
    inventory_product: lot.product_name,
    inventory_quantity: lot.quantity,
    acquisition_line_id: b.acquisition_line_id,
    purchase_product: purchase.product_name,
    seller: purchase.seller,
    purchase_date: purchase.processed_date,
    purchase_quantity: purchase.quantity_purchased,
    purchase_total: purchase.total_paid,
    allocated_quantity: allocatedQuantity,
    allocated_cost: allocatedCost,
    allocation_status: status,
    match_confidence: b.match_confidence ?? 'Owner-entered',
    match_method: b.match_method ?? 'Manual link',
    physical_reference: b.physical_reference ?? null,
    supporting_evidence: b.supporting_evidence ?? null,
    owner_notes: b.owner_notes ?? null,
    row_status: status === 'Confirmed' ? 'CONFIRMED' : 'REVIEW — CANDIDATE',
  });

  recomputeInventoryRollup(b.inventory_lot_id);
  recomputePurchaseRollup(b.acquisition_line_id);

  const row = db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(allocationId);
  res.status(201).json(row);
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });

  const b = req.body || {};
  const fields = ['allocation_status', 'allocated_quantity', 'allocated_cost', 'owner_notes', 'physical_reference', 'supporting_evidence'];
  const updates: Record<string, any> = {};
  for (const f of fields) if (f in b) updates[f] = b[f];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no editable fields provided' });

  if (updates.allocation_status) {
    updates.row_status = updates.allocation_status === 'Confirmed' ? 'CONFIRMED' : updates.allocation_status === 'Rejected' ? 'REJECTED' : 'REVIEW — CANDIDATE';
  }

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE cost_links SET ${setSql} WHERE allocation_id = @id`).run({ ...updates, id: req.params.id });

  recomputeInventoryRollup(existing.inventory_lot_id);
  recomputePurchaseRollup(existing.acquisition_line_id);

  const row = db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(req.params.id);
  res.json(row);
});

export default router;

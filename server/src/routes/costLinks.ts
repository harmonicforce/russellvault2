import { Router } from 'express';
import { getDb } from '../db.js';
import { nextId } from '../ids.js';
import { ValidationError, requirePositiveInteger, requireNonNegativeNumber, sendValidationError } from '../validation.js';

const router = Router();

function recomputeInventoryRollup(inventoryLotId: string) {
  const db = getDb();
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
  const db = getDb();
  const agg = db
    .prepare(`SELECT COALESCE(SUM(allocated_quantity),0) as qty, COALESCE(SUM(allocated_cost),0) as cost
               FROM cost_links WHERE acquisition_line_id = ? AND allocation_status = 'Confirmed'`)
    .get(acquisitionLineId) as any;
  const purchase = db.prepare('SELECT quantity_purchased, total_paid FROM whatnot_purchases WHERE acquisition_line_id = ?').get(acquisitionLineId) as any;
  if (!purchase) return;
  const qty = Number(purchase.quantity_purchased) || 0;
  const paid = Number(purchase.total_paid) || 0;
  // Not clamped to zero: a negative remainder means something is over-allocated
  // relative to the source purchase. Hiding that behind Math.max(0, ...) is the
  // exact stop-loss bug this fixes — LIVE-005 (server/src/routes/checks.ts)
  // watches remaining_quantity < 0, so an over-allocation stays visible instead
  // of silently reading as "fully matched, nothing owed".
  const remainingQty = qty - agg.qty;
  const remainingCost = paid - agg.cost;
  const status = agg.qty <= 0 ? 'Unmatched' : remainingQty <= 0 ? 'Fully Matched' : 'Partially Matched';
  db.prepare(`UPDATE whatnot_purchases SET confirmed_allocated_quantity = ?, remaining_quantity = ?, confirmed_allocated_cost = ?, remaining_cost = ?, reconciliation_status = ? WHERE acquisition_line_id = ?`)
    .run(agg.qty, remainingQty, agg.cost, remainingCost, status, acquisitionLineId);
}

const COST_EPSILON = 1e-6;

// Individual, per-row bound: every Candidate or Confirmed allocation — on its
// own, regardless of any other row — must be physically possible against its
// own source purchase and target lot. A Candidate is still just a proposal
// and never counts against CUMULATIVE capacity shared with other rows
// (multiple candidates may legitimately compete for the same evidence — see
// assertConfirmWithinCapacity below), but an individual allocation claiming
// more than its source purchase holds, or more than its target lot could
// possibly fit, is not a valid proposal at all and must be rejected outright.
function assertWithinIndividualBounds(params: {
  lot: any;
  purchase: any;
  allocatedQuantity: number;
  allocatedCost: number;
}) {
  const { lot, purchase, allocatedQuantity, allocatedCost } = params;
  const sourceQty = Number(purchase.quantity_purchased) || 0;
  const sourceCost = Number(purchase.total_paid) || 0;
  const targetCapacity = Number(lot.quantity) || 0;

  if (allocatedQuantity > sourceQty) {
    throw new ValidationError(
      `allocated_quantity ${allocatedQuantity} exceeds purchase ${purchase.acquisition_line_id}'s purchased quantity of ${sourceQty}`,
      409,
    );
  }
  if (allocatedCost > sourceCost + COST_EPSILON) {
    throw new ValidationError(
      `allocated_cost ${allocatedCost} exceeds purchase ${purchase.acquisition_line_id}'s total_paid of ${sourceCost}`,
      409,
    );
  }
  if (allocatedQuantity > targetCapacity) {
    throw new ValidationError(
      `allocated_quantity ${allocatedQuantity} exceeds inventory lot ${lot.inventory_lot_id}'s quantity of ${targetCapacity}`,
      409,
    );
  }
}

// Confirmed allocations additionally share CUMULATIVE capacity: the sum of
// every Confirmed allocation for the same purchase line, or the same
// inventory lot, must not exceed that purchase's/lot's capacity. Capacity is
// enforced at confirmation time against the sums of every OTHER Confirmed
// allocation for the same purchase line and inventory lot.
function assertConfirmWithinCapacity(params: {
  lot: any;
  purchase: any;
  allocatedQuantity: number;
  allocatedCost: number;
  excludeAllocationId?: string;
}) {
  const { lot, purchase, allocatedQuantity, allocatedCost, excludeAllocationId } = params;
  const db = getDb();

  const confirmedForPurchase = db
    .prepare(
      `SELECT COALESCE(SUM(allocated_quantity),0) as qty, COALESCE(SUM(allocated_cost),0) as cost
         FROM cost_links WHERE acquisition_line_id = ? AND allocation_status = 'Confirmed' AND allocation_id <> ?`,
    )
    .get(purchase.acquisition_line_id, excludeAllocationId ?? '') as any;

  const confirmedForLot = db
    .prepare(
      `SELECT COALESCE(SUM(allocated_quantity),0) as qty
         FROM cost_links WHERE inventory_lot_id = ? AND allocation_status = 'Confirmed' AND allocation_id <> ?`,
    )
    .get(lot.inventory_lot_id, excludeAllocationId ?? '') as any;

  const sourceQty = Number(purchase.quantity_purchased) || 0;
  const sourceCost = Number(purchase.total_paid) || 0;
  const targetCapacity = Number(lot.quantity) || 0;

  if (confirmedForPurchase.qty + allocatedQuantity > sourceQty) {
    throw new ValidationError(
      `allocated_quantity ${allocatedQuantity} would push confirmed allocations for purchase ${purchase.acquisition_line_id} to ${confirmedForPurchase.qty + allocatedQuantity}, exceeding its purchased quantity of ${sourceQty}`,
      409,
    );
  }
  if (confirmedForPurchase.cost + allocatedCost > sourceCost + COST_EPSILON) {
    throw new ValidationError(
      `allocated_cost ${allocatedCost} would push confirmed allocations for purchase ${purchase.acquisition_line_id} to ${confirmedForPurchase.cost + allocatedCost}, exceeding its total_paid of ${sourceCost}`,
      409,
    );
  }
  if (confirmedForLot.qty + allocatedQuantity > targetCapacity) {
    throw new ValidationError(
      `allocated_quantity ${allocatedQuantity} would push confirmed allocations for inventory lot ${lot.inventory_lot_id} to ${confirmedForLot.qty + allocatedQuantity}, exceeding its quantity of ${targetCapacity}`,
      409,
    );
  }
}

function assertNoDuplicateActivePair(inventoryLotId: string, acquisitionLineId: string, excludeAllocationId?: string) {
  const db = getDb();
  const dup = db
    .prepare(
      `SELECT allocation_id FROM cost_links
        WHERE inventory_lot_id = ? AND acquisition_line_id = ? AND allocation_status <> 'Rejected' AND allocation_id <> ?`,
    )
    .get(inventoryLotId, acquisitionLineId, excludeAllocationId ?? '') as any;
  if (dup) {
    throw new ValidationError(
      `an active allocation (${dup.allocation_id}) already links inventory lot ${inventoryLotId} to purchase ${acquisitionLineId} — reject it first`,
      409,
    );
  }
}

router.get('/', (req, res) => {
  const db = getDb();
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

// Core creation logic, exported so regression tests can exercise it directly
// against an in-memory database without going through HTTP.
export function createCostLink(body: any) {
  const db = getDb();
  const b = body || {};
  if (!b.inventory_lot_id || !b.acquisition_line_id) {
    throw new ValidationError('inventory_lot_id and acquisition_line_id are required');
  }

  return db.transaction(() => {
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(b.inventory_lot_id) as any;
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get(b.acquisition_line_id) as any;
    if (!lot) throw new ValidationError('inventory lot not found', 404);
    if (!purchase) throw new ValidationError('purchase line not found', 404);

    assertNoDuplicateActivePair(b.inventory_lot_id, b.acquisition_line_id);

    const allocationId = nextId('cost_links', 'allocation_id', 'RV-ALLOC-');
    const allocatedQuantity = requirePositiveInteger(
      b.allocated_quantity != null ? b.allocated_quantity : purchase.quantity_purchased,
      'allocated_quantity',
    );
    const allocatedCost = requireNonNegativeNumber(
      b.allocated_cost != null ? b.allocated_cost : purchase.total_paid,
      'allocated_cost',
    );
    const status = b.allocation_status === 'Confirmed' ? 'Confirmed' : 'Candidate';

    // Every Candidate or Confirmed allocation must individually fit its
    // source purchase and target lot, even before any cumulative check.
    assertWithinIndividualBounds({ lot, purchase, allocatedQuantity, allocatedCost });

    if (status === 'Confirmed') {
      assertConfirmWithinCapacity({ lot, purchase, allocatedQuantity, allocatedCost });
    }

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

    return db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(allocationId);
  })();
}

router.post('/', (req, res) => {
  try {
    const row = createCostLink(req.body);
    res.status(201).json(row);
  } catch (err) {
    if (sendValidationError(res, err)) return;
    throw err;
  }
});

const EDITABLE_FIELDS = ['allocation_status', 'allocated_quantity', 'allocated_cost', 'owner_notes', 'physical_reference', 'supporting_evidence'];

export function updateCostLink(id: string, body: any) {
  const db = getDb();
  const b = body || {};

  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(id) as any;
    if (!existing) throw new ValidationError('not found', 404);

    const updates: Record<string, any> = {};
    for (const f of EDITABLE_FIELDS) if (f in b) updates[f] = b[f];
    if (Object.keys(updates).length === 0) throw new ValidationError('no editable fields provided');

    const finalQuantity = 'allocated_quantity' in updates
      ? requirePositiveInteger(updates.allocated_quantity, 'allocated_quantity')
      : Number(existing.allocated_quantity) || 0;
    const finalCost = 'allocated_cost' in updates
      ? requireNonNegativeNumber(updates.allocated_cost, 'allocated_cost')
      : Number(existing.allocated_cost) || 0;
    if ('allocated_quantity' in updates) updates.allocated_quantity = finalQuantity;
    if ('allocated_cost' in updates) updates.allocated_cost = finalCost;

    const finalStatus = updates.allocation_status ?? existing.allocation_status;
    if (updates.allocation_status) {
      updates.row_status = finalStatus === 'Confirmed' ? 'CONFIRMED' : finalStatus === 'Rejected' ? 'REJECTED' : 'REVIEW — CANDIDATE';
    }

    if (finalStatus !== 'Rejected' && (updates.allocation_status ?? existing.allocation_status) !== existing.allocation_status) {
      // Re-activating (or newly setting) this pair as Candidate/Confirmed —
      // make sure no OTHER active row already links the same pair.
      assertNoDuplicateActivePair(existing.inventory_lot_id, existing.acquisition_line_id, id);
    }

    // Only re-check capacity when a capacity-relevant field is actually
    // changing (becoming/staying Candidate or Confirmed with a new quantity,
    // cost, or status). An edit to owner_notes or similar on a row whose
    // quantity/cost/status are untouched — including legacy data confirmed
    // before these checks existed — must not be blocked by them.
    const capacityRelevantChange = 'allocation_status' in updates || 'allocated_quantity' in updates || 'allocated_cost' in updates;
    if (finalStatus !== 'Rejected' && capacityRelevantChange) {
      const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get(existing.inventory_lot_id) as any;
      const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get(existing.acquisition_line_id) as any;
      if (!lot) throw new ValidationError('inventory lot not found', 404);
      if (!purchase) throw new ValidationError('purchase line not found', 404);

      // Every Candidate or Confirmed allocation must individually fit its
      // source purchase and target lot, regardless of any other row.
      assertWithinIndividualBounds({ lot, purchase, allocatedQuantity: finalQuantity, allocatedCost: finalCost });

      if (finalStatus === 'Confirmed') {
        assertConfirmWithinCapacity({
          lot,
          purchase,
          allocatedQuantity: finalQuantity,
          allocatedCost: finalCost,
          excludeAllocationId: id,
        });
      }
    }

    const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE cost_links SET ${setSql} WHERE allocation_id = @id`).run({ ...updates, id });

    recomputeInventoryRollup(existing.inventory_lot_id);
    recomputePurchaseRollup(existing.acquisition_line_id);

    return db.prepare('SELECT * FROM cost_links WHERE allocation_id = ?').get(id);
  })();
}

router.patch('/:id', (req, res) => {
  try {
    const row = updateCostLink(req.params.id, req.body);
    res.json(row);
  } catch (err) {
    if (sendValidationError(res, err)) return;
    throw err;
  }
});

export default router;

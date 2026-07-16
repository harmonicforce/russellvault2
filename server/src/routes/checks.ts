import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

function liveChecks() {
  const results: any[] = [];

  const invCount = (db.prepare('SELECT COUNT(*) as n FROM inventory_lots').get() as any).n;
  const invIdDistinct = (db.prepare('SELECT COUNT(DISTINCT inventory_lot_id) as n FROM inventory_lots').get() as any).n;
  results.push({
    check_id: 'LIVE-001', test: 'Inventory IDs unique', actual: invIdDistinct, expected: invCount,
    difference: invCount - invIdDistinct, status: invCount === invIdDistinct ? 'PASS' : 'FAIL',
    notes: `${invCount} lots currently tracked.`,
  });

  const negativeAvail = (db.prepare('SELECT COUNT(*) as n FROM inventory_lots WHERE available_quantity < 0').get() as any).n;
  results.push({
    check_id: 'LIVE-002', test: 'No lot has negative available quantity', actual: negativeAvail, expected: 0,
    difference: negativeAvail, status: negativeAvail === 0 ? 'PASS' : 'FAIL',
    notes: negativeAvail === 0 ? 'All lots within bounds.' : `${negativeAvail} lot(s) oversold.`,
  });

  const orphanLinksLot = (db.prepare(`
    SELECT COUNT(*) as n FROM cost_links cl
    LEFT JOIN inventory_lots il ON cl.inventory_lot_id = il.inventory_lot_id
    WHERE il.inventory_lot_id IS NULL
  `).get() as any).n;
  results.push({
    check_id: 'LIVE-003', test: 'Cost links reference a valid inventory lot', actual: orphanLinksLot, expected: 0,
    difference: orphanLinksLot, status: orphanLinksLot === 0 ? 'PASS' : 'FAIL',
    notes: orphanLinksLot === 0 ? 'All links resolve.' : `${orphanLinksLot} orphaned link(s).`,
  });

  const orphanLinksPurchase = (db.prepare(`
    SELECT COUNT(*) as n FROM cost_links cl
    LEFT JOIN whatnot_purchases wp ON cl.acquisition_line_id = wp.acquisition_line_id
    WHERE wp.acquisition_line_id IS NULL
  `).get() as any).n;
  results.push({
    check_id: 'LIVE-004', test: 'Cost links reference a valid purchase line', actual: orphanLinksPurchase, expected: 0,
    difference: orphanLinksPurchase, status: orphanLinksPurchase === 0 ? 'PASS' : 'FAIL',
    notes: orphanLinksPurchase === 0 ? 'All links resolve.' : `${orphanLinksPurchase} orphaned link(s).`,
  });

  const overAllocated = (db.prepare(`
    SELECT COUNT(*) as n FROM whatnot_purchases WHERE remaining_quantity < 0
  `).get() as any).n;
  results.push({
    check_id: 'LIVE-005', test: 'No purchase line over-allocated', actual: overAllocated, expected: 0,
    difference: overAllocated, status: overAllocated === 0 ? 'PASS' : 'FAIL',
    notes: overAllocated === 0 ? 'Allocations within purchased quantity.' : `${overAllocated} line(s) over-allocated.`,
  });

  const soldWithoutCost = (db.prepare(`
    SELECT COUNT(*) as n FROM sales s
    JOIN inventory_lots il ON s.inventory_lot_id = il.inventory_lot_id
    WHERE il.cost_status = 'Uncosted'
  `).get() as any).n;
  results.push({
    check_id: 'LIVE-006', test: 'Sales have known cost basis', actual: soldWithoutCost, expected: 0,
    difference: soldWithoutCost, status: soldWithoutCost === 0 ? 'PASS' : 'WARN',
    notes: soldWithoutCost === 0 ? 'Profit figures fully confirmed.' : `${soldWithoutCost} sale(s) with unavailable profit.`,
  });

  return results;
}

router.get('/', (_req, res) => {
  const stored = db.prepare('SELECT * FROM checks ORDER BY check_id').all();
  const live = liveChecks();
  res.json({ stored, live });
});

export default router;

import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const inv = db.prepare(`
    SELECT
      COUNT(*) as lotCount,
      COALESCE(SUM(quantity),0) as totalUnits,
      COALESCE(SUM(available_quantity),0) as availableUnits,
      COALESCE(SUM(recorded_unit_value * quantity),0) as recordedValue,
      COALESCE(SUM(confirmed_cost_basis),0) as totalCostBasis,
      SUM(CASE WHEN cost_status = 'Uncosted' THEN 1 ELSE 0 END) as uncostedCount,
      SUM(CASE WHEN cost_status = 'Costed' THEN 1 ELSE 0 END) as costedCount,
      SUM(CASE WHEN cost_status = 'Partially Costed' THEN 1 ELSE 0 END) as partialCostedCount,
      SUM(CASE WHEN record_origin = 'New Intake' OR record_origin = 'Owner Entry' THEN 1 ELSE 0 END) as newIntakeCount
    FROM inventory_lots
  `).get() as any;

  // Excludes flagged rows (e.g. personal food/consumable purchases) so these
  // business totals match pre-Phase-0 behavior; the rows themselves are
  // preserved (see server/src/db.ts flagFoodPurchases), not deleted.
  const purchases = db.prepare(`
    SELECT
      COUNT(*) as lineCount,
      COALESCE(SUM(total_paid),0) as totalPaid,
      COALESCE(SUM(remaining_cost),0) as remainingCost,
      SUM(CASE WHEN reconciliation_status = 'Unmatched' THEN 1 ELSE 0 END) as unmatchedCount,
      SUM(CASE WHEN reconciliation_status = 'Fully Matched' THEN 1 ELSE 0 END) as fullyMatchedCount,
      SUM(CASE WHEN reconciliation_status = 'Partially Matched' THEN 1 ELSE 0 END) as partiallyMatchedCount
    FROM whatnot_purchases WHERE COALESCE(is_excluded, 0) = 0
  `).get() as any;

  const links = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN allocation_status = 'Candidate' THEN 1 ELSE 0 END) as candidateCount,
      SUM(CASE WHEN allocation_status = 'Confirmed' THEN 1 ELSE 0 END) as confirmedCount,
      SUM(CASE WHEN allocation_status = 'Rejected' THEN 1 ELSE 0 END) as rejectedCount
    FROM cost_links
  `).get() as any;

  const listings = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN listing_status = 'Draft' OR listing_status = 'Has draft' THEN 1 ELSE 0 END) as draftCount,
      SUM(CASE WHEN listing_status = 'Active' THEN 1 ELSE 0 END) as activeCount,
      SUM(CASE WHEN listing_status = 'Sold' THEN 1 ELSE 0 END) as soldCount
    FROM ebay_listings
  `).get() as any;

  const sales = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(net_proceeds),0) as totalNetProceeds,
      COALESCE(SUM(profit_after_known_costs),0) as totalProfit,
      COALESCE(SUM(quantity_sold),0) as unitsSold,
      SUM(CASE WHEN profit_status = 'Unavailable' THEN 1 ELSE 0 END) as unavailableProfitCount
    FROM sales
  `).get() as any;

  const checks = db.prepare(`SELECT status, COUNT(*) as n FROM checks GROUP BY status`).all() as any[];

  const recentSales = db.prepare(`SELECT * FROM sales ORDER BY created_at DESC LIMIT 5`).all();
  const recentPurchases = db.prepare(`SELECT * FROM whatnot_purchases ORDER BY processed_date DESC LIMIT 5`).all();

  const topVerticals = db.prepare(`
    SELECT business_vertical, COUNT(*) as lotCount, COALESCE(SUM(recorded_unit_value * quantity),0) as value
    FROM inventory_lots WHERE business_vertical IS NOT NULL
    GROUP BY business_vertical ORDER BY value DESC LIMIT 8
  `).all();

  res.json({ inventory: inv, purchases, links, listings, sales, checks, recentSales, recentPurchases, topVerticals });
});

export default router;

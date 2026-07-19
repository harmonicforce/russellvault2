import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
const { db, initSchema } = await import('../db.js');
const { createCostLink, updateCostLink } = await import('./costLinks.js');

function seedLot(id: string, quantity: number) {
  db.prepare(
    `INSERT INTO inventory_lots (inventory_lot_id, sellable_sku, product_name, quantity, available_quantity, cost_status)
     VALUES (?, ?, 'Test Lot', ?, ?, 'Uncosted')`,
  ).run(id, `SKU-${id}`, quantity, quantity);
}

function seedPurchase(id: string, quantityPurchased: number, totalPaid: number) {
  db.prepare(
    `INSERT INTO whatnot_purchases (acquisition_line_id, product_name, quantity_purchased, total_paid, remaining_quantity, remaining_cost, reconciliation_status)
     VALUES (?, 'Test Purchase', ?, ?, ?, ?, 'Unmatched')`,
  ).run(id, quantityPurchased, totalPaid, quantityPurchased, totalPaid);
}

beforeEach(() => {
  initSchema();
  db.exec(`DELETE FROM cost_links; DELETE FROM inventory_lots; DELETE FROM whatnot_purchases;`);
});

describe('createCostLink', () => {
  it('defaults a new allocation to Candidate, never auto-confirmed', () => {
    seedLot('LOT-1', 5);
    seedPurchase('PUR-1', 5, 50);
    const row = createCostLink({ inventory_lot_id: 'LOT-1', acquisition_line_id: 'PUR-1' }) as any;
    expect(row.allocation_status).toBe('Candidate');
  });

  it('rejects a zero or negative allocated_quantity', () => {
    seedLot('LOT-2', 5);
    seedPurchase('PUR-2', 5, 50);
    expect(() => createCostLink({ inventory_lot_id: 'LOT-2', acquisition_line_id: 'PUR-2', allocated_quantity: 0 })).toThrow(/positive integer/);
    expect(() => createCostLink({ inventory_lot_id: 'LOT-2', acquisition_line_id: 'PUR-2', allocated_quantity: -3 })).toThrow(/positive integer/);
    expect(() => createCostLink({ inventory_lot_id: 'LOT-2', acquisition_line_id: 'PUR-2', allocated_quantity: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a negative allocated_cost', () => {
    seedLot('LOT-3', 5);
    seedPurchase('PUR-3', 5, 50);
    expect(() =>
      createCostLink({ inventory_lot_id: 'LOT-3', acquisition_line_id: 'PUR-3', allocated_quantity: 1, allocated_cost: -1 }),
    ).toThrow(/non-negative/);
  });

  it('OLD BUG: confirming an allocation exceeding the source purchase quantity used to succeed silently — now rejected, no partial write', () => {
    seedLot('LOT-4', 100);
    seedPurchase('PUR-4', 5, 50); // purchase only has 5 units
    expect(() =>
      createCostLink({
        inventory_lot_id: 'LOT-4', acquisition_line_id: 'PUR-4',
        allocated_quantity: 10, allocated_cost: 50, allocation_status: 'Confirmed',
      }),
    ).toThrow(/exceeding its purchased quantity/);

    // Atomicity: the rejected confirm left no cost_link row and no rollup mutation.
    const links = db.prepare('SELECT * FROM cost_links WHERE acquisition_line_id = ?').all('PUR-4');
    expect(links).toHaveLength(0);
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-4') as any;
    expect(purchase.confirmed_allocated_quantity).toBe(0);
    expect(purchase.reconciliation_status).toBe('Unmatched');
  });

  it('OLD BUG: confirming an allocation exceeding the source purchase cost used to succeed silently — now rejected', () => {
    seedLot('LOT-4b', 100);
    seedPurchase('PUR-4b', 10, 20); // only $20 paid
    expect(() =>
      createCostLink({
        inventory_lot_id: 'LOT-4b', acquisition_line_id: 'PUR-4b',
        allocated_quantity: 5, allocated_cost: 999, allocation_status: 'Confirmed',
      }),
    ).toThrow(/exceeding its total_paid/);
  });

  it('OLD BUG: confirming an allocation exceeding the target inventory lot capacity used to succeed silently — now rejected', () => {
    seedLot('LOT-5', 2); // lot only holds 2 units
    seedPurchase('PUR-5', 100, 1000);
    expect(() =>
      createCostLink({
        inventory_lot_id: 'LOT-5', acquisition_line_id: 'PUR-5',
        allocated_quantity: 10, allocated_cost: 10, allocation_status: 'Confirmed',
      }),
    ).toThrow(/exceeding its quantity/);
  });

  it('allows a Confirmed allocation within capacity and updates rollups atomically', () => {
    seedLot('LOT-6', 10);
    seedPurchase('PUR-6', 10, 100);
    const row = createCostLink({
      inventory_lot_id: 'LOT-6', acquisition_line_id: 'PUR-6',
      allocated_quantity: 10, allocated_cost: 100, allocation_status: 'Confirmed',
    }) as any;
    expect(row.allocation_status).toBe('Confirmed');
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get('LOT-6') as any;
    expect(lot.cost_status).toBe('Costed');
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-6') as any;
    expect(purchase.reconciliation_status).toBe('Fully Matched');
    expect(purchase.remaining_quantity).toBe(0);
  });

  it('OLD BUG: two active allocations for the same lot+purchase pair used to be allowed — now rejected as a duplicate', () => {
    seedLot('LOT-7', 10);
    seedPurchase('PUR-7', 10, 100);
    createCostLink({ inventory_lot_id: 'LOT-7', acquisition_line_id: 'PUR-7', allocated_quantity: 3, allocated_cost: 30 });
    expect(() =>
      createCostLink({ inventory_lot_id: 'LOT-7', acquisition_line_id: 'PUR-7', allocated_quantity: 2, allocated_cost: 20 }),
    ).toThrow(/already links inventory lot/);
  });

  it('allows a new allocation for the same pair once the prior one is Rejected', () => {
    seedLot('LOT-8', 10);
    seedPurchase('PUR-8', 10, 100);
    const first = createCostLink({ inventory_lot_id: 'LOT-8', acquisition_line_id: 'PUR-8', allocated_quantity: 3, allocated_cost: 30 }) as any;
    updateCostLink(first.allocation_id, { allocation_status: 'Rejected' });
    const second = createCostLink({ inventory_lot_id: 'LOT-8', acquisition_line_id: 'PUR-8', allocated_quantity: 5, allocated_cost: 50 }) as any;
    expect(second.allocation_status).toBe('Candidate');
  });
});

describe('updateCostLink', () => {
  it('OLD BUG: confirming a Candidate via PATCH used to skip capacity checks — now rejected', () => {
    seedLot('LOT-9', 3);
    seedPurchase('PUR-9', 100, 1000); // purchase capacity is generous; only the lot is small
    const row = createCostLink({ inventory_lot_id: 'LOT-9', acquisition_line_id: 'PUR-9', allocated_quantity: 10, allocated_cost: 10 }) as any;
    // Candidate creation with an over-large quantity is allowed (not yet a commitment)...
    expect(row.allocation_status).toBe('Candidate');
    // ...but confirming it must be rejected since it exceeds the lot's capacity of 3.
    expect(() => updateCostLink(row.allocation_id, { allocation_status: 'Confirmed' })).toThrow(/exceeding its quantity/);
  });

  it('OLD BUG: remaining_quantity/remaining_cost used to clamp to zero, hiding over-allocation — now left negative and visible', () => {
    seedLot('LOT-10', 100);
    seedPurchase('PUR-10', 5, 50);
    // Simulate pre-existing over-allocated legacy data by inserting two
    // already-Confirmed rows directly (bypassing app-level validation), the
    // way data written before this fix could already exist.
    db.prepare(
      `INSERT INTO cost_links (allocation_id, inventory_lot_id, acquisition_line_id, allocated_quantity, allocated_cost, allocation_status)
       VALUES ('RV-ALLOC-900001', 'LOT-10', 'PUR-10', 4, 40, 'Confirmed')`,
    ).run();
    db.prepare(
      `INSERT INTO cost_links (allocation_id, inventory_lot_id, acquisition_line_id, allocated_quantity, allocated_cost, allocation_status)
       VALUES ('RV-ALLOC-900002', 'LOT-10', 'PUR-10', 4, 40, 'Confirmed')`,
    ).run();

    // Touch an unrelated field to trigger a rollup recompute without changing
    // quantity/cost/status (so this exercises the recompute math, not the
    // confirm-time capacity guard).
    updateCostLink('RV-ALLOC-900002', { owner_notes: 'legacy data touch' });

    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-10') as any;
    expect(purchase.remaining_quantity).toBe(-3); // 5 - 8, NOT clamped to 0
    expect(purchase.remaining_cost).toBe(-30); // 50 - 80, NOT clamped to 0
    expect(purchase.reconciliation_status).toBe('Fully Matched');
  });

  it('rejects re-activating a Rejected allocation when another active row already covers the same pair', () => {
    seedLot('LOT-11', 10);
    seedPurchase('PUR-11', 10, 100);
    const a = createCostLink({ inventory_lot_id: 'LOT-11', acquisition_line_id: 'PUR-11', allocated_quantity: 3, allocated_cost: 30 }) as any;
    updateCostLink(a.allocation_id, { allocation_status: 'Rejected' });
    const b = createCostLink({ inventory_lot_id: 'LOT-11', acquisition_line_id: 'PUR-11', allocated_quantity: 4, allocated_cost: 40 }) as any;
    expect(b.allocation_status).toBe('Candidate');
    expect(() => updateCostLink(a.allocation_id, { allocation_status: 'Candidate' })).toThrow(/already links inventory lot/);
  });
});

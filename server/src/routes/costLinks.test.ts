import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
// These suites drive the bootstrap path itself, so they authorize it explicitly.
// Production does not set this; see server/src/legacyBootstrapPolicy.ts.
process.env.SEED_LEGACY_ON_EMPTY = 'true';
const { getDb, initSchema } = await import('../db.js');
const db = getDb();
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
    ).toThrow(/exceeds purchase PUR-4's purchased quantity/); // caught by the individual per-row bound

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
    ).toThrow(/exceeds purchase PUR-4b's total_paid/); // caught by the individual per-row bound
  });

  it('OLD BUG: confirming an allocation exceeding the target inventory lot capacity used to succeed silently — now rejected', () => {
    seedLot('LOT-5', 2); // lot only holds 2 units
    seedPurchase('PUR-5', 100, 1000);
    expect(() =>
      createCostLink({
        inventory_lot_id: 'LOT-5', acquisition_line_id: 'PUR-5',
        allocated_quantity: 10, allocated_cost: 10, allocation_status: 'Confirmed',
      }),
    ).toThrow(/exceeds inventory lot LOT-5's quantity/); // caught by the individual per-row bound
  });

  it('CUMULATIVE (Confirmed-only): two individually-valid Confirmed allocations against the same purchase are rejected once their sum exceeds it', () => {
    seedPurchase('PUR-4c', 5, 50); // purchase has only 5 units total
    seedLot('LOT-4c-1', 10);
    seedLot('LOT-4c-2', 10);
    const a = createCostLink({
      inventory_lot_id: 'LOT-4c-1', acquisition_line_id: 'PUR-4c',
      allocated_quantity: 3, allocated_cost: 30, allocation_status: 'Confirmed',
    }) as any;
    expect(a.allocation_status).toBe('Confirmed'); // 3 <= 5, individually and cumulatively fine
    // A second allocation of 3 against the same purchase is individually fine
    // (3 <= 5) but cumulatively over (3 + 3 = 6 > 5) — must be rejected, and
    // must not leave a partial row or mutate rollups.
    expect(() =>
      createCostLink({
        inventory_lot_id: 'LOT-4c-2', acquisition_line_id: 'PUR-4c',
        allocated_quantity: 3, allocated_cost: 30, allocation_status: 'Confirmed',
      }),
    ).toThrow(/would push confirmed allocations for purchase PUR-4c/);
    const links = db.prepare('SELECT * FROM cost_links WHERE inventory_lot_id = ?').all('LOT-4c-2');
    expect(links).toHaveLength(0);
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-4c') as any;
    expect(purchase.confirmed_allocated_quantity).toBe(3); // unchanged from allocation A only
  });

  it('rejects a Candidate whose allocated_quantity exceeds the source purchase quantity — no row inserted, no rollup change', () => {
    seedLot('LOT-5b', 100);
    seedPurchase('PUR-5b', 5, 50); // purchase only has 5 units
    expect(() =>
      createCostLink({ inventory_lot_id: 'LOT-5b', acquisition_line_id: 'PUR-5b', allocated_quantity: 10, allocated_cost: 10 }),
    ).toThrow(/exceeds purchase PUR-5b's purchased quantity/);

    const links = db.prepare('SELECT * FROM cost_links WHERE acquisition_line_id = ?').all('PUR-5b');
    expect(links).toHaveLength(0);
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-5b') as any;
    expect(purchase.reconciliation_status).toBe('Unmatched');
    expect(purchase.confirmed_allocated_quantity).toBe(0);
  });

  it('rejects a Candidate whose allocated_cost exceeds the source purchase total_paid — no row inserted, no rollup change', () => {
    seedLot('LOT-5c', 100);
    seedPurchase('PUR-5c', 10, 20); // only $20 paid
    expect(() =>
      createCostLink({ inventory_lot_id: 'LOT-5c', acquisition_line_id: 'PUR-5c', allocated_quantity: 5, allocated_cost: 999 }),
    ).toThrow(/exceeds purchase PUR-5c's total_paid/);

    const links = db.prepare('SELECT * FROM cost_links WHERE acquisition_line_id = ?').all('PUR-5c');
    expect(links).toHaveLength(0);
    const purchase = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('PUR-5c') as any;
    expect(purchase.confirmed_allocated_cost).toBe(0);
  });

  it('rejects a Candidate whose allocated_quantity exceeds the target inventory lot capacity — no row inserted, no rollup change', () => {
    seedLot('LOT-5d', 2); // lot only holds 2 units
    seedPurchase('PUR-5d', 100, 1000);
    expect(() =>
      createCostLink({ inventory_lot_id: 'LOT-5d', acquisition_line_id: 'PUR-5d', allocated_quantity: 10, allocated_cost: 10 }),
    ).toThrow(/exceeds inventory lot LOT-5d's quantity/);

    const links = db.prepare('SELECT * FROM cost_links WHERE inventory_lot_id = ?').all('LOT-5d');
    expect(links).toHaveLength(0);
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get('LOT-5d') as any;
    expect(lot.cost_status).toBe('Uncosted');
    expect(lot.confirmed_allocated_quantity).toBe(0);
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
  it('rejects a PATCH that raises an already-Candidate allocated_quantity above the lot capacity — individual bound applies on update too', () => {
    seedLot('LOT-9', 3);
    seedPurchase('PUR-9', 100, 1000); // purchase capacity is generous; only the lot is small
    const row = createCostLink({ inventory_lot_id: 'LOT-9', acquisition_line_id: 'PUR-9', allocated_quantity: 2, allocated_cost: 2 }) as any;
    expect(row.allocation_status).toBe('Candidate');
    expect(() => updateCostLink(row.allocation_id, { allocated_quantity: 10 })).toThrow(/exceeds inventory lot LOT-9's quantity/);
    const unchanged = db.prepare('SELECT allocated_quantity FROM cost_links WHERE allocation_id = ?').get(row.allocation_id) as any;
    expect(unchanged.allocated_quantity).toBe(2); // no partial write
  });

  it('PATCH-confirming a Candidate that individually fits but would exceed CUMULATIVE lot capacity with another Confirmed row is still rejected', () => {
    seedLot('LOT-9b', 5);
    seedPurchase('PUR-9b-1', 100, 1000);
    seedPurchase('PUR-9b-2', 100, 1000);
    // Each candidate individually fits the lot's capacity of 5 on its own...
    const a = createCostLink({ inventory_lot_id: 'LOT-9b', acquisition_line_id: 'PUR-9b-1', allocated_quantity: 3, allocated_cost: 3, allocation_status: 'Confirmed' }) as any;
    const b = createCostLink({ inventory_lot_id: 'LOT-9b', acquisition_line_id: 'PUR-9b-2', allocated_quantity: 3, allocated_cost: 3 }) as any;
    expect(a.allocation_status).toBe('Confirmed');
    expect(b.allocation_status).toBe('Candidate');
    // ...but confirming both together (3 + 3 = 6) exceeds the shared lot capacity of 5.
    expect(() => updateCostLink(b.allocation_id, { allocation_status: 'Confirmed' })).toThrow(/exceeding its quantity/);
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

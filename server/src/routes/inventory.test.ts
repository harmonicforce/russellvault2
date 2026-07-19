import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
const { db, initSchema } = await import('../db.js');
const { createInventoryLot, updateInventoryLot } = await import('./inventory.js');

beforeEach(() => {
  initSchema();
  db.exec(`DELETE FROM inventory_lots;`);
});

describe('createInventoryLot', () => {
  it('OLD BUG: `Number(b.quantity) || 0` accepted a missing/zero quantity as 0, and passed a negative quantity through unchanged — now rejected', () => {
    expect(() => createInventoryLot({ product_name: 'Widget' })).toThrow(/positive integer/); // missing
    expect(() => createInventoryLot({ product_name: 'Widget', quantity: 0 })).toThrow(/positive integer/);
    expect(() => createInventoryLot({ product_name: 'Widget', quantity: -3 })).toThrow(/positive integer/);
    const rows = db.prepare('SELECT COUNT(*) as n FROM inventory_lots').get() as any;
    expect(rows.n).toBe(0); // none of the rejected attempts wrote a row
  });

  it('rejects a fractional quantity', () => {
    expect(() => createInventoryLot({ product_name: 'Widget', quantity: 2.5 })).toThrow(/positive integer/);
  });

  it('accepts a valid positive integer quantity', () => {
    const row = createInventoryLot({ product_name: 'Widget', quantity: 3 }) as any;
    expect(row.quantity).toBe(3);
    expect(row.available_quantity).toBe(3);
  });
});

describe('updateInventoryLot', () => {
  it('OLD BUG: PATCH quantity had no validation at all — now rejects zero/negative/fractional', () => {
    const row = createInventoryLot({ product_name: 'Widget', quantity: 5 }) as any;
    expect(() => updateInventoryLot(row.inventory_lot_id, { quantity: 0 })).toThrow(/positive integer/);
    expect(() => updateInventoryLot(row.inventory_lot_id, { quantity: -1 })).toThrow(/positive integer/);
    expect(() => updateInventoryLot(row.inventory_lot_id, { quantity: 1.2 })).toThrow(/positive integer/);
    const unchanged = db.prepare('SELECT quantity FROM inventory_lots WHERE inventory_lot_id = ?').get(row.inventory_lot_id) as any;
    expect(unchanged.quantity).toBe(5); // no partial write
  });

  it('recomputes available_quantity when quantity is validly updated', () => {
    const row = createInventoryLot({ product_name: 'Widget', quantity: 5 }) as any;
    db.prepare('UPDATE inventory_lots SET sold_quantity = 2 WHERE inventory_lot_id = ?').run(row.inventory_lot_id);
    const updated = updateInventoryLot(row.inventory_lot_id, { quantity: 10 }) as any;
    expect(updated.quantity).toBe(10);
    expect(updated.available_quantity).toBe(8);
  });
});

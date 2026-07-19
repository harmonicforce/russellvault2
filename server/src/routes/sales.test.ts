import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
const { db, initSchema } = await import('../db.js');
const { createSale } = await import('./sales.js');

function seedLot(id: string, quantity: number, available = quantity) {
  db.prepare(
    `INSERT INTO inventory_lots (inventory_lot_id, sellable_sku, product_name, quantity, available_quantity, sold_quantity, cost_status)
     VALUES (?, ?, 'Test Lot', ?, ?, 0, 'Uncosted')`,
  ).run(id, `SKU-${id}`, quantity, available);
}

beforeEach(() => {
  initSchema();
  db.exec(`DELETE FROM sales; DELETE FROM inventory_lots;`);
});

describe('createSale', () => {
  it('OLD BUG: `Number(b.quantity_sold) || 1` let a negative quantity through unrejected (a negative number is truthy in JS) — now rejected', () => {
    seedLot('LOT-1', 10);
    expect(() => createSale({ inventory_lot_id: 'LOT-1', quantity_sold: -5 })).toThrow(/positive integer/);
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get('LOT-1') as any;
    expect(lot.sold_quantity).toBe(0); // no partial write
    expect(lot.available_quantity).toBe(10);
  });

  it('OLD BUG: a zero quantity_sold used to silently fall back to 1 instead of being rejected — now rejected', () => {
    seedLot('LOT-2', 10);
    expect(() => createSale({ inventory_lot_id: 'LOT-2', quantity_sold: 0 })).toThrow(/positive integer/);
  });

  it('rejects a fractional quantity_sold', () => {
    seedLot('LOT-3', 10);
    expect(() => createSale({ inventory_lot_id: 'LOT-3', quantity_sold: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a sale exceeding real availability', () => {
    seedLot('LOT-4', 10, 3);
    expect(() => createSale({ inventory_lot_id: 'LOT-4', quantity_sold: 5 })).toThrow(/only 3 unit\(s\) available/);
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get('LOT-4') as any;
    expect(lot.sold_quantity).toBe(0); // no partial write
  });

  it('defaults to quantity_sold = 1 when omitted, and records a valid sale', () => {
    seedLot('LOT-5', 10);
    const sale = createSale({ inventory_lot_id: 'LOT-5', gross_item_price: 25 }) as any;
    expect(sale.quantity_sold).toBe(1);
    const lot = db.prepare('SELECT * FROM inventory_lots WHERE inventory_lot_id = ?').get('LOT-5') as any;
    expect(lot.sold_quantity).toBe(1);
    expect(lot.available_quantity).toBe(9);
  });
});

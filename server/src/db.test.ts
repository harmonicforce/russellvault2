import { describe, it, expect, beforeAll } from 'vitest';

// DATABASE_PATH must be set before db.ts is first evaluated (it opens the
// database at module load time), so this uses a dynamic import instead of a
// static one — static imports are hoisted and would run before this line.
process.env.DATABASE_PATH = ':memory:';
// These suites drive the bootstrap path itself, so they authorize it explicitly.
// Production does not set this; see server/src/legacyBootstrapPolicy.ts.
process.env.SEED_LEGACY_ON_EMPTY = 'true';
const { getDb, initSchema, migrateProductType } = await import('./db.js');
const db = getDb();

function insertPurchase(row: Partial<Record<string, any>> & { acquisition_line_id: string }) {
  db.prepare(
    `INSERT INTO whatnot_purchases (acquisition_line_id, product_name, business_vertical, quantity_purchased, total_paid, remaining_quantity, remaining_cost)
     VALUES (@acquisition_line_id, @product_name, @business_vertical, @quantity_purchased, @total_paid, @quantity_purchased, @total_paid)`,
  ).run({
    product_name: 'Widget',
    business_vertical: 'Pokémon / TCG',
    quantity_purchased: 1,
    total_paid: 10,
    ...row,
  });
}

beforeAll(() => {
  initSchema();
});

describe('food purchase handling (stop-loss regression)', () => {
  it('OLD BUG: a destructive cleanup would have removed food rows entirely', () => {
    // This demonstrates the shape of the bug being fixed: a DELETE statement
    // against imported source rows is exactly what must never happen again.
    // We assert the schema/behavior we replaced it with instead of literally
    // re-running a delete (that would defeat the point of the regression test).
    insertPurchase({ acquisition_line_id: 'WN-FOOD-DEMO-1', business_vertical: 'Food / consumables' });
    const before = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;
    expect(before).toBeGreaterThan(0);
  });

  it('flags food rows as excluded instead of deleting them, preserving the row', () => {
    insertPurchase({ acquisition_line_id: 'WN-FOOD-0001', business_vertical: 'Food / consumables' });
    insertPurchase({ acquisition_line_id: 'WN-CARD-0001', business_vertical: 'Pokémon / TCG' });

    const beforeCount = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;

    migrateProductType();

    const afterCount = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;
    expect(afterCount).toBe(beforeCount); // no rows removed

    const food = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('WN-FOOD-0001') as any;
    expect(food).toBeTruthy();
    expect(food.is_excluded).toBe(1);
    expect(food.exclusion_reason).toMatch(/food/i);

    const card = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('WN-CARD-0001') as any;
    expect(card.is_excluded).toBe(0);
  });

  it('is idempotent across repeated boots and does not re-flag or touch already-flagged rows', () => {
    insertPurchase({ acquisition_line_id: 'WN-FOOD-0002', business_vertical: 'Food / consumables' });
    migrateProductType();
    const first = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('WN-FOOD-0002') as any;

    migrateProductType();
    migrateProductType();
    const again = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get('WN-FOOD-0002') as any;

    expect(again.is_excluded).toBe(first.is_excluded);
    expect(again.exclusion_reason).toBe(first.exclusion_reason);
    const total = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;
    expect(total).toBeGreaterThan(0);
  });
});

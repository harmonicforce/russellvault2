import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
// These suites drive the bootstrap path itself, so they authorize it explicitly.
// Production does not set this; see server/src/legacyBootstrapPolicy.ts.
process.env.SEED_LEGACY_ON_EMPTY = 'true';
const { getDb, initSchema } = await import('../db.js');
const db = getDb();
const { createListing, updateListing } = await import('./listings.js');

function seedLot(id: string, available: number) {
  db.prepare(
    `INSERT INTO inventory_lots (inventory_lot_id, sellable_sku, product_name, quantity, available_quantity, cost_status, listing_status)
     VALUES (?, ?, 'Test Lot', ?, ?, 'Uncosted', 'Not listed')`,
  ).run(id, `SKU-${id}`, available, available);
}

beforeEach(() => {
  initSchema();
  db.exec(`DELETE FROM ebay_listings; DELETE FROM inventory_lots;`);
});

describe('createListing', () => {
  it('OLD BUG: quantity_to_list had no validation at all — now rejects zero/negative/fractional', () => {
    seedLot('LOT-1', 5);
    expect(() => createListing({ inventory_lot_id: 'LOT-1', quantity_to_list: 0 })).toThrow(/positive integer/);
    expect(() => createListing({ inventory_lot_id: 'LOT-1', quantity_to_list: -2 })).toThrow(/positive integer/);
    expect(() => createListing({ inventory_lot_id: 'LOT-1', quantity_to_list: 1.5 })).toThrow(/positive integer/);
    const rows = db.prepare('SELECT COUNT(*) as n FROM ebay_listings').get() as any;
    expect(rows.n).toBe(0);
  });

  it('defaults quantity_to_list to the lot available_quantity', () => {
    seedLot('LOT-2', 4);
    const listing = createListing({ inventory_lot_id: 'LOT-2' }) as any;
    expect(listing.quantity_to_list).toBe(4);
  });
});

describe('updateListing', () => {
  it('rejects an invalid quantity_to_list on PATCH', () => {
    seedLot('LOT-3', 4);
    const listing = createListing({ inventory_lot_id: 'LOT-3' }) as any;
    expect(() => updateListing(listing.listing_id, { quantity_to_list: 0 })).toThrow(/positive integer/);
  });
});

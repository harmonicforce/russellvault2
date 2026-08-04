import { describe, it, expect, beforeEach } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
// These suites drive the bootstrap path itself, so they authorize it explicitly.
// Production does not set this; see server/src/legacyBootstrapPolicy.ts.
process.env.SEED_LEGACY_ON_EMPTY = 'true';
const { getDb, initSchema } = await import('../db.js');
const db = getDb();
const { getDashboard } = await import('./dashboard.js');

beforeEach(() => {
  initSchema();
  db.exec(`DELETE FROM whatnot_purchases;`);
});

function insertPurchase(id: string, isExcluded: number) {
  db.prepare(
    `INSERT INTO whatnot_purchases (acquisition_line_id, product_name, business_vertical, processed_date, quantity_purchased, total_paid, is_excluded)
     VALUES (?, 'Test Purchase', 'Pokémon / TCG', '2026-01-01', 1, 10, ?)`,
  ).run(id, isExcluded);
}

describe('getDashboard recentPurchases', () => {
  it('excludes flagged purchases from recentPurchases, matching the default business-view filter used elsewhere', () => {
    insertPurchase('WN-VISIBLE-1', 0);
    insertPurchase('WN-EXCLUDED-1', 1);

    const { recentPurchases } = getDashboard();
    const ids = (recentPurchases as any[]).map((r) => r.acquisition_line_id);

    expect(ids).toContain('WN-VISIBLE-1');
    expect(ids).not.toContain('WN-EXCLUDED-1');
  });
});

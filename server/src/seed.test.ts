import { describe, it, expect, beforeAll } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
// These suites drive the bootstrap path itself, so they authorize it explicitly.
// Production does not set this; see server/src/legacyBootstrapPolicy.ts.
process.env.SEED_LEGACY_ON_EMPTY = 'true';
const { getDb, migrateProductType } = await import('./db.js');
const db = getDb();
const { seedIfEmpty } = await import('./seed.js');

beforeAll(() => {
  seedIfEmpty();
  migrateProductType();
});

describe('startup preserves all imported Whatnot source rows (acceptance)', () => {
  it('leaves all 2,149 repository Whatnot source rows intact after boot', () => {
    const total = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;
    expect(total).toBe(2149);
  });

  it('flags food/consumable rows as excluded rather than removing them', () => {
    const excluded = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases WHERE is_excluded = 1').get() as any).n;
    expect(excluded).toBeGreaterThan(0);
    const total = (db.prepare('SELECT COUNT(*) as n FROM whatnot_purchases').get() as any).n;
    expect(total).toBe(2149); // excluded rows are still counted — nothing was deleted
  });

  it('excluded rows remain directly queryable by ID (not hidden from the database, only from default list views)', () => {
    const excludedRow = db.prepare(`SELECT * FROM whatnot_purchases WHERE is_excluded = 1 LIMIT 1`).get() as any;
    expect(excludedRow).toBeTruthy();
    const byId = db.prepare('SELECT * FROM whatnot_purchases WHERE acquisition_line_id = ?').get(excludedRow.acquisition_line_id) as any;
    expect(byId).toBeTruthy();
    expect(byId.is_excluded).toBe(1);
  });
});

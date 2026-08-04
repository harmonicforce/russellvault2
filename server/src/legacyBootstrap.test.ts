// S0.1 safety proof.
//
// These tests run against REAL temporary SQLite databases on disk, not mocks.
// Asserting "seedIfEmpty was not called" would prove nothing about what the
// process actually did to a database, so the central test here bootstraps a
// real database, snapshots its entire catalog and its classification and
// exclusion columns, runs startup again with bootstrap disabled, and requires
// the snapshot to be byte-identical.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLegacyDatabase, initSchema, migrateProductType, type LegacyDatabaseOpenState } from './db.js';
import { seedIfEmpty } from './seed.js';
import { prepareLegacyDatabase } from './legacyBootstrap.js';
import { checkLegacyDatabaseHealth } from './legacyDatabaseHealth.js';
import { LEGACY_BOOTSTRAP_FLAG } from './legacyBootstrapPolicy.js';

const PROD_LOCKED = { NODE_ENV: 'production' } as const;
const PROD_BOOTSTRAP = { NODE_ENV: 'production', [LEGACY_BOOTSTRAP_FLAG]: 'true' } as const;

let tmpRoot: string;
let goldenPath: string;
let serial = 0;

function tmpPath(label: string): string {
  serial += 1;
  return path.join(tmpRoot, `${label}-${serial}.db`);
}

function openWritable(dbPath: string): Database.Database {
  const state = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: true, requestWritesEnabled: true });
  if (state.status !== 'open') throw new Error(`expected an open database, got ${state.reason}`);
  return state.db;
}

/**
 * A writable handle with foreign keys OFF, used only to manufacture damage.
 * Losing a volume does not respect referential integrity, so the fixtures that
 * simulate it must not either.
 */
function openForDamageSetup(dbPath: string): Database.Database {
  const db = openWritable(dbPath);
  db.pragma('foreign_keys = OFF');
  return db;
}

function openProductionLike(dbPath: string): LegacyDatabaseOpenState {
  // Exactly the production default: neither permission granted.
  return openLegacyDatabase({ path: dbPath, bootstrapAuthorized: false, requestWritesEnabled: false });
}

/**
 * Everything a bootstrap could possibly have changed: the full catalog, the row
 * counts, every classification and exclusion value, and the classifier metadata.
 */
function snapshot(db: Database.Database) {
  const tables = ['inventory_lots', 'whatnot_purchases', 'cost_links', 'ebay_listings', 'sales', 'checks'];
  return {
    catalog: db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`).all(),
    purchaseColumns: db.prepare(`PRAGMA table_info(whatnot_purchases)`).all(),
    counts: Object.fromEntries(
      tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
    ),
    // Representative field values, not just aggregates: a re-tag or a re-flag
    // would leave the counts identical while changing these.
    classification: db
      .prepare(
        `SELECT acquisition_line_id, product_type, product_type_source, is_excluded, exclusion_reason
           FROM whatnot_purchases ORDER BY acquisition_line_id`,
      )
      .all(),
    appMeta: db.prepare(`SELECT key, value FROM app_meta ORDER BY key`).all(),
  };
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-s01-'));
  goldenPath = path.join(tmpRoot, 'golden.db');
  // One authorized bootstrap builds the reference database every other test copies.
  const db = openWritable(goldenPath);
  seedIfEmpty(db);
  migrateProductType(db);
  db.close(); // checkpoints WAL into the main file so a plain copy is consistent
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function populatedCopy(label = 'populated'): string {
  const target = tmpPath(label);
  fs.copyFileSync(goldenPath, target);
  return target;
}

describe('an existing populated database is not touched when bootstrap is disabled', () => {
  it('leaves the catalog, every row count, every classification and the metadata identical', () => {
    const dbPath = populatedCopy();

    const before = (() => {
      const db = openWritable(dbPath);
      const s = snapshot(db);
      db.close();
      return s;
    })();

    // Sanity: this really is a populated database, so the assertions below mean something.
    expect(before.counts.inventory_lots).toBe(1487);
    expect(before.counts.whatnot_purchases).toBe(2149);
    expect(before.classification.some((r: any) => r.is_excluded === 1)).toBe(true);
    expect(before.classification.some((r: any) => r.product_type)).toBe(true);

    const state = openProductionLike(dbPath);
    expect(state.status).toBe('open');

    let bootstrapRan = false;
    const outcome = prepareLegacyDatabase({
      env: { ...PROD_LOCKED },
      openState: () => state,
      runBootstrap: () => { bootstrapRan = true; },
      log: () => {},
    });

    expect(outcome).toEqual({ status: 'skipped_not_authorized' });
    expect(bootstrapRan).toBe(false);
    if (state.status === 'open') state.db.close();

    const after = (() => {
      const db = openWritable(dbPath);
      const s = snapshot(db);
      db.close();
      return s;
    })();

    expect(after.catalog).toEqual(before.catalog);
    expect(after.purchaseColumns).toEqual(before.purchaseColumns);
    expect(after.counts).toEqual(before.counts);
    expect(after.classification).toEqual(before.classification);
    expect(after.appMeta).toEqual(before.appMeta);
  });

  it('rejects writes at the SQL layer while both permissions are withheld', () => {
    const dbPath = populatedCopy('queryonly');
    const state = openProductionLike(dbPath);
    if (state.status !== 'open') throw new Error('expected an open database');
    expect(state.queryOnly).toBe(true);

    // Direct proof of the guarantee this slice claims: schema and data changes
    // are refused by the connection itself, not merely skipped by our code.
    expect(() => state.db.exec(`CREATE TABLE s01_probe (x TEXT)`)).toThrow();
    expect(() => state.db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN s01_probe TEXT`)).toThrow();
    expect(() => state.db.exec(`UPDATE whatnot_purchases SET product_type = 'X'`)).toThrow();
    expect(() => state.db.exec(`INSERT INTO checks (check_id) VALUES ('S01')`)).toThrow();
    expect(() => state.db.exec(`DELETE FROM inventory_lots`)).toThrow();
    // Reads still work, which is what keeps a healthy production app serving.
    expect((state.db.prepare(`SELECT COUNT(*) AS n FROM inventory_lots`).get() as any).n).toBe(1487);
    state.db.close();
  });

  it('allows writes when an owner deliberately re-enables legacy HTTP writes', () => {
    const dbPath = populatedCopy('writable');
    const state = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: false, requestWritesEnabled: true });
    if (state.status !== 'open') throw new Error('expected an open database');
    expect(state.queryOnly).toBe(false);
    expect(() => state.db.exec(`UPDATE checks SET notes = 'ok' WHERE check_id = 'OP-001'`)).not.toThrow();
    state.db.close();
  });
});

describe('a missing database is reported, never rebuilt', () => {
  it('does not create the file, does not load fixtures, and reports a bounded reason', () => {
    const dbPath = tmpPath('missing');
    expect(fs.existsSync(dbPath)).toBe(false);

    const state = openProductionLike(dbPath);
    expect(state).toEqual({ status: 'unavailable', reason: 'legacy_database_missing' });

    let bootstrapRan = false;
    const outcome = prepareLegacyDatabase({
      env: { ...PROD_LOCKED },
      openState: () => state,
      runBootstrap: () => { bootstrapRan = true; },
      log: () => {},
    });
    expect(outcome).toEqual({ status: 'skipped_not_authorized' });
    expect(bootstrapRan).toBe(false);

    // The decisive assertion: no database appeared, so no fixture data could have.
    expect(fs.existsSync(dbPath)).toBe(false);

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: () => state });
    expect(health.legacyDatabaseAvailable).toBe(false);
    expect(health.legacySeeded).toBe(false);
    expect(health.reason).toBe('legacy_database_missing');
  });

  it('does not create the parent directory of a mispointed volume path', () => {
    const dbPath = path.join(tmpRoot, 'never-mounted', 'vault.db');
    const state = openProductionLike(dbPath);
    expect(state).toEqual({ status: 'unavailable', reason: 'legacy_database_missing' });
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });
});

describe('a structurally incomplete or emptied database is reported, never repaired', () => {
  it('does not reseed baseline tables that have been emptied', () => {
    const dbPath = populatedCopy('emptied');
    const setup = openForDamageSetup(dbPath);
    setup.exec(`DELETE FROM inventory_lots; DELETE FROM whatnot_purchases;`);
    setup.close();

    const state = openProductionLike(dbPath);
    let bootstrapRan = false;
    prepareLegacyDatabase({
      env: { ...PROD_LOCKED },
      openState: () => state,
      runBootstrap: () => { bootstrapRan = true; },
      log: () => {},
    });
    expect(bootstrapRan).toBe(false);

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: () => state });
    expect(health.legacyDatabaseAvailable).toBe(true);
    expect(health.legacySchemaPresent).toBe(true);
    expect(health.legacySeeded).toBe(false);
    expect(health.reason).toBe('legacy_baseline_empty');
    if (state.status === 'open') state.db.close();

    const verify = openWritable(dbPath);
    expect((verify.prepare(`SELECT COUNT(*) AS n FROM inventory_lots`).get() as any).n).toBe(0);
    expect((verify.prepare(`SELECT COUNT(*) AS n FROM whatnot_purchases`).get() as any).n).toBe(0);
    verify.close();
  });

  it('does not silently create missing tables', () => {
    const dbPath = tmpPath('partial');
    const setup = openWritable(dbPath);
    setup.exec(`CREATE TABLE inventory_lots (inventory_lot_id TEXT PRIMARY KEY)`);
    setup.close();

    const state = openProductionLike(dbPath);
    let bootstrapRan = false;
    prepareLegacyDatabase({
      env: { ...PROD_LOCKED },
      openState: () => state,
      runBootstrap: () => { bootstrapRan = true; },
      log: () => {},
    });
    expect(bootstrapRan).toBe(false);

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: () => state });
    expect(health.legacySchemaPresent).toBe(false);
    expect(health.reason).toBe('legacy_schema_missing');
    if (state.status === 'open') state.db.close();

    const verify = openWritable(dbPath);
    const tables = (verify.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[])
      .map((r) => r.name);
    expect(tables).toEqual(['inventory_lots']);
    verify.close();
  });

  it('reports a pre-migration database as schema-incomplete rather than migrating it', () => {
    // The realistic "restored an older backup" case: tables exist, but the four
    // columns migrateProductType adds do not. /api/purchases queries them.
    const dbPath = tmpPath('premigration');
    const setup = openWritable(dbPath);
    initSchema(setup);
    setup.prepare(
      `INSERT INTO whatnot_purchases (acquisition_line_id, product_name) VALUES ('WN-A-000001', 'Widget')`,
    ).run();
    setup.prepare(`INSERT INTO inventory_lots (inventory_lot_id) VALUES ('RV-N-000001')`).run();
    setup.close();

    const state = openProductionLike(dbPath);
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: () => state });
    expect(health.legacyDatabaseAvailable).toBe(true);
    expect(health.legacySchemaPresent).toBe(false);
    expect(health.reason).toBe('legacy_schema_missing');
    if (state.status === 'open') state.db.close();

    const verify = openWritable(dbPath);
    const cols = (verify.prepare(`PRAGMA table_info(whatnot_purchases)`).all() as any[]).map((c) => c.name);
    // `is_excluded` and `exclusion_reason` are declared twice in the legacy
    // codebase — inline in initSchema's CREATE TABLE and again as ALTERs in
    // migrateProductType — so a schema-only database already has them.
    // `product_type` and `product_type_source` come only from the migration,
    // and /api/purchases filters on product_type.
    expect(cols).not.toContain('product_type');
    expect(cols).not.toContain('product_type_source');
    verify.close();
  });
});

describe('the explicit bootstrap path still works when authorized', () => {
  it('creates the schema and the expected seed populations, and invents no sales', () => {
    const dbPath = tmpPath('authorized');
    const state = openLegacyDatabase({
      path: dbPath,
      bootstrapAuthorized: true,
      requestWritesEnabled: false,
    });
    if (state.status !== 'open') throw new Error('expected an open database');

    const outcome = prepareLegacyDatabase({
      env: { ...PROD_BOOTSTRAP },
      openState: () => state,
      log: () => {},
    });
    expect(outcome).toEqual({ status: 'bootstrapped' });

    const counts = (t: string) => (state.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n;
    expect(counts('inventory_lots')).toBe(1487);
    expect(counts('whatnot_purchases')).toBe(2149);
    expect(counts('cost_links')).toBe(287);
    expect(counts('ebay_listings')).toBe(20);
    expect(counts('checks')).toBe(7);
    // sales has no repository fixture. A bootstrap must never appear to restore it.
    expect(counts('sales')).toBe(0);

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_BOOTSTRAP }, openState: () => state });
    expect(health.legacySeeded).toBe(true);
    expect(health.legacyBootWritesEnabled).toBe(true);
    expect(health.reason).toBeUndefined();
    state.db.close();
  });

  it('is idempotent: a second authorized run changes nothing', () => {
    const dbPath = populatedCopy('rerun');
    const state = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: true, requestWritesEnabled: false });
    if (state.status !== 'open') throw new Error('expected an open database');

    const before = snapshot(state.db);
    prepareLegacyDatabase({ env: { ...PROD_BOOTSTRAP }, openState: () => state, log: () => {} });
    prepareLegacyDatabase({ env: { ...PROD_BOOTSTRAP }, openState: () => state, log: () => {} });
    const after = snapshot(state.db);

    expect(after.counts).toEqual(before.counts);
    expect(after.classification).toEqual(before.classification);
    expect(after.appMeta).toEqual(before.appMeta);
    state.db.close();
  });

  it('does not overwrite a populated table from the fixtures', () => {
    const dbPath = tmpPath('populated-partial');
    const state = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: true, requestWritesEnabled: false });
    if (state.status !== 'open') throw new Error('expected an open database');
    initSchema(state.db);
    state.db.prepare(`INSERT INTO checks (check_id, test) VALUES ('OWNER-1', 'owner row')`).run();

    prepareLegacyDatabase({ env: { ...PROD_BOOTSTRAP }, openState: () => state, log: () => {} });

    // `checks` was not empty, so its seven fixture rows were not applied to it.
    const rows = state.db.prepare(`SELECT check_id FROM checks`).all() as any[];
    expect(rows).toEqual([{ check_id: 'OWNER-1' }]);
    // Tables that WERE empty are still seeded — that is the point of the flag.
    expect((state.db.prepare(`SELECT COUNT(*) AS n FROM whatnot_purchases`).get() as any).n).toBe(2149);
    expect((state.db.prepare(`SELECT COUNT(*) AS n FROM inventory_lots`).get() as any).n).toBe(1487);
    state.db.close();
  });

  it('logs that bootstrap was authorized, without a path or a secret', () => {
    const dbPath = populatedCopy('logging');
    const state = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: true, requestWritesEnabled: false });
    if (state.status !== 'open') throw new Error('expected an open database');

    const lines: string[] = [];
    prepareLegacyDatabase({
      env: { ...PROD_BOOTSTRAP },
      openState: () => state,
      log: (m) => lines.push(m),
    });
    state.db.close();

    const output = lines.join('\n');
    expect(output).toContain(LEGACY_BOOTSTRAP_FLAG);
    expect(output).toMatch(/AUTHORIZED/);
    expect(output).toMatch(/authorized legacy bootstrap complete/);
    expect(output).not.toContain(dbPath);
    expect(output).not.toContain(tmpRoot);
    expect(output).not.toMatch(/vault\.db/);
  });

  it('logs the disabled policy on a locked-down start', () => {
    const lines: string[] = [];
    prepareLegacyDatabase({
      env: { ...PROD_LOCKED },
      openState: () => { throw new Error('must not be consulted before the policy decision'); },
      log: (m) => lines.push(m),
    });
    expect(lines.join('\n')).toMatch(/DISABLED/);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLegacyDatabase, initSchema, migrateProductType } from './db.js';
import { seedIfEmpty } from './seed.js';
import {
  buildHealthResponse,
  checkLegacyDatabaseHealth,
  isLegacyDatabaseHealthy,
  type LegacyDatabaseHealth,
  type LegacyHealthReason,
} from './legacyDatabaseHealth.js';
import { LEGACY_BOOTSTRAP_FLAG } from './legacyBootstrapPolicy.js';

const PROD_LOCKED = { NODE_ENV: 'production' } as const;

const ALL_REASONS: LegacyHealthReason[] = [
  'legacy_database_missing',
  'legacy_database_unreadable',
  'legacy_schema_missing',
  'legacy_baseline_empty',
  'legacy_health_check_failed',
];

let tmpRoot: string;
let goldenPath: string;
let serial = 0;

function tmpPath(label: string): string {
  serial += 1;
  return path.join(tmpRoot, `${label}-${serial}.db`);
}

function openWritable(dbPath: string) {
  const s = openLegacyDatabase({ path: dbPath, bootstrapAuthorized: true, requestWritesEnabled: true });
  if (s.status !== 'open') throw new Error(`expected open, got ${s.reason}`);
  return s.db;
}

/** Writable with foreign keys off: used only to manufacture data loss. */
function openForDamageSetup(dbPath: string) {
  const db = openWritable(dbPath);
  db.pragma('foreign_keys = OFF');
  return db;
}

function productionLike(dbPath: string) {
  return () => openLegacyDatabase({ path: dbPath, bootstrapAuthorized: false, requestWritesEnabled: false });
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-s01-health-'));
  goldenPath = path.join(tmpRoot, 'golden.db');
  const db = openWritable(goldenPath);
  seedIfEmpty(db);
  migrateProductType(db);
  db.close();
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function populatedCopy(label: string): string {
  const target = tmpPath(label);
  fs.copyFileSync(goldenPath, target);
  return target;
}

describe('a healthy existing database reports healthy', () => {
  it('reports available, schema present, baseline populated, boot writes off', () => {
    const dbPath = populatedCopy('healthy');
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health).toEqual({
      legacyDatabaseAvailable: true,
      legacySchemaPresent: true,
      legacySeeded: true,
      legacyBootWritesEnabled: false,
    });
    expect(isLegacyDatabaseHealthy(health)).toBe(true);
  });

  it('reflects the bootstrap policy without changing the verdict', () => {
    const dbPath = populatedCopy('policy-echo');
    const on = checkLegacyDatabaseHealth({
      env: { ...PROD_LOCKED, [LEGACY_BOOTSTRAP_FLAG]: 'true' },
      openState: productionLike(dbPath),
    });
    expect(on.legacyBootWritesEnabled).toBe(true);
    expect(isLegacyDatabaseHealthy(on)).toBe(true);
  });

  // A live database legitimately diverges from the repository fixtures: the
  // owner adds lots, and the verified production backup already holds 2,119
  // purchase rows rather than the seed's 2,149. Health must not treat that as
  // a fault.
  it('stays healthy when counts differ from the repository seed counts', () => {
    const dbPath = populatedCopy('divergent');
    const db = openForDamageSetup(dbPath);
    db.exec(`DELETE FROM whatnot_purchases WHERE rowid % 7 = 0`);
    db.prepare(`INSERT INTO inventory_lots (inventory_lot_id, product_name) VALUES ('RV-N-999999', 'New')`).run();
    const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM whatnot_purchases`).get() as any).n;
    db.close();
    expect(remaining).toBeLessThan(2149);

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.legacySeeded).toBe(true);
    expect(isLegacyDatabaseHealthy(health)).toBe(true);
  });

  // cost_links and ebay_listings are inspected but deliberately excluded from
  // the verdict — they are working tables, not source imports.
  it('stays healthy when the derived working tables are empty', () => {
    const dbPath = populatedCopy('no-worktables');
    const db = openForDamageSetup(dbPath);
    db.exec(`DELETE FROM cost_links; DELETE FROM ebay_listings;`);
    db.close();

    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.legacySeeded).toBe(true);
    expect(health.reason).toBeUndefined();
  });

  // sales has no fixture and is legitimately empty on a fresh database, so it
  // must never be the sentinel.
  it('stays healthy when sales is empty', () => {
    const dbPath = populatedCopy('no-sales');
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.legacySeeded).toBe(true);
  });
});

describe('an unusable database reports a bounded reason and leaks nothing', () => {
  it('reports a missing database', () => {
    const dbPath = tmpPath('gone');
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.reason).toBe('legacy_database_missing');
    expect(health.legacyDatabaseAvailable).toBe(false);
  });

  it('reports a file that is not a database as unreadable', () => {
    const dbPath = tmpPath('garbage');
    fs.writeFileSync(dbPath, 'this is not a SQLite file');
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.reason).toBe('legacy_database_unreadable');
    expect(health.legacyDatabaseAvailable).toBe(false);
    expect(health.legacySeeded).toBe(false);
  });

  it('reports an emptied baseline', () => {
    const dbPath = populatedCopy('emptied');
    const db = openForDamageSetup(dbPath);
    db.exec(`DELETE FROM inventory_lots;`);
    db.close();
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.legacySchemaPresent).toBe(true);
    expect(health.legacySeeded).toBe(false);
    expect(health.reason).toBe('legacy_baseline_empty');
  });

  it('reports missing schema', () => {
    const dbPath = tmpPath('bare');
    const db = openWritable(dbPath);
    db.exec(`CREATE TABLE unrelated (x TEXT)`);
    db.close();
    const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
    expect(health.reason).toBe('legacy_schema_missing');
  });

  it('turns an unexpected failure into a bounded code rather than an exception', () => {
    const health = checkLegacyDatabaseHealth({
      env: { ...PROD_LOCKED },
      openState: () => { throw new Error('/data/vault.db: SQLITE_CANTOPEN unable to open database file'); },
    });
    expect(health.reason).toBe('legacy_health_check_failed');
  });

  it('never emits a reason outside the closed set, a path, SQL or a driver message', () => {
    const cases: LegacyDatabaseHealth[] = [
      checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(tmpPath('leak-a')) }),
      checkLegacyDatabaseHealth({
        env: { ...PROD_LOCKED },
        openState: () => { throw new Error('/data/vault.db SELECT * FROM secrets — SQLITE_CANTOPEN'); },
      }),
    ];
    for (const health of cases) {
      expect(ALL_REASONS).toContain(health.reason);
      const serialized = JSON.stringify(health);
      expect(serialized).not.toMatch(/\/data|vault\.db|SQLITE_|SELECT |\/tmp/);
      expect(serialized).not.toContain(tmpRoot);
    }
  });
});

describe('the health check does not mutate the database', () => {
  it('leaves the catalog, counts and classification identical after repeated checks', () => {
    const dbPath = populatedCopy('immutable');
    const capture = () => {
      const db = openWritable(dbPath);
      const s = {
        catalog: db.prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`).all(),
        lots: (db.prepare(`SELECT COUNT(*) AS n FROM inventory_lots`).get() as any).n,
        purchases: (db.prepare(`SELECT COUNT(*) AS n FROM whatnot_purchases`).get() as any).n,
        classification: db
          .prepare(`SELECT acquisition_line_id, product_type, is_excluded FROM whatnot_purchases ORDER BY acquisition_line_id`)
          .all(),
        appMeta: db.prepare(`SELECT key, value FROM app_meta ORDER BY key`).all(),
      };
      db.close();
      return s;
    };

    const before = capture();
    for (let i = 0; i < 3; i += 1) {
      const health = checkLegacyDatabaseHealth({ env: { ...PROD_LOCKED }, openState: productionLike(dbPath) });
      expect(isLegacyDatabaseHealthy(health)).toBe(true);
    }
    expect(capture()).toEqual(before);
  });
});

describe('the /api/health response contract', () => {
  const healthy: LegacyDatabaseHealth = {
    legacyDatabaseAvailable: true,
    legacySchemaPresent: true,
    legacySeeded: true,
    legacyBootWritesEnabled: false,
  };

  it('returns 200 and keeps the existing ok and readOnly fields the client reads', () => {
    const { status, body } = buildHealthResponse({ legacy: healthy, readOnly: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.readOnly).toBe(true);
    expect(body).toEqual({
      ok: true,
      readOnly: true,
      legacyDatabaseAvailable: true,
      legacySchemaPresent: true,
      legacySeeded: true,
      legacyBootWritesEnabled: false,
    });
  });

  it('reports readOnly=false when an owner has re-enabled legacy HTTP writes', () => {
    const { body } = buildHealthResponse({ legacy: healthy, readOnly: false });
    expect(body.readOnly).toBe(false);
    expect(body.ok).toBe(true);
  });

  it('returns 503 with ok=false and a bounded reason when the database is unusable', () => {
    const { status, body } = buildHealthResponse({
      legacy: {
        legacyDatabaseAvailable: false,
        legacySchemaPresent: false,
        legacySeeded: false,
        legacyBootWritesEnabled: false,
        reason: 'legacy_database_missing',
      },
      readOnly: true,
    });
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    // readOnly still reports the write-guard state, independent of the failure.
    expect(body.readOnly).toBe(true);
    expect(body.reason).toBe('legacy_database_missing');
  });

  it('returns 503 for an emptied baseline, which is the lost-volume signature', () => {
    const { status, body } = buildHealthResponse({
      legacy: {
        legacyDatabaseAvailable: true,
        legacySchemaPresent: true,
        legacySeeded: false,
        legacyBootWritesEnabled: false,
        reason: 'legacy_baseline_empty',
      },
      readOnly: true,
    });
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it('omits reason entirely when healthy', () => {
    const { body } = buildHealthResponse({ legacy: healthy, readOnly: true });
    expect('reason' in body).toBe(false);
  });
});

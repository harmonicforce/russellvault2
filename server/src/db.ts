import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyPurchase, CLASSIFIER_VERSION } from './classify.js';
import { legacyBootWritesEnabled, type EnvLike } from './legacyBootstrapPolicy.js';
import { resolveLegacyWritesEnabled } from './legacyWriteGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DATA_DIR lets a hosting platform (e.g. a Railway volume) point the SQLite
 * file at persistent storage; DATABASE_PATH overrides the whole path. Resolved
 * in a function rather than at module scope so tests can evaluate it against an
 * explicit environment.
 */
export function legacyDatabasePath(env: EnvLike = process.env): string {
  const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  return env.DATABASE_PATH || path.join(dataDir, 'vault.db');
}

/** SQLite's two non-file targets. Neither can be "missing" on disk. */
function isEphemeralTarget(dbPath: string): boolean {
  return dbPath === ':memory:' || dbPath === '';
}

export type LegacyDatabaseUnavailableReason =
  | 'legacy_database_missing'
  | 'legacy_database_unreadable';

/**
 * Thrown when a caller needs the legacy database and it is not usable. Carries
 * a bounded reason code and deliberately never carries the path or the driver's
 * message, so nothing that reaches an HTTP response can leak either.
 */
export class LegacyDatabaseUnavailableError extends Error {
  readonly reason: LegacyDatabaseUnavailableReason;
  constructor(reason: LegacyDatabaseUnavailableReason) {
    super(`legacy database unavailable: ${reason}`);
    this.name = 'LegacyDatabaseUnavailableError';
    this.reason = reason;
  }
}

export type LegacyDatabaseOpenState =
  | {
      status: 'open';
      db: Database.Database;
      /** True when SQL-level writes are rejected by `PRAGMA query_only`. */
      queryOnly: boolean;
    }
  | { status: 'unavailable'; reason: LegacyDatabaseUnavailableReason };

export interface OpenLegacyDatabaseOptions {
  path: string;
  /** May the process create or alter the database? (SEED_LEGACY_ON_EMPTY) */
  bootstrapAuthorized: boolean;
  /** May HTTP requests write? (ALLOW_LEGACY_WRITES / NODE_ENV) */
  requestWritesEnabled: boolean;
}

/**
 * Opens the legacy database under an explicit policy. No module state, no
 * defaults read from the environment — the caller supplies everything, which is
 * what makes the safety properties testable against temporary databases.
 *
 * Two policy effects, and the honest limits of each:
 *
 *   * `fileMustExist` is set whenever bootstrap is NOT authorized. A missing
 *     database is then reported as `legacy_database_missing` instead of being
 *     created. This is what stops a lost or mispointed volume from producing a
 *     brand-new database that startup would then fill from repository fixtures.
 *
 *   * `PRAGMA query_only` is set whenever NEITHER permission is granted. That
 *     makes the connection reject every INSERT, UPDATE, DELETE and DDL
 *     statement at the SQL layer, so no schema object and no business row can
 *     change through this handle.
 *
 * `query_only` is not the same as opening the file read-only. SQLite may still
 * perform engine-level writes — WAL and `-shm` bookkeeping, journal state,
 * locking — against an existing database, and this code does not prevent that.
 * The guarantee being claimed is the narrower one: no schema change and no
 * business-data change. `journal_mode` is deliberately not set when the
 * connection is query-only, because setting it is itself a write; an existing
 * production database already records WAL mode in its own header, so nothing is
 * lost by leaving it alone.
 */
export function openLegacyDatabase(options: OpenLegacyDatabaseOptions): LegacyDatabaseOpenState {
  const { path: dbPath, bootstrapAuthorized, requestWritesEnabled } = options;
  const ephemeral = isEphemeralTarget(dbPath);
  const queryOnly = !bootstrapAuthorized && !requestWritesEnabled;

  // Creating the parent directory is itself a filesystem write, so it happens
  // only when bootstrap is authorized. Without authorization a missing
  // directory is a missing database, which is exactly what we want to report.
  if (bootstrapAuthorized && !ephemeral) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  let connection: Database.Database;
  try {
    connection = new Database(dbPath, {
      fileMustExist: !bootstrapAuthorized && !ephemeral,
    });
  } catch {
    // better-sqlite3 reports "unable to open database file" for both a missing
    // file under fileMustExist and an unreadable one. Distinguish them by
    // asking the filesystem rather than by parsing a driver message.
    const missing = !ephemeral && !fs.existsSync(dbPath);
    return { status: 'unavailable', reason: missing ? 'legacy_database_missing' : 'legacy_database_unreadable' };
  }

  try {
    if (queryOnly) {
      // Order matters: foreign_keys is a connection-level setting and writes
      // nothing, but it cannot be changed once query_only is on.
      connection.pragma('foreign_keys = ON');
      connection.pragma('query_only = true');
    } else {
      connection.pragma('journal_mode = WAL');
      connection.pragma('foreign_keys = ON');
    }
  } catch {
    connection.close();
    return { status: 'unavailable', reason: 'legacy_database_unreadable' };
  }

  return { status: 'open', db: connection, queryOnly };
}

/** Opens under the live process environment. Memoized: one connection per process. */
let processState: LegacyDatabaseOpenState | null = null;

export function legacyDatabaseState(env: EnvLike = process.env): LegacyDatabaseOpenState {
  if (processState === null) {
    processState = openLegacyDatabase({
      path: legacyDatabasePath(env),
      bootstrapAuthorized: legacyBootWritesEnabled(env),
      requestWritesEnabled: resolveLegacyWritesEnabled(env),
    });
  }
  return processState;
}

/**
 * The legacy connection. Throws `LegacyDatabaseUnavailableError` when the
 * database is missing or unreadable, rather than silently substituting an empty
 * one — an empty stand-in would let every legacy read return "no rows" and look
 * healthy, which is the counterfeit-recovery failure this slice exists to stop.
 */
export function getDb(): Database.Database {
  const state = legacyDatabaseState();
  if (state.status === 'open') return state.db;
  throw new LegacyDatabaseUnavailableError(state.reason);
}

export function initSchema(target: Database.Database = getDb()) {
  const db = target;
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_lots (
      inventory_lot_id TEXT PRIMARY KEY,
      sellable_sku TEXT,
      reserved_child_id TEXT,
      active_child_id TEXT,
      record_origin TEXT,
      intake_status TEXT,
      date_received TEXT,
      acquisition_source TEXT,
      business_vertical TEXT,
      category TEXT,
      product_name TEXT,
      variant_model_set TEXT,
      featured_subject TEXT,
      card_number TEXT,
      language TEXT,
      quantity REAL DEFAULT 0,
      tracking_mode TEXT,
      condition_or_quality TEXT,
      condition_reviewed TEXT,
      grading_company TEXT,
      numeric_grade TEXT,
      grade_designation TEXT,
      certification_number TEXT,
      shoe_size TEXT,
      apparel_size TEXT,
      color TEXT,
      serial_number TEXT,
      product_format TEXT,
      seal_or_packaging_condition TEXT,
      physical_reference TEXT,
      location_code TEXT,
      recorded_unit_value REAL,
      owner_notes TEXT,
      source_file TEXT,
      source_row INTEGER,
      original_file_id TEXT,
      confirmed_cost_basis REAL DEFAULT 0,
      cost_status TEXT DEFAULT 'Uncosted',
      confirmed_allocated_quantity REAL DEFAULT 0,
      listing_status TEXT DEFAULT 'Not listed',
      sold_quantity REAL DEFAULT 0,
      available_quantity REAL DEFAULT 0,
      row_readiness TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS whatnot_purchases (
      acquisition_line_id TEXT PRIMARY KEY,
      order_id TEXT,
      processed_date TEXT,
      seller TEXT,
      business_vertical TEXT,
      product_name TEXT,
      reference_number TEXT,
      quantity_purchased REAL,
      total_paid REAL,
      unit_cost REAL,
      order_status TEXT,
      source_file TEXT,
      confirmed_allocated_quantity REAL DEFAULT 0,
      remaining_quantity REAL,
      confirmed_allocated_cost REAL DEFAULT 0,
      remaining_cost REAL,
      reconciliation_status TEXT DEFAULT 'Unmatched',
      is_excluded INTEGER DEFAULT 0,
      exclusion_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS cost_links (
      allocation_id TEXT PRIMARY KEY,
      inventory_lot_id TEXT REFERENCES inventory_lots(inventory_lot_id),
      inventory_product TEXT,
      inventory_quantity REAL,
      acquisition_line_id TEXT REFERENCES whatnot_purchases(acquisition_line_id),
      purchase_product TEXT,
      seller TEXT,
      purchase_date TEXT,
      purchase_quantity REAL,
      purchase_total REAL,
      allocated_quantity REAL,
      allocated_cost REAL,
      allocation_status TEXT DEFAULT 'Candidate',
      match_confidence TEXT,
      match_method TEXT,
      physical_reference TEXT,
      supporting_evidence TEXT,
      owner_notes TEXT,
      row_status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ebay_listings (
      listing_id TEXT PRIMARY KEY,
      inventory_lot_id TEXT REFERENCES inventory_lots(inventory_lot_id),
      sellable_sku TEXT,
      product_name TEXT,
      available_quantity REAL,
      quantity_to_list REAL,
      listing_title TEXT,
      condition_or_item_state TEXT,
      list_price REAL,
      minimum_acceptable_price REAL,
      photos_complete TEXT DEFAULT 'No',
      photo_reference TEXT,
      shipping_policy TEXT,
      return_policy TEXT,
      listing_format TEXT DEFAULT 'Fixed Price',
      best_offer TEXT,
      promotion_rate_percent REAL,
      ebay_category_id TEXT,
      ebay_item_id TEXT,
      listing_url TEXT,
      listed_date TEXT,
      listing_status TEXT DEFAULT 'Draft',
      owner_notes TEXT,
      row_status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      sale_id TEXT PRIMARY KEY,
      listing_id TEXT REFERENCES ebay_listings(listing_id),
      inventory_lot_id TEXT REFERENCES inventory_lots(inventory_lot_id),
      sellable_sku TEXT,
      product_name TEXT,
      ebay_order_id TEXT,
      sold_date TEXT,
      quantity_sold REAL,
      gross_item_price REAL,
      shipping_charged REAL,
      sales_tax_collected REAL,
      ebay_fees REAL,
      promotion_fees REAL,
      shipping_label_cost REAL,
      refund_amount REAL,
      other_expense REAL,
      net_proceeds REAL,
      known_cost_basis_applied REAL,
      profit_after_known_costs REAL,
      profit_status TEXT,
      payment_status TEXT DEFAULT 'Not Paid',
      fulfillment_status TEXT DEFAULT 'Not Packed',
      tracking_number TEXT,
      delivered_date TEXT,
      return_status TEXT,
      owner_notes TEXT,
      row_status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checks (
      check_id TEXT PRIMARY KEY,
      test TEXT,
      actual REAL,
      expected REAL,
      difference REAL,
      status TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_lots(product_name);
    CREATE INDEX IF NOT EXISTS idx_inventory_vertical ON inventory_lots(business_vertical);
    CREATE INDEX IF NOT EXISTS idx_inventory_cost_status ON inventory_lots(cost_status);
    CREATE INDEX IF NOT EXISTS idx_inventory_listing_status ON inventory_lots(listing_status);
    CREATE INDEX IF NOT EXISTS idx_purchases_product ON whatnot_purchases(product_name);
    CREATE INDEX IF NOT EXISTS idx_purchases_seller ON whatnot_purchases(seller);
    CREATE INDEX IF NOT EXISTS idx_purchases_recon ON whatnot_purchases(reconciliation_status);
    CREATE INDEX IF NOT EXISTS idx_costlinks_lot ON cost_links(inventory_lot_id);
    CREATE INDEX IF NOT EXISTS idx_costlinks_line ON cost_links(acquisition_line_id);
    CREATE INDEX IF NOT EXISTS idx_listings_lot ON ebay_listings(inventory_lot_id);
    CREATE INDEX IF NOT EXISTS idx_listings_status ON ebay_listings(listing_status);
    CREATE INDEX IF NOT EXISTS idx_sales_lot ON sales(inventory_lot_id);
  `);
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === col);
}
function meta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key) as any;
  return row?.value;
}
function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// Non-destructive replacement for the old startup DELETE. The food/candy
// lines Jeff and the owner ate at home are not business inventory, but the
// source rows are evidence and must never be removed from the database —
// silently deleting imported source rows was the exact stop-loss bug this
// flag exists to close. Instead, mark them excluded; every read that should
// present a "business" view filters on is_excluded = 0, while the row itself
// is preserved permanently and remains queryable directly. This only stops
// deletion going forward — it does not restore rows the old DELETE already
// removed from a database before this fix was applied (see
// docs/architecture.md for the repository-seed-vs-production-history note).
// Idempotent and safe to run every boot: it only ever flags rows that are
// food and not yet flagged, so it also catches food rows from a future
// import without needing a one-time guard.
function flagFoodPurchases(db: Database.Database) {
  const info = db.prepare(
    `UPDATE whatnot_purchases
        SET is_excluded = 1,
            exclusion_reason = 'Personal food/consumable purchase — excluded from business reconciliation, row preserved'
      WHERE business_vertical = 'Food / consumables'
        AND COALESCE(is_excluded, 0) = 0`,
  ).run();
  if (info.changes > 0) console.log(`flagged ${info.changes} personal food/candy purchases as excluded (rows preserved)`);
}

// Adds and maintains the settled Slab/Single/Sealed/… tag on every purchase.
// Safe and idempotent on an existing database:
//   - only NULL rows are classified on a normal boot;
//   - when CLASSIFIER_VERSION bumps, auto-classified rows are re-tagged, but a
//     row the owner edited by hand (product_type_source = 'manual') is never
//     touched;
//   - cost-link approvals are never touched.
export function migrateProductType(target: Database.Database = getDb()) {
  const db = target;
  db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
  if (!hasColumn(db, 'whatnot_purchases', 'product_type')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN product_type TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_purchases_type ON whatnot_purchases(product_type)`);
  }
  if (!hasColumn(db, 'whatnot_purchases', 'product_type_source')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN product_type_source TEXT`);
  }
  if (!hasColumn(db, 'whatnot_purchases', 'is_excluded')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN is_excluded INTEGER DEFAULT 0`);
  }
  if (!hasColumn(db, 'whatnot_purchases', 'exclusion_reason')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN exclusion_reason TEXT`);
  }

  flagFoodPurchases(db);

  const versionChanged = meta(db, 'classifier_version') !== String(CLASSIFIER_VERSION);
  // On a version bump re-tag everything except owner-edited rows; otherwise just
  // fill in rows that were never classified.
  const rows = db.prepare(
    versionChanged
      ? `SELECT acquisition_line_id, product_name, business_vertical, seller
           FROM whatnot_purchases WHERE COALESCE(product_type_source, 'auto') <> 'manual'`
      : `SELECT acquisition_line_id, product_name, business_vertical, seller
           FROM whatnot_purchases WHERE product_type IS NULL OR product_type = ''`,
  ).all() as any[];

  if (rows.length > 0) {
    const sealedIds = new Set(
      (db.prepare(
        `SELECT DISTINCT acquisition_line_id FROM cost_links WHERE match_method LIKE '%sealed%' AND acquisition_line_id IS NOT NULL`,
      ).all() as any[]).map((r) => r.acquisition_line_id),
    );
    const upd = db.prepare(
      `UPDATE whatnot_purchases SET product_type = @t, product_type_source = 'auto' WHERE acquisition_line_id = @id`,
    );
    const run = db.transaction((rs: any[]) => {
      for (const r of rs) upd.run({ id: r.acquisition_line_id, t: classifyPurchase(r, sealedIds) });
    });
    run(rows);
    console.log(`classified product_type for ${rows.length} purchases (v${CLASSIFIER_VERSION}${versionChanged ? ', re-tag' : ''})`);
  }
  setMeta(db, 'classifier_version', String(CLASSIFIER_VERSION));
}

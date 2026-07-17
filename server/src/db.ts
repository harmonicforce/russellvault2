import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyPurchase, CLASSIFIER_VERSION } from './classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a hosting platform (e.g. a Railway volume) point the SQLite
// file at persistent storage. Falls back to a local ./data directory.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'vault.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
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
      reconciliation_status TEXT DEFAULT 'Unmatched'
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

function hasColumn(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === col);
}
function meta(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key) as any;
  return row?.value;
}
function setMeta(key: string, value: string) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// One-time removal of the food/candy lines Jeff and the owner ate at home —
// never business inventory. Guarded so it runs once and never nukes a food
// item added deliberately later. Skips any line that's referenced by a cost
// link or sale, just in case.
function cleanupFoodPurchases() {
  if (meta('food_cleanup_done') === '1') return;
  const info = db.prepare(
    `DELETE FROM whatnot_purchases
       WHERE business_vertical = 'Food / consumables'
         AND acquisition_line_id NOT IN (SELECT acquisition_line_id FROM cost_links WHERE acquisition_line_id IS NOT NULL)
         AND acquisition_line_id NOT IN (SELECT inventory_lot_id FROM sales WHERE inventory_lot_id IS NOT NULL)`,
  ).run();
  setMeta('food_cleanup_done', '1');
  if (info.changes > 0) console.log(`removed ${info.changes} personal food/candy purchases`);
}

// Adds and maintains the settled Slab/Single/Sealed/… tag on every purchase.
// Safe and idempotent on an existing database:
//   - only NULL rows are classified on a normal boot;
//   - when CLASSIFIER_VERSION bumps, auto-classified rows are re-tagged, but a
//     row the owner edited by hand (product_type_source = 'manual') is never
//     touched;
//   - cost-link approvals are never touched.
export function migrateProductType() {
  db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
  if (!hasColumn('whatnot_purchases', 'product_type')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN product_type TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_purchases_type ON whatnot_purchases(product_type)`);
  }
  if (!hasColumn('whatnot_purchases', 'product_type_source')) {
    db.exec(`ALTER TABLE whatnot_purchases ADD COLUMN product_type_source TEXT`);
  }

  cleanupFoodPurchases();

  const versionChanged = meta('classifier_version') !== String(CLASSIFIER_VERSION);
  // On a version bump re-tag everything except owner-edited rows; otherwise just
  // fill in rows that were never classified.
  const rows = db.prepare(
    versionChanged
      ? `SELECT acquisition_line_id, product_name, business_vertical
           FROM whatnot_purchases WHERE COALESCE(product_type_source, 'auto') <> 'manual'`
      : `SELECT acquisition_line_id, product_name, business_vertical
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
  setMeta('classifier_version', String(CLASSIFIER_VERSION));
}

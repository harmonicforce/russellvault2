import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb, initSchema } from './db.js';
import { legacyBootWritesEnabled, LEGACY_BOOTSTRAP_FLAG } from './legacyBootstrapPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, '..', 'seed');

function loadJson<T = any>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf-8'));
}

function insertMany(db: Database.Database, table: string, columns: string[], rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
  const tx = db.transaction((items: Record<string, any>[]) => {
    for (const item of items) {
      const params: Record<string, any> = {};
      for (const c of columns) params[c] = item[c] ?? null;
      stmt.run(params);
    }
  });
  tx(rows);
}

/**
 * Creates the legacy schema and fills any EMPTY table from the repository
 * fixtures. Only ever called through an authorized bootstrap — see
 * legacyBootstrap.ts. It is not, and must not become, a startup default.
 *
 * `INSERT OR IGNORE` into empty tables only: a populated table is never
 * overwritten, and re-running is a no-op. Note that `sales` has no fixture and
 * is deliberately not seeded here — production sales exist in no repository
 * artifact, so this path cannot recreate them and must never be mistaken for a
 * restore.
 */
export function seedIfEmpty(target: Database.Database = getDb()) {
  const db = target;
  initSchema(db);

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as any).n as number;

  if (count('inventory_lots') === 0) {
    const inventory = loadJson<any[]>('inventory.json');
    const cols = [
      'inventory_lot_id', 'sellable_sku', 'reserved_child_id', 'active_child_id', 'record_origin',
      'intake_status', 'date_received', 'acquisition_source', 'business_vertical', 'category',
      'product_name', 'variant_model_set', 'featured_subject', 'card_number', 'language', 'quantity',
      'tracking_mode', 'condition_or_quality', 'condition_reviewed', 'grading_company', 'numeric_grade',
      'grade_designation', 'certification_number', 'shoe_size', 'apparel_size', 'color', 'serial_number',
      'product_format', 'seal_or_packaging_condition', 'physical_reference', 'location_code',
      'recorded_unit_value', 'owner_notes', 'source_file', 'source_row', 'original_file_id',
      'confirmed_cost_basis', 'cost_status', 'confirmed_allocated_quantity', 'listing_status',
      'sold_quantity', 'available_quantity', 'row_readiness',
    ];
    insertMany(db, 'inventory_lots', cols, inventory);
    console.log(`seeded inventory_lots: ${inventory.length}`);
  }

  if (count('whatnot_purchases') === 0) {
    const purchases = loadJson<any[]>('whatnot_purchases.json');
    const cols = [
      'acquisition_line_id', 'order_id', 'processed_date', 'seller', 'business_vertical', 'product_name',
      'reference_number', 'quantity_purchased', 'total_paid', 'unit_cost', 'order_status', 'source_file',
      'confirmed_allocated_quantity', 'remaining_quantity', 'confirmed_allocated_cost', 'remaining_cost',
      'reconciliation_status',
    ];
    insertMany(db, 'whatnot_purchases', cols, purchases);
    console.log(`seeded whatnot_purchases: ${purchases.length}`);
  }

  if (count('cost_links') === 0) {
    const links = loadJson<any[]>('cost_links.json');
    const cols = [
      'allocation_id', 'inventory_lot_id', 'inventory_product', 'inventory_quantity', 'acquisition_line_id',
      'purchase_product', 'seller', 'purchase_date', 'purchase_quantity', 'purchase_total', 'allocated_quantity',
      'allocated_cost', 'allocation_status', 'match_confidence', 'match_method', 'physical_reference',
      'supporting_evidence', 'owner_notes', 'row_status',
    ];
    insertMany(db, 'cost_links', cols, links);
    console.log(`seeded cost_links: ${links.length}`);
  }

  if (count('ebay_listings') === 0) {
    const listings = loadJson<any[]>('ebay_listings.json');
    const cols = [
      'listing_id', 'inventory_lot_id', 'sellable_sku', 'product_name', 'available_quantity',
      'quantity_to_list', 'listing_title', 'condition_or_item_state', 'list_price',
      'minimum_acceptable_price', 'photos_complete', 'photo_reference', 'shipping_policy', 'return_policy',
      'listing_format', 'best_offer', 'promotion_rate_percent', 'ebay_category_id', 'ebay_item_id',
      'listing_url', 'listed_date', 'listing_status', 'owner_notes', 'row_status',
    ];
    insertMany(db, 'ebay_listings', cols, listings);
    console.log(`seeded ebay_listings: ${listings.length}`);
  }

  if (count('checks') === 0) {
    const checks = loadJson<any[]>('checks.json');
    const cols = ['check_id', 'test', 'actual', 'expected', 'difference', 'status', 'notes'];
    insertMany(db, 'checks', cols, checks);
    console.log(`seeded checks: ${checks.length}`);
  }
}

// `npm run seed` is an explicit operator action, so it runs the same authorized
// bootstrap path rather than a second, looser one. The npm script sets the flag;
// invoking this file directly without it refuses, so there is exactly one rule.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!legacyBootWritesEnabled()) {
    console.error(
      `refusing to seed: legacy bootstrap is not authorized. Set ${LEGACY_BOOTSTRAP_FLAG}=true to run this deliberately. ` +
      'Repository fixtures are the original import, not a backup, and are not a valid production restoration source.',
    );
    process.exit(1);
  }
  seedIfEmpty();
  console.log('done');
}

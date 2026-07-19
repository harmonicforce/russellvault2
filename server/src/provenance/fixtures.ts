// Repository fixture registry for the Phase 3 import adapter.
//
// STRICT ALLOWLIST. The adapter can only ever read one of the files named
// here, resolved against the repository's own seed directory. A caller-supplied
// name is matched against this list by exact string equality and is never used
// to build a path, so there is no path traversal surface and no way to reach a
// live file, a production export, a mounted volume, or anything outside the
// repository.
//
// These fixtures are the SAME files the legacy SQLite seeder reads. The adapter
// opens them read-only and never writes, renames, or mutates them, so the
// canonical source IDs they contain (WN-A-*, RV-LST-*, OP-*) are preserved
// byte-for-byte.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src/provenance -> server/seed
export const SEED_DIR = path.resolve(here, '..', '..', 'seed');

export interface FixtureDefinition {
  /** Exact filename; also the source_label recorded on the import job. */
  readonly filename: string;
  /** Which parser handles this fixture's row shape. */
  readonly shape: 'whatnot_purchase' | 'check' | 'ebay_listing' | 'generic_row';
  /**
   * The field carrying the source's own natural key, when it has one. Recorded
   * as source_row_key for comparison; never treated as a canonical identifier.
   */
  readonly rowKeyField: string | null;
  /** Numeric fields summed into the job's declared source totals. */
  readonly totalFields: readonly string[];
  readonly description: string;
}

export const FIXTURES: readonly FixtureDefinition[] = [
  {
    filename: 'whatnot_purchases.json',
    shape: 'whatnot_purchase',
    rowKeyField: 'acquisition_line_id',
    totalFields: ['total_paid', 'quantity_purchased'],
    description: 'Whatnot acquisition lines exported from the legacy workbook',
  },
  {
    filename: 'ebay_listings.json',
    shape: 'ebay_listing',
    rowKeyField: 'listing_id',
    totalFields: ['available_quantity', 'quantity_to_list'],
    description: 'eBay listing worksheet rows',
  },
  {
    filename: 'checks.json',
    shape: 'check',
    rowKeyField: 'check_id',
    totalFields: ['actual', 'expected', 'difference'],
    description: 'Operational reconciliation checks',
  },
  {
    filename: 'inventory.json',
    shape: 'generic_row',
    rowKeyField: 'inventory_lot_id',
    totalFields: [],
    description: 'Inventory lot rows (staged as raw provenance only)',
  },
  {
    filename: 'cost_links.json',
    shape: 'generic_row',
    rowKeyField: 'cost_link_id',
    totalFields: [],
    description: 'Cost-link rows (staged as raw provenance only)',
  },
  {
    filename: 'sales.json',
    shape: 'generic_row',
    rowKeyField: null,
    totalFields: [],
    description: 'Sales rows (empty in this repository)',
  },
] as const;

export function listFixtures(): readonly FixtureDefinition[] {
  return FIXTURES;
}

export function findFixture(filename: string): FixtureDefinition | null {
  return FIXTURES.find((f) => f.filename === filename) ?? null;
}

// Resolves an allowlisted fixture to its absolute path. Takes the definition,
// not a raw string, so an unvalidated name can never reach this function.
export function fixturePath(fixture: FixtureDefinition): string {
  return path.join(SEED_DIR, fixture.filename);
}

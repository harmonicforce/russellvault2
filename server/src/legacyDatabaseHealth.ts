// Honest readiness reporting for the legacy SQLite database.
//
// The point of this module is to make a lost, empty, mispointed or
// half-restored legacy volume LOOK BROKEN. Before S0.1 the same situation was
// silently repaired from repository fixtures and reported as healthy, which is
// the worst available outcome: most tables plausibly repopulated from the
// original import, `sales` gone entirely because it has no fixture, and nothing
// in the response to say so.
//
// Everything here is read-only. It runs COUNT and catalog queries and issues no
// DDL or DML. When neither legacy permission is granted the connection is also
// `query_only`, so the database layer would reject a write from this path even
// if one were introduced by mistake.

import type Database from 'better-sqlite3';
import type { LegacyDatabaseOpenState } from './db.js';
import { legacyDatabaseState } from './db.js';
import { legacyBootWritesEnabled, type EnvLike } from './legacyBootstrapPolicy.js';

/**
 * Bounded reason codes. Deliberately a closed set: an operator and a monitor
 * both need to match on these, and none of them may carry a path, a SQL
 * fragment, a driver message or a stack trace.
 */
export type LegacyHealthReason =
  | 'legacy_database_missing'
  | 'legacy_database_unreadable'
  | 'legacy_schema_missing'
  | 'legacy_baseline_empty'
  | 'legacy_health_check_failed';

export interface LegacyDatabaseHealth {
  /** The database could be opened. */
  legacyDatabaseAvailable: boolean;
  /** Every table and column the legacy read paths depend on is present. */
  legacySchemaPresent: boolean;
  /** The imported legacy baseline is present rather than catastrophically empty. */
  legacySeeded: boolean;
  /** Whether this process is permitted to create, migrate or seed the database. */
  legacyBootWritesEnabled: boolean;
  /** Present only when unhealthy. */
  reason?: LegacyHealthReason;
}

/**
 * The tables every legacy read path depends on. `app_meta` and `meta` are
 * excluded on purpose: `meta` is dead schema that nothing reads, and `app_meta`
 * is only ever touched by the bootstrap path, which is now gated.
 */
const REQUIRED_TABLES = [
  'inventory_lots',
  'whatnot_purchases',
  'cost_links',
  'ebay_listings',
  'sales',
  'checks',
] as const;

/**
 * Columns added to `whatnot_purchases` by `migrateProductType`. They are checked
 * because `GET /api/purchases` and `GET /api/dashboard` both query
 * `is_excluded` and `product_type`, so a database restored from a backup taken
 * before that migration will fail those routes. Now that bootstrap is gated,
 * that database will no longer silently migrate itself — so health has to say so.
 */
const REQUIRED_PURCHASE_COLUMNS = [
  'product_type',
  'product_type_source',
  'is_excluded',
  'exclusion_reason',
] as const;

/**
 * Tables inspected for emptiness. All four imported tables are counted, but only
 * `inventory_lots` and `whatnot_purchases` decide the verdict — see
 * `BASELINE_TABLES` below.
 */
const INSPECTED_TABLES = ['inventory_lots', 'whatnot_purchases', 'cost_links', 'ebay_listings'] as const;

/**
 * The emptiness predicate: the two imported SOURCE tables must each hold at
 * least one row.
 *
 * Why these two, and why "at least one" rather than a count match:
 *
 *   * No legacy route can delete from either table. The legacy API has no
 *     DELETE endpoint at all and issues no `DELETE FROM` anywhere in its
 *     production code, so neither table can reach zero through normal use.
 *     Zero rows therefore means the data was lost by something outside the
 *     application — a missing volume, a remount, a wrong path — which is
 *     exactly the condition this signal exists to catch.
 *
 *   * Matching repository seed counts (1,487 and 2,149) would be wrong. A live
 *     database legitimately diverges: the owner adds lots, and the verified
 *     production backup already holds 2,119 purchase rows rather than 2,149.
 *     Health must detect catastrophic emptiness, not punish a database for
 *     having history.
 *
 *   * `cost_links` and `ebay_listings` are counted and reported but excluded
 *     from the verdict. They are working tables rather than source imports, and
 *     any event capable of emptying them empties `inventory_lots` too, so
 *     including them would add false-alarm surface without adding detection.
 *
 *   * `sales` is deliberately NOT a sentinel. It has no repository fixture, so
 *     it can be legitimately empty on a fresh database, and using it would
 *     report a healthy production database as broken.
 */
const BASELINE_TABLES = ['inventory_lots', 'whatnot_purchases'] as const;

function tableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export interface LegacyHealthDeps {
  env?: EnvLike;
  openState?: () => LegacyDatabaseOpenState;
}

/** Read-only. Never throws: an unexpected failure becomes a bounded reason code. */
export function checkLegacyDatabaseHealth(deps: LegacyHealthDeps = {}): LegacyDatabaseHealth {
  const env = deps.env ?? process.env;
  const bootWrites = legacyBootWritesEnabled(env);
  const unhealthy = (reason: LegacyHealthReason): LegacyDatabaseHealth => ({
    legacyDatabaseAvailable: reason !== 'legacy_database_missing' && reason !== 'legacy_database_unreadable',
    legacySchemaPresent: false,
    legacySeeded: false,
    legacyBootWritesEnabled: bootWrites,
    reason,
  });

  let state: LegacyDatabaseOpenState;
  try {
    state = (deps.openState ?? (() => legacyDatabaseState(env)))();
  } catch {
    return unhealthy('legacy_health_check_failed');
  }

  if (state.status !== 'open') return unhealthy(state.reason);

  // The catalog read is separated because it is the first statement to touch
  // the file. better-sqlite3 opens lazily, so a corrupt or non-SQLite file
  // opens cleanly and fails here — which is an unreadable database, not an
  // unexplained health failure.
  let tables: Set<string>;
  try {
    tables = tableNames(state.db);
  } catch {
    return unhealthy('legacy_database_unreadable');
  }

  try {
    const missingTable = REQUIRED_TABLES.some((t) => !tables.has(t));
    if (missingTable) {
      return {
        legacyDatabaseAvailable: true,
        legacySchemaPresent: false,
        legacySeeded: false,
        legacyBootWritesEnabled: bootWrites,
        reason: 'legacy_schema_missing',
      };
    }

    const purchaseColumns = columnNames(state.db, 'whatnot_purchases');
    const missingColumn = REQUIRED_PURCHASE_COLUMNS.some((c) => !purchaseColumns.has(c));
    if (missingColumn) {
      return {
        legacyDatabaseAvailable: true,
        legacySchemaPresent: false,
        legacySeeded: false,
        legacyBootWritesEnabled: bootWrites,
        reason: 'legacy_schema_missing',
      };
    }

    // All four imported tables are inspected; two of them decide the verdict.
    const counts = new Map<string, number>();
    for (const table of INSPECTED_TABLES) counts.set(table, countRows(state.db, table));
    const seeded = BASELINE_TABLES.every((t) => (counts.get(t) ?? 0) > 0);

    return {
      legacyDatabaseAvailable: true,
      legacySchemaPresent: true,
      legacySeeded: seeded,
      legacyBootWritesEnabled: bootWrites,
      ...(seeded ? {} : { reason: 'legacy_baseline_empty' as const }),
    };
  } catch {
    // A structurally broken database can make even a catalog read throw. Report
    // the bounded code; never surface the driver's message.
    return {
      legacyDatabaseAvailable: true,
      legacySchemaPresent: false,
      legacySeeded: false,
      legacyBootWritesEnabled: bootWrites,
      reason: 'legacy_health_check_failed',
    };
  }
}

/** A legacy database is usable only when all three facts hold. */
export function isLegacyDatabaseHealthy(health: LegacyDatabaseHealth): boolean {
  return health.legacyDatabaseAvailable && health.legacySchemaPresent && health.legacySeeded;
}

export interface HealthResponse extends LegacyDatabaseHealth {
  ok: boolean;
  readOnly: boolean;
}

/**
 * The exact `GET /api/health` body and status, built as a pure function so the
 * contract can be tested without starting a listening server.
 *
 * `ok` and `readOnly` keep their existing meaning and position for the client's
 * read-only banner. `status` is 503 when the legacy database is unusable: a
 * reassuring 200 over a missing database is precisely the counterfeit signal
 * this slice removes.
 */
export function buildHealthResponse(params: {
  legacy: LegacyDatabaseHealth;
  readOnly: boolean;
}): { status: number; body: HealthResponse } {
  const healthy = isLegacyDatabaseHealthy(params.legacy);
  return {
    status: healthy ? 200 : 503,
    body: { ok: healthy, readOnly: params.readOnly, ...params.legacy },
  };
}

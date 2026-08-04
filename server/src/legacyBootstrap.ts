// The single startup boundary for legacy-database writes.
//
// Before this existed, `server/src/index.ts` called `seedIfEmpty()` and
// `migrateProductType()` at module scope — unconditionally, and before the
// Express legacy-write guard was installed. Between them those two functions
// created seven tables and thirteen indexes, added four columns to
// `whatnot_purchases`, inserted up to 3,950 fixture rows into five tables,
// flagged food purchases as excluded, re-tagged `product_type` on every
// non-manual row whenever CLASSIFIER_VERSION changed, and wrote classifier
// metadata. `ALLOW_LEGACY_WRITES` stopped none of it, because HTTP middleware
// cannot govern module initialization.
//
// Everything above now runs only through `prepareLegacyDatabase`, and only when
// SEED_LEGACY_ON_EMPTY authorizes it. Startup calls this once; nothing else in
// the process may call the underlying mutating functions.

import type Database from 'better-sqlite3';
import { migrateProductType, legacyDatabaseState, type LegacyDatabaseOpenState } from './db.js';
import { seedIfEmpty } from './seed.js';
import {
  describeBootstrapPolicy,
  legacyBootWritesEnabled,
  type EnvLike,
} from './legacyBootstrapPolicy.js';

export type LegacyBootstrapOutcome =
  /** Authorized and executed: schema ensured, empty tables filled from fixtures. */
  | { status: 'bootstrapped' }
  /** Not authorized. Nothing was created, altered, inserted or updated. */
  | { status: 'skipped_not_authorized' }
  /** Authorized, but there is no database to bootstrap into. */
  | { status: 'unavailable'; reason: string };

export interface PrepareLegacyDatabaseDeps {
  env?: EnvLike;
  /** Resolves the connection. Injected so tests can point at a temp database. */
  openState?: () => LegacyDatabaseOpenState;
  /** Injected so tests can assert exactly what the guarded path did or did not run. */
  runBootstrap?: (db: Database.Database) => void;
  log?: (message: string) => void;
}

/** The authorized bootstrap, in the order the legacy app has always run it. */
function defaultBootstrap(db: Database.Database): void {
  seedIfEmpty(db);
  migrateProductType(db);
}

/**
 * Evaluates the policy FIRST, then decides whether to touch the database at all.
 *
 * When the policy is disabled this function performs no DDL, no INSERT, no
 * UPDATE and no metadata write. It does read the connection state so startup can
 * log whether the database is even reachable, and so `GET /api/health` has
 * something honest to report — but reads cannot mutate, and when neither
 * permission is granted the connection is additionally `query_only` so the
 * database layer would reject a write even if one were attempted.
 */
export function prepareLegacyDatabase(deps: PrepareLegacyDatabaseDeps = {}): LegacyBootstrapOutcome {
  const env = deps.env ?? process.env;
  const openState = deps.openState ?? (() => legacyDatabaseState(env));
  const runBootstrap = deps.runBootstrap ?? defaultBootstrap;
  const log = deps.log ?? ((m: string) => console.log(m));

  log(describeBootstrapPolicy(env));

  // The policy decision happens before anything mutating is reachable.
  if (!legacyBootWritesEnabled(env)) {
    return { status: 'skipped_not_authorized' };
  }

  const state = openState();
  if (state.status !== 'open') {
    log(`legacy bootstrap authorized but the database could not be opened (${state.reason})`);
    return { status: 'unavailable', reason: state.reason };
  }

  log('running authorized legacy bootstrap: ensuring schema and seeding EMPTY tables from repository fixtures');
  runBootstrap(state.db);
  log('authorized legacy bootstrap complete');
  return { status: 'bootstrapped' };
}

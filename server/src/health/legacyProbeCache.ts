// A short TTL in front of the legacy health check, so the Railway probe stays
// bounded and fast.
//
// The legacy check opens SQLite, reads the catalog, and runs COUNT(*) over four
// tables. That is cheap, but it is real disk work on a path Railway hits on a
// fixed interval, and the whole point of Work Order 3 is that legacy storage
// must not be able to affect governed deployment. A slow or contended legacy
// file should not be able to slow the probe either.
//
// The TTL is short enough that an operator watching health sees a legacy change
// within seconds, and long enough that a burst of probes collapses into one
// read. Diagnostics bypass the cache, because an owner asking for detail is
// asking about now.
//
// The cache stores only the bounded health record. It never stores an error, a
// path, or a driver message.

import {
  checkLegacyDatabaseHealth,
  type LegacyDatabaseHealth,
  type LegacyHealthDeps,
} from '../legacyDatabaseHealth.js';

export const LEGACY_PROBE_TTL_MS = 5_000;

export interface LegacyProbeCacheDeps {
  /** Injected so tests drive time explicitly rather than sleeping. */
  now?: () => number;
  check?: (deps?: LegacyHealthDeps) => LegacyDatabaseHealth;
  ttlMs?: number;
}

export interface LegacyProbe {
  /** Cached read, for the health probe. */
  read(): LegacyDatabaseHealth;
  /** Uncached read, for owner diagnostics. */
  readFresh(): LegacyDatabaseHealth;
}

export function createLegacyProbe(deps: LegacyProbeCacheDeps = {}): LegacyProbe {
  const now = deps.now ?? Date.now;
  const check = deps.check ?? checkLegacyDatabaseHealth;
  const ttlMs = deps.ttlMs ?? LEGACY_PROBE_TTL_MS;

  let cachedAt = Number.NEGATIVE_INFINITY;
  let cached: LegacyDatabaseHealth | null = null;

  function readFresh(): LegacyDatabaseHealth {
    // checkLegacyDatabaseHealth never throws by contract; the guard here is for
    // the injected implementations tests use, so a throwing double can never
    // turn into an unhandled rejection on the probe path.
    let health: LegacyDatabaseHealth;
    try {
      health = check();
    } catch {
      health = {
        legacyDatabaseAvailable: false,
        legacySchemaPresent: false,
        legacySeeded: false,
        legacyBootWritesEnabled: false,
        reason: 'legacy_health_check_failed',
      };
    }
    cached = health;
    cachedAt = now();
    return health;
  }

  return {
    read() {
      const age = now() - cachedAt;
      if (cached !== null && age < ttlMs) return cached;
      return readFresh();
    },
    readFresh,
  };
}

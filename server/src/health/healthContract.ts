// The three health states, kept separate on purpose.
//
//   LIVENESS            — this process is running and can answer HTTP.
//                         GET /api/live. No configuration, no storage, no I/O.
//   GOVERNED READINESS  — this deployment was given a coherent governed
//                         configuration. GET /api/health, the Railway probe.
//   LEGACY AVAILABILITY — whether the non-authoritative legacy SQLite database
//                         is usable. Reported everywhere, decides nothing.
//
// Before this split, all three were collapsed into one boolean and a missing
// legacy file returned 503 from the endpoint Railway probes. A store that is
// authoritative for no current business fact could therefore veto a governed
// deployment. Legacy state is now reported honestly and never gates readiness.
//
// Legacy absence is represented as `unavailable` or `degraded` — never as
// healthy, never as empty, never as a zero-valued reading that a caller could
// mistake for a real measurement.

import {
  isLegacyDatabaseHealthy,
  type LegacyDatabaseHealth,
  type LegacyHealthReason,
} from '../legacyDatabaseHealth.js';
import {
  readinessStatus,
  type ApplicationMode,
  type GovernedReadiness,
  type GovernedReadinessReason,
} from './governedReadiness.js';

/**
 * Legacy component state.
 *
 * `unavailable` — the database could not be opened or read at all.
 * `degraded`    — it opened, but its schema or baseline is not trustworthy.
 * `ready`       — usable.
 *
 * There is deliberately no value meaning "empty but fine": an empty legacy
 * baseline is `degraded`, because reading zero rows out of it and presenting
 * that as a total is the exact failure this vocabulary exists to prevent.
 */
export type LegacyComponentStatus = 'ready' | 'degraded' | 'unavailable';

export function legacyComponentStatus(legacy: LegacyDatabaseHealth): LegacyComponentStatus {
  if (isLegacyDatabaseHealthy(legacy)) return 'ready';
  return legacy.legacyDatabaseAvailable ? 'degraded' : 'unavailable';
}

// ---------------------------------------------------------------------------
// Liveness

export interface LivenessResponse {
  readonly live: true;
  readonly startedAtUtc: string;
}

/** Always 200. Answers only "is this process up?", so it cannot be vetoed. */
export function buildLivenessResponse(startedAtUtc: string): {
  status: number;
  body: LivenessResponse;
} {
  return { status: 200, body: { live: true, startedAtUtc } };
}

// ---------------------------------------------------------------------------
// Readiness — the Railway probe

export interface HealthResponse {
  /**
   * Governed readiness. CHANGED in Work Order 3: this used to mean "the legacy
   * SQLite database is usable". The six legacy booleans below still carry the
   * legacy facts, so nothing was concealed — but `ok` now answers the question
   * the probe is actually asking.
   */
  readonly ok: boolean;
  /** Unchanged: whether legacy writes are disabled. Drives the client banner. */
  readonly readOnly: boolean;
  readonly mode: ApplicationMode;
  readonly governedReady: boolean;
  readonly governedReason?: GovernedReadinessReason;
  readonly legacyStatus: LegacyComponentStatus;
  readonly legacyDatabaseAvailable: boolean;
  readonly legacySchemaPresent: boolean;
  readonly legacySeeded: boolean;
  readonly legacyBootWritesEnabled: boolean;
  /** Bounded legacy reason. Absent when legacy is ready. */
  readonly reason?: LegacyHealthReason;
}

/**
 * The exact `GET /api/health` body and status.
 *
 * The status is decided by governed readiness ALONE. A missing, corrupt or
 * empty legacy database changes `legacyStatus`, `reason` and the legacy
 * booleans, and changes nothing about whether this deployment is ready.
 *
 * Every field the pre-WO3 client parser required is still present with the same
 * name and type, and the endpoint still emits only 200 or 503, so an older
 * client keeps working rather than falling into its protocol-error path.
 */
export function buildHealthResponse(params: {
  legacy: LegacyDatabaseHealth;
  readiness: GovernedReadiness;
  readOnly: boolean;
}): { status: number; body: HealthResponse } {
  const { legacy, readiness, readOnly } = params;
  return {
    status: readinessStatus(readiness),
    body: {
      ok: readiness.governedReady,
      readOnly,
      mode: readiness.mode,
      governedReady: readiness.governedReady,
      ...(readiness.reason ? { governedReason: readiness.reason } : {}),
      legacyStatus: legacyComponentStatus(legacy),
      legacyDatabaseAvailable: legacy.legacyDatabaseAvailable,
      legacySchemaPresent: legacy.legacySchemaPresent,
      legacySeeded: legacy.legacySeeded,
      legacyBootWritesEnabled: legacy.legacyBootWritesEnabled,
      ...(legacy.reason ? { reason: legacy.reason } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Detailed diagnostics — owner only

export interface ComponentDiagnostic {
  readonly component: 'process' | 'governed_configuration' | 'legacy_database' | 'legacy_bootstrap';
  readonly status: 'ready' | 'degraded' | 'unavailable' | 'not_configured';
  /** Bounded code, or null. Never a path, SQL, driver message, or stack trace. */
  readonly code: string | null;
}

export interface DiagnosticsResponse {
  readonly startedAtUtc: string;
  readonly checkedAtUtc: string;
  readonly mode: ApplicationMode;
  readonly governedReady: boolean;
  readonly legacyStatus: LegacyComponentStatus;
  readonly legacyWritesEnabled: boolean;
  readonly components: readonly ComponentDiagnostic[];
}

/**
 * The owner-only view. It is strictly MORE detail about the same bounded facts,
 * never new kinds of disclosure: no filesystem path, no SQL text, no driver
 * message, no credential, no stack trace, and no project ref.
 */
export function buildDiagnosticsResponse(params: {
  legacy: LegacyDatabaseHealth;
  readiness: GovernedReadiness;
  legacyWritesEnabled: boolean;
  startedAtUtc: string;
  checkedAtUtc: string;
}): DiagnosticsResponse {
  const { legacy, readiness, legacyWritesEnabled, startedAtUtc, checkedAtUtc } = params;
  const legacyStatus = legacyComponentStatus(legacy);
  return {
    startedAtUtc,
    checkedAtUtc,
    mode: readiness.mode,
    governedReady: readiness.governedReady,
    legacyStatus,
    legacyWritesEnabled,
    components: [
      { component: 'process', status: 'ready', code: null },
      {
        component: 'governed_configuration',
        status: readiness.governedReady
          ? 'ready'
          : readiness.mode === 'legacy_only'
            ? 'not_configured'
            : 'degraded',
        code: readiness.reason ?? null,
      },
      {
        component: 'legacy_database',
        status: legacyStatus,
        code: legacy.reason ?? null,
      },
      {
        component: 'legacy_bootstrap',
        status: legacy.legacyBootWritesEnabled ? 'ready' : 'not_configured',
        code: legacy.legacyBootWritesEnabled ? 'legacy_bootstrap_authorized' : 'legacy_bootstrap_disabled',
      },
    ],
  };
}

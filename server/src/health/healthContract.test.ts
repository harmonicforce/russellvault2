// The Work Order 3 acceptance truth table.
//
// The property under test is the one the whole work order exists to establish:
// legacy SQLite state must never change the readiness verdict, while remaining
// fully and honestly reported.
import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticsResponse,
  buildHealthResponse,
  buildLivenessResponse,
  legacyComponentStatus,
} from './healthContract.js';
import {
  isWellFormedSupabaseUrl,
  readinessStatus,
  resolveGovernedReadiness,
} from './governedReadiness.js';
import { createLegacyProbe } from './legacyProbeCache.js';
import type { LegacyDatabaseHealth } from '../legacyDatabaseHealth.js';

// ---- legacy states ---------------------------------------------------------

const LEGACY_HEALTHY: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: true,
  legacySchemaPresent: true,
  legacySeeded: true,
  legacyBootWritesEnabled: false,
};

const LEGACY_MISSING: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: false,
  legacySchemaPresent: false,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_database_missing',
};

const LEGACY_CORRUPT: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: false,
  legacySchemaPresent: false,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_database_unreadable',
};

const LEGACY_SCHEMA_GONE: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: true,
  legacySchemaPresent: false,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_schema_missing',
};

const LEGACY_EMPTY: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: true,
  legacySchemaPresent: true,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_baseline_empty',
};

const LEGACY_STATES = {
  healthy: LEGACY_HEALTHY,
  missing: LEGACY_MISSING,
  corrupt: LEGACY_CORRUPT,
  schema_gone: LEGACY_SCHEMA_GONE,
  empty: LEGACY_EMPTY,
} as const;

// ---- governed configurations ----------------------------------------------

const GOVERNED_ENVS = {
  valid: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' },
  absent: {},
  missing_key: { SUPABASE_URL: 'https://example.supabase.co' },
  missing_url: { SUPABASE_ANON_KEY: 'anon' },
  malformed_url: { SUPABASE_URL: 'example.supabase.co', SUPABASE_ANON_KEY: 'anon' },
  blank_url: { SUPABASE_URL: '   ', SUPABASE_ANON_KEY: 'anon' },
} as const;

const EXPECTED_MODE = {
  valid: 'governed',
  absent: 'legacy_only',
  missing_key: 'misconfigured',
  missing_url: 'misconfigured',
  malformed_url: 'misconfigured',
  blank_url: 'misconfigured',
} as const;

describe('governed readiness is a pure configuration fact', () => {
  it('classifies every configuration shape', () => {
    for (const [name, env] of Object.entries(GOVERNED_ENVS)) {
      const readiness = resolveGovernedReadiness(env);
      expect(readiness.mode, name).toBe(EXPECTED_MODE[name as keyof typeof EXPECTED_MODE]);
      expect(readiness.governedReady, name).toBe(name === 'valid');
    }
  });

  it('distinguishes "nobody configured governed" from "somebody configured it wrong"', () => {
    expect(resolveGovernedReadiness(GOVERNED_ENVS.absent).reason).toBe('governed_configuration_absent');
    expect(resolveGovernedReadiness(GOVERNED_ENVS.missing_key).reason).toBe('governed_configuration_incomplete');
  });

  it('fails closed on a partial configuration and stays up for legacy-only', () => {
    expect(readinessStatus(resolveGovernedReadiness(GOVERNED_ENVS.missing_key))).toBe(503);
    expect(readinessStatus(resolveGovernedReadiness(GOVERNED_ENVS.missing_url))).toBe(503);
    expect(readinessStatus(resolveGovernedReadiness(GOVERNED_ENVS.malformed_url))).toBe(503);
    expect(readinessStatus(resolveGovernedReadiness(GOVERNED_ENVS.absent))).toBe(200);
    expect(readinessStatus(resolveGovernedReadiness(GOVERNED_ENVS.valid))).toBe(200);
  });

  it('validates the URL shape without asserting which project it points at', () => {
    expect(isWellFormedSupabaseUrl('https://abc.supabase.co')).toBe(true);
    expect(isWellFormedSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isWellFormedSupabaseUrl('abcdefghijklmnopqrst')).toBe(false);
    expect(isWellFormedSupabaseUrl('supabase.co')).toBe(false);
    expect(isWellFormedSupabaseUrl('')).toBe(false);
    expect(isWellFormedSupabaseUrl('ftp://example.com')).toBe(false);
  });

  it('never reads a project ref or performs any I/O', () => {
    // resolveGovernedReadiness takes a plain object; there is nothing to stub
    // because there is nothing to call. This test pins that by passing an env
    // whose only Supabase values are syntactically valid but meaningless.
    const readiness = resolveGovernedReadiness({
      SUPABASE_URL: 'https://not-a-real-project.supabase.co',
      SUPABASE_ANON_KEY: 'not-a-real-key',
    });
    expect(readiness).toEqual({ mode: 'governed', governedReady: true });
  });
});

describe('legacy component status is honest and never zero-valued', () => {
  it('maps each legacy state to ready, degraded, or unavailable', () => {
    expect(legacyComponentStatus(LEGACY_HEALTHY)).toBe('ready');
    expect(legacyComponentStatus(LEGACY_MISSING)).toBe('unavailable');
    expect(legacyComponentStatus(LEGACY_CORRUPT)).toBe('unavailable');
    expect(legacyComponentStatus(LEGACY_SCHEMA_GONE)).toBe('degraded');
    // An empty baseline is degraded, never "ready but empty".
    expect(legacyComponentStatus(LEGACY_EMPTY)).toBe('degraded');
  });
});

// ---- the truth table -------------------------------------------------------

describe('truth table: governed configuration x legacy state', () => {
  for (const [configName, env] of Object.entries(GOVERNED_ENVS)) {
    for (const [legacyName, legacy] of Object.entries(LEGACY_STATES)) {
      const label = `${configName} config / ${legacyName} legacy`;
      it(label, () => {
        const readiness = resolveGovernedReadiness(env);
        const { status, body } = buildHealthResponse({ legacy, readiness, readOnly: true });
        const expectedMode = EXPECTED_MODE[configName as keyof typeof EXPECTED_MODE];

        // THE PROPERTY: the verdict depends only on configuration.
        expect(status).toBe(expectedMode === 'misconfigured' ? 503 : 200);
        expect(body.ok).toBe(configName === 'valid');
        expect(body.governedReady).toBe(configName === 'valid');
        expect(body.mode).toBe(expectedMode);

        // ...and legacy is still fully reported.
        expect(body.legacyStatus).toBe(legacyComponentStatus(legacy));
        expect(body.legacyDatabaseAvailable).toBe(legacy.legacyDatabaseAvailable);
        expect(body.legacySchemaPresent).toBe(legacy.legacySchemaPresent);
        expect(body.legacySeeded).toBe(legacy.legacySeeded);
        expect(body.reason).toBe(legacy.reason);
      });
    }
  }

  it('a missing legacy database never fails governed readiness', () => {
    const readiness = resolveGovernedReadiness(GOVERNED_ENVS.valid);
    for (const legacy of [LEGACY_MISSING, LEGACY_CORRUPT, LEGACY_SCHEMA_GONE, LEGACY_EMPTY]) {
      const { status, body } = buildHealthResponse({ legacy, readiness, readOnly: true });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.legacyStatus).not.toBe('ready');
      expect(body.reason).toBe(legacy.reason);
    }
  });

  it('a legacy-only deployment is never reported as governed-ready', () => {
    const readiness = resolveGovernedReadiness(GOVERNED_ENVS.absent);
    const { status, body } = buildHealthResponse({ legacy: LEGACY_HEALTHY, readiness, readOnly: false });
    expect(status).toBe(200);
    expect(body.governedReady).toBe(false);
    expect(body.ok).toBe(false);
    expect(body.mode).toBe('legacy_only');
    expect(body.governedReason).toBe('governed_configuration_absent');
  });
});

describe('the response stays compatible with the pre-WO3 client parser', () => {
  const REQUIRED_BOOLEANS = [
    'ok',
    'readOnly',
    'legacyDatabaseAvailable',
    'legacySchemaPresent',
    'legacySeeded',
    'legacyBootWritesEnabled',
  ] as const;

  it('always emits every required boolean, and only 200 or 503', () => {
    for (const env of Object.values(GOVERNED_ENVS)) {
      for (const legacy of Object.values(LEGACY_STATES)) {
        const { status, body } = buildHealthResponse({
          legacy,
          readiness: resolveGovernedReadiness(env),
          readOnly: true,
        });
        expect([200, 503]).toContain(status);
        for (const field of REQUIRED_BOOLEANS) {
          expect(typeof (body as unknown as Record<string, unknown>)[field]).toBe('boolean');
        }
      }
    }
  });

  it('omits reason entirely when legacy is ready', () => {
    const { body } = buildHealthResponse({
      legacy: LEGACY_HEALTHY,
      readiness: resolveGovernedReadiness(GOVERNED_ENVS.valid),
      readOnly: true,
    });
    expect('reason' in body).toBe(false);
  });

  it('keeps readOnly reporting the write-guard state independently', () => {
    for (const readOnly of [true, false]) {
      const { body } = buildHealthResponse({
        legacy: LEGACY_MISSING,
        readiness: resolveGovernedReadiness(GOVERNED_ENVS.valid),
        readOnly,
      });
      expect(body.readOnly).toBe(readOnly);
    }
  });
});

describe('liveness is unconditional', () => {
  it('is always 200 and depends on nothing', () => {
    const { status, body } = buildLivenessResponse('2026-08-23T00:00:00.000Z');
    expect(status).toBe(200);
    expect(body).toEqual({ live: true, startedAtUtc: '2026-08-23T00:00:00.000Z' });
  });
});

describe('diagnostics report components without disclosure', () => {
  const FORBIDDEN = [/\//, /select/i, /sqlite/i, /\.db\b/i, /Error:/, /at \w+ \(/, /anon/i, /supabase\.co/i];

  it('names every component and carries only bounded codes', () => {
    for (const env of Object.values(GOVERNED_ENVS)) {
      for (const legacy of Object.values(LEGACY_STATES)) {
        const body = buildDiagnosticsResponse({
          legacy,
          readiness: resolveGovernedReadiness(env),
          legacyWritesEnabled: false,
          startedAtUtc: '2026-08-23T00:00:00.000Z',
          checkedAtUtc: '2026-08-23T00:00:05.000Z',
        });
        expect(body.components.map((c) => c.component)).toEqual([
          'process',
          'governed_configuration',
          'legacy_database',
          'legacy_bootstrap',
        ]);
        for (const component of body.components) {
          if (component.code === null) continue;
          for (const pattern of FORBIDDEN) {
            expect(pattern.test(component.code), `${component.code} vs ${pattern}`).toBe(false);
          }
        }
      }
    }
  });

  it('marks governed configuration not_configured in legacy-only and degraded when partial', () => {
    const legacyOnly = buildDiagnosticsResponse({
      legacy: LEGACY_HEALTHY,
      readiness: resolveGovernedReadiness(GOVERNED_ENVS.absent),
      legacyWritesEnabled: false,
      startedAtUtc: 'a',
      checkedAtUtc: 'b',
    });
    expect(legacyOnly.components[1]).toEqual({
      component: 'governed_configuration',
      status: 'not_configured',
      code: 'governed_configuration_absent',
    });

    const partial = buildDiagnosticsResponse({
      legacy: LEGACY_HEALTHY,
      readiness: resolveGovernedReadiness(GOVERNED_ENVS.missing_key),
      legacyWritesEnabled: false,
      startedAtUtc: 'a',
      checkedAtUtc: 'b',
    });
    expect(partial.components[1].status).toBe('degraded');
  });
});

describe('the legacy probe is bounded', () => {
  it('serves repeat probes from cache and refreshes after the TTL', () => {
    let calls = 0;
    let clock = 1_000;
    const probe = createLegacyProbe({
      now: () => clock,
      ttlMs: 5_000,
      check: () => {
        calls += 1;
        return LEGACY_HEALTHY;
      },
    });

    probe.read();
    probe.read();
    probe.read();
    expect(calls).toBe(1);

    clock += 5_001;
    probe.read();
    expect(calls).toBe(2);
  });

  it('lets diagnostics bypass the cache', () => {
    let calls = 0;
    const probe = createLegacyProbe({ now: () => 0, ttlMs: 60_000, check: () => { calls += 1; return LEGACY_HEALTHY; } });
    probe.read();
    probe.readFresh();
    probe.readFresh();
    expect(calls).toBe(3);
  });

  it('turns an unexpected check failure into a bounded unavailable reading, never a throw', () => {
    const probe = createLegacyProbe({
      check: () => {
        throw new Error('/var/data/vault.db is corrupt');
      },
    });
    const health = probe.read();
    expect(health.legacyDatabaseAvailable).toBe(false);
    expect(health.reason).toBe('legacy_health_check_failed');
  });
});

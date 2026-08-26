// Work Order 3's startup claim, proved against real temporary paths rather than
// mocks: in governed mode, an absent legacy SQLite database must neither fail
// startup nor cause any storage mutation, and must not affect readiness.
//
// The broader bootstrap safety proof (catalog snapshots, fixture behaviour,
// idempotency) lives in legacyBootstrap.test.ts and is unchanged. This file
// covers only the fourth dimension of the WO3 truth table — bootstrap flag —
// crossed with governed mode and an absent database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLegacyDatabase } from '../db.js';
import { prepareLegacyDatabase } from '../legacyBootstrap.js';
import { checkLegacyDatabaseHealth } from '../legacyDatabaseHealth.js';
import { LEGACY_BOOTSTRAP_FLAG } from '../legacyBootstrapPolicy.js';
import { buildHealthResponse, legacyComponentStatus } from './healthContract.js';
import { resolveGovernedReadiness } from './governedReadiness.js';

const GOVERNED = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  NODE_ENV: 'production',
} as const;

let tmpRoot: string;
let serial = 0;

function absentPath(): string {
  serial += 1;
  return path.join(tmpRoot, `never-created-${serial}`, 'vault.db');
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-wo3-'));
});

/**
 * `legacyDatabaseState` memoises one connection per PROCESS, so calling it here
 * would hand back whatever another test opened first. Every check below injects
 * its own unauthorized, read-only open of an explicit path instead — which is
 * also the exact posture a locked-down deployment runs in.
 */
function openStateFor(dbPath: string) {
  return () => openLegacyDatabase({
    path: dbPath,
    bootstrapAuthorized: false,
    requestWritesEnabled: false,
  });
}

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('governed startup with an absent legacy database', () => {
  it('does not throw, does not create anything, and reports skipped when the flag is absent', () => {
    const dbPath = absentPath();
    const env = { ...GOVERNED, DATABASE_PATH: dbPath };

    const outcome = prepareLegacyDatabase({ env, log: () => {} });

    expect(outcome.status).toBe('skipped_not_authorized');
    expect(fs.existsSync(dbPath)).toBe(false);
    // Not even the parent directory: a mispointed volume must not be papered over.
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });

  it('does not create anything when the flag is set to anything other than exactly true', () => {
    for (const value of ['false', '1', 'TRUE', 'yes', '']) {
      const dbPath = absentPath();
      const outcome = prepareLegacyDatabase({
        env: { ...GOVERNED, DATABASE_PATH: dbPath, [LEGACY_BOOTSTRAP_FLAG]: value },
        log: () => {},
      });
      expect(outcome.status, value).toBe('skipped_not_authorized');
      expect(fs.existsSync(dbPath), value).toBe(false);
    }
  });

  it('bootstraps — and only then creates anything — when the flag is exactly true', () => {
    const dbPath = absentPath();
    let bootstrapRan = 0;
    const outcome = prepareLegacyDatabase({
      env: { ...GOVERNED, DATABASE_PATH: dbPath, [LEGACY_BOOTSTRAP_FLAG]: 'true' },
      runBootstrap: () => { bootstrapRan += 1; },
      log: () => {},
    });

    // Creating the database IS the authorized behaviour; the point is that it
    // is reachable only through the exact flag, and that it stays bounded to
    // the configured path rather than wandering.
    expect(outcome.status).toBe('bootstrapped');
    expect(bootstrapRan).toBe(1);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(path.dirname(dbPath).startsWith(tmpRoot)).toBe(true);
  });

  it('leaves governed readiness at 200 with legacy honestly unavailable', () => {
    const dbPath = absentPath();
    const env = { ...GOVERNED, DATABASE_PATH: dbPath };

    prepareLegacyDatabase({ env, log: () => {} });
    const legacy = checkLegacyDatabaseHealth({ env, openState: openStateFor(dbPath) });

    expect(legacy.legacyDatabaseAvailable).toBe(false);
    expect(legacyComponentStatus(legacy)).toBe('unavailable');

    const { status, body } = buildHealthResponse({
      legacy,
      readiness: resolveGovernedReadiness(env),
      readOnly: true,
    });

    // The whole point of R-003: a missing non-authoritative store does not veto
    // a governed deployment.
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.governedReady).toBe(true);
    expect(body.mode).toBe('governed');
    // ...and the failure is still visible, not concealed.
    expect(body.legacyStatus).toBe('unavailable');
    expect(body.reason).toBe('legacy_database_missing');
  });

  it('still fails closed on a partial governed configuration, whatever legacy is doing', () => {
    const dbPath = absentPath();
    const env = { SUPABASE_URL: 'https://example.supabase.co', DATABASE_PATH: dbPath };
    const legacy = checkLegacyDatabaseHealth({ env, openState: openStateFor(dbPath) });
    const { status, body } = buildHealthResponse({
      legacy,
      readiness: resolveGovernedReadiness(env),
      readOnly: true,
    });
    expect(status).toBe(503);
    expect(body.governedReady).toBe(false);
    expect(body.governedReason).toBe('governed_configuration_incomplete');
  });

  it('checking legacy health creates nothing', () => {
    const dbPath = absentPath();
    checkLegacyDatabaseHealth({ env: { ...GOVERNED, DATABASE_PATH: dbPath }, openState: openStateFor(dbPath) });
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });
});

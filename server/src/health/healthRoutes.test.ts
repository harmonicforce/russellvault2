// Work Order 3's endpoint contract, proved over real HTTP.
//
// The pure builders are covered in healthContract.test.ts. This file covers the
// part a builder test cannot reach: the WIRING. Which handler consults which
// source, what a caller actually receives, and — the whole point of R-003 —
// that no legacy SQLite condition can change the status line of /api/health or
// reach /api/live at all.

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHealthHandlers } from './healthRoutes.js';
import type { LegacyProbe } from './legacyProbeCache.js';
import type { LegacyDatabaseHealth } from '../legacyDatabaseHealth.js';

const STARTED_AT = '2026-08-25T00:00:00.000Z';

const GOVERNED_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};

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

const LEGACY_EMPTY: LegacyDatabaseHealth = {
  legacyDatabaseAvailable: true,
  legacySchemaPresent: true,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_baseline_empty',
};

/**
 * A probe that counts reads, so "liveness touched legacy storage" is a
 * detectable event rather than something taken on trust.
 */
function countingProbe(health: LegacyDatabaseHealth) {
  const counts = { read: 0, readFresh: 0 };
  const probe: LegacyProbe = {
    read() { counts.read += 1; return health; },
    readFresh() { counts.readFresh += 1; return health; },
  };
  return { probe, counts };
}

/** A probe whose every read explodes: legacy storage at its most hostile. */
function explodingProbe(): LegacyProbe {
  const boom = (): never => { throw new Error('/var/data/vault.db: disk I/O error'); };
  return { read: boom, readFresh: boom };
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/**
 * Mounts the REAL handlers on the same four paths, in the same order and with
 * the same guard placement index.ts uses. The route table itself is pinned
 * separately by Work Order 2's structural test over index.ts, so between the
 * two nothing about the wiring is taken on trust.
 */
function start(options: {
  probe?: LegacyProbe;
  env?: Record<string, string | undefined>;
  legacyWritesEnabled?: boolean;
  nodeVersion?: string;
}): Promise<string> {
  const app = express();
  const health = createHealthHandlers({
    startedAtUtc: STARTED_AT,
    legacyWritesEnabled: options.legacyWritesEnabled ?? false,
    probe: options.probe ?? countingProbe(LEGACY_HEALTHY).probe,
    env: options.env ?? GOVERNED_ENV,
    nodeVersion: options.nodeVersion ?? 'v20.0.0',
  });
  app.get('/api/live', health.live);
  app.get('/api/health', health.health);
  // Owner authorization itself is proved in diagnosticsAuth.test.ts. Here the
  // guard stands in as a refusal, so a test that reaches the diagnostics body
  // has had to say so explicitly.
  app.get(
    '/api/diagnostics',
    (_req, res) => { res.status(403).json({ error: 'diagnostics_owner_required' }); },
    health.diagnostics,
  );
  app.get('/api/version', health.version);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
    });
  });
}

describe('GET /api/live is independent of everything', () => {
  it('answers 200 while legacy storage is throwing and governed config is absent', async () => {
    const base = await start({ probe: explodingProbe(), env: {} });
    const response = await fetch(`${base}/api/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ live: true, startedAtUtc: STARTED_AT });
  });

  it('never reads legacy storage at all', async () => {
    const { probe, counts } = countingProbe(LEGACY_MISSING);
    const base = await start({ probe });
    await fetch(`${base}/api/live`);
    await fetch(`${base}/api/live`);
    expect(counts).toEqual({ read: 0, readFresh: 0 });
  });

  it('answers 200 on a partial governed configuration, which /api/health refuses', async () => {
    const base = await start({ env: { SUPABASE_URL: 'https://example.supabase.co' } });
    expect((await fetch(`${base}/api/live`)).status).toBe(200);
    expect((await fetch(`${base}/api/health`)).status).toBe(503);
  });
});

describe('GET /api/health cannot be vetoed by legacy SQLite', () => {
  it('returns 200 with a valid governed configuration for every unusable legacy state', async () => {
    for (const legacy of [LEGACY_MISSING, LEGACY_EMPTY]) {
      const base = await start({ probe: countingProbe(legacy).probe });
      const response = await fetch(`${base}/api/health`);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.governedReady).toBe(true);
      expect(body.mode).toBe('governed');
      // ...and the legacy failure is still on the wire, not concealed.
      expect(body.legacyStatus).not.toBe('ready');
      expect(body.reason).toBe(legacy.reason);
    }
  });

  it('reports legacy-only as 200 and not-governed-ready', async () => {
    const base = await start({ env: {} });
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.mode).toBe('legacy_only');
    expect(body.governedReason).toBe('governed_configuration_absent');
  });

  it('fails closed with the bounded code on a partial configuration', async () => {
    const base = await start({ env: { SUPABASE_ANON_KEY: 'anon' } });
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.mode).toBe('misconfigured');
    expect(body.governedReason).toBe('governed_configuration_incomplete');
  });

  it('serves the probe from the cache rather than re-reading legacy per request', async () => {
    const { probe, counts } = countingProbe(LEGACY_HEALTHY);
    const base = await start({ probe });
    await fetch(`${base}/api/health`);
    await fetch(`${base}/api/health`);
    await fetch(`${base}/api/health`);
    // The router delegates to the probe's cached read; the TTL behaviour itself
    // is pinned in healthContract.test.ts.
    expect(counts.read).toBe(3);
    expect(counts.readFresh).toBe(0);
  });

  it('reports readOnly from the legacy write flag, not from legacy health', async () => {
    for (const legacyWritesEnabled of [true, false]) {
      const base = await start({ legacyWritesEnabled, probe: countingProbe(LEGACY_MISSING).probe });
      const body = await (await fetch(`${base}/api/health`)).json();
      expect(body.readOnly).toBe(!legacyWritesEnabled);
    }
  });
});

describe('GET /api/diagnostics is guarded before it reveals anything', () => {
  it('refuses an unauthorized caller without reading legacy storage', async () => {
    const { probe, counts } = countingProbe(LEGACY_HEALTHY);
    const base = await start({ probe });
    const response = await fetch(`${base}/api/diagnostics`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'diagnostics_owner_required' });
    expect(counts.readFresh).toBe(0);
  });
});

describe('GET /api/version is unchanged by Work Order 3', () => {
  it('reports the SHA, Node version and start time, and nothing else', async () => {
    const base = await start({
      env: { ...GOVERNED_ENV, GIT_COMMIT_SHA: 'abc123' },
      nodeVersion: 'v20.11.1',
    });
    const response = await fetch(`${base}/api/version`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sha: 'abc123',
      node: 'v20.11.1',
      startedAtUtc: STARTED_AT,
    });
  });

  it('falls back to the Railway SHA, then to unknown', async () => {
    const railway = await start({ env: { ...GOVERNED_ENV, RAILWAY_GIT_COMMIT_SHA: 'railwaysha' } });
    expect((await (await fetch(`${railway}/api/version`)).json()).sha).toBe('railwaysha');

    const none = await start({ env: GOVERNED_ENV });
    expect((await (await fetch(`${none}/api/version`)).json()).sha).toBe('unknown');
  });

  it('answers identically whatever health is doing, so a probe cannot disguise the deployed SHA', async () => {
    const bodies = [];
    for (const env of [
      { GIT_COMMIT_SHA: 'deployedsha', ...GOVERNED_ENV },
      { GIT_COMMIT_SHA: 'deployedsha' },
      { GIT_COMMIT_SHA: 'deployedsha', SUPABASE_URL: 'https://example.supabase.co' },
    ]) {
      const base = await start({ env, probe: explodingProbe() });
      const response = await fetch(`${base}/api/version`);
      expect(response.status).toBe(200);
      bodies.push(await response.json());
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});

/**
 * The wiring itself, read as text.
 *
 * index.ts calls app.listen() at import time, so it cannot be imported here —
 * the same reason Work Order 2's route-inventory test reads it as source. That
 * test already proves the public paths are declared publicly; this one adds the
 * WO3-specific half: diagnostics is the ONE health path that is guarded, and it
 * is guarded before its handler rather than inside it.
 */
describe('index.ts mounts the health paths with the intended guards', () => {
  const indexSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts'),
    'utf8',
  );

  it('puts the owner guard ahead of the diagnostics handler', () => {
    expect(indexSource).toMatch(
      /app\.get\('\/api\/diagnostics',\s*diagnosticsGuard,\s*health\.diagnostics\)/,
    );
  });

  it('leaves live, health and version ungated', () => {
    for (const path of ['live', 'health', 'version'] as const) {
      expect(indexSource).toContain(`app.get('/api/${path}', health.${path});`);
    }
    // No guard slipped in front of the probe: that would let an authentication
    // failure read as an unhealthy deployment, which is the mirror image of the
    // legacy veto this work order removes.
    expect(indexSource).not.toMatch(/app\.get\('\/api\/health',\s*\w+Guard/);
    expect(indexSource).not.toMatch(/app\.get\('\/api\/live',\s*\w+Guard/);
  });
});

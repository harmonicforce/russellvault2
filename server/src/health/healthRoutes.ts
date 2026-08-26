// The request handlers behind the three health endpoints plus /api/version.
//
// They live here, rather than as closures inside index.ts, for one reason:
// Work Order 3's claims are claims about ENDPOINTS — "/api/live depends on
// nothing", "/api/health is not vetoed by legacy SQLite", "/api/version is
// untouched". Testing only the pure builders would leave the part where a
// legacy veto could actually be reintroduced — which handler consults which
// source — unproven. With the handlers exported, a test can mount the real
// ones and drive them over real HTTP.
//
// index.ts still declares each `app.get(path, handler)` itself, so the route
// table and the diagnostics guard stay visible at the wiring site, and Work
// Order 2's structural proof that the public paths are public still reads it.
//
// Every dependency is injectable and every default is the production one, so
// the handlers under test are the handlers that ship.

import type { RequestHandler } from 'express';
import {
  buildDiagnosticsResponse,
  buildHealthResponse,
  buildLivenessResponse,
  buildVersionResponse,
} from './healthContract.js';
import { resolveGovernedReadiness, type EnvLike } from './governedReadiness.js';
import { createLegacyProbe, type LegacyProbe } from './legacyProbeCache.js';

export interface HealthHandlerDeps {
  /** Process start, reported by liveness and version alike. */
  readonly startedAtUtc: string;
  /** Whether the legacy write guard currently permits writes. */
  readonly legacyWritesEnabled: boolean;
  /** Defaults to a fresh cached probe. */
  readonly probe?: LegacyProbe;
  /** Defaults to process.env, read per request rather than captured at boot. */
  readonly env?: EnvLike;
  readonly nodeVersion?: string;
  readonly now?: () => Date;
}

export interface HealthHandlers {
  readonly live: RequestHandler;
  readonly health: RequestHandler;
  readonly diagnostics: RequestHandler;
  readonly version: RequestHandler;
}

export function createHealthHandlers(deps: HealthHandlerDeps): HealthHandlers {
  const probe = deps.probe ?? createLegacyProbe();
  const env = deps.env ?? process.env;
  const nodeVersion = deps.nodeVersion ?? process.version;
  const now = deps.now ?? (() => new Date());

  return {
    // Pure liveness: is this process up? It reads no configuration, opens no
    // database and performs no I/O, so nothing — not a missing legacy volume,
    // not an unreachable Supabase — can veto it.
    live(_req, res) {
      const { status, body } = buildLivenessResponse(deps.startedAtUtc);
      res.status(status).json(body);
    },

    // Governed readiness — the Railway probe. Bounded and fast: readiness is a
    // pure configuration check with no network call (probing Supabase on every
    // request would turn a dependency blip into a self-inflicted outage), and
    // the legacy read is served from a short TTL cache.
    //
    // Status is decided by governed readiness ALONE. 503 only when the governed
    // configuration is present but incomplete — an operator error that must not
    // be promoted. A legacy-only deployment returns 200 with
    // `governedReady: false` and `mode: 'legacy_only'`, so it is explicitly
    // defined rather than quietly counted as governed.
    health(_req, res) {
      const { status, body } = buildHealthResponse({
        legacy: probe.read(),
        readiness: resolveGovernedReadiness(env),
        readOnly: !deps.legacyWritesEnabled,
      });
      res.status(status).json(body);
    },

    // Detailed component diagnostics — OWNER ONLY, and never part of the probe.
    // Carries strictly more detail about the same bounded facts: no filesystem
    // path, SQL text, driver message, credential, project ref, or stack trace.
    diagnostics(_req, res) {
      res.status(200).json(
        buildDiagnosticsResponse({
          legacy: probe.readFresh(),
          readiness: resolveGovernedReadiness(env),
          legacyWritesEnabled: deps.legacyWritesEnabled,
          startedAtUtc: deps.startedAtUtc,
          checkedAtUtc: now().toISOString(),
        }),
      );
    },

    // Read-only build/version info to confirm which commit is actually
    // deployed. Reports only a git SHA + Node version — never any secret.
    // UNCHANGED by Work Order 3, and it reads no health state at all, so no
    // probe verdict can disguise which commit is running.
    version(_req, res) {
      res.json(buildVersionResponse({ env, nodeVersion, startedAtUtc: deps.startedAtUtc }));
    },
  };
}

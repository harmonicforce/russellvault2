import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareLegacyDatabase } from './legacyBootstrap.js';
import { buildDiagnosticsResponse, buildHealthResponse, buildLivenessResponse } from './health/healthContract.js';
import { describeGovernedReadiness, resolveGovernedReadiness } from './health/governedReadiness.js';
import { createLegacyProbe } from './health/legacyProbeCache.js';
import { diagnosticsGuard } from './health/diagnosticsAuth.js';
import { legacyWriteGuard, legacyWritesEnabled } from './legacyWriteGuard.js';
import { legacyAccessGuard } from './legacy/accessGuard.js';
import { LEGACY_ROUTE_PREFIXES, type LegacyRoutePrefix } from './legacy/routeInventory.js';
import { buildCorsOptions, describeCorsPolicy, resolveCorsPolicy } from './corsPolicy.js';
import { ValidationError } from './validation.js';
import inventoryRouter from './routes/inventory.js';
import purchasesRouter from './routes/purchases.js';
import costLinksRouter from './routes/costLinks.js';
import listingsRouter from './routes/listings.js';
import salesRouter from './routes/sales.js';
import dashboardRouter from './routes/dashboard.js';
import checksRouter from './routes/checks.js';
import lookupsRouter from './routes/lookups.js';
import provenanceRouter from './routes/provenance.js';
import acquisitionRouter from './routes/acquisition.js';
import inventoryIdentityRouter from './routes/inventoryIdentity.js';
import intakeRouter from './routes/intake.js';
import locationsRouter from './routes/locations.js';
import cycleCountsRouter from './routes/cycleCounts.js';
import mediaRouter from './routes/media.js';
import listingPrepRouter from './routes/listingPrep.js';
import operationsDashboardRouter from './routes/operationsDashboard.js';
import receivingRouter from './routes/receiving.js';
import costRouter from './routes/cost.js';

// The ONE startup boundary for legacy-database writes. This used to be an
// unconditional `seedIfEmpty(); migrateProductType();` pair, which ran before
// the legacy write guard below was installed and which `ALLOW_LEGACY_WRITES`
// could not reach. It now evaluates SEED_LEGACY_ON_EMPTY before anything
// mutating is reachable, and does nothing at all unless that flag authorizes it.
// See server/src/legacyBootstrapPolicy.ts for why the two permissions are
// separate.
prepareLegacyDatabase();

const app = express();

// Cross-origin policy. Production emits no CORS headers at all (the client is
// served from this same process); development allows an explicit, bounded
// origin list. `app.use(cors())` — reflect every origin — is gone. See
// corsPolicy.ts for why, and note that CORS grants no access on its own: an
// allowed origin still has to satisfy the legacy access guard below.
const corsPolicy = resolveCorsPolicy(process.env);
const corsOptions = buildCorsOptions(corsPolicy);
if (corsOptions) app.use(cors(corsOptions));
console.log(describeCorsPolicy(corsPolicy));

app.use(express.json({ limit: '2mb' }));
// Phase 3 staging provenance is mounted BEFORE the legacy write guard, and is
// deliberately not subject to it.
//
// The guard exists to stop direct writes to the legacy SQLite database. The
// provenance routes never touch SQLite: their planning endpoints only read
// allowlisted repository fixtures, and their commit path writes exclusively to
// the shadow Postgres database under the caller's own JWT. Forcing them behind
// ALLOW_LEGACY_WRITES would mean an operator had to re-enable legacy SQLite
// writes in production merely to review an import — exactly the coupling the
// guard is meant to prevent.
//
// The trade is explicit and narrow: this router carries its own, stricter gate
// (shadow flags for availability, then bearer token + workspace membership +
// role for every request), and it remains 404 by default. Nothing here enables,
// weakens, or bypasses any legacy SQLite write; `legacyWritesEnabled` is
// untouched by provenance activity.
app.use('/api/provenance', provenanceRouter);
// Phase 4 acquisition staging shares the same rationale and gates as the Phase 3
// provenance router: mounted before the legacy write guard, 404 by default, and
// it never touches SQLite — it reads/writes only the shadow Postgres database
// under the caller's own JWT. Nothing here enables or weakens any legacy write.
app.use('/api/acquisition', acquisitionRouter);
// Phase 5 inventory-identity is a STRICTLY READ-ONLY shadow diagnostic surface,
// mounted before the legacy write guard with the same gates as provenance /
// acquisition. It never touches SQLite: it reads only the shadow Postgres
// identity hierarchy under the caller's own JWT. The legacy /api/inventory
// router below remains the authoritative inventory system of record, unchanged.
app.use('/api/inventory-identity', inventoryIdentityRouter);
// Phase 6A intake kernel: the reusable, server-authoritative intake state
// machine and transactional commit kernel. Mounted before the legacy write
// guard with the same gates as provenance / acquisition / inventory-identity. It
// never touches SQLite — every mutation calls a governed SECURITY DEFINER
// Postgres function under the caller's own JWT. The operator Quick Add UI is a
// separate, still-gated deliverable pending the owner-approved wireflow.
app.use('/api/intake', intakeRouter);
// Storage location management shares the same rationale and gates: mounted
// before the legacy write guard, 404 by default, and every mutation calls a
// governed SECURITY DEFINER Postgres function under the caller's own JWT.
app.use('/api/locations', locationsRouter);
app.use('/api/cycle-counts', cycleCountsRouter);
// Inventory photographs. Same gates: 404 by default, caller-token authority,
// and governed functions for every mutation. Image bytes go browser-to-storage
// under a short-lived signed URL and never pass through this process.
app.use('/api/media', mediaRouter);
// Listing Prep. The operational layer between inventory and creating a listing
// elsewhere: it publishes nothing and moves no stock. Same gates as above.
app.use('/api/listing-prep', listingPrepRouter);
app.use('/api/operations-dashboard', operationsDashboardRouter);
// S2.3 governed receiving. Same gates as the acquisition router above: mounted
// before the legacy write guard, 404 unless the governed surface is configured,
// and it never touches SQLite. Every mutation is a call into an S2.2 governed
// function under the caller's own JWT, so receiving semantics stay in the
// database and this process only carries the request.
app.use('/api/receiving', receivingRouter);
// S2.5 governed cost allocation. Same gates as receiving: mounted before the
// legacy write guard, 404 unless the governed surface is configured, and it
// never touches SQLite. Every mutation is a call into a governed acquisition
// cost function under the caller's own JWT, so allocation semantics stay in the
// database and this process only carries the request and the arithmetic the
// owner is shown before anything durable happens.
//
// Note the deliberate distinction from `/api/cost-links` below: that is the
// LEGACY SQLite cost-link surface and is unrelated to governed acquisition cost
// components. The two are not merged, and neither reads the other.
app.use('/api/cost', costRouter);

// ---------------------------------------------------------------------------
// LEGACY SQLite SURFACE — quarantined.
//
// Every one of these routers was anonymously readable before Work Order 2. They
// are now mounted ONLY through this loop, so each one gets, in order:
//   1. legacyAccessGuard — bearer token verified by the governed Supabase
//      project, membership in the configured LEGACY_WORKSPACE_ID resolved under
//      the caller's own JWT, and write authority checked against both role and
//      ALLOW_LEGACY_WRITES. Unconfigured deployments fail closed with 503.
//   2. legacyWriteGuard — the pre-existing read-only switch, retained.
//
// The mount is data-driven from LEGACY_ROUTE_PREFIXES so a legacy router cannot
// be added to the app without appearing in the inventory; routeInventory.test.ts
// fails if any legacy prefix is ever mounted directly instead of through here.
//
// Note that the guard is deliberately NOT mounted at '/api': that would also
// capture /api/health and /api/version, which must stay public.
//
// Authenticating these routes does not make legacy rows authoritative. It only
// stops anonymous access to a non-authoritative store.
const legacyRouters: Record<LegacyRoutePrefix, express.Router> = {
  '/api/inventory': inventoryRouter,
  '/api/purchases': purchasesRouter,
  '/api/cost-links': costLinksRouter,
  '/api/listings': listingsRouter,
  '/api/sales': salesRouter,
  '/api/dashboard': dashboardRouter,
  '/api/checks': checksRouter,
  '/api/lookups': lookupsRouter,
};

for (const prefix of LEGACY_ROUTE_PREFIXES) {
  app.use(prefix, legacyAccessGuard, legacyWriteGuard, legacyRouters[prefix]);
}

// ---------------------------------------------------------------------------
// Health, in three separate states (Genome Repair Work Order 3).
//
// Previously ONE endpoint conflated all three and returned 503 whenever the
// legacy SQLite database was missing, unreadable, structurally incomplete or
// empty. Railway health-checks that path, so a store that is authoritative for
// no current business fact could veto a governed deployment. That is R-003.
//
// Legacy state is still reported in full — nothing was concealed — but it no
// longer decides readiness.
const startedAtUtc = new Date().toISOString();
const legacyProbe = createLegacyProbe();
console.log(describeGovernedReadiness(resolveGovernedReadiness(process.env)));

// Pure liveness: is this process up? No configuration, no storage, no I/O, so
// nothing can veto it. Available as an alternative Railway probe target.
app.get('/api/live', (_req, res) => {
  const { status, body } = buildLivenessResponse(startedAtUtc);
  res.status(status).json(body);
});

// Governed readiness — the Railway probe. Bounded and fast: governed readiness
// is a pure configuration check with no network call (probing Supabase on every
// request would turn a dependency blip into a self-inflicted outage), and the
// legacy read is served from a short TTL cache.
//
// Status is decided by governed readiness ALONE. 503 only when the governed
// configuration is present but incomplete — an operator error that must not be
// promoted. A legacy-only deployment returns 200 with `governedReady: false`
// and `mode: 'legacy_only'`, so it is explicitly defined and never mistaken for
// a governed deployment.
app.get('/api/health', (_req, res) => {
  const { status, body } = buildHealthResponse({
    legacy: legacyProbe.read(),
    readiness: resolveGovernedReadiness(process.env),
    readOnly: !legacyWritesEnabled,
  });
  res.status(status).json(body);
});

// Detailed component diagnostics — OWNER ONLY, and never part of the probe.
// Carries strictly more detail about the same bounded facts: no filesystem
// path, SQL text, driver message, credential, project ref, or stack trace.
app.get('/api/diagnostics', diagnosticsGuard, (_req, res) => {
  res.status(200).json(
    buildDiagnosticsResponse({
      legacy: legacyProbe.readFresh(),
      readiness: resolveGovernedReadiness(process.env),
      legacyWritesEnabled,
      startedAtUtc,
      checkedAtUtc: new Date().toISOString(),
    }),
  );
});

// Read-only build/version info to confirm which commit is actually deployed.
// Reports only a git SHA + Node version — never any secret. Railway provides
// RAILWAY_GIT_COMMIT_SHA automatically; GIT_COMMIT_SHA is a manual override.
// UNCHANGED by Work Order 3: this remains the exact deployment diagnostic.
app.get('/api/version', (_req, res) => {
  res.json({
    sha: process.env.GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    node: process.version,
    startedAtUtc,
  });
});

// In production (e.g. Railway) the API also serves the built client so the
// whole app runs as a single service on one port. The client build is
// produced by `npm run build --prefix client` into client/dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API GET returns index.html so react-router can route.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
  console.log(`Serving client build from ${clientDist}`);
}

// Defense in depth: every mutation route already catches ValidationError and
// responds with a structured 4xx itself. This backstop only fires if a route
// forgets to, so a validation failure never falls through to a raw 500.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Russell Vault listening on port ${PORT}`);
});

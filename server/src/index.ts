import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareLegacyDatabase } from './legacyBootstrap.js';
import { buildHealthResponse, checkLegacyDatabaseHealth } from './legacyDatabaseHealth.js';
import { legacyWriteGuard, legacyWritesEnabled } from './legacyWriteGuard.js';
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

// The ONE startup boundary for legacy-database writes. This used to be an
// unconditional `seedIfEmpty(); migrateProductType();` pair, which ran before
// the legacy write guard below was installed and which `ALLOW_LEGACY_WRITES`
// could not reach. It now evaluates SEED_LEGACY_ON_EMPTY before anything
// mutating is reachable, and does nothing at all unless that flag authorizes it.
// See server/src/legacyBootstrapPolicy.ts for why the two permissions are
// separate.
prepareLegacyDatabase();

const app = express();
app.use(cors());
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

app.use('/api', legacyWriteGuard);

app.use('/api/inventory', inventoryRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/cost-links', costLinksRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/checks', checksRouter);
app.use('/api/lookups', lookupsRouter);

// `ok` and `readOnly` are unchanged and still carry what the client reads:
// `readOnly` reflects the legacy-write guard's live state and is never a secret.
//
// The legacy-database fields are new. Before S0.1 this endpoint answered
// `{ ok: true }` even when the legacy volume was missing, because startup had
// already rebuilt the database from repository fixtures and made the failure
// invisible. Startup no longer does that, so the failure has to be reported
// here instead — and reported as a failure, not as a reassuring 200.
//
// A genuinely unusable legacy database returns 503. That is deliberate: Railway
// health-checks this path, so an unusable database stops a bad deployment from
// being promoted and leaves the previous good one serving. `reason` is a bounded
// code (see legacyDatabaseHealth.ts) and never carries a path, SQL, a driver
// message or a stack trace.
app.get('/api/health', (_req, res) => {
  const { status, body } = buildHealthResponse({
    legacy: checkLegacyDatabaseHealth(),
    readOnly: !legacyWritesEnabled,
  });
  res.status(status).json(body);
});

// Read-only build/version info to confirm which commit is actually deployed.
// Reports only a git SHA + Node version — never any secret. Railway provides
// RAILWAY_GIT_COMMIT_SHA automatically; GIT_COMMIT_SHA is a manual override.
const startedAtUtc = new Date().toISOString();
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

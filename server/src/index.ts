import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './seed.js';
import { migrateProductType } from './db.js';
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

seedIfEmpty();
migrateProductType();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api', legacyWriteGuard);

app.use('/api/inventory', inventoryRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/cost-links', costLinksRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/checks', checksRouter);
app.use('/api/lookups', lookupsRouter);
// Phase 3 staging provenance. Inert (every route 404s) unless
// SHADOW_IMPORT=repository-fixtures is set. Never seeds or imports on startup.
app.use('/api/provenance', provenanceRouter);

// readOnly reflects the legacy-write guard's live state — never a secret,
// just the boolean the client needs to render its read-only banner.
app.get('/api/health', (_req, res) => res.json({ ok: true, readOnly: !legacyWritesEnabled }));

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

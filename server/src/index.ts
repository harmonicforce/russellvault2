import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './seed.js';
import inventoryRouter from './routes/inventory.js';
import purchasesRouter from './routes/purchases.js';
import costLinksRouter from './routes/costLinks.js';
import listingsRouter from './routes/listings.js';
import salesRouter from './routes/sales.js';
import dashboardRouter from './routes/dashboard.js';
import checksRouter from './routes/checks.js';
import lookupsRouter from './routes/lookups.js';

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/inventory', inventoryRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/cost-links', costLinksRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/checks', checksRouter);
app.use('/api/lookups', lookupsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Russell Vault listening on port ${PORT}`);
});

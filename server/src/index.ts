import express from 'express';
import cors from 'cors';
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

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Russell Vault API listening on http://localhost:${PORT}`);
});

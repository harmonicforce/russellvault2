# The Russell Vault — Operations

A working operations app for the Russell Vault resale business (Pokemon TCG,
sneakers, apparel, electronics resold via Whatnot → eBay), replacing the
"Easy Operator" / "Operations" spreadsheets with a real UI backed by a local
database.

Seeded with the real data from `Russell_Vault_Operationsmost_capable.xlsx`:
1,487 inventory lots, 2,149 Whatnot purchase lines, 287 cost-basis link
candidates, and 20 eBay listings.

## What it does

- **Dashboard** — daily-glance KPIs, inventory value by vertical, reconciliation health.
- **Inventory** — search/filter/sort 1,487+ lots, inline edit, add new intake.
- **Whatnot Purchases** — browse the 2,149-line purchase source of truth.
- **Cost Basis Links** — guided two-pane search to link inventory lots to purchases,
  confirm/reject candidate matches, with automatic rollup of cost basis and
  remaining purchase balances.
- **eBay Listings** — quick-list costed inventory, track draft → active → sold.
- **Sales** — record proceeds/fees/shipping, auto-computed net proceeds and
  profit against confirmed cost basis, fulfillment tracking.
- **Health Checks** — live data-integrity checks (unique IDs, no oversold lots,
  no orphaned links, no over-allocated purchases) plus the imported baseline checks.

## Stack

- `server/` — Express + better-sqlite3 (TypeScript, runs with `tsx`). SQLite file
  lives at `server/data/vault.db` and is seeded once from `server/seed/*.json`.
- `client/` — Vite + React + TypeScript + Tailwind v4, TanStack Query for data
  fetching, react-router for navigation.

## Running it

```bash
npm run install:all   # installs server + client dependencies
npm run dev            # runs the API on :4000 and the Vite dev server on :5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the Express
backend. The SQLite database is created and seeded automatically on first run
of the server (`server/data/vault.db`, gitignored) — delete it to reseed
from scratch.

## Running it on a Chromebook (Linux / Crostini)

A Chromebook runs this natively through its built-in Linux environment — no
cloud account needed. Everything below is typed into the **Linux Terminal**.

1. **Turn on Linux** (one time): Settings → *Advanced* → *Developers* → *Linux
   development environment* → **Turn on**. When it finishes, a "Terminal" app
   appears.

2. **Install the basics** (Node 20+ via nvm, plus build tools for the native
   SQLite module):
   ```bash
   sudo apt update && sudo apt install -y git curl build-essential python3
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # close the Terminal and reopen it, then:
   nvm install 22
   ```

3. **Get the code and run it** (single-port production mode — one URL, simplest):
   ```bash
   git clone https://github.com/harmonicforce/russellvault2.git russellvault2
   cd russellvault2
   git checkout claude/ui-better-spreadsheet-cjhwjb
   npm install
   npm run build     # installs deps + builds the client (first run takes a few minutes)
   npm start         # serves the whole app on http://localhost:4000
   ```

4. Open **http://localhost:4000** in the Chromebook's Chrome browser. Leave the
   Terminal open while you use it; press `Ctrl+C` there to stop.

   Prefer live-reload while developing? Use `npm run install:all && npm run dev`
   instead and open **http://localhost:5173**.

The database file (`server/data/vault.db`) lives in the Linux container and
persists between runs, so anything you enter stays put.

## Deploying to Railway

The app deploys as a **single Railway service**: the build compiles the React
client, and in production the Express server serves that build alongside the
API on one port. `railway.json` already wires this up.

1. **Create the service** — "New Project → Deploy from GitHub repo" and pick
   this repo/branch. Railway reads `railway.json`:
   - Build: `npm run build` (installs server + client deps, builds the client).
   - Start: `npm run start` (runs the API, which also serves the client).
   - Health check: `/api/health`.
2. **Add a volume for the database (recommended).** SQLite lives on disk, and
   Railway containers have an ephemeral filesystem — without a volume the
   database resets on every redeploy. It would re-seed the original workbook
   data automatically, but any inventory/sales you entered in the app would be
   lost. To persist:
   - Add a Volume to the service and mount it at e.g. `/data`.
   - Set the environment variable `DATA_DIR=/data`.

   The database is then stored at `/data/vault.db` and survives redeploys.
3. **Port** — none needed; Railway injects `PORT` and the server reads it.

That's it — Railway builds, runs the health check, and serves the app at the
generated domain. No `.env` is required for a default deploy.

### Notes
- `better-sqlite3` is a native module; Railway's Nixpacks Node build compiles
  or fetches a prebuilt binary automatically.
- To reseed a deployed instance from scratch, delete `vault.db` from the volume
  (or detach/reattach the volume) and redeploy.

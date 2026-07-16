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

# The Russell Vault — Operations

An operations app for the Russell Vault resale business (Pokemon TCG, sneakers,
apparel, electronics resold via Whatnot → eBay).

It contains **two systems that must not be confused with each other**:

| | Legacy SQLite app | Governed Supabase inventory |
|---|---|---|
| Lives in | `server/` + `client/` legacy pages | `supabase/` + the workspace-scoped client pages |
| Seeded from | `Russell_Vault_Operationsmost_capable.xlsx` (1,487 lots, 2,149 Whatnot purchase lines, 287 cost-basis candidates, 20 eBay listings) | nothing — operators enter inventory through governed intake |
| Authority | **none.** A prototype and a spreadsheet replacement | authoritative for inventory identity, readiness, movement and history |
| Money | SQLite `REAL` | `amount_minor` integers with an explicit currency |
| Visible when | always | only when the shadow flag *and* shadow auth configuration are both set |

Totals from the two systems are **never** added together. Anywhere the legacy
numbers appear they are labelled as legacy, spreadsheet-imported inventory.

## ⚠️ Project status & safety

The legacy SQLite app is **a working prototype, not the authoritative system of
record.** The governed Supabase model is authoritative for the inventory
workflows described under "What it does", and is reached only through
`SECURITY DEFINER` functions under RLS.

- **The SQLite app is non-authoritative.** Financial facts must not be trusted
  from it. It is not being migrated into the governed model by anything in this
  repository.
- **Startup data deletion is fixed going forward** — `server/src/db.ts` no
  longer deletes imported source rows. Food/candy purchases are flagged
  (`is_excluded`), not removed. Note: the repository seed has 2,149
  `whatnot_purchases` rows, but the verified production Railway backup has
  2,119 — a 30-row difference consistent with the old code having deleted rows
  from production, but the backup has **not** been reconciled row-for-row
  against the seed, so it cannot be said the backup is missing exactly those
  30 food/candy rows. No restoration is performed here; see
  `docs/architecture.md` for the exact reconciliation procedure required
  before any restoration.
- **Two separate legacy permissions, neither implying the other.**
  `ALLOW_LEGACY_WRITES=true` re-enables legacy HTTP mutation routes.
  `SEED_LEGACY_ON_EMPTY=true` is what allows the process to create, migrate or
  seed the legacy SQLite database at startup. Both are off in production by
  default, and the startup one is what stops a missing or mispointed volume from
  being silently rebuilt from `server/seed/*.json`. See `docs/architecture.md`.
- **Unsafe financial writes remain a concern for later target-model phases**,
  and money/quantities are stored as SQLite `REAL` rather than integer cents
  (though request-level validation now rejects non-integer quantities).
- **`main` is the stable branch and the source of truth.** It is the GitHub
  default branch and the Railway source branch. All work lands on `main` through
  a pull request with the four required CI jobs green.
- **A green CI run is not evidence that the hosted app works.** CI never touches
  Railway or the hosted Supabase project. Repository migration state and *hosted*
  migration state are separate facts, and this repository can only prove the
  first. See
  [`docs/runbooks/hosted-migration-parity.md`](docs/runbooks/hosted-migration-parity.md)
  for how an owner checks the second.

See [`docs/architecture.md`](docs/architecture.md) for repository/branch reality
and data paths, and
[`docs/runbooks/railway-backup-deploy-preflight.md`](docs/runbooks/railway-backup-deploy-preflight.md)
for the Gate G0A backup/deploy preflight.

## What it does

### Governed inventory operations (Supabase-backed)

Visible only when the shadow surfaces are configured (see "Feature flags"):

- **Dashboard** — inventory health, an explainable bounded work queue, media and
  Listing Prep backlogs, and recent governed movement. Every number links to a
  destination containing exactly the records it counted. When a dependency is
  unavailable the panel says so; it never substitutes a zero.
- **Daily Workbench** — the day's exceptions across intake, location, media and
  corrections.
- **Add Inventory / Batch Intake / Intake Sessions** — multi-category single and
  batch intake with draft recovery, over the governed Product → SKU → Lot → Item
  hierarchy.
- **Current Inventory** — server-side paging, sorting and filtering with
  URL-held state, plus printable labels and bulk move.
- **Scan or Find**, **Locations**, **Corrections** — governed movement,
  workspace-scoped locations, and correction request/review/supersession.
- **Cycle Counts** — location-scoped, blind by default, with frozen snapshots,
  immutable round evidence and a governed resolution matrix.
- **Listing Prep** — the queue between "in inventory" and "listed elsewhere":
  blockers, readiness, a not-started candidate list, and bulk operations.
- **Photo Issues** — the media backlog: records with no active photo, records
  missing a required angle, and open photo issues.

### Legacy spreadsheet surfaces (SQLite, non-authoritative)

- **Legacy Inventory** — search/filter/sort the imported 1,487+ lots, inline edit.
- **Whatnot Purchases** — browse the 2,149-line imported purchase file.
- **Cost Basis Links** — guided two-pane search linking imported lots to
  purchases, with rollup of cost basis and remaining purchase balances.
- **eBay Listings** — quick-list costed legacy inventory, draft → active → sold.
- **Sales** — proceeds/fees/shipping and computed net against confirmed cost basis.
- **Health Checks** — data-integrity checks over the imported data.

### Feature flags

The Supabase-backed surfaces require **both** `VITE_SHADOW_IMPORT=repository-fixtures`
and a complete shadow auth configuration. With either absent there is no nav
entry, no route and no Supabase traffic, and the app is the legacy SQLite
experience exactly as it was. Which flags a given deployment sets is a hosted
fact this repository cannot verify — read it from the running service.

## Stack

- `server/` — Express + better-sqlite3 (TypeScript, runs with `tsx`). SQLite file
  lives at `server/data/vault.db`. It is created and seeded from
  `server/seed/*.json` only when `SEED_LEGACY_ON_EMPTY=true`, which `npm run dev`
  and `npm run seed` set for you and production does not set.
- `client/` — Vite + React + TypeScript + Tailwind v4, TanStack Query for data
  fetching, react-router for navigation.
- `supabase/` + `scripts/db/` — the **governed inventory model**: a
  PostgreSQL/Supabase schema (workspaces, RLS, `SECURITY DEFINER` functions,
  append-only history, private storage policies) covered by pgTAP
  (`npm run db:reset` / `npm run db:test`). This is where inventory identity,
  readiness, movement and history actually live. Every multi-row invariant is
  enforced in the database, not in the browser; the client holds no service-role
  key and performs no direct writes that bypass a governed function. Started as
  the Phase 2 shadow foundation described in
  `docs/supabase-shadow-foundation.md`, which remains accurate about the
  foundation but predates the operational surfaces built on top of it.

  The schema is applied forward only. Each migration's final statement appends
  its own name to `public.schema_migrations_log`, which is what makes hosted
  parity checkable.

### Migration state

Two different facts, never conflated:

- **Repository migration state** — count it, do not read it from a document:
  ```bash
  ls supabase/migrations/*.sql | wc -l
  ```
  `supabase/tests/06_provenance_structure.sql` asserts the same number, so a
  migration added without updating that assertion fails CI.
- **Hosted migration state** — *unverified by this repository.* Nothing in CI or
  in a build session can see the hosted project. Follow
  [`docs/runbooks/hosted-migration-parity.md`](docs/runbooks/hosted-migration-parity.md).

## Running it

```bash
npm run install:all   # installs server + client dependencies
npm run dev            # runs the API on :4000 and the Vite dev server on :5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the Express
backend. `npm run dev` sets `SEED_LEGACY_ON_EMPTY=true`, so the SQLite database
is created and seeded on first run (`server/data/vault.db`, gitignored) — delete
it to reseed from scratch, or run `npm run seed`.

Without that flag the server does **not** create or seed anything: it reports the
missing database through `GET /api/health` and returns 503. That is deliberate,
and it is what production runs. If you start the server some other way and see
`legacy_database_missing`, set the flag or run `npm run seed`.

## Development, CI, and the three dependency roots

This monorepo has **three independent dependency trees** — root (`/`), `client/`,
and `server/` — each with its own `package.json` and lockfile. A root-only
install or audit does **not** cover client or server. Install and check all three:

```bash
npm ci && npm ci --prefix client && npm ci --prefix server
npm run lint          # client (oxlint); server is covered by strict typecheck
npm run typecheck     # server (tsc --noEmit) + client (tsc -b)
npm run build:ci      # build client + typecheck-build server
npm test              # server + client (vitest)

# Dependency audits (run per root):
npm audit --omit=dev --audit-level=high            # production (blocking)
npm audit --prefix client --omit=dev --audit-level=high
npm audit --prefix server --omit=dev --audit-level=high
npm audit --audit-level=low                        # full (dev advisories, reported)
```

The governed schema has its own suite, which CI runs on **two independent
tiers** — a plain-PostgreSQL shim and the local Supabase CLI stack — because the
two ship incompatible pgTAP overloads and a contract that passes on only one of
them is not portable:

```bash
npm run db:reset && npm run db:test                              # shim tier
SHADOW_DB_RUNNER=supabase-cli npm run db:reset                   # Supabase tier (needs Docker)
SHADOW_DB_RUNNER=supabase-cli npm run db:test
```

`db:reset` replays every migration from empty, so it is the real test of a
corrective migration.

CI (`.github/workflows/ci.yml`, Node 20) runs all of the above on push/PR across
four required jobs — `build-and-verify`, `shadow-db-postgres-shim`,
`shadow-db-supabase-stack`, `dev-advisory-report`. It never deploys, touches
Railway or the hosted Supabase project, or writes to a hosted database. **CI
proves the repository is internally consistent. It proves nothing about the
hosted app.**

### Verify the deployed commit

The server exposes `GET /api/version` reporting the deployed commit SHA (from
`RAILWAY_GIT_COMMIT_SHA` / `GIT_COMMIT_SHA`) and Node version — no secrets. Use
it to confirm which commit is actually running.

### Verify a SQLite backup (read-only)

```bash
npm run verify:backup -- /path/to/vault-backup.db     # SHA-256, integrity_check, table counts
```

This opens the file read-only and never mutates it. See the
[G0A preflight runbook](docs/runbooks/railway-backup-deploy-preflight.md).

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
   cd russellvault2   # clones `main`, the default branch
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
2. **Add a volume for the database (required).** SQLite lives on disk and
   Railway containers have an ephemeral filesystem, so without a volume the
   database is gone on every redeploy.

   It no longer re-seeds itself. A deployment that boots without its database
   reports `GET /api/health` as 503 with
   `{ "reason": "legacy_database_missing" }` and Railway's health check fails,
   which keeps the previous good deployment serving instead of promoting one
   backed by a counterfeit database rebuilt from the original workbook import.
   Restoring is a deliberate act — see
   `docs/runbooks/railway-backup-deploy-preflight.md`.
   - Add a Volume to the service and mount it at e.g. `/data`.
   - Set the environment variable `DATA_DIR=/data`.

   The database is then stored at `/data/vault.db` and survives redeploys.
3. **Port** — none needed; Railway injects `PORT` and the server reads it.

That's it — Railway builds, runs the health check, and serves the app at the
generated domain. No `.env` is required for a default deploy.

### Notes
- `better-sqlite3` is a native module; Railway's Nixpacks Node build compiles
  or fetches a prebuilt binary automatically.
- Reseeding a deployed instance from scratch is now an explicit, two-part act:
  remove `vault.db` from the volume **and** set `SEED_LEGACY_ON_EMPTY=true` for
  that boot. Unset it again afterwards. `server/seed/*.json` is the original
  workbook import, not a backup — in particular it contains no `sales` rows, so
  seeding over a lost production database would silently discard every recorded
  sale. Restore from a verified backup instead.

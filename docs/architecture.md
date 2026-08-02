# Architecture & Repository Reality

This document records the *actual* state of the repository and application. It is
descriptive, not aspirational — it is meant to keep anyone (human or agent) from
acting on wrong assumptions about branches, deployment, or data authority.

## Two systems, one repository

Reading anything below without this distinction will produce wrong conclusions.

| | Legacy SQLite prototype | Governed Supabase model |
|---|---|---|
| Code | `server/` (Express + better-sqlite3), the legacy client pages | `supabase/migrations/`, `scripts/db/`, the workspace-scoped client pages, `server/src/routes/` for the governed proxies |
| Data | `server/data/vault.db`, seeded from the imported workbook | the hosted Supabase project (and a local replica for tests) |
| Authority | **none** | authoritative for inventory identity, readiness, duplicate detection, serialization, movement and immutable history |
| Access control | none beyond the legacy-write guard | RLS + workspace membership + role checks, on every read and mutation |
| Money | SQLite `REAL` | `amount_minor` integers plus an explicit currency |
| Reachable | always | only when the shadow flag and shadow auth configuration are both present |

**The two are never summed.** A legacy total that appears anywhere is labelled as
legacy, spreadsheet-imported inventory. Nothing in this repository migrates
legacy rows into the governed model, and the SQLite system does not become
authoritative by being present.

## ⚠️ Safety notices (read first)

- **The SQLite application is NOT authoritative.** It is a working operations
  prototype and must not be treated as the system of record for financial facts.
  The governed PostgreSQL model described above is the one that governs
  inventory.
- **Startup data deletion is fixed going forward (branch `claude/p0-legacy-stop-loss`).**
  `server/src/db.ts` no longer runs a `DELETE` against imported source rows at
  boot. The food/candy cleanup (`flagFoodPurchases`) now sets a non-destructive
  `is_excluded` / `exclusion_reason` flag instead — from this fix onward, every
  original `whatnot_purchases` row is preserved permanently. Business-facing
  reads (the purchases list, dashboard totals, facets) filter `is_excluded = 0`
  by default; pass `?includeExcluded=true` on `GET /api/purchases` to see
  flagged rows, or query the row directly by ID.
  **Repository seed vs. production history — these are not the same number,
  and the two are NOT reconciled row-for-row:**
  the repository seed (`server/seed/whatnot_purchases.json`, used by fresh
  installs and by `server/src/seed.test.ts`) has **2,149** rows; booting
  against it flags 30 as excluded and deletes none (2,149 in, 2,149 out). The
  **verified production Railway backup**, collected and checked by the owner
  before the Phase 0 merge, has **2,119** `whatnot_purchases` rows — a
  difference of 30 from the seed count. That count difference is consistent
  with the old destructive `DELETE` having removed rows from production at
  some point before this fix existed, but **which specific rows differ between
  the seed and the backup has not been verified** — the backup has not been
  reconciled against the seed by `acquisition_line_id` or row content, so it
  cannot be asserted that the backup is missing exactly the same 30
  food/candy rows the seed's `flagFoodPurchases` would flag. This fix stops
  any further deletion; it does **not** restore anything. Any restoration
  requires the source to be independently adjudicated first — the 2,149-row
  repository seed may be used as a restoration source only after an exact
  `acquisition_line_id` and content reconciliation against the production
  backup, carried out as a separate, backup-protected, idempotent,
  owner-reviewed procedure. No restoration is performed in this repository
  work, and none is performed against a live database.
- **Legacy writes are disabled by default in production.** See "Legacy-write
  guard" below. This does not change local development.
- **Unsafe financial writes remain a concern for later target-model phases.**
  Cost-basis and related writes now reject invalid quantities/costs and run
  allocation creation/confirmation + rollup recomputation in a single
  transaction (see `server/src/routes/costLinks.ts`), but the underlying
  money-cents migration has not happened.
- **Money and quantities are stored as SQLite `REAL`.** The target model uses
  integer cents; the legacy `REAL` storage is another reason the legacy app is
  non-authoritative. Request-level validation now rejects non-integer
  *quantities* (inventory, allocation, listing, sale), but stored money fields
  are still `REAL`.

## Legacy-write guard

In production (`NODE_ENV=production`), all non-GET `/api/*` requests are
rejected with `403 { error, readOnly: true }` unless the server-only env var
`ALLOW_LEGACY_WRITES=true` is set. This is deliberate: the point is to make the
prototype incapable of accepting further legacy writes while the relational
shadow system is built, without an explicit owner opt-in. Reads are never
blocked. Outside production (local dev, tests, CI) writes are always enabled —
this guard does not change local workflows. There is no client-side switch and
no secret in client code: the client only ever learns the current state from
`GET /api/health` (`{ ok, readOnly }`) and shows a non-dismissible banner when
`readOnly` is `true`. See `server/src/legacyWriteGuard.ts`.

## Repository / branch reality

| Fact | Value |
|---|---|
| GitHub default branch | `main` (the empty `Beginner` branch has been deleted) |
| Canonical / Railway source branch | `main` |
| Former deployment branch | `claude/ui-better-spreadsheet-cjhwjb` — merged into `main` and behind it |
| Phase 0 baseline branch (historical) | `claude/p0-repository-baseline`, application head `630f4c29837bab85127824309a5330dbc3b07c9f`, earlier audited SHA `df914af260435d555742a490d9bb063c61c98570` |

All work lands on `main` through a pull request with the four required CI jobs
green. **Gate G0A is READY** — the owner collected and verified the Railway
backup evidence (see the Railway preflight runbook and manifest) before the
Phase 0 merge; no Claude session has Railway access or independently verified
that evidence, and this document only records the owner's attestation. G0A being
READY does not itself deploy anything; any deployment-affecting change remains a
distinct owner action.

## Application stack

- **`client/`** — Vite + React + TypeScript + Tailwind v4, TanStack Query,
  react-router. Built with `tsc -b && vite build` into `client/dist`.
- **`server/`** — Express 5 + better-sqlite3, TypeScript run directly with `tsx`
  (no compiled build artifact is required at runtime; the "build" script is a
  strict `tsc --noEmit` typecheck).
- **Legacy data** — SQLite. Seeded once from `server/seed/*.json` when a table is
  empty.
- **`supabase/`** — the governed model: migrations, pgTAP contracts, and storage
  policies.
- **`scripts/db/`** — the deterministic replay and test runner for that model.

## The governed model

### Identity

`Product → SKU → Lot → Item`. A product is the catalog concept, a SKU its
sellable variant, a lot a received quantity of that SKU, and an item a
serialized unit within a lot. Lots are either `lot_managed` (a quantity) or
serialized (a parent whose units are counted individually) — counting both grains
for the same physical stock would double-count it, and the read models and cycle
count snapshots take care not to.

Owner-facing UI never accepts a raw UUID. Records are addressed by governed
public ids (`RV-…`), minted in the database.

### Governance rules

- Every read and mutation is workspace-scoped and runs under the caller's own
  token. `SECURITY DEFINER` functions re-derive the caller from the JWT and
  check workspace membership and role; they do not trust a workspace id supplied
  by the client without checking it.
- Multi-row invariants are enforced in the database. The browser holds no
  service-role key and performs no write that bypasses a governed function.
- History is append-only. Movement, adjustments, corrections, cycle count rounds
  and loss events are recorded, not overwritten.
- Multi-step operations that a flaky connection can retry take an idempotency
  key held by the **database**, so a replay returns the first attempt's result
  rather than creating a second record. A key held in browser memory proves
  nothing and is not treated as idempotency.
- Deprecated functions are **revoked, not dropped**, so a database that already
  has them is unchanged while no application role can still reach them.
- Money is `amount_minor` (integer) plus an explicit currency. Never a float.

### Current work versus history

An operational queue shows current stock only. Retired, voided, superseded,
lost, absorbed, depleted and cancelled records are excluded unless the surface
explicitly labels itself as historical. `inventory_record_overview` is the
unified read model that encodes this: its item grain requires
`item_state = 'active'`, and its lot grain requires `tracking_mode =
'lot_managed'` with `lot_state = 'active'`. Historical detail pages still resolve
through their own functions, so a voided record can be inspected — it simply
does not appear in a work queue.

### Migrations

Forward-only, additive by preference. Existing migration files are never edited,
because a hosted database may already have applied them; a correction is a new
migration. `create or replace view` may only **append** columns at the end —
reordering or removing one requires a dependency-breaking `DROP CASCADE` that
this repository avoids.

Each migration's final statement appends its own name to
`public.schema_migrations_log`. That ledger is what makes hosted parity a
checkable fact rather than an assumption.

### Repository migration state versus hosted migration state

These are **different facts** and the distinction is load-bearing.

- **Repository** state is countable here: `ls supabase/migrations/*.sql | wc -l`.
  `supabase/tests/06_provenance_structure.sql` asserts the same number and names
  the migrations, so adding one without updating the assertion fails CI. Do not
  quote a count from a document — count the directory.
- **Hosted** state is *not verifiable from this repository or from CI.* No build
  session and no CI job can see the hosted Supabase project. When a dashboard
  panel reports that a required database update has not been applied, that is a
  parity answer, and
  [`runbooks/hosted-migration-parity.md`](runbooks/hosted-migration-parity.md) is
  how an owner establishes the truth. Nothing here may claim hosted parity
  exists.

### Test tiers

The pgTAP suite runs on two independent tiers, and CI requires both:

- `shadow-db-postgres-shim` — plain PostgreSQL with a shim providing the
  Supabase-specific objects the contracts depend on;
- `shadow-db-supabase-stack` — the local Supabase CLI stack, which needs Docker.

The two ship incompatible pgTAP overloads, so an assertion that passes on only
one tier is not portable and is treated as a defect. `db:reset` replays every
migration from empty before the suite runs, which is what actually exercises a
corrective migration.

### Three dependency roots

This monorepo has **three independent dependency trees**, each with its own
`package.json` and `package-lock.json`:

- root (`/`) — tooling only (`concurrently`)
- `client/`
- `server/`

A root-only install or audit does **not** cover client or server. Always install
and audit all three:

```
npm ci
npm ci --prefix client
npm ci --prefix server
```

## SQLite data paths and WAL mode

- Default DB path: `server/data/vault.db` (gitignored).
- Overridable via `DATA_DIR` (directory) or `DATABASE_PATH` (full path). In
  production these should point at a **persistent volume** so data survives
  redeploys.
- The database runs in **WAL mode** (`journal_mode = WAL`), so there are
  companion `vault.db-wal` and `vault.db-shm` files. **Copying only `vault.db`
  while the writer is live is not a consistent backup** — use SQLite's online
  backup (`.backup`) or stop the writer and capture the WAL/SHM state. See
  `docs/runbooks/railway-backup-deploy-preflight.md`.

## Deployment (Railway) — and what this repository work does NOT do

`railway.json` defines a single-service deploy (`npm run build` → `npm run
start`, healthcheck `/api/health`). The server also serves the built client in
production, so the whole app runs on one port.

No repository work performed by a build session makes **any**
deployment-affecting change. Build sessions do not deploy, redeploy, restart,
change Railway configuration, apply migrations to the hosted Supabase project,
alter production environment variables, or touch production data. **Gate G0A is
READY** (owner-collected and verified Railway backup evidence, completed before
the Phase 0 merge — see the Railway preflight runbook); no Claude session has
Railway access and none performed a deployment action regardless of gate status.
G0A being READY clears that specific gate for a future deployment-affecting
change — it does not itself trigger one, and any such change remains a separate
step the owner takes deliberately.

**A successful Railway deployment is not evidence of hosted Supabase parity.**
Railway builds and serves the application; it says nothing about which
migrations the hosted database has. The two must be verified separately, and a
release depending on new migrations needs both.

### Verifying the deployed commit SHA

The server exposes `GET /api/version`, which returns the commit SHA it was built
from when the host provides it (Railway sets `RAILWAY_GIT_COMMIT_SHA`; a manual
`GIT_COMMIT_SHA` also works). Use it to confirm which commit is actually running:

```
curl -s https://<your-app-host>/api/version
# { "sha": "<commit>", "node": "v20.x", "startedAtUtc": "..." }
```

Do not infer the deployed branch/SHA from GitHub's default branch or
`railway.json` — confirm it from the running service and, for G0A, from Railway's
own build/deploy evidence.

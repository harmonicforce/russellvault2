# Architecture & Repository Reality

This document records the *actual* state of the repository and application as of
the Phase 0 baseline. It is descriptive, not aspirational — it is meant to keep
anyone (human or agent) from acting on wrong assumptions about branches,
deployment, or data authority.

## ⚠️ Safety notices (read first)

- **The SQLite application is NOT authoritative.** It is a working operations
  prototype. It must not be treated as the system of record for financial facts.
  The approved target data model (see the Phase 3 architecture / audit) is a
  separate PostgreSQL model that later phases build.
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
| GitHub default branch | `Beginner` — contains only `README.md`, **not** the application |
| `Beginner` head | `dc6993e4d71956e79f81ff068ebb90a3d46f5b7a` |
| Application branch | `claude/ui-better-spreadsheet-cjhwjb` |
| Application head (verified this baseline) | `630f4c29837bab85127824309a5330dbc3b07c9f` |
| Ahead of `Beginner` | 12 commits |
| Earlier audited SHA | `df914af260435d555742a490d9bb063c61c98570` (3 commits behind current head) |
| Phase 0 baseline branch | `claude/p0-repository-baseline` (from the application head above) |

The default branch is wrong (it has no app). Correcting the default/deployed
branch is a **deployment-affecting action**. **Gate G0A is READY** — the owner
collected and verified the Railway backup evidence (see the Railway preflight
runbook and manifest) before the Phase 0 merge; this Claude session has no
Railway access and did not independently verify that evidence, and this
document only records the owner's attestation. G0A being READY does not by
itself change the default branch or deploy anything — that remains a distinct,
separate owner-approved action, not performed by this PR or any prior one.

## Application stack

- **`client/`** — Vite + React + TypeScript + Tailwind v4, TanStack Query,
  react-router. Built with `tsc -b && vite build` into `client/dist`.
- **`server/`** — Express 5 + better-sqlite3, TypeScript run directly with `tsx`
  (no compiled build artifact is required at runtime; the "build" script is a
  strict `tsc --noEmit` typecheck).
- **Data** — SQLite. Seeded once from `server/seed/*.json` when a table is empty.

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

Neither the Phase 0 baseline nor the `claude/p0-legacy-stop-loss` work makes
**any** deployment-affecting change. Neither deploys, redeploys, restarts,
changes Railway config, or changes the default/deployed branch. **Gate G0A is
READY** (owner-collected and verified Railway backup evidence, completed
before the Phase 0 merge — see the Railway preflight runbook); this Claude
session has no Railway access and performed no deployment action regardless of
gate status. G0A being READY clears that specific gate for a future
deployment-affecting change — it does not itself trigger one, and any such
change remains a separate step the owner takes deliberately.

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

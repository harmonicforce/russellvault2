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
- **Startup data deletion still exists.** `server/src/db.ts` runs
  `migrateProductType()` at boot, which calls `cleanupFoodPurchases()` and issues
  `DELETE FROM whatnot_purchases` for food/consumable rows. This is a known
  **Phase 1** stop-loss item; it is *documented*, not fixed, in Phase 0.
- **Unsafe financial writes remain a Phase 1 concern.** Cost-basis and related
  writes are not yet guarded to the standard the target model requires.
- **Money and quantities are stored as SQLite `REAL`.** The target model uses
  integer cents; the legacy `REAL` storage is another reason the legacy app is
  non-authoritative.

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
branch is a **deployment-affecting action** and is gated behind **G0A** (see the
Railway preflight runbook). Do not change it as part of Phase 0.

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

## Deployment (Railway) — and what Phase 0 does NOT do

`railway.json` defines a single-service deploy (`npm run build` → `npm run
start`, healthcheck `/api/health`). The server also serves the built client in
production, so the whole app runs on one port.

Phase 0 makes **no** deployment-affecting change. It does not deploy, redeploy,
restart, change Railway config, or change the default/deployed branch. All of
those are blocked until **Gate G0A** is `READY` (owner-provided Railway backup
evidence).

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

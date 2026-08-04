# Last Implementation Handoff

## Surrender state

- Repository / canonical branch: `harmonicforce/russellvault2`, `main`
- **Actual base SHA: `1a3e27ba818c4b3a0150f1b99ac6d83dd865b794`** (`origin/main`,
  fetched this session). This matches the SHA named in the work order exactly;
  `main` had not moved. PR #37 (Phase 0) is merged.
- Work order: Commercial Core & Legacy Retirement Program — **S0.1, Legacy
  Boot-Write Gating and Health Signal**
- Implementation branch: `claude/s0-1-legacy-boot-write-safety`
- Pull request: **draft**, into `main`. Not to be merged.
- Repository migration count: **60 → 60.** No Supabase migration was added,
  edited, replayed or removed; `supabase/` is byte-identical to `main`. Count it
  from the directory, not from this line: `ls supabase/migrations/*.sql | wc -l`
- pgTAP files: 54 → 54. `supabase/tests/06_provenance_structure.sql` unchanged.
- Hosted Supabase parity: **not checked and not claimed.** No hosted database
  contacted.
- Railway: not deployed, not restarted, not reconfigured; no variable changed;
  no volume touched; `/api/version` not queried.
- Hosted acceptance: **not run.** The owner checklist is at the end of this
  document.
- Production data, configuration and secrets: untouched. **No production
  database was accessed and no production backup was captured** — the S0.3 owner
  backup action remains outstanding.
- `docs/ai/CURRENT_STATE.md`: **not edited.** Proposed replacement text is at the
  end of this document.
- **S0.2 was not implemented.** `client/src/lib/dataAdapter.ts` is untouched.
  S1 was not started.

## The exact startup hazard

`server/src/index.ts` called two functions at module scope, on line 28 and line
29, before `legacyWriteGuard` was installed on line 83:

```ts
seedIfEmpty();
migrateProductType();
```

Between them, those two functions performed **every one of the following** on
every boot, and `ALLOW_LEGACY_WRITES=false` stopped none of it, because Express
middleware cannot govern module initialization:

| # | Write | Source |
|---|---|---|
| 1 | `fs.mkdirSync` of the database directory | `db.ts` module scope |
| 2 | Creation of the database **file** if absent | `new Database(DB_PATH)`, module scope |
| 3 | `journal_mode = WAL` (writes the file header) | `db.ts` module scope |
| 4 | `CREATE TABLE IF NOT EXISTS` × 7 | `initSchema` via `seedIfEmpty` |
| 5 | `CREATE INDEX IF NOT EXISTS` × 12 | `initSchema` |
| 6 | `INSERT OR IGNORE` of up to 3,950 fixture rows across 5 tables | `seedIfEmpty` → `insertMany` |
| 7 | `CREATE TABLE IF NOT EXISTS app_meta` | `migrateProductType` |
| 8 | `ALTER TABLE whatnot_purchases ADD COLUMN product_type` | `migrateProductType` |
| 9 | `CREATE INDEX idx_purchases_type` | `migrateProductType` |
| 10 | `ALTER TABLE … ADD COLUMN product_type_source` | `migrateProductType` |
| 11 | `ALTER TABLE … ADD COLUMN is_excluded` | `migrateProductType` |
| 12 | `ALTER TABLE … ADD COLUMN exclusion_reason` | `migrateProductType` |
| 13 | `UPDATE whatnot_purchases SET is_excluded = 1, exclusion_reason = …` | `flagFoodPurchases` |
| 14 | Mass `UPDATE … SET product_type, product_type_source='auto'` on every non-manual row when `CLASSIFIER_VERSION` changes | classifier backfill |
| 15 | `INSERT … ON CONFLICT DO UPDATE` of `classifier_version` | `setMeta` |

Writes 1–3 were **import-time side effects**: merely importing any of the ten
files that consumed the `db` handle triggered them.

The consequence that mattered: `seedIfEmpty()` refilled any table it found
empty. A container booting against a missing, empty, remounted or mispointed
volume rebuilt the schema and repopulated five tables from `server/seed/*.json`
— the original workbook import, not a backup. The result looked like a
recovered production database, while `sales`, which has no fixture at all,
was simply gone. Most tables plausibly restored and one silently missing is the
worst available failure mode, because it does not look like a failure.

## Implementation approach

**One policy, evaluated before anything mutating is reachable.**

New `server/src/legacyBootstrapPolicy.ts` is pure environment parsing with no
side effects. New `server/src/legacyBootstrap.ts` exposes
`prepareLegacyDatabase()`, the single startup boundary; `index.ts` calls it in
place of the two bare calls. It reads the policy and returns
`skipped_not_authorized` **before** it consults the database at all — a test
injects an `openState` that throws, and proves it is never called.

**Import-time side effects removed.** `server/src/db.ts` no longer opens a
connection at module scope. `openLegacyDatabase({ path, bootstrapAuthorized,
requestWritesEnabled })` is an explicit factory with no module state;
`legacyDatabaseState()` memoizes one process connection from the live
environment, and `getDb()` returns it or throws a typed
`LegacyDatabaseUnavailableError` carrying a bounded reason code. The ten
consumer files bind `const db = getDb();` at the top of each function that uses
it, so every existing query body is unchanged.

Rejected alternative: falling back to an empty in-memory database when the file
is missing. That would let every legacy read return "no rows" and look healthy —
the same counterfeit-recovery failure in a different costume.

**`seedIfEmpty`, `initSchema` and `migrateProductType`** now accept an optional
`Database` handle (defaulting to `getDb()`), which is what makes the safety
properties testable against temporary databases without module-state juggling.
Their internals are otherwise unchanged, and seed counts and semantics are
identical.

## Environment-variable contract

Two permissions. **Neither implies the other**, and they are never merged.

| Variable | Governs | Production default | Enabled by |
|---|---|---|---|
| `ALLOW_LEGACY_WRITES` | legacy HTTP mutation routes | off | exactly `'true'` (unchanged) |
| `SEED_LEGACY_ON_EMPTY` | creating, migrating or seeding the legacy database at startup | off | exactly `'true'` |

`SEED_LEGACY_ON_EMPTY` is fail-closed. Missing, empty, `'false'`, `'1'`,
`'TRUE'`, `'True'`, `'yes'`, `'on'`, `'enabled'`, `' true'` and `'true '` are all
disabled — asserted individually by test. Permission is **never** inferred from
`NODE_ENV`, `DATA_DIR`, `DATABASE_PATH`, a writable filesystem, or
`ALLOW_LEGACY_WRITES`. Each of those would have authorized exactly the accident
the flag prevents.

`resolveLegacyWritesEnabled(env)` was extracted from `legacyWriteGuard.ts` as a
pure function so `db.ts` can evaluate it lazily against an explicit environment.
`legacyWritesEnabled` still exists with the same value and the HTTP semantics
are unchanged, which the existing guard tests confirm.

**Local ergonomics, preserved without weakening the production rule:** the
policy has no `NODE_ENV` escape hatch at all. Instead `server/package.json` sets
the flag in the two scripts whose purpose is bootstrap:

- `dev`: `SEED_LEGACY_ON_EMPTY=true tsx watch src/index.ts`
- `seed`: `SEED_LEGACY_ON_EMPTY=true tsx src/seed.ts`
- `start` (what Railway runs): **unchanged**, sets nothing.

`server/src/seed.ts`'s CLI entry refuses and exits 1 without the flag, so there
is exactly one rule rather than a second looser path.

## Database opening behavior

| Bootstrap | HTTP writes | `fileMustExist` | `query_only` | `journal_mode` set |
|---|---|---|---|---|
| off | off *(production default)* | **yes** | **yes** | no |
| off | on | yes | no | yes |
| on | off | no | no | yes |
| on | on | no | no | yes |

The directory is created only when bootstrap is authorized, so a mispointed
volume path does not gain a directory either — asserted by test.

**The guarantee, stated exactly.** With both permissions withheld, no schema
object and no business row can change through this connection. That is **not**
the same as "SQLite performs no writes": the file is opened read-write, so the
engine may still perform WAL and `-shm` bookkeeping, journal state and locking
against an existing database. `journal_mode` is deliberately not set on a
query-only connection because setting it is itself a write; an existing
production database already records WAL mode in its own header, so nothing is
lost. A test proves the narrower claim directly by asserting that `CREATE
TABLE`, `ALTER TABLE`, `UPDATE`, `INSERT` and `DELETE` all throw on that
connection while `SELECT` still returns 1,487 rows.

## Health contract

`GET /api/health` keeps `ok` and `readOnly` in place and with their existing
meanings, and adds four typed fields plus an optional bounded reason.

Healthy — HTTP 200:

```json
{ "ok": true, "readOnly": true,
  "legacyDatabaseAvailable": true, "legacySchemaPresent": true,
  "legacySeeded": true, "legacyBootWritesEnabled": false }
```

Unhealthy — HTTP **503**:

```json
{ "ok": false, "readOnly": true,
  "legacyDatabaseAvailable": false, "legacySchemaPresent": false,
  "legacySeeded": false, "legacyBootWritesEnabled": false,
  "reason": "legacy_database_missing" }
```

Reason codes are a closed set: `legacy_database_missing`,
`legacy_database_unreadable`, `legacy_schema_missing`, `legacy_baseline_empty`,
`legacy_health_check_failed`. No path, SQL, driver message or stack trace is
ever included; a test feeds an error containing `/data/vault.db`,
`SELECT * FROM secrets` and `SQLITE_CANTOPEN` and asserts none of it appears in
the serialized response.

503 is deliberate. Railway health-checks this path, so an unusable legacy
database now fails the check and keeps the previous good deployment serving
rather than promoting one backed by a counterfeit database. `railway.json` is
unchanged and the health-check path is unchanged.

### How `legacySeeded` is defined, and why it is safe

`legacySeeded` is true when **`inventory_lots` and `whatnot_purchases` each hold
at least one row.**

- **Why those two.** No legacy route can delete from either. The legacy API has
  no `DELETE` endpoint at all and issues no `DELETE FROM` anywhere in production
  code — verified by grep across all eight legacy routers. Zero rows therefore
  means loss from outside the application, which is exactly the condition this
  signal exists to catch.
- **Why "at least one" and not a count match.** A live database legitimately
  diverges from the fixtures: the owner adds lots, and the verified production
  backup already holds 2,119 purchase rows against the seed's 2,149. A test
  deletes one row in seven and adds a new lot, and asserts health stays green.
- **Why `cost_links` and `ebay_listings` are inspected but excluded from the
  verdict.** They are working tables rather than source imports, and any event
  capable of emptying them empties `inventory_lots` too, so including them adds
  false-alarm surface without adding detection. A test empties both and asserts
  health stays green.
- **Why `sales` is not the sentinel.** It has no repository fixture and is
  legitimately empty on a fresh database. Using it would report a healthy
  production database as broken.

`legacySchemaPresent` additionally requires the four columns
`migrateProductType` adds to `whatnot_purchases`, because `/api/purchases` and
`/api/dashboard` query `is_excluded` and `product_type`. Now that the migration
is gated, a database restored from a pre-migration backup will no longer migrate
itself — so health has to say so, and does, with `legacy_schema_missing`.

## Tests

Three new files, **48 focused tests**, all passing:

| File | Tests | Covers |
|---|---|---|
| `server/src/legacyBootstrapPolicy.test.ts` | 19 | fail-closed parsing including 8 near-miss values; no inference from `NODE_ENV`/`DATA_DIR`/`DATABASE_PATH`; the two permissions are independent in both directions; `ALLOW_LEGACY_WRITES` semantics unchanged; the startup log line names the flag and leaks no path |
| `server/src/legacyBootstrap.test.ts` | 12 | the no-mutation proof; `query_only` enforcement; missing database not created; directory not created; emptied baseline not reseeded; missing tables not created; pre-migration database not migrated; authorized bootstrap still produces 1,487/2,149/287/20/7 and **0 sales**; idempotent rerun; populated table not overwritten; authorized-bootstrap logging with no path |
| `server/src/legacyDatabaseHealth.test.ts` | 17 | healthy verdict; divergent counts stay healthy; empty working tables stay healthy; empty `sales` stays healthy; each bounded reason code; no leakage of path/SQL/driver text; health checks do not mutate; the full 200/503 response contract including `ok` and `readOnly` |

**The central test does not mock anything.** It bootstraps a real SQLite
database on disk, snapshots its complete `sqlite_master` catalog, its
`PRAGMA table_info(whatnot_purchases)`, row counts for all six tables, **all
2,149 rows of `(acquisition_line_id, product_type, product_type_source,
is_excluded, exclusion_reason)`**, and the full `app_meta` table; runs startup
again with bootstrap disabled; and requires every one of those to be identical.
Field values are compared, not only aggregates, because a re-tag or a re-flag
would leave counts unchanged.

Existing tests: `server/src/seed.test.ts` and `server/src/db.test.ts` now set
`SEED_LEGACY_ON_EMPTY = 'true'` explicitly, with a comment stating that
production does not. The legacy write-guard tests are unchanged and pass.

## Verification

All commands run at `1a3e27b` + this branch, with all three dependency roots
installed (`npm ci`, `npm ci --prefix client`, `npm ci --prefix server`, all
exit 0).

| Command | Result | Exit |
|---|---|---|
| `npm run lint` | pass (pre-existing warnings only, unchanged) | 0 |
| `npm run typecheck` | pass (server + client) | 0 |
| `npm run build:ci` | pass (client build + server strict typecheck) | 0 |
| `npm test` | **server 461 tests / 30 files, client 441 tests / 33 files, guard suites** all pass | 0 |
| focused S0.1 suites | **48 passed / 3 files** | 0 |
| `node --test scripts/db/guard.test.mjs` | 23 pass | 0 |
| `node --test scripts/ci/client-audit-gate.test.mjs` | pass | 0 |
| `git diff --check` | clean | 0 |
| `npm run db:reset` (postgres-shim tier) | 60 migrations replayed from empty | 0 |
| `npm run db:test` (postgres-shim tier) | 54 files, **1,625 assertions**, all pass | 0 |
| `ls supabase/migrations/*.sql \| wc -l` | 60, unchanged | — |
| `git status --porcelain supabase/` | empty — `supabase/` untouched | — |

**The `shadow-db-supabase-stack` tier was NOT run locally** and is not claimed
to have passed locally: it needs a Docker-local Supabase stack this environment
cannot start. Exact-head GitHub CI is the evidence for that tier.

### End-to-end production boot checks

Beyond the unit and integration suites, the real server was started with
`NODE_ENV=production` against temporary databases:

- **Missing database:** `GET /api/health` returned **503** with
  `reason: "legacy_database_missing"`; the database file and its parent
  directory were confirmed absent afterwards; the process stayed up and served;
  the startup log printed the DISABLED policy line.
- **Healthy database, two consecutive production restarts:** `GET /api/health`
  returned **200** both times with all four legacy fields correct, and a
  before/after snapshot of row counts (1,487 / 2,149 / 287 / 20 / 0 / 7),
  excluded count (30), classified count (2,149), `app_meta`
  (`classifier_version=5`) and full table catalog was **identical**.

## Limitations

- **This is repository verification, not hosted verification.** Nothing here
  proves how the deployed Railway service behaves. Hosted acceptance is
  outstanding and is listed below.
- The `shadow-db-supabase-stack` tier was not run locally (see above).
- `query_only` is not the same as opening the file read-only. Engine-level WAL,
  `-shm`, journal and locking writes may still occur against an existing
  database. The verified claim is narrower: no schema change and no business-row
  change. This is stated in `docs/architecture.md` rather than glossed.
- **Client behaviour on 503 is deliberately unchanged and slightly degraded.**
  `client/src/lib/api.ts` throws on a non-2xx, so `ReadOnlyBanner`'s health query
  errors and the banner renders nothing when the legacy database is unusable.
  It does not crash (`if (!data?.readOnly) return null;`). Teaching the client
  about the new fields belongs to S0.2, which owns `client/src/lib/`; the
  `HealthStatus` interface still declares only `{ ok, readOnly }` and simply
  ignores the additions.
- A pre-migration database now reports `legacy_schema_missing` instead of
  migrating itself. That is the intended trade, but it means restoring an older
  backup requires one deliberate authorized bootstrap.
- The dead `meta` table and the double declaration of
  `is_excluded`/`exclusion_reason` (inline in `initSchema` **and** as `ALTER`s in
  `migrateProductType`) were found again during this work and left alone — both
  are outside S0.1's scope and are already recorded in the Phase 0 census.

## Rollout

One deploy. The behaviour change is confined to the boot path and the health
response; no route, page, table, migration or dependency was added or removed.
On a healthy production volume with `SEED_LEGACY_ON_EMPTY` absent, the only
observable differences are the new fields on `/api/health` and one extra
startup log line.

## Rollback

Repository and deployment rollback only.

1. Revert the merge commit.
2. Redeploy the prior known-good commit if needed.
3. Do **not** edit SQLite rows.
4. Do **not** set `SEED_LEGACY_ON_EMPTY=true` as a casual rollback. It is an
   emergency explicit-bootstrap path, not a repair: `server/seed/*.json` is the
   original workbook import, contains **no** `sales` rows, and is not
   automatically valid production restoration data.
5. Restore from a verified backup only if the database was actually damaged, and
   only by following `docs/runbooks/railway-backup-deploy-preflight.md`.

Reverting is safe at any point because nothing in this change writes to,
migrates, or reshapes an existing database.

## Hosted acceptance checklist (owner, after review and merge)

**Not performed. Do not record any of these as passed until they are.**

1. Confirm a fresh verified Railway SQLite backup exists **before** deploying.
2. Record its SHA-256, size, `integrity_check` result and per-table row counts
   (`node scripts/verify-sqlite-backup.mjs <path> --json`).
3. Confirm the production volume is mounted and holds the expected database.
4. Confirm `SEED_LEGACY_ON_EMPTY` is absent or `false` in Railway.
5. Deploy the reviewed merge.
6. Confirm `/api/version` reports the expected merge SHA.
7. Confirm `/api/health` returns **200** with `legacyDatabaseAvailable: true`,
   `legacySchemaPresent: true`, `legacySeeded: true`,
   `legacyBootWritesEnabled: false`, and `readOnly` still reflecting the intended
   `ALLOW_LEGACY_WRITES` state.
8. Confirm legacy Inventory, Purchases, Cost Links, Listings, Sales, Health
   Checks and the Dashboard still load.
9. Restart the service once and confirm row counts and representative records
   are unchanged.
10. Confirm Railway health stays green.
11. Record the acceptance evidence **before** beginning S0.2 or S1.

If step 7 returns 503, do **not** set `SEED_LEGACY_ON_EMPTY`. Investigate the
volume first; the 503 is the signal working.

## Proposed `CURRENT_STATE.md` replacement text

Not applied. `AGENTS.md` reserves that file for the state steward and this work
order did not grant an exception. `CURRENT_STATE.md` remains stale in two
checkable ways carried over from the Phase 0 handoff: it records a repository
migration count of **47** when the directory holds **60**, and a last-reviewed
merge of PR #25 when PR #37 has merged.

**Replace "Deployment and verification" with:**

> - Repository: `harmonicforce/russellvault2`
> - Canonical and GitHub default branch: `main`
> - Railway source branch: `main`
> - Live app: `https://russellvault2-production.up.railway.app`
> - Supabase project: `ykdyqnvmwpxhowbwhzqz`
> - Last reviewed merge: `1a3e27ba818c4b3a0150f1b99ac6d83dd865b794` (PR #37,
>   Commercial Core & Legacy Retirement Phase 0)
> - Repository migration count: **60**
> - pgTAP files: **54**
> - Exact PR-head CI run: *(steward to record for PR #37 and for the S0.1 PR)*
> - Required jobs: build-and-verify, shadow-db-postgres-shim,
>   shadow-db-supabase-stack, dev-advisory-report
> - Railway deployment status on the reviewed merge: *(steward to record)*
> - Hosted acceptance: *(steward to record)*
>
> The repository documents do not independently prove the live Supabase
> migration ledger, and a green CI run proves nothing about the hosted app. Each
> migration-bearing release must verify live parity before acceptance, using
> `docs/runbooks/hosted-migration-parity.md`.

**Add a new section, "Legacy retirement program":**

> Phase 0 (census, architecture, plan) is merged as PR #37 and lives in
> `docs/programs/commercial-core-legacy-retirement/`.
>
> **S0.1 is implemented on a draft PR and is not merged.** It gates legacy
> boot writes and makes legacy database health explicit. Once merged and
> accepted:
>
> - Legacy SQLite writes are governed by **two independent permissions**.
>   `ALLOW_LEGACY_WRITES` governs legacy HTTP mutation routes;
>   `SEED_LEGACY_ON_EMPTY` governs whether startup may create, migrate or seed
>   the database. Both are off in production by default and neither implies the
>   other.
> - Startup no longer creates schema, seeds fixtures, adds columns, flags
>   exclusions, re-tags classifications or writes classifier metadata unless
>   explicitly authorized. The previous unconditional
>   `seedIfEmpty(); migrateProductType();` pair ran before the HTTP guard
>   existed, so the guard alone never made production read-only.
> - With both permissions withheld the connection is opened `fileMustExist` and
>   `PRAGMA query_only`, so a missing database is reported rather than created
>   and no schema or business row can change. Engine-level WAL and journal
>   activity against an existing file is not prevented and is not claimed to be.
> - `GET /api/health` returns 503 with a bounded reason code
>   (`legacy_database_missing`, `legacy_database_unreadable`,
>   `legacy_schema_missing`, `legacy_baseline_empty`,
>   `legacy_health_check_failed`) when the legacy database is unusable. `ok` and
>   `readOnly` are unchanged.
>
> **Still outstanding, in order:** S0.3 — the owner has not yet captured a fresh
> verified production backup, and that remains the highest-priority action in
> the program. S0.2 — `client/src/lib/dataAdapter.ts` still asserts that legacy
> SQLite is the only read and write path for business data, which is false and
> CI-enforced by two client tests.

**Amend "Current known incomplete or weak areas" → "Acquisition and cost" to
add:**

> - There is no governed inventory cost basis and no COGS entity anywhere in the
>   model, so no governed realized profit is computable.
> - There is no governed receiving step linking an acquisition line to the
>   inventory it produced.

## Owner actions carried forward

1. **S0.3 — capture and verify a SQLite export, `sales` included.** Still not
   done, and still the highest-priority action in the program. `sales` exists in
   no repository artifact. S0.1 makes a lost volume visible; it does not make it
   recoverable.
2. Review and merge the S0.1 draft PR, then run the hosted acceptance checklist
   above before starting S0.2 or S1.
3. Note that `docs/ai/CURRENT_STATE.md` is stale in two checkable ways;
   proposed replacement text is above.
4. `06_OWNER_DECISIONS.md` D-17 (gate reseed-on-empty) is answered by this PR in
   the recommended direction. The remaining eleven blocking decisions are
   untouched; D-8 (cost basis method) and D-1/D-2 (the 30-row adjudication) have
   the longest lead time.

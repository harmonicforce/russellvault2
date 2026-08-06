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
| Access control | none beyond the legacy-write guard (HTTP only) and the boot-write policy | RLS + workspace membership + role checks, on every read and mutation |
| Money | SQLite `REAL` | `amount_minor` integers plus an explicit currency |
| Reachable | always | only in `governed` mode — all four client variables present and exact. A PARTIAL governed configuration now fails closed rather than falling back here (see "Application configuration modes") |

**The two are never summed.** A legacy total that appears anywhere is labelled as
legacy, spreadsheet-imported inventory. Nothing in this repository migrates
legacy rows into the governed model, and the SQLite system does not become
authoritative by being present.

### The client knows which system owns which fact

`client/src/lib/dataTopology.ts` is the map, and it is the client's own copy of
the table above rather than a second opinion. Two facts about it are
load-bearing:

- **There are two business-data backends, and authority is per DOMAIN.** There
  is deliberately no zero-argument function naming one global active backend,
  because no honest answer exists — `backendForDomain(domain)` requires the
  domain. Governed Supabase owns and is authoritative for inventory identity,
  intake, current inventory, locations, movement, media, corrections, cycle
  counts, Listing Prep, readiness and the operations dashboard. Legacy SQLite
  REST owns legacy inventory, purchases, cost links, listings, sales, checks and
  the legacy dashboard section, and is authoritative for none of them.
- **Runtime availability is separate from authority.** Losing the governed
  configuration makes the governed backend unreachable; it does not make legacy
  authoritative for anything. `DUAL_WRITES_ENABLED` is `false` and
  `domainsWithMultipleAuthoritativeWriters()` is required by test to be empty,
  so no fact is ever written to both systems.

This replaced `dataAdapter.ts`, which asserted that legacy SQLite REST was "the
ONLY read and write path for business data" and that Supabase was touched
"solely for authentication and workspace-membership checks". Both had been false
since governed intake shipped, and two client tests were pinning the false
version in place.

## Application configuration modes

Which application the browser runs is resolved once, by
`client/src/lib/appConfig.ts`, before any client is constructed or any request
is made. There are three outcomes and `AuthShell` acts on them:

| Mode | Condition | Behaviour |
|---|---|---|
| `governed` | `VITE_SHADOW_AUTH=supabase`, `VITE_SHADOW_IMPORT=repository-fixtures`, and a non-empty `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` | Supabase Auth, workspace gating, first-run setup, governed routes. No legacy-only warning. |
| `legacy-only` | **none** of those four variables present | The legacy application renders, and the status banner says so: legacy-only, non-authoritative, governed workflows unavailable, totals must not be combined. |
| `misconfigured` | any other combination — one missing, a wrong flag value, a whitespace-only URL or key | **Fails closed.** A full-screen configuration error naming the offending variables. No routes, no sign-in form, no Supabase client constructed, no request issued. |

The third row is the point. Before S0.2, every one of those partial states
resolved to `null` and fell through to the unauthenticated legacy application,
so a single dropped environment variable silently downgraded a governed
deployment into the legacy one with nothing on screen to say so. The error
screen names FIELDS only and never a value, because two of the four carry a
project URL and an anon key.

The variable names keep their historical `SHADOW_` prefix because the deployed
service already sets them; renaming them is a separate change.

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
- **Legacy writes are disabled by default in production, and there are TWO
  permissions, not one.** `ALLOW_LEGACY_WRITES` governs legacy HTTP mutation
  routes; `SEED_LEGACY_ON_EMPTY` governs whether startup may create, migrate or
  seed the SQLite database. The HTTP guard alone never made production
  read-only — startup writes ran before it existed. See "The two legacy write
  permissions" below. Neither changes local development.
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

## The two legacy write permissions

Legacy SQLite writes arrive by two completely different routes, and they are
governed by two different, independent switches. Neither implies the other.

### 1. Legacy HTTP writes — `ALLOW_LEGACY_WRITES`

In production (`NODE_ENV=production`), all non-GET `/api/*` requests are
rejected with `403 { error, readOnly: true }` unless the server-only env var
`ALLOW_LEGACY_WRITES=true` is set. Reads are never blocked. Outside production
(local dev, tests, CI) writes are always enabled — this guard does not change
local workflows. There is no client-side switch and no secret in client code:
the client only ever learns the current state from `GET /api/health`
(`{ ok, readOnly, … }`) and shows a non-dismissible banner when `readOnly` is
`true`. See `server/src/legacyWriteGuard.ts`.

**This guard governs HTTP requests and nothing else.** It is Express
middleware, so it cannot govern anything that happens while modules are being
imported.

### 2. Legacy boot/bootstrap writes — `SEED_LEGACY_ON_EMPTY`

Until S0.1, `server/src/index.ts` called `seedIfEmpty()` and
`migrateProductType()` at module scope, before the guard above was installed.
Between them those two functions created seven tables and thirteen indexes,
added four columns to `whatnot_purchases`, inserted up to 3,950 fixture rows
into five tables, flagged food purchases as excluded, re-tagged `product_type`
on every non-manual row whenever `CLASSIFIER_VERSION` changed, and wrote
classifier metadata. `ALLOW_LEGACY_WRITES=false` stopped none of it.

The practical hazard was not theoretical. `seedIfEmpty()` refilled any table it
found empty, so a container that booted against a missing, empty, remounted or
mispointed volume rebuilt the schema and repopulated five tables from
`server/seed/*.json` — the ORIGINAL WORKBOOK IMPORT, not a backup. The result
looked like a recovered production database while `sales`, which has no fixture
at all, was simply gone.

All of that now runs only through `prepareLegacyDatabase()`
(`server/src/legacyBootstrap.ts`), and only when the separate server-only env
var `SEED_LEGACY_ON_EMPTY=true` authorizes it. The policy is fail-closed and
exact-match: missing, empty, `false`, `1`, `TRUE` and every other value are
disabled. Permission is never inferred from `NODE_ENV`, `DATA_DIR`,
`DATABASE_PATH`, a writable filesystem, or `ALLOW_LEGACY_WRITES`. See
`server/src/legacyBootstrapPolicy.ts`.

`npm run dev` and `npm run seed` set the flag so local workflows are unchanged.
`npm run start` — which is what Railway runs — does not.

### 3. Database opening mode

`server/src/db.ts` opens the connection lazily under both policies:

- **`fileMustExist` is set whenever bootstrap is not authorized.** A missing
  database is reported as `legacy_database_missing` rather than created, and the
  parent directory is not created either. This is what prevents a lost volume
  from producing a new database for startup to fill.
- **`PRAGMA query_only` is set whenever neither permission is granted** — the
  production default. The connection then rejects every `INSERT`, `UPDATE`,
  `DELETE` and DDL statement at the SQL layer.

**The guarantee, stated exactly:** with both permissions withheld, no schema
object and no business row can change through this connection. That is *not*
the same as "SQLite performs no writes". The database is opened read-write at
the file level, so the engine may still do WAL and `-shm` bookkeeping, journal
state and locking against an existing file. `journal_mode` is deliberately not
set on a query-only connection, because setting it is itself a write; an
existing production database already records WAL mode in its own header.

### 4. Health signalling

`GET /api/health` reports the legacy database honestly instead of assuming it
was repaired at boot:

```
{ "ok": true, "readOnly": true,
  "legacyDatabaseAvailable": true, "legacySchemaPresent": true,
  "legacySeeded": true, "legacyBootWritesEnabled": false }
```

`ok` and `readOnly` are unchanged. A missing, unreadable, structurally
incomplete or catastrophically empty database returns **503** with `ok: false`
and a bounded `reason` from a closed set: `legacy_database_missing`,
`legacy_database_unreadable`, `legacy_schema_missing`, `legacy_baseline_empty`,
`legacy_health_check_failed`. No path, SQL, driver message or stack trace is
ever included. Railway health-checks this path, so an unusable database now
fails the check and keeps the previous good deployment serving.

#### How the client consumes it

`client/src/lib/healthApi.ts` is a dedicated transport, because the generic
`request()` helper in `api.ts` turns every non-2xx into an `Error` and would
discard the 503 body — which is exactly what made the old banner vanish at the
moment it had something to say. The health transport treats **200 and the
defined 503 as two successful parses** and everything else as a transport
error: an unexpected status, a body that is not the documented shape, or a
network failure. A reason code the client does not recognize is dropped rather
than displayed, and no server text, path, SQL or stack trace can reach the
screen. The generic `get()` is unchanged, so no other endpoint gains permission
to return 503.

`client/src/components/SystemStatusBanner.tsx` renders one banner with a fixed
precedence — structured failure, then unverifiable health, then legacy-only,
then read-only — so the operator never sees two banners contradicting each
other. A structured failure is `role="alert"`, is shown on every route
including governed ones, and says that legacy data is untrusted while stating
plainly that governed inventory workflows are unaffected.

#### The predicate

`legacySeeded` requires `inventory_lots` and `whatnot_purchases` each to hold at
least one row. It deliberately does **not** compare against the repository seed
counts, because a live database legitimately diverges — the verified production
backup already holds 2,119 purchase rows rather than the seed's 2,149. Those two
tables are the sentinel because no legacy route can delete from them: the legacy
API has no `DELETE` endpoint and issues no `DELETE FROM` anywhere in production
code, so zero rows means loss from outside the application. `cost_links` and
`ebay_listings` are inspected but excluded from the verdict as working rather
than source tables, and `sales` is excluded because it has no fixture and is
legitimately empty on a fresh database. See
`server/src/legacyDatabaseHealth.ts`.

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
  production these must point at a **persistent volume** so data survives
  redeploys. A volume that is missing, empty or mispointed is no longer papered
  over by an automatic reseed: the service reports 503 from `/api/health` with
  a bounded reason code.
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

### Governed acquisition classification foundation (S1.1)

Acquisition classification taxonomy is governed workspace reference data, not a PostgreSQL enum and not only a TypeScript constant. Each workspace receives the ten D-6 default options (`slab`, `single`, `sealed`, `sneakers`, `apparel`, `accessories`, `electronics`, `collectibles`, `other`, `unreviewed`) through `acquisition_classification_options`, while owners can add future options without a deployment.

Classification rules are workspace-scoped, versioned rows in `classification_rules`. Initial `legacy_classifier_v5` seed data records the business-vertical mappings, delivered-item/full-title pattern families, strong mystery handling, explicit-evidence placeholder, and owner-confirmed seller-specialization fallbacks for `topshelfcollects`, `loosepacks`, and `findsfordays`. Rule-version changes insert new rows; existing rule history is not rewritten.

Governed acquisition line decisions are append-only rows in `acquisition_line_classifications`. A newer decision points at the prior decision through `supersedes_classification_id`; the prior row is retired exactly once by setting `superseded_at`, and current classification means `superseded_at IS NULL`, so current and historical rows remain queryable without mutating semantic evidence. Until later S1 cutover work, `server/src/classify.ts` remains the active classifier for the legacy SQLite path only; no Express endpoint or React page reads the governed classification tables yet.

### Governed acquisition classification function layer

S1.2 adds database-owned acquisition classification execution on top of the S1.1 governed rule tables. The classifier resolves a classifiable input from governed acquisition/provenance rows only: acquisition line, import job, source record/source system, product title, business vertical, delivered-item title, and the exact normalized supplier alias linked through the governed acquisition order. The delivered-item title preserves legacy semantics by using only the final ` - ` delimiter and trimming the trailing segment.

Rule evaluation is deterministic and limited to active governed rules with S1.1 matcher kinds (`exact`, `regex`, `evidence_set`) and closed match fields. Lower numerical precedence wins, preserving explicit evidence before non-card verticals, delivered-item signals, strong mystery terms, full-title fallbacks, seller specialization, and then fallback. If more than one active rule matches at the winning precedence, evaluation fails closed with a stable check-violation instead of selecting a physical-row-order winner.

Automatic classification is atomic at the acquisition-line level. The public classifier locks the authorized committed acquisition line, locks the current classification if one exists, evaluates active rules in the same transaction, and either returns the current row idempotently or retires the predecessor exactly once while inserting a successor linked by `supersedes_classification_id`. Owner overrides are never overwritten by automatic classification; retrying the classifier returns the preserved override without creating misleading history or audit events.

Owner overrides are separate governed actions. They require an owner role, an active same-workspace option, and a bounded nonblank reason. Overrides create `owner_override` classification rows with owner evidence and no system rule provenance, preserving prior automatic or owner decisions through supersession rather than deletion.

Rule authoring also uses governed functions rather than direct table writes. Owners can create a new logical rule or supersede an active rule by supplying the expected current version. Supersession locks the active rule, marks it `superseded`, inserts the next active version with `supersedes_rule_id`, and leaves all historical rows queryable. Direct authenticated inserts into `classification_rules` remain denied.

The S1.1 `explicit_evidence:legacy_sealed_line_ids` rule remains a governed placeholder in S1.2 because no trustworthy workspace-scoped governed equivalent of the legacy `sealedLineIds` set exists yet. The evidence-set matcher therefore fails closed and records the unavailable dependency instead of reading legacy SQLite or deriving sealed status from unrelated facts.

### Governed acquisition-line read surface (S1.3)

`acquisition_line_overview` is the committed governed-native list grain: exactly one row per acquisition line, joined only to its active lot/order placement and current (`superseded_at is null`) classification. It carries the same title, delivered-item, business-vertical, and exact supplier-alias semantics as governed classification input; historical classifications and placements do not multiply rows.

`list_acquisition_lines` performs bounded search, closed filters and sorts, deterministic immutable-identity tie-breaking, exact counting, and offset/limit pagination in PostgreSQL across the complete authorized workspace population. `get_acquisition_facets` counts that same committed population and includes active classification options at zero. Both functions re-derive membership from `auth.uid()`, permit owner/operator/viewer, and are executable only by `authenticated`.

The `/acquisitions` page and `/api/acquisition/{lines,facets}` are authoritative within that committed governed-native scope. Historical Whatnot purchases remain on the legacy page until reconciliation and their counts must not be added to governed counts. S1.3 intentionally exposes no financial totals because payment, shipment, landed-cost, and historical-import facts are not complete.

## S1.4 governed acquisition detail, payment, and shipment boundary

A governed acquisition payment is one immutable, positive, explicitly denominated cash-payment event at order grain. `source_reported_total_minor` remains source evidence and is never inferred to be a payment. Corrections reverse the original event once, with actor, timestamp, reason, and idempotency evidence preserved, then record a separate corrected payment. Mixed currencies are never summed.

An acquisition shipment is one inbound physical consignment at order grain. Carrier and tracking identity use deterministic lowercase/whitespace-and-hyphen normalization only; there is no fuzzy matching. The closed graph is `expected → in_transit|delivered|lost|cancelled`, `in_transit → delivered|lost|cancelled`, and `lost → in_transit|delivered|cancelled`; delivered and cancelled are terminal. Delivered is carrier/source arrival evidence only, never a receipt, reconciliation, or inventory event. A shipping reference amount is informational and is not an acquisition cost component or cost basis.

`get_acquisition_line_detail(uuid,text)` is the one caller-token, workspace-authorized snapshot boundary for committed governed-native line, order, current placement, classification and history, payment history and safe summary, shipment state, options, and bounded source evidence. HTTP and browser mutation boundaries use governed public IDs. Public-ID classification wrappers delegate to the existing S1.2 classifier and override functions rather than duplicating their algorithm. Historical legacy coverage remains false.

### S1.4 acceptance and integrity hardening

Payment reversal identity now lives in the append-only `acquisition_payment_reversals` ledger. Each workspace-wide operation key has one canonical meaning, each payment has at most one reversal event, and the mutable payment state links to that governed event. Shipment operations likewise live in append-only `acquisition_shipment_transitions`, including durable applied/no-op outcomes. The older last-key columns on `acquisition_shipments` are retained only for migration compatibility and are not operation-history authority.

All four payment/shipment operations hash normalized, named JSON objects rather than delimiter tuples. JSON preserves null separately from empty text and includes the target identity plus every semantic input. An identical workspace/key replay returns its recorded outcome; a changed meaning fails closed even after later shipment transitions. Shipment creation is restricted to the states named under "source-qualified acquisition operations" below; lost/cancelled require governed transitions and reasons.

Acquisition detail placement must resolve the selected line's exact active `acquisition_lot_lines` row rather than an arbitrary lot in its order. Client submissions create request keys before transport, keep them with mutation variables across failure/retry, and replace them only after confirmed success or deliberate cancellation.

## S1.4 source-qualified acquisition operations

An acquisition line's imported `public_id` is unique only within its governed source system, not within a workspace. The canonical identity is therefore the tuple **workspace + source-system public ID + acquisition-line public ID**. The browser route is `/acquisitions/:sourceSystemPublicId/:linePublicId`; the canonical server read and classification routes are `/api/acquisition/sources/:sourceSystemPublicId/lines/:linePublicId` and its `/classify` and `/classification-override` actions. Legacy workspace-plus-line wrappers fail with `ambiguous_acquisition_line_id` rather than selecting an arbitrary imported row.

Detail reads count active placements explicitly. Zero active placements returns `missing_active_placement`, one returns that exact lot, and more than one raises `acquisition_integrity_error`, including while the deferrable uniqueness constraint is deferred inside a transaction.

Shipment carrier and tracking columns preserve trimmed submitted capitalization, spaces, and punctuation as display evidence. Separately normalized values drive fingerprints, advisory locking, and case/format-insensitive duplicate detection. Formatting removed by the earlier S1.4 function cannot be reconstructed without independent source evidence. New shipments can begin only as `expected` or `in_transit`; delivery is a governed transition that requires an explicitly supplied actual `received_at` and never derives it from expected, shipped, or creation time.

The detail contract includes typed payment reversal events and complete typed shipment transition histories. The client renders both operation histories. Each payment creation, payment reversal, shipment creation, and shipment transition retains a distinct semantic payload and idempotency key after response loss. Its visible Retry action resubmits those exact variables; success or cancellation discards them. A stale shipment transition instead refetches current state and requires fresh confirmation with a new key.

## S1.4 acceptance completion

**Governed operation fingerprints.** The four governed mutation functions compute their idempotency fingerprint with `encode(sha256(convert_to(..., 'UTF8')), 'hex')`. `sha256`, `convert_to`, and `encode` all resolve from `pg_catalog`, which stays in scope under the `SET search_path = ''` that every `SECURITY DEFINER` routine here carries. An unqualified `digest()` does not resolve under that empty search path and pgcrypto is not installed, so any such call raises `undefined_function` at execution time rather than at deploy time. Governed functions must not depend on an extension-schema routine by bare name.

**Exact detail root-row cardinality.** `get_acquisition_line_detail_by_source` counts `acquisition_line_overview` ROWS, not distinct line IDs. The view LEFT JOINs `acquisition_lot_lines` on `state = 'active'`, so a line carrying two active placements yields two overview rows while still counting one distinct line ID; every other join in the view is to a unique key, which makes row count exactly equivalent to active-placement count. Zero rows returns not found, more than one raises `acquisition_integrity_error`, and the response is built from a literal one-row source through LEFT JOINs onto unique keys under `INTO STRICT`. There is no `LIMIT`: the query is one-row-safe because its cardinality is proven, and `TOO_MANY_ROWS` or `NO_DATA_FOUND` raises `acquisition_integrity_error` rather than returning an arbitrary answer.

**Source evidence names state what the value is.** `sourceEvidence.sourceImportJobPublicId` carries `public.import_jobs.public_id` — the SOURCE import job reached through `acquisition_import_jobs.source_import_job_id`. `public.acquisition_import_jobs` has no governed public ID, and none is invented to preserve a friendlier name. `sourceEvidence.sourceRecordRowKey` carries `public.source_records.source_row_key`, a raw source row key, never an RV-style governed public identity. The previous `acquisitionImportPublicIdentity` and `sourceRecordPublicIdentity` names described neither value and are gone.

**Migration ledger.** Every file in `supabase/migrations` records its own name in `public.schema_migrations_log`, and `supabase/tests/06_provenance_structure.sql` asserts the exact count and the full ordered list. `db:reset` applies the whole directory, so a migration that omits its ledger insert makes that count fall short and turns the assertion red. A mismatch is repaired by adding the missing entry, never by lowering the expected number.

**One unresolved governed operation at a time.** Recovery from an unconfirmed payment, reversal, shipment, or transition means resending the identical payload under the identical idempotency key, which is only safe while exactly one such request is outstanding. The client therefore retains a failed operation and blocks further payment and shipment submissions until it is retried or explicitly discarded, so two unresolved keys can never coexist invisibly. A stale transition is the exception and is never retained: its expected status is already known to be wrong, so it refetches and requires a newly confirmed transition under a new key.

### S1.5 acquisition-line exclusion boundary

A committed governed-native acquisition line is **included by default** until an owner records an explicit exclusion decision. Exclusion is a separate, reason-required decision; it is not deletion, classification, refund, cancellation, zero quantity, or zero cost. The source-qualified acquisition line remains authoritative evidence and remains visible in list, search, facets, and detail reads.

`acquisition_line_exclusions` stores append-only `excluded` and restoring `included` successor decisions. Only an owner may apply either decision; operators and viewers have workspace-isolated read access. A partial unique index permits at most one current decision per line. Source system plus line public ID addresses mutations, while workspace-global idempotency keys and canonical payload fingerprints make retries durable and reject changed-payload reuse.

`app.assert_acquisition_line_eligible_for_downstream(workspace_id, acquisition_line_item_id)` is the internal eligibility boundary. It accepts the default/included state and raises the stable `acquisition_line_excluded` code for a current exclusion. **Every S2 receiving or cost entry point targeting an acquisition line must enforce the S1.5 exclusion eligibility contract.** S1.5 creates no receiving, inventory, or cost workflow.

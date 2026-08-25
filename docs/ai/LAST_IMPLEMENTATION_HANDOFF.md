# Last Implementation Handoff

## Genome Repair Work Order 3 — decouple governed readiness from legacy SQLite health

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/russell-vault-genome-repair-hjt51c` (the existing PR #81
  branch, refreshed in place).
- Base SHA: `fa6cd832188d79505f9d41ca777c9ae1d9e7bba7` — current `main`, the
  merge of PR #83 (Work Order 4), read from GitHub on 2026-08-25.
- PR: **#81**, open, **draft**, not merged.
- Release authority: branch and draft PR only. No merge, no deploy, no Railway
  change, no hosted Supabase contact, no migration.
- Status: **implemented** and **validated** locally; CI evidence recorded below.

### What changed since the previous revision of this PR

PR #81 was written against `77a019a` and its previously observed head was
`b118c42084a4cc284ca4b4e0d1ce55939dccd2f0`. Both are superseded. The branch was
**rebased** onto `fa6cd83`; the WO3 commit replayed as `bbef4a5` with exactly
one conflict — this file, which WO4 had rewritten — resolved by taking `main`'s
version and then rewriting it here for WO3. A second commit, `1fa4c02`, carries
the drift repair and the added proofs.

The prior PR body claimed `main` was RED. **That claim is stale and has been
removed.** The `shadow-db-supabase-stack` timeout it described was Work Order
11's scope and was repaired and merged; `main` at `fa6cd83` is green.

## Behavior before and after

Before, `GET /api/health` returned **503** whenever the legacy SQLite database
was missing, unreadable, structurally incomplete or empty. `railway.json`
health-checks that path, so a store that is authoritative for **no current
business fact** could veto a governed deployment. That is R-003.

After, three states are kept separate and only one of them decides readiness:

| State | Endpoint | Question |
| --- | --- | --- |
| Process liveness | `GET /api/live` | Is this process up? Depends on nothing. |
| Governed readiness | `GET /api/health` | Was this deployment given a coherent governed configuration? |
| Legacy availability | reported in both, decides neither | Is the non-authoritative legacy database usable? |

`GET /api/version` is unchanged and remains the exact deployment diagnostic.

## The health truth table

Asserted in `server/src/health/healthContract.test.ts` as a full 6 × 5 matrix
(6 governed configurations × 5 legacy states), and again over real HTTP in
`server/src/health/healthRoutes.test.ts`.

| Governed configuration | Legacy condition | HTTP | `mode` | `ok` | `governedReady` | `legacyStatus` |
| --- | --- | --- | --- | --- | --- | --- |
| Valid | Ready | 200 | `governed` | true | true | `ready` |
| Valid | Missing | 200 | `governed` | true | true | `unavailable` |
| Valid | Corrupt | 200 | `governed` | true | true | `unavailable` |
| Valid | Required schema missing | 200 | `governed` | true | true | `degraded` |
| Valid | Empty baseline | 200 | `governed` | true | true | `degraded` |
| Absent (legacy-only) | Any | 200 | `legacy_only` | false | false | reported |
| Partial or malformed | Any | 503 | `misconfigured` | false | false | reported |

Partial or malformed governed configuration returns the bounded code
`governed_configuration_incomplete`; a wholly absent one reports
`governed_configuration_absent` at 200.

`ok` now reports **governed readiness**. All six legacy booleans are still
present with the same names and types, `legacyStatus` is added, and only 200 or
503 is ever emitted — so a pre-WO3 client still parses the response rather than
falling into its protocol-error path.

Readiness is decided by `SUPABASE_URL` + `SUPABASE_ANON_KEY` — the same two
variables `legacy/accessConfig.ts` and `provenance/config.ts` already read. No
second configuration-semantic authority was created: `governedReadiness.ts`
answers only "is this deployment governed, legacy-only, or half-configured",
and the existing modules keep deciding what their own surfaces do.

## Security properties

- `/api/health` performs **no network call and never touches Supabase**.
  Readiness is a pure function of configuration, so a transient dependency
  failure cannot fail the probe and cannot create a Railway restart loop.
- The legacy read sits behind a 5-second TTL cache (`legacyProbeCache.ts`), so
  slow or contended disk cannot dominate readiness. Diagnostics bypass the
  cache, because an owner asking for detail is asking about now.
- Health inspection is **side-effect-free**. With `SEED_LEGACY_ON_EMPTY` absent
  or set to anything other than exactly `true`, neither startup nor a health
  check creates the database, creates its parent directory, seeds records, or
  otherwise mutates legacy state. Proved against real temporary paths in
  `governedStartup.test.ts`, including `false`, `1`, `TRUE`, `yes` and `''`.
- `GET /api/diagnostics?workspaceId=<uuid>` requires a bearer token, a
  well-formed workspace id, and the **owner** role in the named workspace,
  resolved under the caller's own JWT through `workspace_members`. Operator,
  viewer and non-member are refused with the same code.
- **No service-role key** exists anywhere in the server source
  (`grep -rn 'SERVICE_ROLE\|service_role\|serviceRole' server/src client/src`
  returns nothing outside tests).
- Cross-workspace authority is proved by postcondition rather than by a stubbed
  `true`: a recording membership double asserts the query is filtered by both
  the **named** workspace and the **token-derived** user id, that an owner of
  one workspace naming another is refused, that a caller-supplied `userId` never
  displaces the token-derived one, and that only `workspace_members` is read.
- Every diagnostic code is bounded. A test asserts no code matches `/`,
  `select`, `sqlite`, `.db`, `Error:`, a stack frame, `anon`, or `supabase.co`.

## Client truth states

`SystemStatusBanner` keyed its legacy warning on the **overall** result status.
Health is now 200 when only legacy is broken, so that would have silently
deleted the warning at exactly the moment it was the only thing saying the
legacy numbers on screen cannot be trusted. It now keys on `legacyStatus`.

- When the server omits `legacyStatus` — an older deployment — the parser
  **derives** it from the three legacy booleans, so every consumer can rely on
  it. Unavailable legacy data is never presented as healthy, empty, or
  authoritative.
- A legacy failure **outranks** the incomplete-configuration notice, so the two
  can never appear together or contradict each other.
- Unrecognized server strings for `legacyStatus`, `mode` and `governedReason`
  are dropped rather than rendered.

## Verification evidence — local, on `1fa4c02`

| Command | Result |
| --- | --- |
| `npm ci` (root, client, server) | exit 0 |
| `npm run lint --prefix client` | exit 0 (warnings only, pre-existing) |
| `npm run typecheck` (server + client) | exit 0 |
| `npm run build:ci` (client + server) | exit 0 |
| `npm test` | exit 0 — server **1134** in 41 files, client **1637** in 68 files, Node guards **154** |
| `npm run guard:escapes` | exit 0 — 18 enforced files, only ESC-001/002/003 |
| `node --test scripts/ci/type-negative.test.mjs` | exit 0 — 7 compile-negative proofs |
| `node scripts/ci/current-state-guard.mjs` | exit 0 |
| `npm run db:reset` (shim) | exit 0 — 79 migrations replayed from empty |
| `npm run db:test` (shim) | exit 0 — **70 files, 2673 assertions**, matching the manifest |
| `npm audit --omit=dev --audit-level=high` (root) | exit 0 |
| `node scripts/ci/client-audit-gate.mjs` | exit 0 — GHSA-qwww-vcr4-c8h2 waived under the standing BrowserRouter/no-RSC policy |
| `npm audit --prefix server --omit=dev --audit-level=high` | exit 0 |
| `npx playwright test --project=chromium-desktop-1440x900 --project=chromium-tablet-portrait-834x1194` | exit 0 — 378 passed, 36 skipped, visual baselines unchanged |

**Not run locally, and why.** `npm run db:types:check` and the
`shadow-db-supabase-stack` pgTAP lane both need the local Supabase stack. The
agent environment's egress policy answers `403 Forbidden` to the Docker
registry blob fetch (`production.cloudfront.docker.com`), so
`supabase start` cannot pull its images. The full Playwright matrix additionally
needs WebKit, which is not installed here. All three run in CI on the exact PR
head; see the CI section. WO3 contains **zero SQL** and does not touch
`shared/database.types.ts`, so neither database lane can be affected by it.

## Preserved behavior

- **WO2** — legacy routes remain authenticated and bound to
  `LEGACY_WORKSPACE_ID`; an unconfigured surface still returns bounded
  `503 legacy_surface_not_configured`; read/write role separation and the exact
  `ALLOW_LEGACY_WRITES === 'true'` semantics are untouched; CORS is unchanged.
  Its structural proof over `index.ts` — that the public paths are declared
  publicly and no legacy prefix is mounted without the guard — passes
  **unmodified**. `/api/live` was added to `PUBLIC_API_PATHS` so that same proof
  now covers it; `/api/diagnostics` was deliberately not, because it is
  owner-gated.
- **WO11** — the CI timeout hierarchy, budgets, supervisor, progress and suite
  manifest are untouched; their self-tests pass.
- **WO4** — the generated contract, `shared/databaseAliases.ts`, the escape
  manifest and baseline, the compile-negative proofs and the migration-replay
  drift guard are untouched. The one interaction was the escape guard correctly
  rejecting a double cast in this PR's own new code; it was **removed**, not
  baselined.

## Files changed relative to `fa6cd83`

```
client/src/components/SystemStatusBanner.tsx        client banner keys on legacyStatus
client/src/components/SystemStatusBanner.test.tsx   +6 precedence / no-contradiction tests
client/src/lib/healthApi.ts                         WO3 fields, derived fallback, legacyIsUsable
client/src/lib/healthApi.test.ts                    old-payload and new-payload parsing
docs/ai/LAST_IMPLEMENTATION_HANDOFF.md              this file
docs/runbooks/health-and-readiness.md               new runbook
server/.env.example                                 documents the four endpoints and readiness inputs
server/src/health/governedReadiness.ts              new — configuration-only readiness
server/src/health/healthContract.ts                 new — liveness, health, diagnostics, version bodies
server/src/health/healthRoutes.ts                   new — the handlers behind those four paths
server/src/health/legacyProbeCache.ts               new — bounded, cached legacy read
server/src/health/diagnosticsAuth.ts                new — owner-only guard, caller JWT only
server/src/health/healthContract.test.ts            new — the 6x5 truth table
server/src/health/healthRoutes.test.ts              new — the same contract over real HTTP
server/src/health/governedStartup.test.ts           new — bootstrap opt-in and side-effect absence
server/src/health/diagnosticsAuth.test.ts           new — authorization and cross-workspace proofs
server/src/index.ts                                 route table for the four paths
server/src/legacy/routeInventory.ts                 /api/live added to PUBLIC_API_PATHS
server/src/legacyDatabaseHealth.ts                  superseded buildHealthResponse DELETED
server/src/legacyDatabaseHealth.test.ts             its 503-veto contract tests removed with it
```

No migration was added or altered. `docs/ai/CURRENT_STATE.md`,
`docs/ai/CURRENT_STATE.attestation.json`, `supabase/migrations/**` and
`shared/database.types.ts` are untouched.

The superseded `buildHealthResponse` is **deleted** from
`legacyDatabaseHealth.ts` rather than deprecated in place. Two functions with
the same name and opposite semantics is the duplicate-truth pattern this
program removes; one import of the wrong one would restore the veto.
`grep -rn 'buildHealthResponse' server/src client/src` finds it only in
`health/healthContract.ts` and its callers.

## Deployment and hosted state

- Railway: **not touched**. `railway.json` still declares
  `healthcheckPath: "/api/health"`, deliberately unchanged — that path is now
  the governed-readiness probe, which is the correct target. No executable
  evidence was found that the existing configuration cannot satisfy WO3, so
  scope was not expanded. Repointing it at `/api/live` is possible but not
  recommended and is an owner-timed action; see the runbook.
- Live Supabase project ref: **not checked**. No live read, migration, reset,
  restore or parity claim was made, so no deployed-configuration read was
  required.
- `/api/version` against the deployed app: **not checked / not authorized**.
- Hosted acceptance: **not performed**. Nothing was deployed.
- Production data touched: **none**.

## Known limitations and deferred work

- **ESC-002 remains open and is outside this work order.** Work Order 4 found
  that `submit_acquisition_receipt`, `cancel_acquisition_receipt` and
  `reconcile_acquisition_receipt` have unnamed SQL parameters and therefore
  appear uncallable through PostgREST. Repairing them needs a database
  migration and belongs in its own work order.
- `db:types:check` and the Supabase-stack pgTAP lane were not run locally; see
  the "Not run locally" note above. Both run in CI.
- The full browser matrix was not run locally: WebKit is not installed in the
  agent environment. Chromium desktop and tablet-portrait passed.
- Governed readiness validates the **shape** of `SUPABASE_URL`, never which
  project it names. Deployment identity remains the deployed runtime's to
  answer, per `CLAUDE.md`.
- The anon key is checked only for presence. A syntactically valid but wrong
  key cannot be detected without a network call, which the probe deliberately
  does not make.

## Rollback

Revert commits `1fa4c02` and `bbef4a5`, or close PR #81. Nothing has been
merged, deployed, or changed in any live system.

## Exact next decision

Create the separate **Receiving RPC Dispatch Repair** work order for ESC-002
before beginning WO5, then return to review and merge PR #81.

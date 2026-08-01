# Daily Workbench independent audit — 2026-08-01

## Scope and repository identity

The audited checkout was the clean merge commit `6be9955621d013699aeac0a39e0be6cf60b55ee7` (PR #30). Its first parent is PR #29, and its history contains merges #27–#30. There is no later commit in the supplied object database. Fetching `origin/main` was attempted with both the public GitHub URL and the repository-metadata proxy URL; the former was blocked by HTTP CONNECT 403 and the latter was unavailable. Therefore “no later remote commit” is **not independently verifiable** from this environment.

Static evidence included the named client/server files, all 55 migrations, migration guards, pgTAP suites, PR handoffs preserved in Git, and focused tests. No live Supabase, Railway, GitHub Actions, or hosted-owner access was available.

## Executive verdict

Immediate narrow correction was warranted. Current main had four user-visible Workbench correctness defects: mixed photo definitions, contradictory correction-card copy, first-page-only intake counting, and failure/race handling that could turn unknown into zero or allow an old workspace response to overwrite a new one. The whole-workspace dependency concern was a false alarm for the current provider, though primitive dependencies are safer. Dashboard duplication is a bounded architectural risk, not grounds for redesign. The canonical state and roadmap are definitively stale as repository ledgers, while deployment, live migration, and hosted acceptance remain unverified rather than implicitly complete.

## Finding matrix

| # | Classification | Severity | Exists at audited base? | Evidence and user effect | Recommended action / verification |
|---|---|---:|---|---|---|
| 1 | Documentation inconsistency | Medium | Yes | `CURRENT_STATE.md` names PR #25/47 migrations and says media/listing/dashboard are next or incomplete; history contains merged #27–#30 and 55 migrations. PR #27/#28 handoffs explicitly say no live migration/deploy/hosted acceptance; #30 says the same. | Update canonical wording only under steward authority. Repository facts verified locally; remote/deploy/live/hosted facts not verified. |
| 2 | False alarm (with resilience improvement) | Low | No demonstrated loop | `WorkspaceProvider` memoizes `workspace` from `workspaces` and `selectedId`; `client` is a provider prop. Workbench depended on the full object, but its identity is stable until a real workspace-list/selection change. This differs from Listing Prep's former freshly-created dependency loop. | Prefer `workspace?.id`; do not describe the old code as an infinite-loop bug. Inferred from React identity rules and code. |
| 3 | Confirmed bug | Medium | Yes | Count/rows/drill-down used `inventory_work_queue.needs_photos`, defined as zero media rows; Current Inventory's filter used `media_count = 0`. The sentence used `get_media_readiness_summary`, whose statuses include reserved uploads, open issues, missing required angles/defects, and zero active photos. | Keep this card explicitly zero-photo end-to-end; present readiness/issues separately until a bounded readiness queue and matching drill-down exist. Verified statically and by SQL contracts. |
| 4 | Confirmed bug | Low | Yes | `QueueCard` rendered “Nothing waiting here” whenever rows were empty. Corrections intentionally supplied `rows={[]}`, so a positive count also displayed that sentence and a review link. | Suppress empty copy for positive/count-only cards. Rendered regression test added. |
| 5 | Confirmed bug | Medium | Yes | Workbench requested 10 newest sessions, then filtered `state === open` in the browser. Server ordered all states by `updated_at`, paginated, and only returned the unfiltered total. Ten newer abandoned sessions could hide an older open session and show zero. | Add validated server-side state filtering before ordering/range; use filtered `total` as the badge and first ten as preview. Route and transport tests added. |
| 6 | Confirmed bug / partially valid | Medium | Yes | Core six queue calls shared one fatal `Promise.all`. Correction failure was `.catch(() => 0)` (dishonest zero). Media/prep failures became null; prep visibly said unavailable, but media null silently changed explanatory semantics. Intake failed the whole load after core state had committed. | Isolate optional sources, represent correction/intake unknown visibly, and never substitute zero. Keep core queue failure page-visible. Verified by rendered test. |
| 7 | Confirmed bug | High for multi-workspace users | Yes | No cancellation or request generation guard existed. A→B: B could finish, then A's setters could overwrite B. Loading did not clear prior values, and an error left old values visible. Transports captured the selected ID through closures. | Clear state at load start and guard every commit/finalizer with a monotonically increasing request ID. Verified from control flow; hosted timing not required. |
| 8 | Not verifiable from repository evidence; architectural/deployment risk | High if schema is stale | Unknown live | Main contains eight new media/listing migrations (55 total). PR #27/#28 handoffs say they were CI/shadow tested but not applied live or hosted-tested. Feature flags gate the whole Supabase surface, not individual RPC availability. Missing media/listing RPCs yield 400/unavailable responses; Dashboard workflows fails as one panel; old Workbench core view failures can fail the page. | Before release, compare live ledger, apply only with authorization, verify `/api/version`, and perform hosted acceptance. Never infer parity from files or CI. |
| 9 | Architectural risk / partially valid | Medium | Yes | Dashboard health and Workbench location use equivalent predicates over related views. Dashboard work and Workbench zero-photo task share `inventory_work_queue`. Dashboard workflow endpoint uses readiness/listing RPCs, while Workbench mixed zero-photo and readiness concepts. Corrections/intake are absent from Dashboard; legacy totals are explicitly separated. Dashboard missing-media destination `/media?status=missing` is not a declared client route (Photo Issues is `/photo-issues`). | Share database authorities; do not merge the surfaces. Correct invalid drill-down separately and add predicate-parity contract tests. |
| 10 | Partially valid | Medium | Yes | pgTAP directly covers migration ledger, work-queue/location parity, media readiness summary, listing summary, RLS and concurrency. Route/transport tests cover auth and APIs. Before this patch there was no rendered Workbench suite for positive corrections, failure-to-zero, pagination totals, or workspace races; no Dashboard/Workbench cross-contract test; no missing-live-RPC Workbench test. | The focused Workbench contracts and A-to-B race now have rendered/route coverage. Retain pgTAP authority for SQL semantics and add cross-surface tests only with a corresponding implementation change. |

## Definition and scenario evidence

### Photos

`inventory_work_queue.needs_photos` counts **any media row**, including lifecycle states introduced later. Current Inventory similarly checks `media_count = 0`. Media readiness counts only active photos as coverage and prioritizes `upload_incomplete`, then `media_review_needed`, then missing required angle/defect, then complete.

Concrete divergence:

* One active front photo with a missing back angle: zero-photo card count/rows/drill-down exclude it; readiness explanation counted it.
* All required angles plus a reserved upload: zero-photo population excludes it; readiness is `upload_incomplete`.
* Active photo with an open issue: zero-photo population excludes it; readiness is `media_review_needed`.
* No rows at all: both identify work (`missing_required_angle` even with no category matrix).
* A subtype with no required matrix and one active photo: readiness complete and zero-photo false.

The authoritative contract for the existing **Needs photos** inventory card is the bounded zero-photo queue. `inventory_media_readiness` is authoritative for a distinct **Photo readiness/issues** workflow; mixing its aggregate prose into the old queue is incorrect.

### Failure and race behavior at the audited base

* Work-queue counts/rows and operations counts/rows: one failure rejects the core `Promise.all`, shows the page error, leaves previously successful values in place, and skips later sources.
* Correction count: failure became factual `0`.
* Media summary: failure became `null`; no warning, and prose fell back to zero-photo semantics.
* Listing summary: failure became `null`, with visible “could not be read”.
* Intake sessions: failure entered the outer catch after core values were committed, producing a page error.
* No request was cancelled. A late A response could execute every setter after B, including A's `finally`.

PR #30's `PanelState` is the better honesty pattern (“No zero has been substituted”), but a wholesale React Query migration is unnecessary for this repair.

### Routes and flags

The client route is `/inventory/current`; boolean URL parsing accepts the Workbench's `1` and Dashboard's `true`. Photo Issues is `/photo-issues`; `/media?status=missing` has no client route. Media and Listing Prep server routes are mounted and gated by the repository-fixtures/Supabase capability configuration. The gate establishes availability of the broad shadow surface, not migration-by-migration RPC capability.

## Documentation findings and replacement wording

Do **not** edit `CURRENT_STATE.md` under this work order. A steward-authorized update should say:

* **Definitively outdated:** “Last reviewed merge PR #25” → “Repository review includes merge `6be9955` (PR #30), subject to remote-main fetch limitation.”
* **Definitively outdated:** “Repository migration count: 47” → “55.”
* **Definitively outdated as repository status:** Media and Photography Hardening and Listing Prep are no longer merely next-stage options; their repository implementations merged in #27/#28. Dashboard foundation expanded in #30.
* **Still accurate/incomplete:** acquisition/cost, sales/fulfillment/returns, broad Playwright/release normalization, saved views/configurable priority, and broader dashboard intelligence remain incomplete.
* **Not independently verifiable:** whether #27–#30 exact merge heads have current green CI, whether Railway serves #30, whether migrations 48–55 are live, live-ledger parity, and hosted owner acceptance for Media, Listing Prep, or Dashboard.
* **Evidence-qualified replacement:** “PR #27/#28 handoffs report green exact-head CI/shadow evidence, but explicitly report no live migration, deploy, or hosted acceptance. PR #29/#30 handoffs contain local validation only and no independently verified exact-head CI/deployment evidence in this checkout.”
* **Recommended next work:** first reconcile live migration/deployment/hosted evidence; then choose remaining commercial slices. Do not continue listing Media/Listing Prep/Dashboard as wholly unimplemented.

`PROJECT_ROADMAP.md` has the same repository-status inconsistency: #27/#28/#30 capabilities should move from “Next-stage options” to implemented-but-release-evidence-pending, without calling them hosted-complete.

## Patch proposal and regression plan

The focused patch accompanying this audit:

1. aligns Needs photos prose with its existing zero-photo count/rows/drill-down contract;
2. makes count-only positive corrections non-empty and correction failure unknown;
3. adds `state=open` filtering before intake pagination and uses filtered `total`;
4. isolates optional requests, clears stale metrics, and rejects late response commits;
5. uses primitive workspace ID dependencies.

No database model, migration, deployment configuration, secrets, live data, or canonical ledger is changed.

Regression tests:

| File / test | Setup and action | Expected / invariant |
|---|---|---|
| `client/src/pages/Workbench.test.tsx` — positive correction queue | Count 3, no preview rows | No “Nothing waiting”; review direction remains. |
| same — correction request failure | Reject count promise | `—` and visible warning; unknown never becomes zero. |
| same — intake total | Server returns total 14 with ten-row preview | Badge is 14 and request includes `state=open`. |
| `client/src/lib/intakeApi.test.ts` — filter transport | Call `listSessions(..., 'open')` | Encoded state query is sent. |
| `server/src/routes/intake.test.ts` — filter before pagination | Newer abandoned and older open fixtures, limit 1 | Only open row and filtered total 1. |
| same — workspace race | Deferred A/B promises, resolve B then A | B remains visible and A cannot finish/overwrite B. |
| future pgTAP parity | Fixtures for each media readiness scenario | Any readiness-driven UI consumes the readiness population end-to-end. |
| future Dashboard route test | Inspect each task destination against router table | Every destination resolves; `/media` cannot recur. |

## Verification boundary

Verified locally: Git graph in the supplied checkout, file and SQL contracts, migration count, focused client/server tests, typecheck. Historical CI statements are repository handoff evidence, not a fresh GitHub verification. Live migration parity, Railway deployment SHA, and hosted acceptance were not checked and must remain reported as unknown.

# Last Implementation Handoff

## Surrender state

- Repository / canonical branch: `harmonicforce/russellvault2`, `main`
- Base SHA: `ac0441c589927b807159e96ae59a6ba459e58ee8` (`origin/main`, fetched
  this session, matching the work order; the merged dashboard PR is #35)
- Work order: Production Integrity Repair Pass
- Implementation branch: `claude/repair-production-integrity`
- Pull request: draft, into `main`
- Repository migration count: **56 → 60** (four new forward migrations). No
  migration that has ever been applied anywhere was edited. `20260802000400` was
  amended in place during the review pass — it exists only on this unmerged
  branch and has been applied to no database — so the count is unchanged by that
  amendment. Count it from the directory, not from this line:
  `ls supabase/migrations/*.sql | wc -l`.
- pgTAP files: 50 → 54
- Hosted Supabase parity: **not checked and not claimed.** No migration applied
  remotely.
- Railway: not deployed, not restarted, not reconfigured; `/api/version` not
  queried
- Hosted acceptance: not run. An owner checklist is at the end of this document.
- Production data, configuration and secrets: untouched
- `docs/ai/CURRENT_STATE.md`: **not edited.** Proposed replacement text is in
  this document under "Proposed CURRENT_STATE.md replacement text".

## What this pass was for

PR #35 merged an operations dashboard whose numbers did not agree with the pages
they opened, and which in production showed the operator a raw PostgREST string:

> `Could not find the function public.get_operations_inventory_health(p_workspace_id) in the schema cache`

The goal was not new product features. It was to restore operational truth:
a number opens exactly the records it counted, a dependency failure is legible
without leaking database internals, current queues contain only current stock,
two workflows that existed on the server gained an owner-facing entry point, the
shell became usable on the device it is actually used on, and the documentation
came back into agreement with the code.

Every defect below was re-verified against `ac0441c` rather than taken from the
review threads. Two threads GitHub had marked outdated (the diff hunk had moved)
were **still real** and are repaired here.

## Defects repaired

### 1. Dashboard failure contract (`eda1a88`)

`fail(res, message)` returned `error.message` verbatim, so a PostgREST schema
cache error reached the browser with the governed function's name in it, and
`operationsDashboardApi.ts` read only `body.detail`, so a 401 and a 503 were
indistinguishable to the panel.

Now `server/src/operationsDashboard/contract.ts` holds a stable public contract —
`unauthenticated` (401), `unauthorized_workspace` (403), `feature_unavailable`
(404), `dashboard_contract_missing` (503, for a missing governed function) and
`dependency_failed` (503). The raw message is logged with `console.error` and
never returned. `FORBIDDEN_IN_CLIENT_PAYLOAD` names the strings a client payload
must never contain, and a route test asserts it. The client surfaces `code` and
status through a `PanelError`, and a failed panel still refuses to render a zero.

`docs/runbooks/hosted-migration-parity.md` is new: how an owner distinguishes
"the dashboard is broken" from "the dashboard's database update has not been
applied." It is read-only and applies nothing.

### 2. One authoritative no-active-photo fact (`a2e6960`, migration `20260802000100`)

`inventory_work_queue.needs_photos` counted media with `lifecycle = 'active'`;
the Current Inventory drill-down filtered `media_count = 0`, and `media_count`
counted **every** lifecycle. A record whose only photo had been deleted was
counted by the dashboard and then absent from the page the dashboard opened.

`media_count` is preserved rather than redefined — its consumers were not
audited, and silently changing its meaning would have moved the defect rather
than fixed it. Appended instead: `active_media_count`, and the authoritative
`needs_photos` boolean carrying the *same* predicate as the work queue,
including its current-stock scope. `primary_media_path` is now restricted to
active media, so a deleted photo can no longer be a record's thumbnail.
Current Inventory filters on `needs_photos`.

### 3. Media backlog truth (`0f54c6c`, migration `20260802000200`)

`inventory_media_readiness` builds subjects from all items and lots with no state
predicate, and `get_media_readiness_summary` added none — so the backlog counted
voided, superseded, lost, absorbed and depleted records as photography work.

`inventory_media_readiness` is **not** narrowed, because `get_inventory_media_readiness`
(item, lot and Listing Prep detail for historical records) and
`listing_prep_readiness` both consume it; narrowing it would have broken
historical detail pages. A separate `inventory_media_readiness_current` view
joins it to `inventory_record_overview`, and the summary reads that.

`get_operations_media_backlog` is the exact governed aggregate for the "No active
photo" total — deliberately not derived from `/work`, which is capped at twenty
candidates and would have understated any backlog above twenty.
`list_current_media_readiness` is the matching drill-down, reached through a new
readiness tab on Photo Issues.

### 4. Listing Prep destinations (`0acdfee`, migration `20260802000300`)

Three separate mismatches: the no-active-preparation count had no reachable
destination; readiness links forced `tab=queue`, whose statuses exclude
`ready_to_list`, so a regressed ready record was counted and then unreachable;
and `by_status.ready_to_list` counted records that had since acquired blockers.

`listing_prep_candidates` is one view holding the predicate, and both the
summary count and the new candidate listing read it, so they cannot drift. Raw
`by_status` is preserved unchanged; `ready_now` (ready with `blocker_count = 0`)
and `regressed_ready` (ready with blockers) are added alongside it, and the
dashboard uses those. `list_listing_prep_queue` keeps its signature — no new
overload — and readiness queries broaden the status list they supply. Listing
Prep gains a "No active preparation" tab and a "Regressed from ready" badge. No
record's status is silently mutated.

The population is named for what it is, not "never started" — see review
correction 5.

### 5. Deterministic candidate selection (`eda1a88`)

`.order('created_at').limit(20)` with no unique tie-breaker returns an arbitrary
subset when candidates share a timestamp — a bulk intake produces exactly that.
Ordering is now `created_at, subject_kind, subject_id`, so repeated calls return
the same twenty. The two rule queries stay independently bounded: each is
ordered oldest-first and age is the only variable term within a rule, so merging
two correct top-20s yields the correct global top 20, and a record with two
exceptions still produces two tasks.

### 6. Cycle Count first use (`89ce4e0`, migration `20260802000400`)

`CycleCounts.tsx` rendered "Choose a session" with no way to create one, while
the server route and `create_cycle_count` already existed.

Two things were wrong underneath, and both are fixed in the database rather than
the client:

- `create_cycle_count` took no idempotency key and performed a bare `INSERT`
  with a freshly minted `RV-CC` id. A retry after a lost response — exactly what
  a "Start cycle count" button produces on a flaky connection — opened a second
  draft over the same shelf. A key held in browser memory proves nothing to the
  database. `create_cycle_count_session` takes a required key, is protected by a
  partial unique index, returns `outcome: 'created' | 'idempotent_replay'`, and
  handles the lost race in an exception block so the loser returns the winner's
  session rather than an error. The non-idempotent function is **revoked, not
  dropped**, matching repository convention.
- `start_cycle_count` returned expected item, lot and unit counts to every
  caller. The Express route deleted those three fields, but the browser's cycle
  count transport calls the function directly through PostgREST, so a boundary
  enforced in one transport was not a boundary. A blind session now omits them at
  the database layer; a deliberately non-blind session still reports its scope.

The UI adds scope selection, a scope review that shows no expected totals, an
explicit draft-then-start step, and operator/owner enforcement.

### 7. iPad usability (`e77f4af`)

The app is used mostly on an iPad. `App.tsx` docked a 240px sidebar at every
width and Current Inventory switched to the desktop table at `md` — 768px,
exactly iPad portrait — leaving the table roughly 528px, which is what clipped
it.

Navigation is now one `NavigationPanel` definition rendered twice: the permanent
sidebar from `lg` up, and a slide-over drawer below it. The drawer is a labelled
modal dialog and closes on the backdrop, on Escape, and on choosing a
destination. Current Inventory moves its table to `lg:block` and its cards to
`lg:hidden`, and the card list gains the selection checkbox it was missing so
bulk move is reachable without a desktop.

### 8. Documentation (this commit)

`README.md` still called Supabase a "Phase 2 local shadow foundation" that was
"local-only", described only the legacy dashboard, and carried a completed owner
action about the Railway source branch. `docs/architecture.md` described one
system. `LAST_IMPLEMENTATION_HANDOFF.md` described the
`codex/audit-workbench-contracts` Workbench audit and predated both #28 and #35.

All three now distinguish legacy SQLite surfaces from the governed Supabase
model, state that the two totals are never summed, describe the governance rules
actually enforced, and separate **repository** migration state (countable here)
from **hosted** migration state (not verifiable here, and not claimed).

## Review corrections (second pass)

Independent review of the draft PR found six required corrections. All six are
applied on the same branch. Each was a real defect; none is cosmetic.

### 1. The drawer closed on any click inside the nav

`NavigationPanel` put the close handler on the `<nav>` element, so it fired for
anything that bubbled — including the "Tools & legacy" expander. Opening that
group closed the panel containing it, which made every legacy and tools
destination unreachable from a tablet.

The handler moved onto each `NavLink`, and `ToolsNavGroup` now receives and
applies it to its nested links. `App.governedNav.test.tsx` renders the shell
with the governed surfaces **enabled** — the configuration where the nav
contains anything other than destinations — and proves the group expands
without closing, its nested destinations stay reachable, choosing one closes the
drawer, and backdrop and Escape still work. Verified as a genuine regression
test: with the handler restored to the `<nav>`, four of its seven cases fail.

### 2. The readiness drill-down could not reach past fifty records

`list_current_media_readiness` returns an exact total and defaults to fifty
rows. `MediaIssues` made one request and offered no paging, so a dashboard tile
reporting 120 opened a page from which seventy of those records were
unreachable — the same class of defect as a count opening the wrong page.

The transport takes `limit`/`offset`; the page holds status *and* page in the
URL, so a filtered page is shareable and Back restores it. Changing status
resets to page one, because a different population starts at its own beginning.
Readiness rows are **cleared before each load** — showing the previous status's
rows under a new heading reads as the answer to the new question.

Status is now validated on both sides. `MediaIssues` drops an unrecognised
status and says so rather than indexing the label table with it and taking the
page down; the route refuses one with a `400 invalid_status` rather than
forwarding text that matches no rows and reports an empty backlog. Nine rendered
cases plus six server cases cover it, including SQL-injection-shaped input.

### 3. A cycle count key was bound to nothing

`create_cycle_count_session` returned the existing session for a matching key
without checking that the request was the same request. An operator who noticed
the wrong shelf, corrected it, and pressed create again was handed the count
over the shelf they had just corrected away from — and nothing said so.

The key is now bound to a fingerprint of the normalized creation payload:
resolved root location, include-descendants, subtype filter, vertical filter,
blind-count setting, and normalized notes. Identical replay returns
`idempotent_replay`; any changed dimension returns
`{outcome: 'idempotency_conflict', code: 'IDEMPOTENCY_KEY_REUSED'}` and neither
returns nor modifies the original session. This matches the convention already
established for observation idempotency in `20260730000300`.

The `unique_violation` handler now re-selects and returns the existing session
**only if a row for that key genuinely exists**, and re-raises otherwise — the
violation could have come from another constraint entirely, and swallowing it
would have reported a replay that never happened.

The location is resolved *before* the key lookup, so the fingerprint describes
the location the request names rather than the code string it used. The cost is
that a replay whose location has since been retired raises instead of replaying;
it still creates nothing, so the no-double-create guarantee is untouched.

Client side: editing the scope after an attempt mints a fresh key, because that
is a different request and the database now correctly refuses key reuse. Leaving
the scope untouched still reuses the key. A conflict is reported plainly and no
draft is invented from a response that carried none.

`20260802000400` was **amended in place** rather than superseded. It exists only
on this unmerged branch, has been applied to no database, and `db:reset` replays
every migration from empty, so there is no drift for a forward correction to
protect against. `ENGINEERING_RULES.md` says "prefer additive migrations" and
does not forbid this. **The repository migration count is unchanged at 60.**

### 4. Cycle Count scope filters were raw enum text boxes

Category and Business vertical were free-text inputs over database enums. A typo
produced a filter matching nothing and a count finding nothing, with no way to
tell which had happened. Both are now selects built from `INVENTORY_SUBTYPES`
and `BUSINESS_VERTICALS` — the same governed constants Current Inventory filters
by — showing labels, never raw enum values, on both the form and the review
screen.

### 5. "Never started" was false

`listing_prep_candidates` admits records whose prior preparations are `listed`
or `cancelled`, because repeat preparation is deliberate: stock comes back, a
listing ends, and the record needs preparing again. Calling that population
"never started" was false about those records' own history.

Repeat-preparation behaviour is preserved and the name corrected throughout:
`get_listing_prep_summary.never_started` → `no_active_preparation`, the dashboard
tile and Listing Prep tab → "No active preparation", plus the view comment, the
API types, the Workbench tile (which also pointed at the wrong tab), the route
documentation and the pgTAP. `52_listing_prep_destinations.sql` now proves a
record whose preparation was **listed** returns to the population, which is the
decisive case for the naming.

### 6. Handoff accuracy

Totals refreshed from GitHub, and the hosted rollback instruction replaced — see
"Rollback". The previous wording advised re-applying prior migration files,
which is not a safe rollback and could have destroyed the migration ledger's
value as evidence.

## Files changed

As reported by GitHub for PR #36 at head `25c49d6`: **41 files changed,
+5306 / −213** against `ac0441c`, across 9 commits. (These are GitHub's figures,
not a local diffstat.)

Migrations added (four; no existing migration edited):

- `supabase/migrations/20260802000100_active_media_semantics.sql`
- `supabase/migrations/20260802000200_current_media_readiness.sql`
- `supabase/migrations/20260802000300_listing_prep_candidates.sql`
- `supabase/migrations/20260802000400_cycle_count_create_idempotency.sql`

pgTAP added (four): `50_active_media_semantics.sql` (18 assertions),
`51_current_media_readiness.sql` (18), `52_listing_prep_destinations.sql` (25),
`53_cycle_count_create_idempotency.sql` (31). `06_provenance_structure.sql` moves
its ledger assertion 56 → 60 and names the four new migrations.

Server: `operationsDashboard/contract.ts` (new), `routes/operationsDashboard.ts`,
`routes/cycleCounts.ts`, `routes/listingPrep.ts`, plus route tests.

Client: `App.tsx`, `pages/CurrentInventory.tsx`, `pages/Dashboard.tsx`,
`pages/ListingPrep.tsx`, `pages/MediaIssues.tsx`, `pages/CycleCounts.tsx`,
`pages/Workbench.tsx`, `lib/inventoryData.ts`, `lib/operationsDashboardApi.ts`,
`lib/listingPrepApi.ts`, `lib/cycleCountApi.ts`, plus tests including the new
`App.responsive.test.tsx`, `App.governedNav.test.tsx` and
`pages/MediaIssues.readiness.test.tsx`.

Docs: `README.md`, `docs/architecture.md`,
`docs/runbooks/hosted-migration-parity.md` (new), this file.

## Validation evidence

Every figure below was observed with an exit code in this session. Nothing is
reported as passed that did not actually run.

- `npm run lint` — exit 0. Seven pre-existing warnings, all confirmed present on
  `ac0441c` by linting the base version of the same files. No new warning.
- `npm run typecheck` (server `tsc --noEmit` + client `tsc -b`) — exit 0.
- `npm test` — server 27 files / 413 tests passed; client 33 files / 441 tests
  passed; DB guard 23/23 passed.
- `npm run db:reset` then `npm run db:test` (**shim tier**) — replayed all 60
  migrations from empty; **54 files, 1625 assertions, all passed.**
- `npm run build:ci` — exit 0 (Vite emitted its existing chunk-size advisory).
- `node --test scripts/db/guard.test.mjs` — 9 passed.
- `node --test scripts/ci/client-audit-gate.test.mjs` — 14 passed.
- `git diff --check` — clean.

**Exact-head CI, run `30765560756` on `25c49d6`: all four required jobs
succeeded** — `build-and-verify`, `shadow-db-postgres-shim`,
`shadow-db-supabase-stack`, `dev-advisory-report`. The Supabase CLI tier passed
there, which is the only evidence for the tier that cannot be run in this
environment.

**One honest caveat about the shim run.** On the first attempt,
`15_acquisition_digest_parity.sql` exceeded the runner's 600s per-file timeout
and the suite aborted. Run standalone against the same database it completed in
**6.7 seconds**. A second full reset-and-run then completed with all 54 files
passing. This is the intermittent in-suite slowdown already recorded in
`CURRENT_STATE.md` under acceptance infrastructure; it is not caused by anything
in this branch (that file predates it and is untouched here), but it is real,
it recurred, and it is reported rather than smoothed over.

**The Supabase CLI tier was not run locally** — Docker is not available in this
environment. It is therefore CI-only evidence for this branch and is **not**
claimed as locally passed. The `shadow-db-supabase-stack` job on the exact PR
head is the only thing that establishes it.

Not run, and not claimed: hosted browser acceptance, `/api/version`, hosted
Supabase parity, dependency audits, Playwright (no harness exists in this
repository).

### What the responsive tests do and do not prove

`App.responsive.test.tsx` asserts the mechanism: which nodes exist, which classes
gate them, that the drawer opens as a labelled dialog and closes on backdrop,
Escape and navigate, and that the drawer and sidebar list identical destinations.
jsdom evaluates no media queries and has no viewport, so it **cannot** prove that
768px renders cards rather than the table, that nothing overflows at a real
width, or anything about touch targets, momentum scrolling or the software
keyboard. That is recorded in the test file itself rather than implied. Only a
real iPad — or a browser harness this repository does not have — settles it.

## Limitations

- Hosted parity is unknown. Migrations `20260801000100` and later, including this
  branch's four, may or may not exist in the hosted project. Until an owner runs
  the parity runbook, the panels that depend on them may legitimately report
  `dashboard_contract_missing` — which is now a truthful answer rather than a
  leaked error string, but it is still a missing capability.
- There is no governed void path for an inventory item today. pgTAP 51 documents
  that gap where it would otherwise have asserted the behaviour, rather than
  testing a function that does not exist.
- The blind-count boundary is fixed for `start_cycle_count`. Other governed
  functions were not swept for the same one-transport-only pattern; that is worth
  a dedicated audit.
- `media_count` still counts every lifecycle. That is deliberate — its consumers
  were not audited — but it means two similarly-named columns now exist and a
  future reader could pick the wrong one. `active_media_count` and `needs_photos`
  are the authoritative ones.
- The readiness drill-down pages at fifty. That is a page size, not a cap, and
  the exact total is always shown — but there is no jump-to-page control, so
  reaching page 12 of a large backlog is eleven clicks.
- A cycle count replay whose root location has been retired between attempts
  raises rather than replaying. It creates nothing, so no count is duplicated,
  but the operator must re-enter a valid location.
- The intermittent `15_acquisition_digest_parity.sql` in-suite slowdown is
  unexplained and unfixed.

## Rollback

**Before the migrations have been applied to any hosted database** — which is
the current state — rollback is entirely a repository action: revert every
commit after `ac0441c` on this branch, or close the PR. Nothing outside the
repository has changed, so nothing outside the repository needs undoing.

**After a hosted application**, rollback is *not* a repository action and the
repository cannot describe it precisely, because it depends on what the data
looks like at that moment. It requires either:

- a **separately reviewed compensating migration**, written against the actual
  post-application schema and reviewed on its own merits; or
- a **restore from a verified backup**, taken before the application.

Specifically forbidden, because each silently corrupts the record of what the
database actually is:

- **Do not re-apply historical migration files** to "put back" a replaced view
  or function. A migration is a statement about a transition from one specific
  prior state, not a reversible patch; replaying one against a database that has
  moved on can restore a definition whose dependencies no longer match, and it
  appends a second ledger row claiming the migration ran again.
- **Do not delete rows from `schema_migrations_log`.** That ledger is the only
  evidence of what was applied. Editing it to make a rollback look clean
  destroys the one artefact the parity runbook depends on, and the next parity
  check will report a state that never existed.
- **Do not hand-edit schema to match an older migration file.** The result is a
  database that matches no migration in the repository.

An earlier draft of this section advised re-applying prior migration files. That
was wrong and is corrected here.

For reference when writing a compensating migration, this branch's schema
changes are: four replaced views/functions (`inventory_item_overview`,
`inventory_lot_overview`, `inventory_record_overview`,
`get_media_readiness_summary`, `get_listing_prep_summary`, `start_cycle_count`),
three new views/functions (`inventory_media_readiness_current`,
`listing_prep_candidates`, `list_listing_prep_candidates`,
`list_current_media_readiness`, `get_operations_media_backlog`,
`create_cycle_count_session`, `app.cycle_count_create_replay`), two added columns
(`cycle_count_sessions.idempotency_key`, `.idempotency_fingerprint`) with one
partial unique index, and one revocation (`create_cycle_count`, revoked rather
than dropped — restoring its grants restores the previous behaviour without
recreating the function).

## Owner acceptance checklist (hosted, after migrations are separately authorized)

Do not run this until the four migrations have been applied to the hosted
project under a separate authorization, with a verified backup, and the parity
runbook re-run afterwards.

1. `GET /api/version` returns the merged SHA. Railway is serving this code.
2. Dashboard loads with no raw PostgREST text anywhere on screen. If a panel is
   unavailable it says a required database update has not been applied.
3. Disconnect nothing and check no panel shows `0` where it previously errored.
   A failed dependency must say so, never report zero.
4. "No photo yet" — note the number, click it, count the rows. They match, and
   the total is not silently capped at twenty.
5. "Missing required angles" — opens the Photo Issues readiness tab filtered to
   that status, not the no-photo queue.
5b. If that backlog exceeds 50, page forward and confirm the last page is
   reachable and the total matches the tile. Edit the URL's `status=` to
   nonsense and confirm the page still loads, says the filter was not
   recognised, and reports no backlog as empty on the strength of it.
6. Confirm a recently voided or fully depleted record does **not** appear in the
   photo backlog, and that its detail page still opens.
7. "Ready to list" — every row shown has no blockers. "Regressed from ready" —
   every row shown is status ready **and** has at least one blocker.
8. "No active preparation" — opens that tab; *Prepare for listing* on one row
   moves it into the queue and the two counts move by one in opposite
   directions. Confirm a record that was listed and whose listing has ended
   appears here, since repeat preparation is supported.
9. Reload the dashboard several times; the twenty work candidates are the same
   twenty in the same order.
10. Cycle Counts in a workspace with no sessions offers *Start cycle count*.
    Category and Business vertical are dropdowns showing labels, never raw enum
    values. Create one; the scope review shows no expected totals. Start it;
    still no expected totals. Press create twice quickly — exactly one draft
    exists.
10b. Begin a create, interrupt the network so the result is unknown, then go
    Back, change the root location, and create again. A second count is created
    for the new location and the first is untouched — not a conflict, and not a
    silent hand-back of the original.
11. Sign in as a viewer: creating a cycle count is refused.
12. On an iPad in portrait: no horizontal page scroll anywhere; Current Inventory
    shows cards, not a clipped table; selection checkboxes are reachable and bulk
    move works; the hamburger opens the drawer, and choosing a destination both
    navigates and closes it in one tap.
13. In the same drawer, tap "Tools & legacy". It expands and the drawer stays
    open; the legacy destinations inside it are reachable and choosing one
    closes the drawer.

## Proposed `CURRENT_STATE.md` replacement text

Not applied. `AGENTS.md` reserves that file for the state steward and this work
order did not grant an exception. Proposed replacements, section by section:

**Replace "Deployment and verification" with:**

> - Repository: `harmonicforce/russellvault2`
> - Canonical and GitHub default branch: `main`
> - Railway source branch: `main`
> - Live app: `https://russellvault2-production.up.railway.app`
> - Supabase project: `ykdyqnvmwpxhowbwhzqz`
> - Last reviewed merge: *(pending — the production integrity repair PR)*
> - Repository migration count: **60**
> - Exact PR-head CI run: *(pending — record the run id and result)*
> - Required jobs green: build-and-verify, shadow-db-postgres-shim,
>   shadow-db-supabase-stack, dev-advisory-report
> - Railway deployment status on the reviewed merge: *(pending)*
> - Hosted acceptance: **not run.** The owner checklist is in
>   `LAST_IMPLEMENTATION_HANDOFF.md`.
>
> The repository documents do not independently prove the live Supabase migration
> ledger, and a green CI run proves nothing about the hosted app. Each
> migration-bearing release must verify live parity before acceptance, using
> `docs/runbooks/hosted-migration-parity.md`.

**Replace the "Listing and sales operations" bullet list with:**

> - Listing Prep is implemented and merged (PR #28): blockers, readiness, a
>   no-active-preparation candidate list, bulk operations and Workbench
>   integration. Repeat preparation is supported, so that population includes
>   records whose earlier preparation was listed or cancelled; it is deliberately
>   not called "never started". It has had no hosted acceptance.
> - marketplace publishing remains out of scope unless explicitly authorized;
> - sales, fulfillment, returns, and governed inventory exit are incomplete.

**Replace the "Dashboard and acceptance infrastructure" bullet list with:**

> - The operations dashboard is implemented and merged (PR #35), and its counts,
>   destinations and failure behaviour were repaired in the production integrity
>   pass: every tile opens exactly the records it counted, a dependency failure
>   reports a stable code rather than a raw PostgREST string and never renders as
>   zero, and the work queue is deterministic under ties.
> - saved views, aging and cross-workflow activity remain incomplete;
> - broad Playwright coverage and release normalization remain future work. There
>   is no browser harness, so responsive and touch behaviour is asserted only as
>   class-gating in jsdom and remains unproven on a real device.
> - `15_acquisition_digest_parity.sql` has shown an intermittent local in-suite
>   slowdown while passing standalone and in CI. It recurred during the repair
>   pass — one run exceeded a 600s per-file timeout, the same file completed in
>   6.7s standalone, and a second full run passed.

**Add a new subsection under "Current known incomplete or weak areas":**

> ### Governance gaps found during the repair pass
>
> - there is no governed void path for an inventory item;
> - `start_cycle_count` leaked expected counts to the browser transport because
>   the boundary was enforced only in the Express route; it is now enforced in
>   the database. Other governed functions have not been swept for the same
>   one-transport-only pattern.
> - cycle count creation accepted an idempotency key bound to nothing, so
>   reusing it with a different scope returned the original session. The key is
>   now bound to a fingerprint of the normalized creation payload. Other keyed
>   operations were not re-audited for the same unbound-key pattern.

**Amend the Media bullet list to add:**

> - `media_count` counts every media lifecycle and is retained for its existing
>   consumers; `active_media_count` and `needs_photos` are the authoritative
>   current-photo facts.
> - the readiness drill-down pages at fifty with the exact total always shown;
>   there is no jump-to-page control.

## PR cleanup assessment

Each head was diffed against `ac0441c`.

- **#32, #33, #34** are all earlier iterations of the same dashboard work,
  sitting on pre-#35 bases. Their only content not already on `main` is an older
  form of one pgTAP assertion — `like(...)` / `matches(...)` where `main` already
  carries the portable `ok(boolean, text)` form, with a comment explaining that
  the two test harnesses ship incompatible overloads. **There is no unique fix in
  any of them and nothing to recover.**

Recommendation was to close all three as superseded by #35. The owner
subsequently gave explicit instruction to do so, and all three are now closed
with a comment recording the reason. Each was already conflicting with `main`,
which corroborates the assessment independently.

## Standing owner actions carried forward

- Prune stale branches. Session credentials cannot delete refs (HTTP 403).
- Enable branch protection on `main` and auto-delete-on-merge.
- Decide the fate of `claude/p1-intake-kernel-quick-add-vvyn44`.
- Run `docs/runbooks/hosted-migration-parity.md` and record the result. This is
  the blocking prerequisite for everything in the acceptance checklist above.

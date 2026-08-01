# Last Implementation Handoff

## Surrender state

- Canonical branch: `main`
- Base SHA this work started from: `0ec684244e6667df47f786aee52b40b49559db6d`
- Implementation branch: `claude/listing-prep-command-center`
- Pull request: **draft, not merged**
- Repository migration count: 55 (was 51; four `20260801000500`–`000800` migrations added)
- Live Supabase: **unchanged.** No migration was applied to the live project.
- Railway: **unchanged.** No deployment, restart, or configuration change.
- `docs/ai/CURRENT_STATE.md`: **not edited.**
- Working tree at handoff: clean, branch pushed

This work order authorized branch work and a draft PR only. Merge, live
migration, and deployment were not performed and remain owner decisions.

## What this slice added

Inventory could be received, identified, stored and photographed, but nothing
connected that to selling it. Listing Prep is the operational layer between
intake and creating a listing elsewhere: the owner opens an Item or Lot, sees
exactly what is stopping it being listed, does that work, and moves it into a
Ready to List queue.

**Explicit non-goals, honoured:** no marketplace publishing, and **no inventory
mutation**. Recording that something was listed moves, reserves and decrements
nothing — asserted directly in `46_listing_prep_lifecycle.sql`.

Database (`20260801000500`–`000800`, all additive):

- `listing_prep` — the preparation record, keyed to a serialized **Item** or a
  quantity-managed **Lot**, with a partial unique index permitting exactly one
  live preparation per inventory record;
- `listing_prep_requirements` — the bounded per-category matrix;
- `listing_prep_checks` — the confirmations a person actually made;
- `listing_prep_events` — append-only through the shared guard;
- `listing_package_presets` — named shipping defaults, retired not deleted;
- `listing_prep_readiness` — readiness as a **view**;
- governed functions for start, content, checks, assignment, priority, the
  single lifecycle gate, recording a listing, readiness, the queue, the
  detail read, presets, bulk work, and the Workbench summary.

Application:

- `/api/listing-prep` (member reads, operator preparation, owner-only review),
  each route calling a governed function on the caller's own token;
- `listingPrepApi.ts`, the Listing Prep queue with three tabs and
  URL-persisted filters, the detail workspace, `ListingPrepEntry` on Item and
  Lot detail, and a Workbench card.

## The design decisions worth knowing

**Readiness is a view, not a column.** A stored readiness flag goes stale the
moment somebody voids the item, deletes a photograph or opens a correction —
and each of those happens in a feature with no reason to know Listing Prep
exists. Computing it live means a record cannot advertise itself as listable
after the fact that made it listable stopped being true.

**Readiness is earned, not inferred.** `listing_prep_checks` exists precisely
so that a filled-in field is not a confirmation. Absence of an answer is
`unknown`, and `unknown` blocks. Test 47 asserts that writing a condition
summary does not satisfy "condition assessed".

**The grain rule.** A serialized parent lot gets no preparation of its own; its
items are the sellable units. Enforced in `start_listing_prep`, so two records
can never compete for the same physical goods.

**Owner-only final review.** Operators prepare, edit, confirm, assign and
request review. Only an owner may declare `ready_to_list`, record a listing, or
reopen a listed record. Viewers are read-only throughout.

**Bulk work is a loop over the same single-record functions.** That costs a
little speed and buys the guarantee that a batch cannot do what one record at a
time could not — the owner gate and the per-record readiness check still run.
Per-record failures are reported; the batch does not abort on row 7 of 50.

**Photo requirements are delegated,** not restated. Listing Prep consumes
`get_inventory_media_readiness`, so the two can never disagree about what a
category needs.

## Defects found and fixed during this work

Three, all caught by tests written for this slice:

1. **The asking-price blocker was category-gated.** It fired only where the
   matrix carried a required `price` requirement, and only `graded_card` does.
   A raw card, a pair of shoes or a sealed box could have been declared ready
   to list with no price at all. A price is not category policy — nothing can
   be listed without one — so that blocker is now unconditional.
2. **Readiness read subject state from `inventory_record_overview`,** which
   deliberately hides voided, lost and superseded records because they are
   history rather than stock. That is exactly the case Listing Prep must name:
   a lost item was reported as "this record could not be read" instead of
   "this item is lost". Category and lifecycle now come from the inventory
   tables directly, and the queue and detail read keep a retired record's
   public id so the owner can still open it and see why.
3. **A render loop.** `ListingPrepDetail` and `ListingPrep` depended on the
   whole `workspace` object in their load effects; any render producing a fresh
   object put them into an infinite loop. Both now depend on `workspace?.id`.

## Migration ledger and the Phase 6+ tripwire

`06_provenance_structure.sql` carried a tripwire asserting that no
listing/sale/marketplace/COGS/cost-basis/purchase table existed yet. This slice
is the authorized crossing, and only for the layer **before** a listing exists.
The tripwire now names the five Listing Prep tables and the readiness view
individually, so it still fires on an actual marketplace `listings` table, a
sale, a cost basis, or a purchase table.

## Verification evidence

Run locally with verified exit codes on the final SHA:

- client lint, typecheck, build: exit 0; **364** client tests pass (was 318)
- server typecheck, build: exit 0; **393** server tests pass (was 368)
- plain-PostgreSQL shim pgTAP: **49 files, 1528 assertions, exit 0**
- production audits (root, server, client gate): exit 0
- `scripts/db/guard.test.mjs`, `scripts/ci/client-audit-gate.test.mjs`: pass
- `git diff --check`: exit 0

New test files: `45_listing_prep_structure.sql` (30),
`46_listing_prep_lifecycle.sql` (39), `47_listing_prep_readiness.sql` (30),
`48_listing_prep_concurrency.sql` (10), plus `listingPrep.test.ts` (25 routes),
`listingPrepApi.test.ts` (15), `ListingPrep.test.tsx` (14),
`ListingPrepDetail.test.tsx` (17).

### One test was wrong, and CI is what caught it

The first push was **red on `shadow-db-postgres-shim`** — and the same commit
passed on the Supabase tier and failed on the shim, which is the signature of a
test encoding one scheduling outcome rather than an invariant.

Assertion 4 of `48_listing_prep_concurrency.sql` demanded that exactly one of
two racing transitions reach the history. Two outcomes are correct: the loser
reads `not_started` before the winner commits and the state machine refuses
`not_started → needs_review` (one transition recorded), or the winner has
already committed and released the lock so `blocked → needs_review` is legal
(two recorded). It now asserts what was actually meant — no two transitions
applied from the same starting status, and the single unconsumed head of the
event chain is the status the record holds.

Verified on both schedules: five live race runs on fresh databases, all green,
every one landing the two-transition schedule; the one-transition schedule was
reconstructed deterministically and both assertions hold there too. No product
code changed.

## Not verified, and why

- **Supabase-stack pgTAP was not run locally.** The Docker daemon is not
  running in this environment at all (`Cannot connect to the Docker daemon`),
  so the authoritative `shadow-db-supabase-stack` job is confirmed by CI on the
  PR head, not locally. It passed there on run 30699699952, which is the only
  evidence for that tier and is worth re-checking on the final head.
- **No hosted acceptance.** Nothing was deployed, so no owner workflow was
  exercised against Railway.
- **No browser workflow coverage.** This repository still has no Playwright
  harness or dependency; none was added, and none is claimed. The work order
  made that scenario conditional on one existing.

## Deviations from the approved plan, stated

- The plan listed nine readiness values. Two more exist — `needs_quantity` and
  `needs_content` — because the matrix genuinely produces those blockers and
  folding them into a neighbouring status would have mislabelled the work.
- The plan's Workbench bucket "listed without an external reference" is not
  built: recording a listing **requires** that reference, so the bucket could
  only ever be empty. `never_started` is surfaced instead.
- The plan kept a cached readiness snapshot on the row to make the queue fast.
  That column was removed before anything depended on it, in favour of the view
  described above.

## Deployment prerequisite for whoever releases this

`/api/listing-prep` is gated on the same server-side flags as `/api/media`,
`/api/intake`, `/api/provenance` and `/api/acquisition` (`SHADOW_IMPORT`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`). If those are set for the shipped surfaces
they are set for Listing Prep; if they are ever unset, the UI will render and
every operation will 404.

The four Listing Prep migrations must be applied to the live project before the
hosted workflow can work. Check live migration parity first — note the four
media migrations from PR #27 are a prerequisite, since readiness consumes
`get_inventory_media_readiness`.

## Open product work

- Acquisition Receiving and Landed Cost
- inventory cost-basis read models
- Sales, Fulfillment, Returns, and Inventory Exit
- Operational Dashboard and Inventory Intelligence
- broader browser acceptance and release normalization

## Known technical follow-ups

- bundle listings (one preparation covering several records) are deliberately
  out of scope and would need the grain rule revisited;
- a reclassified record keeps its old confirmations; they are not consulted
  while the subtype differs, but they return if it is reclassified back;
- the queue joins the readiness view per page; if preparation counts grow into
  the tens of thousands this is the first thing to measure;
- carried forward from the media slice: purge has no scheduled cleanup job, and
  reconciliation reports truncation rather than paginating;
- carried forward: intermittent local in-suite slowdown in
  `15_acquisition_digest_parity.sql`;
- verify generated database types remain aligned now that schema has changed;
- preserve exact-head CI and live-migration verification for every release.

## Standing owner actions carried forward

- prune the nine stale branches identified earlier (session credentials can
  push but cannot delete refs — HTTP 403);
- enable branch protection and auto-delete-on-merge;
- decide on `claude/p1-intake-kernel-quick-add-vvyn44`.

## Next-agent instruction

Read `AGENTS.md` and the files listed in `CLAUDE.md`. The Listing Prep PR is a
draft against `main` and has not been merged; do not assume its schema exists
anywhere but the branch. If the owner authorizes release, confirm the exact
green PR head, check live Supabase migration parity before applying the four
migrations, then verify `/api/version` and the hosted preparation workflow.

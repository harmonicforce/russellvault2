# Cycle Count Application Layer — phase plan and status

Implementation-agent working document for the Cycle Count Application Layer work
order. Updated at each phase boundary.

This file is **not** `CURRENT_STATE.md` and does not replace it. `CURRENT_STATE.md`
remains the reviewer's independent ledger and is never edited by the
implementation agent. This file records phase decomposition and progress so the
work can be picked up in a new session without re-deriving it.

Work order origin commit: `e30b0b7`.

---

## Phases

| Phase | Scope | Depends on | Exit gate | Status |
|---|---|---|---|---|
| A | Authorization and disclosure integrity | — | Zero client-reachable write grants and zero blind-quantity column grants anywhere in `public`; both asserted structurally and behaviourally in pgTAP | **Complete** |
| B | Governed read interfaces and the client application layer (§§1–24) | A | Routes usable; client and pgTAP suites green; CI green | **Complete** |
| C | Browser-test infrastructure | B | A trivial spec signs in and reaches an authenticated route in CI | Open |
| D | The five §25 browser workflows | C | All five green in CI | Open |
| E | Accessibility and mobile audit (§21) with automated assertions | B | Automated a11y checks green on the counting and review routes at phone and iPad widths | Open |
| F | Hosted verification (§§26–27) | C, D | Runbook executed, or its single credentialed step reported as externally blocked | Open |

Phases C/D and E are independent of each other and may run in either order.
Phase F's repository deliverables (runbook, seed procedure, readiness checklist)
do not depend on credentials and are completed in-repo; only the final sign-in
and exercise step is externally blocked.

---

## Phase A — authorization and disclosure integrity

**Complete.** Three defects, all found by inspecting real grants rather than by
reading code.

### A1. Blind-count expected quantity readable from the snapshot tables

`authenticated` held table-wide `SELECT` on `cycle_count_expected_lots`
(carries `expected_quantity`) and `cycle_count_lot_observations` (copies
`expected_quantity` and `variance`), so a counter running a blind count could
read the numbers blind mode exists to withhold by querying the table directly.

Fixed in `20260730000100`: table grants replaced with explicit column lists
omitting those columns; quantities served only through `cycle_count_lot_queue`,
which omits them from the payload entirely while the session is blind and being
counted, and reports `saved` rather than `short`/`over` because the word alone
discloses the sign of the variance.

### A2. The recount round of a blind count was not blind

A blind count reaches review, discrepancies are written carrying
`expected_quantity` and `observed_quantity`, and a reviewer requests a recount —
which returns the **session** to `in_progress` while `blind_count` stays true.
The person now counting could read the expected quantity out of the discrepancy
row for the very lot they were being asked to recount.

That is the round where blindness matters most: a recount exists to obtain an
*independent* second observation, and an observation made while looking at the
number it is meant to confirm is not independent.

Fixed in `20260730000300`:

- `cycle_count_discrepancies.expected_quantity` / `.observed_quantity` and
  `cycle_count_resolutions.expected_value` / `.observed_value` left the client
  grant; every other column stays readable so the queue can still be grouped;
- `cycle_count_review` withholds the discrepancy quantities, the derived
  variance, and the per-observation lot figures for exactly as long as
  `app.cycle_count_quantities_withheld` says so, and reports
  `quantities_withheld` in its payload;
- the client shows an explicit notice rather than blank figures, and stops
  claiming the rounds agree — with the figures withheld every lot observation
  reads as `saved`, so comparing them would report agreement that has not been
  established.

Accepted cost: while a blind count is mid-recount the review screen shows the
disagreement without the figures. They reappear on resubmission. Withholding a
number from the reviewer for the length of a recount is the price of the recount
being worth anything.

### A3. Default-privilege drift on read models

A hosted Supabase project ships with
`alter default privileges in schema public grant all on tables to authenticated`,
so every table **and view** created afterwards starts with the full privilege
set. A migration that revokes only from `public, anon` leaves the rest behind.
The plain-PostgreSQL shim has no such default privileges, so identical SQL
produced a locked-down view locally and a loose one on the live project.

Eight views were affected. All are non-auto-updatable and none has an
`INSTEAD OF` trigger, so PostgreSQL refuses DML against them whatever the grant
says — the exposure was latent, not active, and no write was ever possible
through them. Corrected anyway, because a boundary that holds only through an
unrelated property of the object is not a boundary, and the next read model
written as a simple single-table view would be auto-updatable.

- `20260730000200`: `cycle_count_session_overview`,
  `cycle_count_post_snapshot_activity`
- `20260730000300`: `inventory_correction_overview`, `inventory_item_overview`,
  `inventory_lot_lineage_view`, `inventory_lot_overview`,
  `inventory_record_overview`, `inventory_work_queue`

**Deliberately not changed:** twelve Phase 2 intake-schema base tables
(`workspaces`, `workspace_members`, `sessions`, `items`, `photos`,
`photo_requirements`, `intake_groups`, `field_registry`, `field_rules`,
`reference_lists`, `reference_options`, `inventory_media`) hold
INSERT/UPDATE/DELETE for `authenticated` **and** carry matching per-command RLS
policies. Those grants are that schema's designed direct-write path, authorized
by policy rather than by function. They are not drift.

### Phase A regression cover

`supabase/tests/34_cycle_count_application_layer.sql` asserts, structurally:
no blind-quantity column is granted to `authenticated` on any of the four
tables that carry those numbers; no read model in the schema grants
`authenticated` anything but `SELECT`; the identity and status columns stay
readable. And behaviourally: a blind count discloses at review, withholds again
across a requested recount — payload, derived variance, per-round outcome word,
and direct table read all checked — and discloses once more on resubmission,
with both rounds preserved.

---

## Phase C — browser-test infrastructure (open)

The repository has no browser-test infrastructure at all: no Playwright
dependency, no config, no spec files, no CI job. Phase C builds it.

Planned deliverables:

1. `@playwright/test` dev dependency, pinned; reuse the preinstalled Chromium at
   `/opt/pw-browsers` rather than downloading (`PLAYWRIGHT_BROWSERS_PATH`,
   `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
2. `playwright.config.ts` with a single Chromium project, phone and iPad
   viewports, and a webServer that builds and serves the client.
3. An authenticated storage-state fixture that signs in once per run.
4. An isolated-workspace seed and teardown that creates its own workspace,
   locations and inventory through the governed functions, and never touches an
   existing workspace.
5. A CI job running the suite, reported independently of the existing four.

Exit gate: one trivial spec signs in and reaches an authenticated route in CI.

## Phase D — the five §25 workflows (open)

Visible count, blind count, resolution failure, recount, cancellation. Written
against the Phase C harness. Exit gate: all five green in CI.

## Phase E — accessibility and mobile (open)

§21 is currently satisfied by construction and by component tests, not by an
audit. Phase E adds automated assertions for focus order, labelling, live-region
behaviour, non-colour status encoding, touch-target size, and layout at phone
and iPad widths on the counting and review routes.

## Phase F — hosted verification (open)

Repository deliverables, all completable without credentials: an executable
runbook covering the sixteen §27 checks, the isolated-workspace seed procedure,
a deployment-readiness checklist, and the live-migration gate.

Externally blocked: the final sign-in and exercise step. This environment has no
`SUPABASE_*`, `VITE_*` or Railway variables — only `.env.example`. Live
migrations can be applied through the Supabase MCP, which holds its own
authorization, but signing into the deployed application as an operator cannot
be done from here.

---

## Live Supabase state

Repository and live must be compared before any phase that applies migrations.

- Live was brought from 38 to 43 migrations during the Phase B session, matching
  the repository at that time.
- `20260730000300` (Phase A) is **authored and not applied**. Repository is at
  44; live is at 43.
- Migrations are applied only at a phase gate, never speculatively.

## Deployment branch

Unresolved and needs an owner decision. `CLAUDE.md` names
`claude/ui-better-spreadsheet-cjhwjb` as the deployment branch until Railway is
confirmed switched; `CURRENT_STATE.md` names `main` as canonical. Both are
ancestors of the working branch with no unique commits. Phase F cannot verify a
deployment without knowing which branch Railway watches.

## Known test issue

`supabase/tests/15_acquisition_digest_parity.sql` intermittently exceeds the
600 s runner timeout when run in-suite locally, so
`node scripts/db/test.mjs` exits non-zero. It passes standalone (`rc=0`) and in
both CI database jobs. Pre-existing and unrelated to cycle count; local database
evidence is therefore gathered by a per-file sweep, and the non-zero full-suite
exit is reported as a failure rather than explained away.

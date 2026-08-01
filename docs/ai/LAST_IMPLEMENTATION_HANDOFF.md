# Last Implementation Handoff

## Surrender state

- Canonical branch: `main`
- Base SHA this work started from: `2ef44b710ebffad8215375e9a39fdaa5a2b77722`
- Implementation branch: `claude/media-photography-hardening`
- Final branch SHA: `b68f2d54d10f602b20551bd9a37f66b0feaf6472`
- Pull request: **#27, "Media and Photography Hardening" — DRAFT, not merged**
- Repository migration count: 51 (was 47; four `20260801*` media migrations added)
- Live Supabase: **unchanged.** No migration was applied to the live project.
- Railway: **unchanged.** No deployment, restart, or configuration change.
- Working tree at handoff: clean, branch pushed

This work order authorized branch work and a draft PR only. Merge, live
migration, and deployment were not performed and remain owner decisions.

## What this slice added

The media foundation stored photographs correctly but could not describe what
happens to them: the interrupted upload, the retry after a lost response, the
photo deleted by accident, the object orphaned when a row insert failed.

Database (`20260801000100`–`000400`, all additive):

- photograph lifecycle (`reserved` → `active` → `deleted`), retry key, content
  hash, non-destructive `rotation_degrees`, soft-delete and purge columns;
- governed functions for reserve/commit/abandon, reorder, primary selection,
  rotation, soft delete, restore, purge, listing, readiness and reconciliation;
- append-only `inventory_media_events`;
- `inventory_media_requirements` — the category photo matrix;
- `inventory_media_issues` — the orphan/mismatch queue;
- `inventory_media_readiness` view and a bounded Workbench summary.

Application:

- `/api/media` routes (member reads, operator mutations, owner-only purge)
  calling those functions on the caller's own token;
- an upload manager with bounded concurrency, per-file progress, per-file
  retry, cancellation, validation and duplicate reporting;
- gallery, mobile capture sheet, photo checklist, recently-deleted/restore, and
  the Photo Issues page.

## Defects this fixed

- primary switching was two unguarded browser `UPDATE`s, leaving a real window
  with zero primary and split-brain on failure;
- `sort_order` came from a read-then-write and could duplicate positions;
- no idempotency key, so a retry after a lost response created a second photo;
- deletion removed the row first and **ignored the storage error**, orphaning
  objects with no way to recover the photograph;
- a lock-order deadlock found by the new concurrency suite (target row locked
  before the subject's set) — now one deterministic lock order.

The ungoverned `MediaPanel` / `uploadMedia` / `deleteMedia` / `setPrimaryMedia`
path was removed rather than left as a second way into governed data.

## Verification evidence

Run locally with verified exit codes on the final SHA:

- client lint, typecheck, build: exit 0; **318** client tests pass
- server typecheck, build: exit 0; **368** server tests pass
- plain-PostgreSQL shim pgTAP: **45 files, exit 0** (41 pre-existing + 4 new)
- production audits (root, client gate, server): exit 0
- `scripts/db/guard.test.mjs`, `scripts/ci/client-audit-gate.test.mjs`: pass

New test files: `41_media_structure.sql` (24), `42_media_workflow.sql` (35),
`43_media_readiness_and_issues.sql` (15), `44_media_concurrency.sql` (8),
plus `media.test.ts` (13 routes), `uploadManager.test.ts` (10),
`MediaGallery.test.tsx` (11).

## Not verified, and why

- **Supabase-stack pgTAP was not run locally.** Docker runs in this
  environment but the container registry is blocked through its proxy
  (503/403 on image pull), so the authoritative `shadow-db-supabase-stack`
  job is confirmed by CI on the PR head, not locally.
- **No hosted acceptance.** Nothing was deployed, so no owner workflow was
  exercised against Railway.
- **No browser workflow coverage.** This repository has no Playwright harness;
  none was added, and none is claimed.
- `15_acquisition_digest_parity.sql` again showed the documented intermittent
  local in-suite slowdown (one run had to be cleared and restarted). It passes
  in the completed suite run and is unrelated to this work.

## Deployment prerequisite for whoever releases this

`/api/media` is gated on the same server-side flags as the existing
`/api/intake`, `/api/provenance` and `/api/acquisition` surfaces
(`SHADOW_IMPORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`). If those are set for
the shipped surfaces they are set for media; if they are ever unset, the photo
UI will render and every operation will 404. `locationsApi.ts` documents this
exact failure happening once before.

The four media migrations must be applied to the live project before the hosted
photo workflow can work. Check live migration parity first.

## Open product work

- Acquisition Receiving and Landed Cost
- inventory cost-basis read models
- Listing Prep Command Center
- Sales, Fulfillment, Returns, and Inventory Exit
- Operational Dashboard and Inventory Intelligence
- broader browser acceptance and release normalization

## Known technical follow-ups

- purge is exposed as a governed owner-only operation but has no scheduled
  cleanup job; expired photos stay until someone purges them;
- reconciliation walks at most 500 subject folders and 1000 files per folder,
  and reports truncation rather than paginating;
- readiness treats a record with no photographs as `missing_required_angle`
  even where the category defines no required angle, which is deliberate but
  worth revisiting if a category should be exempt;
- intermittent local in-suite slowdown in `15_acquisition_digest_parity.sql`;
- verify generated database types remain aligned now that schema has changed;
- preserve exact-head CI and live-migration verification for every release.

## Next-agent instruction

Read `AGENTS.md` and the files listed in `CLAUDE.md`. PR #27 is a draft against
`main` and has not been merged; do not assume its schema exists anywhere but
the branch. If the owner authorizes release, confirm the exact green PR head,
check live Supabase migration parity before applying the four media
migrations, then verify `/api/version` and the hosted photo workflow.

# Russell Vault Current State

Last context-document update: 2026-07-28

This is a maintained operational ledger, not a complete project history. Update it after each substantial shipped work order.

## Deployment

- Repository: `harmonicforce/russellvault2`
- Current canonical deployment branch: `claude/ui-better-spreadsheet-cjhwjb`
- Live app: `https://russellvault2-production.up.railway.app`
- Supabase project: `ykdyqnvmwpxhowbwhzqz`
- Last product commit reviewed: see the operations-slice entry below
- Live Supabase schema: 35 migrations applied

The context-document commits are not evidence that product behavior changed.

## Confirmed implemented foundation

- Supabase authentication and workspace selection
- first-run workspace/location setup
- workspace-scoped locations
- multi-category Intake Hub
- graded card, raw card, sealed TCG, footwear, apparel, electronics, and other-collectible intake forms
- governed preview and idempotent commit flow
- single-item draft recovery
- Batch Intake with independent row outcomes and draft recovery
- Product → SKU → Lot → Item identity hierarchy
- serialized and lot-managed inventory
- Current Inventory combining individual Items and quantity Lots
- private inventory media and signed display URLs
- item and lot detail routes
- browser-printable inventory labels
- scan/find workflow
- item movement and whole-lot movement with immutable history
- Daily Workbench foundation
- plain PostgreSQL and local Supabase database test jobs
- governed inventory subtype (graded card, raw card, sealed TCG, footwear,
  apparel, electronics, other collectible, unclassified), persisted at commit
  and frozen thereafter
- server-backed pagination, sorting, and filtering over the whole workspace,
  with the entire query held in the URL
- expanded search across set, card number, style code, colorway, size, brand,
  model, certificate, serial and location, with exact identifier matching
  ranked separately
- real bulk movement with per-record results and retry of failures alone
- governed lot quantity adjustments, recount, split, and merge, with
  append-only quantity history and lot lineage
- governed correction requests, review, and supersession: a committed record is
  retired in favour of a re-entered one, never edited, and duplicates are voided
  and linked to the survivor rather than deleted

## Recently corrected

- database CI and storage shim compatibility
- unified Current Inventory instead of serialized-card-only inventory
- single-item draft persistence and reconciliation
- safer batch session recovery
- prevention of copying unique identifiers into “Add another like this”
- graded-card quantity removal
- server-side unique-unit identifier reinforcement
- Workbench Needs Location filter alignment

## Known incomplete or weak areas

These are not automatically in scope for every task.

### Inventory browsing

- work-status filters remain undefined (no work-status concept exists yet)
- "needs source review" and "ready for listing prep" filters await the
  acquisition and listing-prep features they depend on

### Corrections and quantity control

- cycle counts are NOT implemented
- resolving an approved correction is a two-step operator flow (re-enter the
  record, then retire the wrong one); there is no guided "correct this" wizard

### Media

- photo reorder and rotation are not confirmed
- atomic primary-media switching should be verified
- deletion recovery and orphan cleanup should be reinforced
- per-file upload retry/progress may be incomplete

### Acquisition, cost, and listing

- owner-facing acquisition-to-inventory receiving is incomplete
- landed-cost allocation is incomplete
- inventory cost-basis read models are incomplete
- Listing Prep is incomplete
- marketplace publishing remains out of scope unless explicitly requested

### Repository operations

- production still uses a temporary Claude-named branch
- GitHub default/base branch normalization remains open
- the historical mega-PR is not a useful review unit
- release tags and concise release notes should be introduced
- hosted Playwright coverage should be added or verified

## Shipped: operations slice (2026-07-28)

Commits on `claude/ui-better-spreadsheet-cjhwjb`, on top of `16ac93a`.

Migrations added and applied to the live project:

- `20260728000800_inventory_subtype`
- `20260728000900_inventory_read_model_operations`
- `20260728001000_lot_quantity_governance`
- `20260728001100_read_model_lot_state`
- `20260728001200_inventory_corrections`
- `20260728001300_read_model_record_state`

New governed functions: `adjust_lot_quantity`, `recount_lot_quantity`,
`split_inventory_lot`, `merge_inventory_lots`, `lot_merge_compatibility`.
`move_inventory_lot` now refuses empty and absorbed lots.

New read model: `inventory_record_overview`, a SECURITY INVOKER union of both
grains so one query can page and sort them together. Serialized parent lots and
absorbed lots are excluded so no physical stock is counted twice; both remain
readable through `inventory_lot_overview` for their detail pages.

Verified: 281 client tests, client typecheck, client build, lint (3 pre-existing
fast-refresh warnings), and the full pgTAP suite against a reset plain-PostgreSQL
shim. Live Supabase confirmed at 35 migrations with all four inventory read
models SECURITY INVOKER.

NOT verified: hosted acceptance. Egress to the Railway host is blocked from the
build environment (403 at CONNECT), so `/api/version` could not be read and no
hosted path was exercised.

## Next-work guidance

Before creating a work order, choose one coherent vertical slice from the incomplete areas rather than combining every open domain.

Good examples:

- inventory scale: pagination, sorting, exact subtype, search, and filters
- inventory control: corrections, quantity adjustments, split, merge, and cycle count
- media hardening: reorder, rotation, atomic primary, safe deletion, and hosted tests
- commercial loop: acquisition, receiving, cost allocation, and cost basis
- listing preparation: listing drafts and Workbench queues without marketplace publishing
- repository normalization and release process

## Update protocol

At the end of a substantial work order:

1. replace the reviewed product SHA;
2. record CI and Railway state;
3. move completed capabilities into Confirmed implemented;
4. remove or rewrite resolved limitations;
5. add newly discovered limitations briefly;
6. keep this document compact enough to read at the start of every coding session.
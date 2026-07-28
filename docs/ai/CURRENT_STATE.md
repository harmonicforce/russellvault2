# Russell Vault Current State

Last context-document update: 2026-07-28

This is a maintained operational ledger, not a complete project history. Update it after each substantial shipped work order.

## Deployment

- Repository: `harmonicforce/russellvault2`
- Current canonical deployment branch: `claude/ui-better-spreadsheet-cjhwjb`
- Live app: `https://russellvault2-production.up.railway.app`
- Supabase project: `ykdyqnvmwpxhowbwhzqz`
- Last product commit reviewed before these context documents: `16ac93a23acad9a27072ab31c0fe445433355dcf`
- CI at that commit: green
- Railway deployment at that commit: successful

The context-document commits follow that product commit and should not be treated as evidence that product behavior changed.

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

- true pagination is not yet confirmed; current inventory may still cap results
- server-backed sorting remains limited
- condition, work-status, date-range, and several Workbench filters remain incomplete
- exact Apparel/Electronics/Other subtype preservation may be incomplete
- search coverage for style code, model, brand, and other non-card facts should be verified

### Bulk operations

- selected-row Move previously opened only the first record; real bulk movement must be verified or implemented
- partial quantity movement requires an explicit split-lot workflow

### Corrections and quantity control

- governed correction/supersession workflow is not yet confirmed
- duplicate voiding without hard deletion is not yet confirmed
- quantity adjustments, recounts, shrinkage, lot splitting, and lot merging are not yet confirmed
- cycle counts are not yet confirmed

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
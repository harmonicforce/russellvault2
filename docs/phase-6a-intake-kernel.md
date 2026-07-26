# Phase 6A — Intake Kernel and Quick Add (backend portion)

**Status: draft / unmerged. Backend intake kernel implemented. Operator Quick
Add UI NOT implemented — the design (wireflow) gate is unresolved. Phase 6A is
NOT fully accepted. UB-01 owner timing gate is pending.**

## Authority (read this first)

- **Legacy SQLite remains the authoritative deployed inventory system.**
- **The new Supabase intake kernel and every Product / SKU / Lot / Item write it
  performs are shadow-only and NON-authoritative.**
- **No deployment, dual-write, cutover, or authority transfer is authorized** by
  this work. Nothing here writes, enables, or weakens any legacy SQLite path.

This document records the dependency manifest, the schema and state-machine
decisions, the idempotency/concurrency contract, the commit transaction
boundaries, the hybrid serialization behavior, the candidate-evidence behavior,
the next-action vocabulary, and the wireflow-gate finding for the Phase 6A
intake kernel.

## Scope actually delivered

Server-authoritative **intake state machine** and one **transactional commit
kernel** that later Phase 6 surfaces (Quick Add, Batch, Guided, scanner
recovery) reuse, plus its schema, RLS, governed field-rule system, candidate
acquisition evidence, next-action contract, authenticated workspace-scoped
APIs, backend/client contract types, and tests. **No operator Quick Add screen
is built** (see the wireflow gate below). Nothing writes legacy SQLite; nothing
creates a second committed inventory truth.

## Wireflow / Figma gate — BLOCKED

A repository and artifact search for an approved low-fidelity Quick Add and
minimal Item Detail handoff (Figma file/key or reviewed static exports; approved
frame/node IDs; Kyle approval; desktop and iPad frames; happy/empty/validation/
blocked/interrupted-resume/repeated-submit states; scanner and keyboard behavior;
primary action + max action count; field/validation/blocker matrix) found **no
such handoff**. The only incidental hits were a code comment in
`client/src/pages/InventoryIdentity.tsx` and the Railway runbook.

Per the task's gate rule, because the approved handoff is absent this PR
implements the schema, RLS, state machine, field rules, commit kernel, APIs, and
backend/client contract types, and does **not** implement or fake the operator
Quick Add screen. Final Quick Add UI acceptance and the UB-01 owner timing gate
(one practice run; 10 known slabs; median ≤ 60s; P90 ≤ 90s; no duplicate
inventory; no invented factual defaults) remain **pending the owner-approved
wireflow and Kyle's availability**.

## Canonical base

- Canonical branch `claude/ui-better-spreadsheet-cjhwjb`, verified head =
  Phase 5 merge commit `69b7eebabc2e84448560cadf2dde043096e22009`.
- Phase 5 accepted head `9dbcfc8851a7417b69ead4e98b23d4a99918af44` and merge
  `69b7eebabc2e84448560cadf2dde043096e22009` are both ancestors of the base.
- Phase 5 Product → Sellable SKU → Inventory Lot → optional Inventory Item →
  Storage Location implementation confirmed present.

## Dependency manifest

Established, unchanged, and depended upon by this kernel:

| Concern | Establishing files |
|---|---|
| Workspace auth + membership authorization | `supabase/migrations/20260719000100_workspace_foundation.sql` (`workspaces`, `workspace_members`, `app.member_role`); `server/src/provenance/auth.ts` |
| RLS + workspace isolation | every `*_rls.sql`; the `UNIQUE (id, workspace_id)` + composite-FK convention |
| Immutable source/import provenance | `20260719000600_provenance_schema.sql` … `20260719001000_provenance_import_workflow.sql`; `app.forbid_update_delete`, `app.forbid_column_change`, `app.require_uid`, `app.log_audit_event`, `audit_events`, `data_quality_issues` |
| Acquisition lines + candidate source evidence | `20260720000100_acquisition_schema.sql` (`acquisition_line_items`, `source_crosswalks`) |
| audit_events / data_quality_issues | `20260719000600_provenance_schema.sql` |
| Product Catalog | `20260721000100_inventory_identity_schema.sql` (`product_catalog`, subtype tables) |
| Sellable SKU + deterministic fingerprint | same schema + `20260721000400_inventory_identity_functions.sql` (`app.sku_fingerprint`, `register_sellable_sku`) |
| Inventory Lot | `inventory_lots` + `stage_inventory_lot` |
| Serialized Inventory Item | `inventory_items` + `mint_serialized_item` |
| Opaque unit scan-SKU minting | `app.gen_scan_sku` + `mint_serialized_item` |
| Serialized-lot capacity enforcement | `mint_serialized_item` (row lock + count check) |
| Storage Location masters | `storage_locations` + `register_storage_location` |
| Exact Product/SKU/Lot/Item lookup | `server/src/routes/inventoryIdentity.ts` |
| Phase 5 registrar + mint functions | `register_product`, `register_sellable_sku`, `register_storage_location`, `stage_inventory_lot`, `mint_serialized_item`, `app.mint_governed_public_id` |

All required dependencies are present and match the accepted Phase 5
architecture, so the kernel was built (the "stop if a dependency is absent or
materially different" condition did not trigger).

### Corrected intake premise

There is no proven pre-existing Supabase intake architecture. This PR does not
claim, preserve, backfill, or fabricate two intake sessions, fourteen intake
groups, four intake items, a pre-existing committed-items table, or any old
intake IDs. Phase 2 shipped a now-vestigial shadow foundation that already owns
the bare names `sessions`, `intake_groups`, `items`, `field_registry`,
`field_rules`, `reference_lists`, and `reference_options`; those tables are
mutable, non-append-only, and are **not** wired to the Phase 5 identity core.
To keep the boundary unmistakable and avoid a second committed truth, every
control-plane table here is a distinct object under an `intake_` prefix and the
kernel never reads or writes the Phase 2 tables.

## Control-plane schema

New migrations (all under `supabase/migrations/20260722*`):

1. `..0100_intake_kernel_schema.sql` — `intake_sessions`, `intake_draft_groups`
   (distinct from Phase 2 `intake_groups`), `intake_entries`,
   `intake_field_registry`, `intake_field_rules`, `intake_reference_lists`,
   `intake_reference_options`, `intake_candidate_links`,
   `intake_commit_attempts` (immutable commit receipt / idempotency),
   `intake_transition_events` (immutable audit). Enums `intake_group_state`,
   `intake_session_state`, `intake_source_state`, `intake_category`,
   `intake_next_action`.
2. `..0200_intake_kernel_append_only.sql` — receipts and audit log are fully
   append-only; governed config is seed-once immutable; draft records are
   editable only while their group is a draft; committed/abandoned groups (and
   their entries/candidate links) are frozen.
3. `..0300_intake_kernel_rls.sql` — SELECT-only grants + member policies; config
   readable by any authenticated caller (gated on a resolved `auth.uid()`, never
   an always-true policy); all writes via SECURITY DEFINER functions.
4. `..0400_intake_kernel_seed.sql` — governed field registry, deterministic
   field rules, reference lists/options.
5. `..0500_intake_kernel_functions.sql` — the state machine + commit kernel.

## State machine

Governed transitions: `draft → ready_to_commit → committed`; `draft →
abandoned`; plus a `ready_to_commit → draft` reopen and `ready_to_commit →
abandoned`. Every other edge fails closed via `app.intake_assert_transition`.
Only draft/ready groups may be edited; editing a ready group reopens it to draft
and bumps `version`. Committed and abandoned groups are frozen (trigger-level),
so a committed group's identity, quantity, serialization policy, serialized
children, source evidence, location, and resulting Product/SKU/Lot/Item
relationships can never silently change; corrections require a later governed
path. Abandonment preserves the full frozen draft plus an audit event naming the
actor, prior/resulting state, and structured reason. Every transition records
actor, timestamp, workspace, prior state, resulting state, and a structured
reason in `intake_transition_events`.

`public.audit_events` (Phase 3) is deliberately **not** reused: its `event_type`
CHECK and its import/source/crosswalk foreign keys are scoped to the provenance
domain. Widening that governed table to carry intake events would blur two
separately-governed audit surfaces, so the intake plane keeps its own immutable
transition log with the same actor/workspace conventions.

## Field registry and rule model

`intake_field_registry` is workspace-independent governed config. Each
identity-driving field carries `maps_to = schema.table.column` naming the exact
Phase 5 typed target — never an EAV identity bag; ungoverned attribute keys are
refused at write. `is_factual` marks facts that must never be defaulted (source,
cost, condition, grade, grading company, certificate, defects, marketplace
status). `intake_field_rules` binds a field to a category with applicability,
requiredness, a commit-blocker flag, and an optional cross-field condition;
`rule_version` is stamped on every receipt. The server is the single authority
(`app.intake_validate_group`); the client may preview via
`evaluate_intake_field_rules` / `preview_intake_commit` but runs no competing
engine — the TypeScript layer does request-shape validation and display mapping
only.

## Idempotency and optimistic-concurrency contract

`commit_intake_group(workspace, group, idempotency_key, expected_version,
content_hash)`:

- The group row is `SELECT … FOR UPDATE`, serializing all commits on a group.
- `content_hash` is a deterministic digest of the exact committed snapshot,
  obtained from `preview_intake_commit`, binding the idempotency key to content.
- **Idempotent replay:** committed group + same key + matching content ⇒ the
  same immutable receipt (`idempotent_replay: true`), no new rows.
- **Structured conflicts (returned, not raised, so the audit is durable):**
  same key + changed content ⇒ `idempotency_content_changed`; committed under a
  different key ⇒ `already_committed`; client content ≠ server snapshot ⇒
  `content_hash_mismatch`; `expected_version` ≠ current ⇒ `stale_version`.
- **Blocked:** re-running authoritative rules inside the transaction finds
  blockers ⇒ `{ outcome: 'blocked', blockers }`, no write.
- Concurrent identical commits converge to one receipt and one lot; concurrent
  conflicting commits produce one winner and one explicit conflict, never
  duplicate inventory; concurrent commits of the same identity converge on one
  Sellable SKU (proven by genuine overlapping dblink sessions in
  `supabase/tests/26_intake_concurrency.sql`).

## Commit transaction boundaries

One transaction: authorize (operator/owner) → lock group → idempotency/version
checks → re-run rules → `register_product` → `register_sellable_sku` →
(optional) `register_storage_location` → mint one lot public id →
`stage_inventory_lot` (exactly one canonical lot) → for serialized groups,
`mint_serialized_item` per entry (Phase 5 opaque scan-SKU minting + capacity
enforcement) → freeze the group to `committed` with its resulting identity →
write the immutable receipt → record the commit. A genuine mid-write failure
(e.g. a duplicate certificate) raises and rolls the **entire** transaction back
— no partial Product/SKU/Lot/Item persists and the draft stays recoverable
(proven in `24_intake_commit_kernel.sql`).

## Hybrid serialization behavior

Serialized units are required for graded/certified items, footwear, and any
owner-tagged / unique-condition / item-media unit. A graded slab must be
quantity 1 with exactly one serialized item; footwear must be serialized;
eligible sealed quantity > 1 may remain one lot-managed lot **or** be explicitly
expanded into exactly N serialized children (no double counting); a raw card may
remain lot-managed with uncertain condition and no fabricated grade or defect.
Historical inventory is never mass-serialized.

## Candidate acquisition evidence — zero financial effect

`intake_candidate_links` references a canonical `acquisition_line_items` row as
CANDIDATE EVIDENCE only. It records workspace, intake entry (optional),
acquisition line, evidence, confidence, actor, timestamp, source state, and
review state. It has **no financial columns by construction** (proven
structurally in `21_intake_structure.sql`) and cannot allocate quantity or
cents, alter an acquisition balance, establish landed cost, confirm cost basis,
or affect profit; tests assert no acquisition cost component or allocation is
created by attaching evidence or committing. Those actions are Phase 7.

## Next-action vocabulary

Every successful commit returns exactly one of `CONDITION_DETAILS_NEEDED`,
`LOCATION_ASSIGNMENT_NEEDED`, `PHOTOS_NEEDED`, `SOURCE_REVIEW_NEEDED`,
`READY_FOR_FUTURE_LISTING_PREP`, `NO_IMMEDIATE_ACTION`, by deterministic
precedence. No Daily Workbench, listing-readiness engine, media workflow, or
movement workflow is built.

## APIs

`/api/intake/*` (mounted before the legacy write guard, 404 by default behind
the same shadow flag + Supabase URL/anon key as Phases 3-5; no service-role
key): create/resume/abandon session; create/update draft group; create/update
entry; evaluate field rules; validate readiness; governed transition;
attach/remove candidate evidence; preview outcomes; commit with an idempotency
key; retrieve receipt; retrieve next action. Reads allow any member; every
mutation requires owner/operator; every query and mutation fails closed.

## Feature-flag and rollback plan

The whole surface is dark by default: with `SHADOW_IMPORT` /
`SUPABASE_URL` / `SUPABASE_ANON_KEY` unset the routes 404 and nothing is
reachable. The migrations are additive and isolated to new `intake_*` objects
plus one `app` sequence; rollback is dropping the five `20260722*` migrations
(no existing object is altered; the two updated acceptance tests only widen the
migration-manifest and always-true-policy assertions). No deploy, no Railway, no
remote Supabase, no legacy SQLite write.

## Acceptance patch (backend hardening)

A bounded backend acceptance patch hardened the kernel without changing its
authority posture or the Phase 5 identity core:

1. **Persisted state machine.** Commit persists `draft → ready_to_commit` (stored
   state, not just an audit note) and then `ready_to_commit → committed` in one
   transaction; editing a group or entry actually reopens `ready → draft`. Tests
   assert stored state and audit state always agree.
2. **Session terminality.** An abandoned session refuses group/entry creation and
   editing, candidate attach/remove, readiness, preview, and commit; abandoning a
   session **auto-abandons its uncommitted groups** (truthful stored state) while
   committed groups stay readable and unchanged.
3. **Optimistic concurrency.** Every draft-content mutation (group update, entry
   create/update, candidate attach/remove, source-state change) requires
   `expected_version`, locks the group, and returns a structured `stale_version`
   conflict on a stale edit; each success bumps the version exactly once. A
   genuine concurrent-edit dblink proof shows one winner and one conflict.
4. **Candidate-evidence exactness.** The deterministically ordered candidate
   snapshot (acquisition line, entry, evidence, confidence, source_state,
   review_state) is in the content hash, the receipt, and the replay comparison.
   A composite FK proves a candidate's entry belongs to the same group.
   `source_state` is derived (candidate requires a link; removing the last link
   returns to unknown unless a governed stated source exists); a caller cannot
   claim candidate without evidence, and a bare "stated" is refused — a governed
   `source_kind` is required, so "stated" never bypasses `SOURCE_REVIEW_NEEDED`.
5. **Graded identity coherence.** The serialized entry may not disagree with the
   SKU identity (grading company / numeric grade / grade designation); the item's
   grading company is derived from the canonical SKU, so a CGC SKU can never mint
   a PSA item. Mismatches block before any canonical write.
6. **Complete serialization policy.** Graded ⇒ qty 1 + one child; footwear ⇒
   `serialized_child_count = quantity`; any serial-numbered or certified entry
   forces serialized tracking; owner-tagged / unique-condition / item-media /
   security-sensitive units serialize; sealed keeps the eligible lot-vs-expansion
   choice.
7. **Governed entry attributes + truthful rule contract.** Unregistered
   `entry_attrs` keys are rejected at write; the evaluator honors conditional
   applicability (cross-field), data types (text/integer/boolean/reference), and
   reference values — no stored rule property is silently ignored.
8. **Location resolution.** Intake resolves an existing active location by code,
   rejects retired/unknown codes (block / `LOCATION_ASSIGNMENT_NEEDED`), and never
   mints a location master during a commit.
9. **Durable failure audit.** A genuine mid-write failure rolls back all
   Product/SKU/Lot/Item writes in a controlled subtransaction while a durable
   `commit_failed` event (workspace, session, group, actor, idempotency key,
   sanitized failure class + sqlstate, timestamp) persists in the outer
   transaction. A duplicate-certificate test proves no partial rows persist, the
   draft is recoverable, and exactly one durable failure event is written.

## Verification

Ordinary PostgreSQL / shim tier: `npm run db:reset` + `npm run db:test` →
**908 pgTAP assertions pass** (`21_…`–`28_intake_*`). `npm run lint`,
`npm run typecheck`, `npm run build`, and `npm test` (server 342 + client 92 +
db guard 9) all pass; `npm audit --omit=dev --audit-level=high` finds 0
vulnerabilities for root, client, and server. The Docker-local Supabase stack
tier (`SHADOW_DB_RUNNER=supabase-cli`) could not be run in this environment
because no Docker daemon is available; the PR's CI runs it as the
`shadow-db-supabase-stack` job, and the concurrency proofs' dblink harness is
written to run in both tiers.

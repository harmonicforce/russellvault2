# Last Implementation Handoff

## S3.1.1 — Deterministic Reconciliation Adjudication Ordering

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s3-1-1-deterministic-adjudication-order`.
- Exact base SHA: `a8c951728c887ffdba330b98b6d6416cd0a839e7`.
- Release authority: branch and Create PR only. No merge, push, hosted migration, deployment, or production data action was authorized.
- Final SHA: recorded in the final response after commit.

### Defect reproduced and repaired

Before editing, test 68 failed on its first direct execution at former assertions 42–43. Both governed adjudications were inserted in one transaction, so PostgreSQL's transaction-stable `now()` gave them the same `adjudicated_at`; `reconciliation_cutover_eligibility` then ordered the tie by random UUID descending and selected the earlier deferred event instead of the later accepted event.

Forward-only migration `20260818000100_deterministic_reconciliation_adjudication_order.sql` leaves merged S3.1 untouched. It adds an authoritative positive per-finding `adjudication_ordinal`, a partial unique index preventing duplicate positions, and an explicit `ordering_ambiguity` representation. The governed adjudication function locks the canonical finding row, preserves normalized idempotent replay, refuses to extend ambiguous legacy chronology, assigns `max(ordinal)+1`, and returns the ordinal. Cutover eligibility reads only the ordinal for current review; timestamps remain immutable evidence and UUIDs are never adjudication chronology.

### Existing history and concurrency

Existing histories with distinct per-finding timestamps are backfilled in timestamp order. If any timestamp ties within a finding, every event in that finding is marked `legacy_timestamp_tie`; cutover treats the review as open/blocking and new adjudication fails closed rather than inventing an order. Genuine asynchronous dblink sessions prove the second concurrent writer waits on the finding lock and the two committed events receive unique serial ordinals 1 and 2.

### Validation

- Defect reproduction: pre-repair test 68 failed assertions 42–43 on direct run 1, exactly because the deferred event won the timestamp tie by UUID.
- Direct repaired test 68: **10 consecutive runs**, each **76/76 assertions** after a fresh reset; no retry wrapper or CI retry was introduced.
- `PGOPTIONS='-c jit=off' npm run db:reset`: passed.
- `PGOPTIONS='-c jit=off' npm run db:test`: **68 files, 2668 assertions**, all passed; test 68 passed **76 assertions**.
- `npm run typecheck`: passed.
- `npm test`: server **861**, client **1601**, Node guards **23** (**2485 total**), all passed.
- `npm run build:ci`: passed with the existing Vite chunk-size warning.
- `git diff --check`: passed.
- One initial full database suite run correctly failed because the migration-ledger contract still expected 77 migrations; the contract was updated to 78 and the complete suite was rerun green.

### Delivery and operational status

- PR: not created in this environment; the work order reserves creation for the owner's Codex Create PR button and forbids push/`gh pr create`.
- Exact-head hosted CI: not checked; branch was not pushed.
- Live Supabase migration count/parity: not checked; hosted migration was not authorized.
- Railway and `/api/version`: not checked; deployment was not authorized.
- Hosted acceptance: not applicable to this database-only repair and not authorized.
- Production data touched: none.
- `docs/ai/CURRENT_STATE.md`: untouched.
- Rollback before deployment: revert the repair commit. After a separately authorized live migration, correction must use another forward-only migration.
- Exact next owner decision: use Create PR for this committed branch, obtain green exact-head CI, then decide whether to merge; do not apply the migration live without separate release authority.


## S2.5 — Cost Allocation Owner Surface (Batches 1 and 2, COMPLETE)

S2.5 turns the governed acquisition cost machinery into the complete
owner-usable allocation workflow: **see every cost → preview a split → propose
it → confirm it as the basis → reverse it → withdraw and correct it → see the
derived basis it produced.**

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-5-cost-allocation-ui`.
- Base SHA: `2a858591c12b0b2a1a13bd186eadfd2baaaafbe3` (current `main`).
- Status: **implemented and validated locally.** Not merged, not deployed, not
  hosted-accepted.

### Integration with S2.4 / S2.4.1

Batch 1 was rebased from `33d182e` onto current `main`. One conflict, in
`docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`, which `main` had rewritten; resolved
by keeping both records. No code conflict. Batch 1 behaviour was preserved and
re-verified on the new base before any Batch 2 work began (828 server + 1552
client tests passing at that point).

### Scope discipline

**Zero Supabase edits, zero migrations, zero pgTAP changes, zero function
changes**, across both batches. Verified by `git diff 2a85859 -- supabase/`
returning empty. `docs/ai/CURRENT_STATE.md` untouched.

`public.reverse_cost_component` remains deliberately **unexposed**; a test
asserts no route reaches it and it is never called.

### Batch 2, item by item

**Withdrawal.** `/api/cost/components/:id/allocations/withdraw` calls
`withdraw_cost_allocation`. Owner and operator may withdraw; a viewer is refused
before any governed call. A reason is REQUIRED by this surface and by the
database. Withdrawn rows stay visible in their own history region, and nothing
anywhere describes withdrawal as deletion — asserted by a test that scans every
recovery phase for affirmative deletion language.

**Response-loss truth for withdrawal.** `withdraw_cost_allocation` has no
idempotency key, and — the reason this needed its own coordinator rather than
reusing the proposal one — **withdrawing and confirming both empty the candidate
set**, so "the proposal is no longer pending" is the question, not the answer.
The intent therefore retains the EXACT allocation public identities that were
candidates at confirmation time, and the re-read distinguishes five outcomes:

| Re-read shows | Outcome | Locked? |
| --- | --- | --- |
| those exact rows now `withdrawn` | withdrawal committed | yes |
| those exact rows `confirmed`, or component `allocated` | a confirmation won | yes |
| those exact rows still `candidate`, set unchanged | proven absent | **no** — a new attempt is allowed |
| the set moved some other way | not safely attributable | yes |
| the re-read failed | still unknown | yes |

Nothing says "nothing was sent". The confirmation-won case points at reversal,
which is the correct governed operation for a confirmed allocation.

**The conservation guard is KEPT.** Withdrawal now provides recovery, but a
non-conserving proposal still cannot be confirmed and undoing it costs a
governed act with a permanent audit record. Every claim that a proposal "can
never be withdrawn" has been corrected in code comments, UI copy and tests.

**Cost-basis recomputation.** Confirm, reverse and withdraw each invoke
`recompute_inventory_cost_basis` afterwards, as a SEPARATE operation.
`refreshBasis` never throws. Its outcome travels beside the allocation result as
`basisRecompute: refreshed | unchanged | failed`, and a failure is reported as
*"The allocation change is recorded; the derived basis was not refreshed"* —
never as an allocation failure. Retry is stated as safe because S2.4
short-circuits on an unchanged content hash and holds an advisory lock. There is
deliberately **no recompute after a proposal-only candidate write**, per the work
order.

**Basis impact.** The component workspace reads
`inventory_cost_basis_current` and `unresolved_inventory_cost_basis` for its
scope lines, with explicit column lists (the view is `select b.*`, so `*` would
have leaked seven internal identifiers). Truth rules: exact minor-unit money for
established basis; **no figure at all** where unresolved; `null` never becomes
zero; currencies rendered separately with **no combined total**; FIFO labelled
and described as an accounting convention that does not assert physical
movement. A third state — **not derived** — is distinct from both resolved and
unresolved and never renders as zeroes. Component-scoped only; **no S2.6 global
queue was built.**

### Defects found and fixed in Batch 2

1. **Batch 1's typecheck claim was wrong.** `client/tsconfig.json` has
   `"files": []` and only project references, so the `npx tsc --noEmit` used in
   Batch 1 typechecked **zero files**. The repo's real `npm run typecheck`
   (`tsc -b`) surfaced **four** genuine type errors in Batch 1 code:
   `size="large"` on a `Dialog` that has no such size; an unsound
   `as Exclude<…>` cast handing `DependencyState` a state it cannot describe;
   `EmptyState body=` (the prop is `description`); and a non-existent `subject`
   prop on `DependencyState`. All four are fixed, and verification now runs the
   repo's own scripts rather than a bare compiler invocation.
2. **Two raw control bytes shipped in Batch 1 source** — a `NUL` in
   `server/src/routes/cost.ts` and a `NUL`/`SOH` pair in
   `client/src/pages/cost/proposalCreation.ts`, used as string separators. Inert
   at runtime, but they made the files binary to `grep`, `diff` and review
   tools. Replaced with printable separators and documented. A repo-wide sweep
   confirms no control bytes remain in any source file.

### Validation, on this branch

All commands exited 0.

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors; warnings only, all `only-export-components`, matching existing presentation adapters |
| `npm run typecheck` | clean (`tsc -b`, all three client projects + server) |
| `npm test` | server **861**, client **1601**, guards **23** — all passed |
| `npm run build:ci` | client bundle + server typecheck, clean |
| `node --test scripts/db/guard.test.mjs scripts/ci/client-audit-gate.test.mjs` | 23 passed |
| `PGOPTIONS='-c jit=off' npm run db:test` | all files passed, **2592 assertions** |
| Playwright, 5 chromium viewports, full suite | **818 passed**, 0 failed, 107 skipped |
| `git diff --check` | clean |

Batch 2 added 33 server tests (861 vs 828), 49 client tests (1601 vs 1552) and
19 browser tests (41 cost tests × 5 viewports).

### Explicitly NOT proved

- **WebKit is unverified.** The WebKit binary is absent in this sandbox
  (`Executable doesn't exist at /opt/pw-browsers/webkit-2215/pw_run.sh`).
  `webkit-ipad.spec.ts` iterates `CANONICAL_SURFACES`, which includes both cost
  surfaces, so **CI is the only place WebKit results can come from.**
- **CI has not run** at the time of writing; the PR was opened at the end of
  this batch.
- **Live Supabase migration count and parity: not checked.** No migration was
  written by this branch.
- **Railway deployment and `/api/version`: not checked.**
- **Hosted acceptance: not performed.**
- **No production data touched.**

### An interaction worth the owner's attention

The S2.4.1 blocker rule treats a component with a pending `candidate` allocation
as blocking its lines' basis. So PROPOSING moves a line to `unresolved`, but the
work order specifies no recompute after a proposal-only write — which is
correct, since a proposal is not a basis. The consequence is that the displayed
basis can lag a proposal until the next confirm/reverse/withdraw. This is
stated, not hidden: the basis panel always reports what the last derivation
concluded, with its algorithm version and timestamp.

### Visual baselines

Eight `cost-component` baselines were regenerated because the workspace gained
the derived-basis region. Every other baseline — including the `cost` queue —
matched byte-for-byte, so nothing unrelated is masked.

### Known flakiness

`40_cycle_count_concurrency.sql` and race H in
`66_acquisition_receiving_acceptance_hardening.sql` are load-sensitive. Both
passed. Neither was modified.

### Rollback

Revert the branch's commits or close the PR. No migration, no deployment, no
live data, no shared configuration was changed.

### Exact next owner decision

Whether to merge S2.5 once CI (including WebKit) is green. S2.6 was not started.

## S2.4.1 — Cost Basis Truth Hardening + Allocation Proposal Recovery

### Lineage and authority

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s2-4-1-cost-basis-truth-hardening`.
- Exact base SHA: `deca424928a698db3cb456c53ca0a6cc950d05ed`.
- Release authority: branch/PR only. No merge, push, hosted migration, deployment,
  production restart, or production data action was authorized.
- `docs/ai/CURRENT_STATE.md` is untouched.

### Implemented database changes

Two forward-only additive migrations leave the merged S2.4 migration untouched:

1. `20260815000100_cost_allocation_withdrawn_state.sql` adds the terminal
   `withdrawn` allocation state in its own transaction-safe migration.
2. `20260815000200_cost_basis_truth_hardening.sql`:
   - adds owner/operator-only `withdraw_cost_allocation(uuid,text)`, requires a
     nonblank reason, preserves candidate rows and reasoned audit history, permits
     later corrected proposals, and serializes confirm/withdraw on the same
     component row lock;
   - makes allocation transition enforcement treat `withdrawn` as terminal and
     records `cost_allocation_withdrawn` in the existing audit vocabulary;
   - makes the derived-table guard fail closed when its GUC is unset using
     `coalesce(current_setting(..., true), '')`;
   - replaces cost-basis algorithm `1.0.0` with `1.1.0`, expanding unresolved
     order/lot shared evidence to every active acquisition line in scope;
   - emits null-money `unresolved` rows, while retaining normalized known
     contributions, whenever applicable direct/shared evidence is unknown,
     unresolved, candidate, or otherwise unattributable;
   - sends negative net unit basis to the same explicit unresolved state rather
     than publishing a current negative inventory value;
   - removes trust in undeclared `source_detail.specific_unit_costs_minor` for
     multi-unit serialized lines. Multi-unit attribution is deterministic equal;
     quantity-one serialized item-price lines may retain source-specific method.

FIFO ordering, expected-quantity denominators, remainder distribution,
overreceipt handling, and currency separation are unchanged.

### Tests and evidence

- `67_governed_inventory_cost_basis.sql`: 41/41 assertions. Added regressions
  for unset GUC direct DML, candidate order-shared blocking with known subtotal,
  history-preserving reasoned withdrawal and replacement, arbitrary multi-unit
  source JSON, unknown direct evidence, lot-shared unresolved propagation,
  negative net basis, and overlapping confirm-versus-withdraw with exactly one
  winner.
- `06_provenance_structure.sql`: migration ledger updated for 76 migrations.
- Plain PostgreSQL reset passed.
- Full plain PostgreSQL pgTAP passed: 67 files, 2592 assertions.
- `npm run typecheck` passed.
- `npm test` passed: server 686, client 1431, Node guards 23 (2140 total).
- `npm run build:ci` passed with the existing Vite chunk-size warning.
- `git diff --check` passed.
- Initial typecheck/test/build attempts failed because client/server dependencies
  were absent. `npm ci --prefix client` and `npm ci --prefix server` restored the
  environment without tracked changes; the mandated commands then passed.
- An initial pgTAP run exposed and corrected the expected migration-ledger count;
  the final full run is green.

### Delivery status

- Final SHA: recorded in the final response after commit.
- PR: not created in this environment; the work order explicitly reserves PR
  creation for the owner's Codex Create PR button and forbids `gh` push/create.
- Exact-head hosted CI: not checked; branch was not pushed.
- Live Supabase migration count/parity: not checked; not authorized.
- Railway deployment and `/api/version`: not checked; not authorized.
- Hosted acceptance: not applicable (no client/server/UI change) and not authorized.
- Production data touched: none.
- Rollback before deployment: revert the feature commit. After any separately
  authorized migration deployment, use another forward migration.

### Exact next owner decision

Use Codex's Create PR button for the committed branch, obtain green exact-head CI,
and then decide whether to merge. Do not apply either migration live until that
separate release decision.

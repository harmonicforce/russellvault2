# Last Implementation Handoff

## S2.6 — Governed Unresolved Cost Queue (COMPLETE)

The final S2 application slice. An owner-usable triage queue answering: **what
cost truth still needs attention, why, and where do I go to resolve it.**

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-6-unresolved-cost-queue`.
- Base SHA: `3efe5b9422aa6016aa1ed36047f6a90ffa2c6a7d` (S2.5 merged as PR #70).
- Status: **implemented and validated locally.** Not merged, not deployed, not
  hosted-accepted.

### Scope discipline

**Zero Supabase edits, zero migrations, zero pgTAP changes, zero function
changes** — `git diff 3efe5b9 -- supabase/` is empty. No S3 or reconciliation
file touched (Codex owns S3.1). `docs/ai/CURRENT_STATE.md` untouched. No COGS,
sales, profit, marketplace, Railway or hosted-acceptance work.

The entire queue is derived from governed surfaces already granted to
`authenticated`: `acquisition_cost_components`, `acquisition_cost_allocations`,
`acquisition_lots`, `acquisition_lot_lines`, `acquisition_orders`,
`acquisition_line_overview`, `inventory_cost_basis_current`,
`unresolved_inventory_cost_basis` and `inventory_cost_basis_events`.

### The reason model — seven distinct, evidenced reasons

There is deliberately **no "needs attention" bucket**. Ordered by workflow
position, because that is the order an owner can act in.

| Reason | Evidence |
| --- | --- |
| `amount_not_known` | component `amount_state='unknown'`, not reversed |
| `shared_cost_unallocated` | lot/order-scoped, `attribution_state='unresolved'`, known amount, no candidates |
| `proposal_awaiting_review` | ≥1 allocation in `state='candidate'` |
| `basis_unresolved` | `inventory_cost_basis_current` rows with `state`/`basis_method` = `unresolved`, grouped per (line, currency) |
| `overage_without_cost` | `unresolved_inventory_cost_basis.overage_quantity > 0` |
| `negative_net_cost_evidence` | signed sum of direct + confirmed-allocated evidence per (line, currency) < 0 |
| `basis_never_derived` | no run row in `inventory_cost_basis_events` |

### The one state that could NOT be derived, reported rather than invented

The work order asked for "basis not yet derived **or not refreshed**, if that
state is actually evidenced". Those are two questions with two answers.

**Not yet derived IS evidenced** — `inventory_cost_basis_events` records one row
per run, so no run row means no recompute has happened. That is
`basis_never_derived`.

**Not refreshed is NOT evidenced.** Staleness means comparing the stored
`input_content_hash` against a hash of *current* inputs. That hash is a sha256
over a `jsonb_agg(...)::text` computed inside the function; reproducing it in
TypeScript would mean reproducing PostgreSQL's exact jsonb serialisation,
ordering and numeric formatting, and any divergence yields a confident, wrong
"stale" or "current" verdict. The algorithm version has the same problem — it is
a constant inside the function body, readable only by calling it, and a read
endpoint must not invoke a mutation to answer a question.

So the surface reports what the last derivation **was** (version, timestamp) and
carries `staleness: 'not_evidenced'` permanently. Asserted by test, at the
contract, route and screen.

**THE MISSING DATABASE FACT, stated precisely so it can be added deliberately:**
a governed read-only way to compare the current input hash with the stored one —
e.g. a `public.inventory_cost_basis_freshness` view exposing
`(workspace_id, algorithm_version, stored_hash, current_hash, is_current)`, or a
`stable` function returning the current hash. Either would make staleness
first-class and this contract would gain a `basis_stale` reason.

### The exclusions, enforced in code

`documented_free`; confirmed/attributable known cost; multiple currencies alone;
**expected units not yet received** (the governed view publishes these — a cost
queue full of parcels in transit is a queue nobody reads); reversed and
withdrawn rows; and absence of inventory where none should exist.

**Withdrawal is history, not a resolution.** After a withdrawal the candidates
are gone, so `proposal_awaiting_review` stops firing and
`shared_cost_unallocated` fires instead — the component still needs allocating
and the queue says so. Proved at contract, route, jsdom and browser levels.

### API contract

One read endpoint, `GET /api/cost/unresolved`, `requireMember`, caller-JWT/RLS
only, no service-role credential, no mutation on the path (asserted). Returns
`coverage`, `complete`, `role`, the `reasons` vocabulary, `derivation`, and
`rows`. Every read is bounded at 2000 and `complete:false` is reported when any
contributing read reaches its ceiling. No internal UUID is returned — basis
columns are listed explicitly because the governed view is `select b.*`.

### Empty / partial / failure semantics

`empty` — and therefore "no unresolved cost" — is reachable **only** from a
complete authoritative read. A capped read renders `partial` with "this is NOT a
statement that there are none"; a failed read renders `unavailable`. Each of the
five contributing reads is proved individually to fail rather than return an
empty queue. Filtering narrows a complete list: the unfiltered total stays on
screen, every option carries its count, and a filter matching nothing says so
instead of borrowing the empty state's words.

The queue is a **separate governed read** from the component list, so one
failing never blanks the other — proved in both directions.

### Role behaviour

Owner and operator read the queue and follow links into the existing S2.5
workflow. A viewer reads it and is offered no mutation — the panel contains no
mutation control at all, and no new mutation authority was invented. The queue
is triage and navigation; allocation editing is not duplicated.

### Validation, on this branch

| Command | Result |
| --- | --- |
| `npm ci` (root/client/server) | all pass |
| `npm run lint` | 0 errors; warnings only, matching existing presentation adapters |
| `npm run typecheck` | clean |
| `npm test` | server **919**, client **1623**, guards **23** |
| `npm run build:ci` | clean |
| `PGOPTIONS='-c jit=off' npm run db:test` | all files passed, **2592 assertions** |
| Playwright, 5 chromium viewports | **913 passed**, 0 failed, 107 skipped |
| `git diff --check` | clean |

S2.6 added 58 server tests (919 vs 861), 22 client tests (1623 vs 1601) and 20
browser tests (60 cost tests × 5 viewports). Ten `cost` visual baselines were
regenerated because `/cost` gained the queue region; every other baseline
matched byte-for-byte.

### Explicitly NOT proved

- **WebKit is unverified locally** — the binary is absent in this sandbox.
  `webkit-ipad.spec.ts` iterates `CANONICAL_SURFACES`, which includes `/cost`,
  so CI is the only place WebKit results come from.
- Live Supabase parity, Railway deployment and hosted acceptance: **not
  checked**. No production data touched.

### Rollback

Revert the branch's commit or close the PR. Nothing outside the branch changed.

### Exact next owner decision

Whether to merge S2.6 once CI is green, and whether to add the freshness fact
described above so a `basis_stale` reason can exist. S3 was not started.

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

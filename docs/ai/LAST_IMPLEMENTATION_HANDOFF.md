# Last Implementation Handoff

## S2.6 — Governed Unresolved Cost Queue (COMPLETE, including the final truth repair)

The final S2 application slice. An owner-usable triage queue answering: **what
cost truth still needs attention, why, and where do I go to resolve it.**

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-6-unresolved-cost-queue`.
- Base SHA: `3efe5b9422aa6016aa1ed36047f6a90ffa2c6a7d` (S2.5 merged as PR #70).
- Current `main` merged in twice to clear merge conflicts — at `a8c9517` (S3.1,
  PR #73) and again at `44b98eb` (S3.2, PR #74). Both times the only conflict was
  this file, because each slice adds a section at the top; every section is kept
  and Codex's text is verbatim. `git diff origin/main HEAD -- supabase/
  docs/ai/CURRENT_STATE.md` is empty after both merges.
- PR: **#72 (open, unmerged)**.
- Status: **implemented, truth-repaired and validated locally.** Not merged, not
  deployed, not hosted-accepted.

### The final truth repair

Three defects in the first implementation were found in review and fixed on the
same branch and PR. Each was a case of the surface stating something it could
not support.

**1. Missing basis was workspace-scoped, and produced a false clean queue.**
`basis_never_derived` asked one question — *has any recompute ever run in this
workspace* — which a workspace answers yes to forever after its first run. So
this sequence went unreported: a recompute runs; a line later gains reconciled,
linked inventory and applicable cost evidence; no recompute runs again; that
line holds no basis row; and the queue said nothing needed attention. An owner
would have been told their cost truth was complete while a whole line of it did
not exist.

The reason is now asked per **(line, currency)** — the grain the derivation
itself publishes at — and all three conditions must hold:

1. reconciled, inventory-linked units exist for the line
   (`acquisition_receipts.status='reconciled'` → `acquisition_receipt_lines` →
   `acquisition_receipt_line_inventory_links`, summing `quantity_linked`, which
   is exactly the function's `_icb_units`);
2. the line is basis-eligible in that currency — the union of `_icb_costs` and
   `_icb_blockers` the function joins its `currencies` set from, mirrored in
   `basisEligibleCurrenciesByLine`;
3. `inventory_cost_basis_current` holds **no** row for that pair.

Exclusions are enforced, not incidental: unreceived inventory, non-reconciled
receipts, received-but-unlinked quantity, and lines with no applicable cost
evidence in any currency are all silent. A pair that already HAS rows is left
alone however old they are — that is the staleness question, and staleness is
still not evidenced. And because this is the one reason asserting an ABSENCE, it
is **suppressed entirely when any contributing read hit its ceiling**: a
truncated read is indistinguishable from a workspace that never derived those
lines, so the response's own `complete: false` carries the truth instead.

**2. Last-derivation metadata was scavenged off basis rows.** It is now read
from the run-level event — `inventory_cost_basis_events` where
`inventory_cost_basis_id is null`, ordered by `created_at` then `recompute_id`
descending, limit 1. A recompute over a workspace with nothing derivable
publishes no basis rows, and scavenging then reported an OLDER run's version and
time, or nothing at all, while labelling it the last derivation. The run event
has no such gap. `basis_stale` was **not** added.

**3. Copy that promised things the application cannot do.** Fixed:

- the header no longer states the size of the reason vocabulary in prose — it
  derives it from the vocabulary the server sent, and a guard test scans all five
  S2.6 source files for a hand-written count;
- the overage reason no longer implies recording another cost component gives
  those units a basis. S2.4 leaves every unit beyond the expected source quantity
  unresolved by design, so the copy now says so explicitly and points at the
  receiving discrepancy, which is a surface that exists;
- no reason tells an owner to confirm or reverse an unrelated allocation to
  trigger a recompute. That would be asking them to falsify a governed review
  decision to move a number;
- `amount_not_known` no longer says "establish the amount". Component amounts
  arrive through import and nothing in this application edits one
  (`reverse_cost_component` remains deliberately unexposed), so it says that.

Where no direct repair surface exists, the next action says so. A bare row with
an honest "there is nowhere to do this yet" is better than a fabricated button.

### Scope discipline

**Zero Supabase edits, zero migrations, zero pgTAP changes, zero function
changes** — `git diff 3efe5b9 -- supabase/` is empty. No S3 or reconciliation
file touched (Codex owns S3.1). `docs/ai/CURRENT_STATE.md` untouched. No COGS,
sales, profit, marketplace, Railway or hosted-acceptance work.

The entire queue is derived from governed surfaces already granted to
`authenticated`: `acquisition_cost_components`, `acquisition_cost_allocations`,
`acquisition_lots`, `acquisition_lot_lines`, `acquisition_orders`,
`acquisition_line_overview`, `inventory_cost_basis_current`,
`unresolved_inventory_cost_basis`, `inventory_cost_basis_events`,
`acquisition_receipts`, `acquisition_receipt_lines` and
`acquisition_receipt_line_inventory_links`.

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
| `basis_never_derived` | line has reconciled linked units and is basis-eligible in this currency, and `inventory_cost_basis_current` holds no row for that (line, currency) |

### The one state that could NOT be derived, reported rather than invented

"Basis not yet derived" and "basis no longer refreshed" sound like one question.
They are two, and only one is evidenced.

**Not yet derived IS evidenced**, per line and currency. Whether
`inventory_cost_basis_current` holds a row for a basis-eligible pair is a fact,
not an inference. That is `basis_never_derived`.

**Not refreshed is NOT evidenced — and the missing half is specific.** The
*historical* side of the comparison already exists and is durable: every run
stores `input_content_hash` on both `inventory_cost_basis` and
`inventory_cost_basis_events`, so what the inputs hashed to **when the derivation
ran** is on record. What is missing is the other half — the hash of the inputs
**as they stand now**. That value exists only inside
`recompute_inventory_cost_basis`, computed mid-transaction as a sha256 over a
`jsonb_agg(...)::text` of the governed inputs, and it is never published.
Reproducing it in TypeScript would mean reproducing PostgreSQL's exact jsonb
serialisation, key ordering and numeric formatting, and any divergence yields a
confident, wrong verdict. Calling the function to find out is worse: a read
endpoint would be performing a governed mutation to answer a question.

So the surface reports what the last **run** was — algorithm version and
timestamp, both from the run-level event — and carries
`staleness: 'not_evidenced'` permanently. Asserted by test, at the contract,
route and screen.

**THE MISSING DATABASE FACT, stated precisely so it can be added deliberately:**
a governed, read-only publication of the **current** input content hash, so it
can be compared against the stored one — e.g. a `stable` security-definer
function returning the current hash for a workspace, or a
`public.inventory_cost_basis_freshness` view exposing
`(workspace_id, algorithm_version, stored_hash, current_hash, is_current)`. The
stored hash is already there; only the current-input side is absent. Once it
exists, staleness becomes first-class and this contract can carry a
`basis_stale` reason.

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
columns are listed explicitly because the governed view is `select b.*`, and the
three receiving reads select join keys and `quantity_linked` only.

The run-event read is deliberately **excluded** from the completeness check: it
is `limit(1)` by design, asking for the newest run, so its length proves nothing
about whether rows were dropped.

### Empty / partial / failure semantics

`empty` — and therefore "no unresolved cost" — is reachable **only** from a
complete authoritative read. A capped read renders `partial` with "this is NOT a
statement that there are none"; a failed read renders `unavailable`. Each of the
eight contributing reads is proved individually to fail rather than return an
empty queue, and each is proved to force `complete: false` at its ceiling. Filtering narrows a complete list: the unfiltered total stays on
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
| `npm test` | server **953**, client **1626**, guards **23** |
| `npm run build:ci` | clean |
| `PGOPTIONS='-c jit=off' npm run db:test` | all files passed, **2648 assertions** (68 files, including S3.1's, after merging main) |
| Playwright, 5 chromium viewports | **928 passed**, 0 failed, 107 skipped |
| `git diff --check` | clean |

Against `main`, S2.6 adds 92 server tests (953 vs 861), 25 client tests (1626 vs
1601) and 30 browser tests. The truth repair alone added 34 server, 3 client and
15 browser tests. Ten `cost` visual baselines were regenerated when `/cost`
gained the queue region and eight again when its header copy changed; every other
baseline matched byte-for-byte throughout.

Regressions the repair specifically pins:

- an old workspace recompute does not hide a newly basis-eligible line with no
  current basis row (contract, route and browser);
- unreceived, non-reconciled, unlinked and evidence-free lines are never queued;
- a recompute event that published zero basis rows still reports its real
  version and time, and does not fall back to an older run's;
- the reason count cannot drift back into prose — a guard scans all five S2.6
  source files, and the panel is rendered against two differently-sized
  vocabularies;
- overage copy states that more cost evidence will not give those units a basis;
- no next action names a repair surface this application lacks, and none tells an
  owner to touch an allocation to trigger a recompute;
- a failed contributing read stays `unavailable` while a capped read stays
  `partial`, asserted side by side so the two cannot collapse into each other or
  into the empty state.

### Explicitly NOT proved

- **WebKit is unverified locally** — the binary is absent in this sandbox.
  `webkit-ipad.spec.ts` iterates `CANONICAL_SURFACES`, which includes `/cost`,
  so CI is the only place WebKit results come from.
- Live Supabase parity, Railway deployment and hosted acceptance: **not
  checked**. No production data touched.
- **Basis freshness of an EXISTING row.** The queue proves a basis row is absent;
  it never claims an existing one is out of date. See the missing database fact
  above.

### Rollback

Revert the branch's commit or close the PR. Nothing outside the branch changed.

### Exact next owner decision

Whether to merge S2.6 once CI is green, and whether to add the freshness fact
described above so a `basis_stale` reason can exist. S3 was not started.

## S3.2 — Offline Reconciliation Runner + Synthetic Divergence Tests

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s3-2-reconciliation-runner`.
- Exact base SHA: `a8c951728c887ffdba330b98b6d6416cd0a839e7` (merged PR #73 / S3.1).
- Final SHA: recorded after the delivery commit.
- Authority: branch and Create PR only. No merge, hosted database, deployment,
  production data, historical import, SQLite mutation, or S3.3 work authorized.

### Implemented architecture and evidence contract

The reusable ESM runner under `scripts/reconciliation/` separates fixed JSON
artifact parsing/hashing, domain configuration validation, deterministic L1/L2
comparison, CLI serialization, and optional ledger persistence. Artifact input
is `{ "artifactVersion": 1, "rows": [...] }`; SHA-256 and byte length are
computed from the exact input bytes. Authoritative output contains no timestamp
or machine-local path and is canonically serialized with stable object-key and
finding order.

Domain configuration supplies the domain, comparison key, complete ordered
field list with per-field materiality, numeric aggregate fields, categorical
aggregate fields, and only explicitly selected string normalization. Duplicate
or missing keys, malformed rows/configuration, non-finite numeric evidence, and
unsafe integer aggregation fail closed.

L1 records row count, distinct key count, configured numeric sums, configured
group counts, and artifact metadata on both sides. It explicitly records that
aggregate agreement is not a reconciliation pass. L2 indexes both sides and
emits exactly one ordered finding for every key in their union. Differences
remain independent and ordered; source-only/target-only findings carry no
fabricated field differences.

The optional persistence adapter has no database client dependency. A caller
injects an RPC function; the adapter uses only S3.1's
`begin_reconciliation_run`, `record_reconciliation_finding`,
`complete_reconciliation_run`, and, after a begun-run persistence failure,
`fail_reconciliation_run`. Comparison remains entirely offline.

### Synthetic and integration proof

The focused Node suite has 15 passing tests covering all required synthetic
divergence, union, materiality, fail-closed, ordering, hash/output determinism,
zero/null, normalization, network independence, and governed adapter cases.
`supabase/tests/69_reconciliation_runner_integration.sql` supplies a synthetic
runner result to the S3.1 functions and asserts three findings for three union
keys, preserved differences/hashes, governed completion, and explicit L1
non-pass semantics. It passed all 8 assertions in both its focused position and
the full sequential database suite.

### Validation and operational status

- Root, client, and server `npm ci`: passed; npm reported existing dependency
  audit findings and a root Node-engine warning.
- `npm run test:reconciliation`: 15/15 passed.
- `npm run typecheck`: passed.
- `npm test`: server 861, client 1601, Node 39; all passed (2501 total).
- `npm run build:ci`: passed with the existing Vite chunk-size warning.
- `PGOPTIONS='-c jit=off' npm run db:reset`: passed after starting the local
  PostgreSQL cluster and creating the sandbox's missing local `root` role.
- `PGOPTIONS='-c jit=off' npm run db:test`: 69 files, 2656 assertions, all
  passed; the new integration test passed 8/8. Initial reset/test attempts
  failed because the local PostgreSQL cluster was stopped, then because the
  sandbox lacked its expected local role; both environment conditions were
  corrected before the final green runs.
- `git diff --check`: passed before the handoff update and will be rerun before
  commit.
- Draft PR/CI: not created or checked; the owner reserved creation for the
  Create PR button.
- Live Supabase parity, Railway, `/api/version`, and hosted acceptance: not
  checked/not authorized. Production and SQLite data touched: none.
- `docs/ai/CURRENT_STATE.md`: untouched.
- Rollback: revert the S3.2 commit; no schema or live state changed.
- Exact next owner decision: use Create PR for this committed branch, run the
  database suites and exact-head CI where PostgreSQL is available, and decide
  whether to merge S3.2. Do not begin S3.3.

## S3.1 — Reconciliation Ledger Final Integrity Repair

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Existing branch/PR: `codex/implement-reconciliation-ledger-schema`, draft PR #71.
- Integrated main SHA: `3efe5b9422aa6016aa1ed36047f6a90ffa2c6a7d` (PR #70 / S2.5 preserved via merge commit `54dfc80`).
- Release authority: branch and draft PR only. No merge, hosted migration, deployment, or production data action was authorized.
- Final SHA: recorded in the final response after commit.

### Integrity repairs

The still-unmerged `20260815000300_reconciliation_ledger.sql` migration was corrected in place. All three evidence tables now reject privileged `TRUNCATE` as well as their already-governed update/delete operations. Finding rows enforce verdict/difference consistency at the table contract: identical matches require an empty difference array, differing matches require at least one difference, and source-only/target-only retain legitimate empty arrays.

Begin-run and adjudication idempotency fingerprints now hash canonical JSON arrays containing the same trimmed/null-normalized values written to storage. Delimiter-containing fields cannot collide through concatenation, while semantically identical normalized retries replay. Cutover eligibility now always returns one explicit `eligible=false`, `reason=run_not_found` row for a missing requested run or domain. No client, server, SQLite, S3.2, historical-data, or deployment work was performed.

### Validation

- `PGOPTIONS='-c jit=off' npm run db:reset`: passed after starting the local PostgreSQL service.
- `PGOPTIONS='-c jit=off' npm run db:test`: 68 files, **2648 assertions**, all passed; test 68 passed **56 assertions**.
- `npm run typecheck`: passed.
- `npm test`: server **861**, client **1601**, Node guards **23** (**2485 total**), all passed.
- `npm run build:ci`: passed with the existing Vite chunk-size warning.
- `git diff --check`: recorded after the handoff update and before commit.
- The first reset attempt could not connect because local PostgreSQL was stopped. One later full-suite reset was disrupted by an orphaned prior test process touching the same shadow database; after terminating it, the clean final full suite passed.

### Delivery and operational status

- PR #71 exact-head CI: to be checked after push; exact run/job conclusions belong in the final report.
- Live Supabase migration count/parity: not checked; hosted migration was not authorized.
- Railway and `/api/version`: not checked; deployment was not authorized.
- Hosted acceptance: not applicable to this database-only repair and not authorized.
- Production data touched: none.
- `docs/ai/CURRENT_STATE.md`: untouched.
- Rollback: revert the repair commit and merge commit while PR #71 remains unmerged.
- Exact next owner decision: merge S3.1 only after required exact-head CI is green; do not begin S3.2 from this work order.


## S2.5 — Cost Allocation Owner Surface (Batches 1 and 2, COMPLETE)

S2.5 turns the governed acquisition cost machinery into the complete
owner-usable allocation workflow: **see every cost → preview a split → propose
it → confirm it as the basis → reverse it → withdraw and correct it → see the
derived basis it produced.**

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-5-cost-allocation-ui`.
- Base SHA: `2a858591c12b0b2a1a13bd186eadfd2baaaafbe3` (current `main`).
- PR: **#72 (draft, unmerged)**.
- Status: **implemented, truth-repaired and validated locally.** Not merged, not
  deployed, not hosted-accepted.

### The final truth repair

Three defects in the first implementation were found in review and fixed on the
same branch and PR. Each was a case of the surface stating something it could
not support.

**1. Missing basis was workspace-scoped, and produced a false clean queue.**
`basis_never_derived` asked one question — *has any recompute ever run in this
workspace* — which a workspace answers yes to forever after its first run. So
this sequence went unreported: a recompute runs; a line later gains reconciled,
linked inventory and applicable cost evidence; no recompute runs again; that
line holds no basis row; and the queue said nothing needed attention. An owner
would have been told their cost truth was complete while a whole line of it did
not exist.

The reason is now asked per **(line, currency)** — the grain the derivation
itself publishes at — and all three conditions must hold:

1. reconciled, inventory-linked units exist for the line
   (`acquisition_receipts.status='reconciled'` → `acquisition_receipt_lines` →
   `acquisition_receipt_line_inventory_links`, summing `quantity_linked`, which
   is exactly the function's `_icb_units`);
2. the line is basis-eligible in that currency — the union of `_icb_costs` and
   `_icb_blockers` the function joins its `currencies` set from, mirrored in
   `basisEligibleCurrenciesByLine`;
3. `inventory_cost_basis_current` holds **no** row for that pair.

Exclusions are enforced, not incidental: unreceived inventory, non-reconciled
receipts, received-but-unlinked quantity, and lines with no applicable cost
evidence in any currency are all silent. A pair that already HAS rows is left
alone however old they are — that is the staleness question, and staleness is
still not evidenced. And because this is the one reason asserting an ABSENCE, it
is **suppressed entirely when any contributing read hit its ceiling**: a
truncated read is indistinguishable from a workspace that never derived those
lines, so the response's own `complete: false` carries the truth instead.

**2. Last-derivation metadata was scavenged off basis rows.** It is now read
from the run-level event — `inventory_cost_basis_events` where
`inventory_cost_basis_id is null`, ordered by `created_at` then `recompute_id`
descending, limit 1. A recompute over a workspace with nothing derivable
publishes no basis rows, and scavenging then reported an OLDER run's version and
time, or nothing at all, while labelling it the last derivation. The run event
has no such gap. `basis_stale` was **not** added.

**3. Copy that promised things the application cannot do.** Fixed:

- the header no longer states the size of the reason vocabulary in prose — it
  derives it from the vocabulary the server sent, and a guard test scans all five
  S2.6 source files for a hand-written count;
- the overage reason no longer implies recording another cost component gives
  those units a basis. S2.4 leaves every unit beyond the expected source quantity
  unresolved by design, so the copy now says so explicitly and points at the
  receiving discrepancy, which is a surface that exists;
- no reason tells an owner to confirm or reverse an unrelated allocation to
  trigger a recompute. That would be asking them to falsify a governed review
  decision to move a number;
- `amount_not_known` no longer says "establish the amount". Component amounts
  arrive through import and nothing in this application edits one
  (`reverse_cost_component` remains deliberately unexposed), so it says that.

Where no direct repair surface exists, the next action says so. A bare row with
an honest "there is nowhere to do this yet" is better than a fabricated button.

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

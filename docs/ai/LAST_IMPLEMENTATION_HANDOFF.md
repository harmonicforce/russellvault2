# Last Implementation Handoff

## S2.5 Batch 1 — Cost Allocation Owner Surface (branch checkpoint, NOT complete)

S2.5 turns the already-governed acquisition cost machinery into an owner-usable
allocation workflow: **see every cost → preview a split → propose it → confirm
it as the basis → reverse it.** Batch 1 is a **checkpoint**, not the slice.

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-5-cost-allocation-ui`.
- Base SHA: `33d182eb787df76f0af3119af2d17402fc9975a7`.
- Final SHA: see the branch head; PR: **none opened** (the work order preferred
  no PR for this batch). Status: **implemented and validated locally; not
  merged, not deployed, not hosted-accepted.**

### Scope discipline

**Zero Supabase edits, zero migrations, zero pgTAP changes, zero function
changes.** Verified by `git diff 33d182e -- supabase/` returning empty. Codex
owns S2.4; the three files reserved to it and `docs/ai/CURRENT_STATE.md` were
not touched, verified the same way.

The whole surface is built over the EXISTING governed functions
`propose_cost_allocation`, `confirm_cost_allocation` and
`reverse_cost_allocation`, and over the existing `select` grant on
`acquisition_cost_components` / `acquisition_cost_allocations`. No new SQL was
needed and none was written.

`public.reverse_cost_component` exists and is deliberately **not exposed**.
There is no route that reaches it, and a test asserts it is never called.

### The governed dead end this batch had to design around

`propose_cost_allocation` writes durable `candidate` rows, has **no idempotency
key**, and returns **no `replayed` flag**. Nothing in the governed contract can
remove a candidate row: propose refuses while candidates exist, confirm refuses
unless they conserve the component amount, and reverse requires a CONFIRMED
allocation. A proposal that does not add up is therefore **permanent and
unusable** — it can never be confirmed, never be reversed, and never be
replaced.

Two consequences, both handled in the application rather than left to the owner:

1. **A pre-flight conservation guard.** The transport refuses a non-conserving
   proposal before the RPC. This is not a duplicated rule — the database
   performs no conservation check at propose time at all — it is a guard against
   writing an irreversible mistake through a door the contract leaves open. It
   quotes the database's own one-minor-unit tolerance so it can never refuse
   something confirm would have accepted.
2. **Verify-first recovery, with four outcomes.** A lost response is resolved by
   an authoritative re-read, never a retry:
   *committed* (pending candidates match line-for-line and amount-for-amount),
   *foreign* (a pending proposal exists that is NOT the one attempted — neither
   proof it landed nor proof it did not), *absent* (nothing pending, so a new
   attempt is permitted), *superseded* (the component became allocated or was
   reversed meanwhile), and *unverified* (the re-read itself failed, so it stays
   locked). Nothing anywhere says "nothing was sent".

### Money

Every amount is an integer number of minor units carried as a **canonical
decimal string** and computed on in `BigInt`, in both directions. No amount is a
JavaScript float at any point where it is authoritative. Splits use exact
largest-remainder distribution, so every minor unit is accounted for, including
for negative totals. An operator's typed amount carrying more precision than the
currency has is **refused, not rounded**.

An amount the source never reported has **no `minor` field at all** in the wire
type, so no rendering path can reach for one. It renders as words. A
`documented_free` zero is a different fact and renders as a real zero.

There is **no headline total anywhere** on the cost surface, and the page says
why: mixed currencies, unknown amounts, and a possibly-subset read.

### Files added

- `server/src/cost/contract.ts` — pure assembly, split strategies, exact
  integer arithmetic, conservation guard, bounded refusal vocabulary.
- `server/src/routes/cost.ts` — `/api/cost`: `GET /queue`,
  `GET /components/:componentPublicId`,
  `POST /components/:id/allocation-preview` (writes nothing),
  `POST /components/:id/allocations`,
  `POST /components/:id/allocations/confirm`,
  `POST /components/:id/allocations/reverse`.
- `server/src/cost/contract.test.ts`, `server/src/routes/cost.test.ts`.
- `client/src/lib/costApi.ts` — transport and wire types.
- `client/src/pages/cost/costMoney.ts` — BigInt money, exact formatting.
- `client/src/pages/cost/costTruth.ts` — the S1.6 truth model.
- `client/src/pages/cost/costMessages.ts` — bounded refusals in the owner's words.
- `client/src/pages/cost/costPresentation.tsx` — the domain adapter.
- `client/src/pages/cost/proposalCreation.ts` — the verify-first coordinator.
- `client/src/pages/cost/AllocationEditor.tsx` — the split editor.
- `client/src/pages/Cost.tsx`, `client/src/pages/CostComponentWorkspace.tsx`.
- Tests: `costMoney.test.ts`, `proposalCreation.test.ts`, `Cost.test.tsx`.
- Browser gate: `client/browser/fixtures/costData.ts`,
  `client/browser/specs/cost.spec.ts`, plus two new canonical surfaces.

### Files modified

`server/src/index.ts` (mounts `/api/cost`), `client/src/app/routing/AppRoutes.tsx`
and its route-preservation test (`/cost`, `/cost/:componentPublicId`),
`client/src/app/navigation/navigationModel.ts` (advertises Cost Allocation),
`client/browser/fixtures/app.ts` and `surfaces.ts`.

`/api/cost` is deliberately distinct from the legacy SQLite `/api/cost-links`
surface; neither reads the other.

### No raw UUID, in either direction

The governed cost functions take internal UUIDs. The browser never supplies one:
a component is named `RV-ACOST-…`, and an allocation target is named by the
**source-qualified pair** (`sourceSystemPublicId`, `acquisitionLinePublicId`),
because a line public id alone is unique only within its source system.
Resolution happens server-side under the caller's own JWT and proves same
workspace, caller readability, and membership of the component's governed scope
before any UUID is used. A request carrying a UUID is refused. Route tests
assert no internal id appears in any response body.

### Defect found by the browser gate and fixed

The split editor is a `<dialog>`. When a proposal's outcome became unknown it
stayed open, sat on top of the recovery banner, and swallowed every click aimed
at the only control that could resolve the situation. jsdom applies no CSS and
has no top layer, so nothing in the unit suites could see it. The editor now
closes on an unknown outcome (where it has nothing left to do) and stays open on
a named refusal (which the owner can fix in place). Pinned by a jsdom test and
two browser tests.

A second defect was found the same way: the queue's narrow rendering was handed
raw domain rows instead of records, producing a list of empty cards at every
phone width while the desktop table was fine. Corrected to `DataTable`'s
`responsive` slot and pinned by a jsdom test.

### Validation, on this branch

All commands exited 0.

| Command | Result |
| --- | --- |
| `npm run typecheck` (server + client) | clean |
| `npm run lint` | 0 errors; warnings only, all `only-export-components`, matching the existing presentation-adapter files |
| `npx vitest run` (server) | 34 files, **828 tests passed** |
| `npx vitest run` (client) | 67 files, **1552 tests passed** (1431 → 1552) |
| `node --test scripts/db/guard.test.mjs scripts/ci/client-audit-gate.test.mjs` | 23 passed |
| `PGOPTIONS='-c jit=off' npm run db:test` | all files passed, **2551 assertions** |
| Playwright, 5 chromium viewports, full suite | **723 passed**, 0 failed, 107 skipped |

New tests in this batch: **142 server** (81 contract + 61 route), **121 client**
(61 money + 20 proposal coordinator + 40 rendered), **22 browser** × 5 chromium
viewports = 110 browser runs.

### Explicitly NOT proved

- **WebKit is unverified.** The WebKit binary is absent in this sandbox
  (`Executable doesn't exist at /opt/pw-browsers/webkit-2215/pw_run.sh`), so the
  six `webkit-ipad` tests could not run locally. `webkit-ipad.spec.ts` iterates
  `CANONICAL_SURFACES`, which now includes the two cost surfaces, so CI will
  cover them. **WebKit results must come from CI.**
- **No CI run.** No PR was opened, so there are no CI run IDs or conclusions.
- **Live Supabase migration count and parity: not checked.** No migration was
  written, so no parity change is expected, but this was not verified.
- **Railway deployment and `/api/version`: not checked.** Nothing was deployed.
- **Hosted acceptance: not performed.** The workflow has not been exercised
  against the deployed app or the live schema.
- **No production data touched.**
- Batch 2 was not begun, and S2.5 acceptance was not attempted.

### Visual baselines

Adding a navigation entry shifted the sidebar on every governed page. Twenty new
cost baselines were generated. Regenerating the full chromium set rewrote
**only** `receiving-{light,dark}-chromium-wide-desktop-1728x1117` (2% of pixels,
the one pair that exceeded the 1% threshold); every other existing baseline
matched byte-for-byte, so no unrelated regression is being masked.

### Known flakiness

`40_cycle_count_concurrency.sql` and race H in
`66_acquisition_receiving_acceptance_hardening.sql` are load-sensitive. Both
passed on this run. Neither was modified.

### Rollback

Delete the branch, or revert its commits. Nothing outside the branch was
changed: no migration, no deployment, no live data, no shared configuration.

### Exact next owner decision

Whether to proceed to S2.5 Batch 2 on this branch, and whether the pre-flight
conservation guard should instead be closed in the database — a governed
function that can discard a `candidate` set would remove the dead end entirely
and make the transport guard unnecessary. That is an S2.4-adjacent SQL decision
this batch was not permitted to make.

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

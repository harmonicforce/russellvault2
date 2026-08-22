# Last Implementation Handoff

## Genome Repair Work Order 2 — authenticate and quarantine every legacy HTTP surface

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/russell-vault-genome-repair-hjt51c` (restarted from merged `main`; WO1 shipped as PR #79).
- Base SHA: `fac90b3b4a821985efc8f68bb0b901353e9463aa` (merge of PR #79).
- Release authority: branch and draft PR only. No merge, deploy, Railway change, or Supabase mutation.
- Status: **implemented** and **validated**. Not merged, not deployed, not hosted-accepted.

### Baseline re-proved at fac90b3

- All eight legacy routers had **no** authentication or workspace middleware: `grep` for
  `authorization|Bearer|requireMember|requireOperator|resolveCaller` across
  `routes/{inventory,purchases,costLinks,listings,sales,dashboard,checks,lookups}.ts` returned nothing.
- `app.use(cors())` at `index.ts:40` reflected every origin.
- `resolveLegacyWritesEnabled` read `!isProduction || flag === 'true'`, so development and test were
  writable by default.
- 24 legacy route declarations across 8 routers.

### What changed

New: `server/src/legacy/accessConfig.ts`, `server/src/legacy/accessGuard.ts`,
`server/src/legacy/routeInventory.ts`, `server/src/corsPolicy.ts`, plus tests for each and
`docs/runbooks/legacy-surface-quarantine.md`.

Changed: `server/src/index.ts` (CORS policy; legacy prefixes mounted through one guarded loop),
`server/src/legacyWriteGuard.ts` (rule moved and semantics changed), `server/.env.example`, and three
existing tests whose assertions encoded the old permissive default.

**No SQL, no migration, no client code.** `git status --short -- supabase/ client/` is empty.

### Security model as implemented

- Quarantine, not authority: `LEGACY_WORKSPACE_ID` names the one governed workspace whose members may
  reach the global legacy dataset. It does not make legacy rows workspace-scoped or authoritative.
- No `LEGACY_WORKSPACE_ID` (or malformed, or missing Supabase config) → every legacy route returns
  `503 legacy_surface_not_configured`. No "first workspace" inference exists.
- Bearer token verified by Supabase Auth (`auth.getUser`); membership read from `workspace_members`
  under the caller's own JWT. **No service-role key anywhere in this path.**
- A client-supplied `workspaceId` is **ignored**. Only the configured workspace is checked — otherwise
  a member of any workspace could name their own and read the global legacy data.
- Read: any member (owner/operator/viewer). Write: owner or operator **and** `ALLOW_LEGACY_WRITES=true`.
  Read/write split matches `ENGINEERING_RULES.md` §1, so legacy authority is never broader than governed.
- Writes fail closed in **every** environment. The old non-production exemption is gone.
- CORS: production emits no headers at all (same-origin); non-production uses a bounded allowlist
  defaulting to the two standard Vite origins, overridable via `DEV_CORS_ORIGINS`; empty means
  same-origin. `credentials: false`. CORS grants no access on its own.
- Refusals are bounded codes carrying no path, SQL, token, workspace id, or provider message.

### Coverage boundary

The guard is mounted per legacy prefix, **not** at `/api`, so `/api/health` and `/api/version` stay
public. Health semantics are untouched — that is Work Order 3. Governed prefixes are mounted plainly
and never consult `ALLOW_LEGACY_WRITES`; `routeInventory.test.ts` asserts all of this structurally,
including that no legacy prefix is ever mounted directly instead of through the guarded loop.

### Validation, all exit codes checked

- `npm test`: exit 0 — server **1057** (37 files), client **1626** (68 files), Node guards **84**.
- New tests: 84 in `legacy/accessGuard.test.ts` (the acceptance matrix runs against all 8 route
  families), plus `corsPolicy.test.ts` and `legacy/routeInventory.test.ts`.
- `npm run lint`, `npm run typecheck`, `npm run build:ci`: exit 0.
- `node scripts/ci/current-state-guard.mjs`: OK.
- `git diff --check`: exit 0.
- Not run: database suites (this change contains no SQL) and hosted acceptance (not authorized).

### Compatibility impact on the current UI

`client/src/lib/api.ts` sends no `Authorization` header. Once the surface is configured, the legacy
pages (`/inventory`, `/purchases`, `/cost-links`, `/listings`, `/sales`, `/checks`, legacy dashboard)
receive `401`; before it is configured they receive `503`. That is the intended quarantine effect.
Attaching a session token to legacy requests is deliberately **not** done here — whether those pages
should keep existing is the legacy retirement question, and this work order's scope is to stop
anonymous access, not to re-enable the pages under a new mechanism.

Governed pages are unaffected.

### Owner deployment variables required later

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LEGACY_WORKSPACE_ID` to enable legacy reads;
`ALLOW_LEGACY_WRITES=true` only when legacy writing is actually needed; optional `DEV_CORS_ORIGINS`
for non-standard dev servers. See `docs/runbooks/legacy-surface-quarantine.md`. None were set by this
work order.

### Rollback

Revert the WO2 commit. Nothing was merged, deployed, or changed in any live system.

---

## Genome Repair Work Order 1 — production identity, current-state truth, and freshness guards

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/russell-vault-genome-repair-hjt51c`.
- Base SHA: `a647b77a0f88fbaac9abc86430be58502a562bf9` (merge of PR #77). `origin/main` was at exactly this SHA at fetch time; **main did not drift** from the sequencing baseline.
- Release authority: branch and draft PR only. No merge, live migration, Railway change, or deployment was performed or authorized.
- Status: **implemented** and **validated**. Not merged, not deployed, not hosted-accepted.

### What this changes

Documentation and repository control plane only. **No SQL, no migration, and no application code changed** — `git status --short -- supabase/` is empty and no file under `client/` or `server/` was touched.

Added:

- `docs/ai/CURRENT_STATE.attestation.json` — a machine-readable, evidence-classed projection of current state.
- `scripts/ci/current-state-guard.mjs` and `scripts/ci/current-state-guard.test.mjs` — the freshness and production-identity guard.
- A `Current-state freshness and production-identity guard` step plus its policy test in the `build-and-verify` CI job; `npm test` and `npm run guard:current-state` also run them.

Repaired: `CLAUDE.md`, `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `PROJECT_CONTEXT.md`, `ENGINEERING_RULES.md`, `PROJECT_ROADMAP.md`, `HANDOFF_PROTOCOL.md`, `SESSION_CHECKLIST.md`, `docs/runbooks/hosted-migration-parity.md`. Marked historical without rewriting: the nine `docs/programs/commercial-core-legacy-retirement/*` documents and `docs/ai/WORKBENCH_AUDIT_2026-08-01.md`.

`docs/ai/CURRENT_STATE.md` was edited under the one-time exception this work order explicitly grants. Normal stewardship returns to ChatGPT.

### Production identity — UNVERIFIED, and deliberately so

Deployment configuration **could not be inspected**: the egress policy answered `403` to `CONNECT` for `russellvault2-production.up.railway.app:443`, so `/api/health`, `/api/version`, and the served bundle were all unreachable, and Railway environment variables are not in the repository.

Therefore the attestation carries `verificationPerformed: false` and `canonicalProjectRef: null`. The repository now names **no** production project, and the guard forbids any document from asserting one until deployment verification is actually recorded.

Separately, by **live-schema** evidence (a different and weaker class than deployed config):

- `ncyqqitqtsyjrijieykd` — governed ledger 79/79, last `20260819000200_null_safe_acquisition_mutation_guards`; matches the reviewed repository set exactly. Registered as `ledger_match_candidate`, **not** as production. It does not appear in the verifier's scoped Supabase project listing yet is directly reachable.
- `ykdyqnvmwpxhowbwhzqz` — governed ledger 40, last `20260729000300_cycle_count_observations`; 39 migrations behind. This is the ref the canonical docs named as *the* Supabase project. It is a real `ACTIVE_HEALTHY` Russell Vault database, so a destructive action aimed there on the old documentation would have hit a credible-looking wrong database.

### CI truth for the exact baseline SHA

Run `32265646383`, event `push`, branch `main`, head `a647b77a0f88fbaac9abc86430be58502a562bf9`:

- **attempt 1: failure** — `shadow-db-supabase-stack`, pgTAP step ran ~12m12s on 2026-08-19 and failed; the other three required jobs were green.
- **attempt 2: success** — the re-run job's pgTAP step completed in 59s on 2026-08-21. Overall run conclusion **success**.

This is *green after a rerun*, not *never failed*. PR #78's "Current CI state: RED" was written against attempt 1 and went stale when attempt 2 succeeded.

### Validation, all exit codes checked

- `npm ci` (root, client, server): exit 0.
- `npm run lint`: exit 0 (pre-existing `react-refresh/only-export-components` warnings only).
- `npm run typecheck`: exit 0 (server and client).
- `npm run build:ci`: exit 0 (pre-existing Vite chunk-size warning).
- `npm test`: exit 0 — server **953** tests / 34 files, client **1626** tests / 68 files, Node guards **64** tests.
- `PGOPTIONS='-c jit=off' npm run db:reset`: exit 0, after installing pgTAP and starting the local PostgreSQL 16 cluster.
- `PGOPTIONS='-c jit=off' npm run db:test`: exit 0 — **all files passed, 2673 assertions**. `06_provenance_structure.sql` passed its 79-migration ledger contract; `15_acquisition_digest_parity.sql` took 5.5s locally and did not reproduce the CI timeout.
- `node scripts/ci/current-state-guard.mjs`: exit 0 on the repaired baseline.
- `git diff --check`: **the first report of this was wrong.** It was run against a clean working tree after
  committing, which checks nothing. Run against the base range it flagged trailing whitespace at
  `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md:51`. Fixed in the review-repair commit; `git diff --check`
  and `git diff --cached --check` now both exit 0, verified against `origin/main...HEAD`.

Not run: local Supabase CI tier (`supabase` CLI stack) and hosted/browser acceptance — not reachable from this environment. The change contains no SQL and no client code, so neither gates it; CI will run both.

### Review repair (second commit on this branch)

Independent adversarial review found two blocking holes in the guard and three consistency defects. All are fixed:

1. **Deployment-identity state machine.** The guard previously returned zero findings for an incoherent
   `verificationPerformed: true` + `canonicalProjectRef: null` + no `deployed_production` entry + a document
   asserting production. It now enforces two complete states. UNVERIFIED requires `verificationPerformed:false`,
   a null canonical ref, no `deployed_production` role, a nonempty `blocker`, and no production assertion in any
   canonical document. VERIFIED requires `verificationPerformed:true`, exactly one valid canonical ref, exactly
   one `deployed_production` registry entry equal to it, that entry's `evidenceClass` to be `deployed_config`,
   its own `verifiedAtUtc` and `verificationMethod`, an `authoritativeSource`, and every document assertion to
   name that exact ref. Duplicate registry refs and unknown evidence classes are rejected at parse time.
   A `live_schema` ledger match can never satisfy production identity.

2. **Bare-reference bypass.** `findProjectRefs('Supabase project: ncyqqitqtsyjrijieykd')` returned nothing.
   Supabase hosts and backticked refs are still recognised on every line; an unquoted 20-character ref is now
   also recognised on any line carrying a production/deployment assertion. An unrelated 20-letter English word
   outside identity context is still ignored.

3. **Structurally exact derived-document markers.** The old check passed if `79` appeared anywhere in
   `CURRENT_STATE.md`, so a stale contradictory count could coexist with the right one. Three labelled fields —
   `reviewed-main-sha`, `governed-migration-count`, `last-migration-name` — now live in a marked
   `machine-derived-baseline` block. Each label must appear exactly once in the whole document, inside the block,
   non-empty, and exactly equal to the attestation. Unrelated prose edits do not invalidate it.

4. **Stewardship contradiction resolved.** One model, stated identically in `AGENTS.md`, `CLAUDE.md`,
   `ENGINEERING_RULES.md`, `HANDOFF_PROTOCOL.md`, `WORK_ORDER_PROTOCOL.md`, and `CURRENT_STATE.md`:
   migration-bearing work is auto-authorized to update **only** the marked baseline block and the attestation,
   together; all narrative and program-phase content stays steward-controlled behind an explicit exception.

5. **Program sequence corrected.** `docs/ai/GENOME_PROGRAM_REGISTRY.md` records the active reliability track —
   WO1 (this PR) active, WO2 Legacy Confidentiality Membrane next, S3.3 remapped to WO13 after prerequisite
   hardening. WO3–WO12 are explicitly left unenumerated rather than invented. The commercial roadmap is
   preserved and marked as the separate product track.

### Second review repair (third commit on this branch)

A further review found one remaining state-coherence bypass and two consistency gaps.

**The bypass.** Setting `verificationPerformed:true`, a canonical ref, `verifiedAtUtc`, `verificationMethod`, and a
`deployed_production` / `deployed_config` registry entry — while leaving `currentState: UNVERIFIED`,
`evidenceClass: not_inspectable`, and the Railway-unreachable `blocker` in place — returned **zero findings**. The
attestation simultaneously claimed VERIFIED, UNVERIFIED, deployed evidence, not-inspectable evidence, and an active
verification blocker.

`deploymentIdentity.currentState` was introduced by the previous repair and was the root cause: a second,
independently editable state label that can disagree with `verificationPerformed`. It is **removed**, and the guard
now **rejects the key at parse time** so it cannot return — including when it happens to agree. `verificationPerformed`
is the single state variable.

**Both tuples are now complete and all-or-nothing:**

| Field | UNVERIFIED | VERIFIED |
| --- | --- | --- |
| `verificationPerformed` | `false` | `true` |
| `canonicalProjectRef` | `null` | one valid 20-char ref |
| registry `deployed_production` entries | zero | exactly one, equal to `canonicalProjectRef` |
| that entry's `evidenceClass` | n/a | `deployed_config` |
| `deploymentIdentity.evidenceClass` | `not_inspectable` | `deployed_config` |
| `blocker` | nonempty | `null` or absent |
| `verifiedAtUtc` | `null` | strict ISO-8601 UTC instant |
| `verificationMethod` | `null` | nonempty |
| `authoritativeSource` | — | nonempty |
| production assertions in canonical docs | none | must name the canonical ref |

`deploymentIdentity.evidenceClass` is validated against the known evidence-class set at parse time, alongside registry
entries. `verifiedAtUtc` uses a strict `YYYY-MM-DDTHH:MM:SS(.sss)?(Z|+00:00)` check — `Date.parse` alone accepted
`2026-08-22` and other junk. A test walks every strict prefix of the seven-step transition and asserts each one fails,
then asserts the complete tuple passes: the owner transition cannot be applied halfway.

**Production-identity wording contradiction resolved.** `CLAUDE.md` said no repository document may name the production
project, while the owner transition requires recording the verified ref in the attestation. One rule now, applied in
`CLAUDE.md`, `AGENTS.md`, `PROJECT_CONTEXT.md`, and `CURRENT_STATE.md`: the attestation **may** record the last
deployment-verified ref with its evidence; ordinary prose must **not** replicate it; the attestation is historical
verification evidence, **not** live-action authority; every live action re-reads the deployed environment immediately
before acting.

**Program registry completed.** WO1–WO17 with titles and prerequisites, supplied by the program owner. Prompts remain
owner-held. The prerequisite graph is not linear — WO11 gates on `main` being green, and WO10/12/15/16 fan in from
several predecessors — so the registry says to read the prerequisite column rather than the numbering. S3.3 is carried
by WO13, gated on WO4, WO5, WO7, WO9, WO11.

### Guard behaviour, demonstrated against the real repository

| Case | Result |
| --- | --- |
| Migration added, attestation untouched | FAIL — `migration_count_drift`, `migration_last_name_drift`, `migration_set_digest_drift` |
| Migration renamed, count unchanged | FAIL — `migration_set_digest_drift` (unit test) |
| Attestation updated but `CURRENT_STATE.md` left behind | FAIL — `derived_doc_count_stale`, `derived_doc_last_migration_stale` |
| Two refs presented as production | FAIL — `conflicting_production_refs` |
| A ref asserted as production while deployment unverified | FAIL — `unverified_production_assertion` |
| Malformed attestation | FAIL — parse/shape error, guard exits 1 |
| Rerun-recovered run presented without its failed attempt | FAIL — `ci_claim_hides_rerun` |
| Repaired baseline | PASS |

The guard's authority model: the **deployed runtime** owns production identity. The guard never blesses a hard-coded ref — it forbids the repository from claiming an identity it has not verified, which is the opposite of making a stale ref safer by repeating it. It is not pinned to `HEAD`: only a governed migration-set change invalidates the attestation, so documentation-only commits need no edit.

### Open PR collision

- **PR #78** (head `ea8dc27`, draft, based on this same SHA) — superseded, valid corrections preserved, its two defects (stale CI-RED claim; a canonical deployed ref its evidence did not establish from deployed config) corrected. Not merged, not closed. Owner decides.
- **PR #75** (head `453075c`) — superseded by merged PR #76; its migration `20260818000100` is absent from `main` and would collide with the 79-migration ledger. Recommend closing. Owner decides.

### Remaining owner-only action

1. Read `VITE_SUPABASE_URL` from the deployed Railway service, then set `deploymentIdentity.verificationPerformed: true`, `canonicalProjectRef`, and the matching registry role in the attestation. Until then production identity stays unverified by design.
2. Decide PR #78 and PR #75 disposition.
3. `15_acquisition_digest_parity.sql` against the 12-minute Supabase-stack budget remains the top platform debt; it caused the real attempt-1 failure above.

### Rollback

Revert the branch commit. Nothing was merged, migrated, deployed, or changed in any live system.

---

## Hosted parity prerequisite — NULL-safe acquisition mutation guards

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `fix/null-safe-acquisition-guards`.
- Base SHA: `f5a12aaa88297ab6019a1fd0b54f6339d28040ad`.
- PR: to be created from the committed branch; status is implemented and locally validated except for the pre-existing Cycle Count concurrency assertion described below. Not merged, deployed, hosted-accepted, or applied to live Supabase.
- Migration: `20260819000200_null_safe_acquisition_mutation_guards.sql` (forward-only additive replacement of two trigger functions; no merged migration changed).
- Guard repair: both mutation checks now use `coalesce(current_setting(..., true), '') <> 'on'`. Every remaining condition, SQLSTATE, trigger, grant, and RLS rule is unchanged.
- Regression evidence: with each custom GUC asserted genuinely NULL, privileged payment UPDATE/DELETE and shipment UPDATE/DELETE are refused with `42501/governed_write_required`, and a privileged exclusion supersession-shaped UPDATE is refused with `55000/append_only_violation`. Existing governed payment, shipment, exclusion, and restoration lifecycle assertions remain green; focused files now contain 161 assertions each.
- Validation: `PGOPTIONS='-c jit=off' npm run db:reset` passed. Two complete `db:test` runs reached every file and both showed the unrelated pre-existing nondeterministic `40_cycle_count_concurrency.sql` cancel/observation race assertion failure (assertion 8 on the first run, assertion 6 on the second); all other files passed on the second run, including `06` (56), `61` (161), and `63` (161). `npm run typecheck`, `npm test` (server 953, client 1,626, Node 38), `npm run build:ci`, and `git diff --check` passed.
- Live Supabase migration parity: not checked. Production data, hosted schema, S3, Railway, and application code were not touched.
- Rollback: revert the branch commit before merge; after migration application, a new forward migration would be required.
- Exact next owner decision: review/create the PR and decide whether the unrelated Cycle Count concurrency test defect must be repaired separately before merge.

## S2.6 — Governed Unresolved Cost Queue (COMPLETE, including the final truth repair)

The final S2 application slice. An owner-usable triage queue answering: **what
cost truth still needs attention, why, and where do I go to resolve it.**

- Repository: `harmonicforce/russellvault2`. Canonical branch: `main`.
- Branch: `claude/s2-6-unresolved-cost-queue`.
- Base SHA: `3efe5b9422aa6016aa1ed36047f6a90ffa2c6a7d` (S2.5 merged as PR #70).
- Current `main` merged in three times as other slices landed — `a8c9517`
  (S3.1, PR #73), `44b98eb` (S3.2, PR #74) and `a37109d` (the S3.1 ordering
  repair, PR #76). The first two conflicted only in this file, because each slice
  adds a section at the top; every section is kept and Codex's text is verbatim.
  `git diff origin/main HEAD -- supabase/ docs/ai/CURRENT_STATE.md` is empty
  after every merge.
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
changes** — `git diff origin/main HEAD -- supabase/` is empty. (Stated against
`main` rather than the original base, because merging `main` in legitimately
brings other slices' migrations onto the branch; what matters is that S2.6
contributes none of them.) No S3 or reconciliation file authored here. `docs/ai/CURRENT_STATE.md` untouched. No COGS,
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

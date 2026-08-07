# Last Implementation Handoff

## S1.5 behavioral acceptance and retry hardening

### Lineage and base

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `claude/s1-5-acceptance-hardening`.
- Base SHA: `72ceb34762e2f305205f1ec60526c6dbc51aa8c1` — current `main` exactly matched the expected PR #50 merge commit. No drift, no intervening commits.
- PR #50 implementation head: `c94af65b0ba1a076ecad8ddceb38a29e00f5e6b0`, confirmed an ancestor of the base.
- PR #50 exact-head CI run: **31131267196**, with all four jobs green (`build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, `dev-advisory-report`). The merged base was therefore CI-clean; it was not acceptance-complete.

### What PR #50 actually supplied

- `supabase/tests/63_acquisition_line_exclusions.sql` held **15 assertions, all structural or grant-level**: table, columns, functions, RLS, direct-write privileges, ledger entry. It executed no exclusion, no restoration, no audit check, no state transition, no idempotency, no role behaviour, no isolation, and no concurrency.
- **No S1.5 server acceptance was added.** The server suite stayed at the S1.4 total of 555.
- **No rendered S1.5 client acceptance was added.** The existing rendered detail test was only relaxed to stop asserting that exclusion content was forbidden.
- The exclusion UI **bypassed the durable retry mechanism**, minting `crypto.randomUUID()` inside the mutate call.
- An invalid `?exclusionState=` value was **silently ignored** rather than governed like every other filter.

### The regression that mattered most: `list_acquisition_lines`

00700 needed a twelfth parameter for the exclusion filter. PostgreSQL cannot add a parameter in place, so it dropped the eleven-argument function and rewrote the body, condensing the S1.3 implementation. Four behaviours were lost. Each was proved failing by an executable assertion before the fix, and passing after:

1. **`total` counted the page, not the result set.** `select count(*), jsonb_agg(...) from (select * from f limit p_limit offset p_offset) x` — both aggregates read the already-paged subquery. Measured directly against the shadow database: the same unfiltered query returned `total = 1` at `limit 1` and `total = 4` at `limit 50`. At the client's page size of 50 every result set of 50 or more reported exactly "50 filtered lines", and the page count is uncomputable, so page 2 is unreachable from the UI.
2. **LIMIT/OFFSET applied to an unordered relation.** No `ORDER BY` before the cut, so which rows land on which page is undefined; two pages could repeat a row and drop another. Ordering was applied afterwards inside `jsonb_agg`, which only sorts rows that already survived the cut.
3. **`p_sort` validated and then ignored.** Ordering was always by `acquisition_line_public_id`, so all six offered sorts returned identical ordering.
4. **Closed filter vocabularies stopped failing closed.** S1.3 rejected an unknown classification method, state, or key with `invalid_filter` and an over-length query with `invalid_query`. Measured: each now returned `total = 0` instead of raising — an unsupported filter silently reads as "there are none", the most dangerous possible answer for an inventory filter.

### Corrective migration

**One** additive migration was required: `supabase/migrations/20260806000800_acquisition_list_pagination_repair.sql`.

It restores the S1.3 semantics and adds the exclusion filter to them: `total` counted over the full filtered set before paging, ordering applied before LIMIT/OFFSET with a stable tie-break on the immutable line public ID so pages partition the result set, and every closed vocabulary failing closed again. The eleven-argument compatibility wrapper delegates here and inherits all of it.

- Migration count: **69 → 70**; ledger entries **69 → 70**, verified against the directory.
- `supabase/tests/06_provenance_structure.sql` updated to expect 70 with the ordered list extended.
- **Migration `20260806000700_acquisition_line_exclusions.sql` was not edited.**

### Evidence

**Database — `supabase/tests/63`: 15 → 159 executed assertions.** Real committed two-workspace fixture (owner/operator/viewer/foreign owner, two source systems, committed source and acquisition import jobs, channels, suppliers, five lines with distinct quantities, one foreign line).

- *Successful exclusion lifecycle:* default-included state, `RV-AEXCL` governed ID, exactly one current decision, normalized reason, owner actor, and — the point of the whole feature — the line itself still exists with unchanged quantity, classification, and source evidence, still present in the overview, still returned by the unfiltered list. Overview and detail both report `excluded`, detail names the exact current decision, facets move 4/1, the excluded filter returns it, and the downstream eligibility helper now raises `acquisition_line_excluded`.
- *Successful restoration lifecycle:* its own governed ID, the original exclusion preserved as superseded history, exactly one current decision, successor and predecessor links verified in both directions, reason preserved, one `acquisition_line_restored` audit event with `prior_state = excluded`, both decisions in deterministic history order, overview and filters back to included, eligibility helper succeeding again, and the line visible throughout.
- *Obsolete-operation replay:* exclude under key A, restore under key B, then replay A — returns the **original** exclusion receipt, creates no row, creates no audit event, and leaves the line **included**. Then exclude under key C and replay B — returns the original restore receipt and leaves the line **excluded**. Replay returns history; it never re-applies superseded state.
- *Changed-payload idempotency:* changed reason, different line, and opposite operation under one key each raise `idempotency_conflict` with no history, no audit, and no state change. Redundant transitions raise `already_excluded` / `not_excluded`.
- *Authorization:* owner may exclude and restore; operator and viewer may read current state and history but are denied both mutations; anonymous is denied table access and both functions; `authenticated` is denied INSERT, UPDATE, DELETE and TRUNCATE on the ledger; the internal `app.assert_acquisition_line_eligible_for_downstream` is not executable by `authenticated`.
- *Workspace isolation:* foreign decision rows invisible, a foreign workspace refuses another workspace's owner, a cross-workspace target is indistinguishable from a missing one, and the same idempotency key is independently usable per workspace (two rows coexist, neither member sees both).
- *List/facet:* historical decisions never duplicate list rows, every line contributes exactly once to facets, included/excluded filters partition correctly, unfiltered keeps all evidence visible.
- *Pagination:* `total` is the full count on every page, three pages of size 2 cover five lines exactly once with no overlap, filtered totals stay truthful, and both sort directions are honoured.

**Genuine concurrency — 3 overlapping dblink races.** Both calls are dispatched with `dblink_send_query` on two connections *before either result is collected*, under a bounded 30 s deadline. No sequential statement is represented as concurrency.

| Scenario | Outcome |
| --- | --- |
| A — two exclusions of one included line, different keys | Exactly one decision applied, one current row, loser `ERR:23505` (`already_excluded`), one audit event, no partially superseded row |
| B — two identical exclusions, same key | One semantic decision, one current row, one audit event, neither caller an error |
| C — exclude vs restore on one line | Winner is legitimately order-dependent, so **invariants** are asserted: exactly one current decision, no partial superseded row, every successor and predecessor link resolves, audit count equals applied-decision count, no self-supersession, at most one side refused |

**Server — `acquisition.finalAcceptance.test.ts`: 92 → 130 tests; full server suite 555 → 593.** Real HTTP against the mounted router; no source-text inspection. Owner exclude/restore succeed with exact argument forwarding; operator, viewer and anonymous denied on both; percent-encoded source and line identities decoded exactly once; reason whitespace normalized; idempotency key forwarded byte-for-byte; missing, blank, empty, and over-long reasons plus missing, short and over-long keys all rejected before any RPC; `already_excluded`, `not_excluded`, `idempotency_conflict`, `acquisition_integrity_error`, `ambiguous_acquisition_line_id` bounded as 409 and `acquisition_not_found` as 404; unexpected failures bounded as 502 with no SQL text, constraint names, or table names in the body; empty dependency responses never become successes; caller-token client proved the only data path even with a service-role key in the environment; and the list route rejects `exclusionState=banana` before any RPC while forwarding valid values.

**Client — 643 → 684 tests.** `AcquisitionDetail.render.test.tsx` 60 → 81, plus a new `Acquisitions.render.test.tsx` with 20 rendered list tests.

- *Role matrix:* viewer and operator see state, current reason and decision history but no exclude or restore control; owner sees exactly one control matching the current state.
- *Confirmation:* an empty reason is blocked by the native `required` attribute before any handler runs; a whitespace-only reason (which satisfies `required`) is caught by the trim check; Cancel sends nothing; Confirm sends the exact source, line, trimmed reason, and a key.
- *Pending:* with the request held in flight, Confirm is disabled and repeated clicks cannot produce a second request — and the exclusion control is **not** disabled merely because a payment is in flight, proving the pending state belongs to the decision itself.
- *Retry-key proof:* exclusion and restoration each fail once, surface the governed Retry notice naming the operation, and the retry is asserted to carry the **identical** target, reason, and idempotency key. Success clears the retained operation; Discard clears it with no request; a retained failure blocks a second decision and blocks payments; invalidation of the list and facet queries plus a detail refetch is asserted on success.
- *List page:* excluded badge present and absent correctly, excluded lines stay visible, linkable and searchable, governed total rendered rather than page size, eligibility filter options and URL synchronisation both directions, and unsupported URL filters removed and reported.

### Full repository verification

`npm ci` (root/client/server), `npm run lint`, `npm run typecheck`, `npm run build:ci`, `npm test`, `node --test scripts/db/guard.test.mjs`, `node --test scripts/ci/client-audit-gate.test.mjs`, `npm run db:reset`, `npm run db:test`, `git diff --check`. Lint reports only pre-existing warnings in files this work did not touch.

### Exact-head CI

Head `44f80318bde61026f556844f3a099816e4ad1178`, workflow run **31172593688** — **all four jobs green**:

| Job | Conclusion |
| --- | --- |
| `build-and-verify` | success |
| `shadow-db-postgres-shim` | success |
| `shadow-db-supabase-stack` | success |
| `dev-advisory-report` | success |

Both database tiers independently confirm the same total. The shim tier logged `all test files passed (2300 assertions)`; the authoritative Supabase-stack tier logged `All tests successful. Files=63, Tests=2300, Result: PASS`, matching the local run exactly.

The previous head `ddb0b235` was green on three of four: `shadow-db-supabase-stack` failed on assertions 58-59 of test 63. That was a genuine defect in the new test, not infrastructure and not a flake — see risk 4 — and it was fixed on this same branch rather than rerun.

### Remaining risks

1. **`15_acquisition_digest_parity.sql` remains performance-flaky in this container.** It was classified against the known pattern rather than assumed: one backend pinned at ~91 % CPU with CPU-time equal to elapsed, zero ungranted locks, inside `app.compute_acquisition_plan_digest`, and the file references none of the objects changed here (verified by grep) and runs *before* test 63 alphabetically. A local PostgreSQL restart clears it. It is pre-existing and untouched; a rerun is the correct response if it times out on CI.
2. **`40_cycle_count_concurrency.sql` failed once, intermittently, and is also pre-existing.** Assertion 2 (`no item evidence lands after evaluation`) asserts that no accepted observation's `observed_at` post-dates its round's `submitted_at`. Those two timestamps come from two independent transactions and are transaction-start times, so a run where the observation legitimately serializes first can still record a later start instant than the submit it beat — the assertion can fail while the serialization was correct. It was classified on evidence, not assumed: the file references none of the objects changed here (verified by grep, 0 matches), it is cycle-count code with no acquisition, list, or exclusion surface, and it passed 3/3 on isolated re-runs and in the subsequent full-suite run. It is a genuine intermittent race in a pre-existing file and is worth tightening separately; it is not caused by this work and was not papered over.

3. **Sort coverage is proven for `quantity` only.** The corrective migration restores the full S1.3 sort ladder verbatim, but test 63 asserts the ordering effect for `quantity` ascending and descending. The other five sorts are restored code, not re-asserted behaviour.
4. **The exclusion decision ledger has no monotonic ordering column, and this was proved the hard way.** `acquisition_line_exclusions.created_at` defaults to `now()`, the transaction timestamp, so two decisions written in one transaction share an instant and the detail view's `order by h.created_at, h.id` tie-breaks on a random UUID. Test 63 originally asserted history by array position; that passed on the plain-PostgreSQL shim and **failed on the Supabase stack** (assertions 58-59, run 31171643264) purely because the random UUIDs sorted the other way. The assertions were corrected to identify history entries by supersession state, which is the durable ordering fact, rather than by position. The underlying read-model ordering is unchanged and is deterministic in production, where decisions land in separate transactions; no speculative migration was added for it. A sequence or `clock_timestamp()` default would make intra-transaction ordering total, and is worth considering alongside the same caveat already noted for `acquisition_shipment_transitions`.
5. Hosted Supabase, Railway, and deployment were not touched — not authorized by this work order. The corrective migration has not been applied to hosted Supabase.

### Authority and scope

Migration `20260806000700` was not edited. No receiving, receipts, discrepancies, cost basis, historical import, or marketplace work. No SQLite change. No Railway work, no hosted Supabase access, no hosted migration. No S1.6 and no S2 implementation. `docs/ai/CURRENT_STATE.md` was not edited.

### Rollback

Revert the branch commits. The corrective migration has not been applied to hosted Supabase, so no hosted rollback is required.

### Next decision

Do not merge until all four exact-head CI jobs are green on the final head. **S1.6 — Governed UI Foundation and Russell Vault Design System** is the next engineering checkpoint after owner approval of its separate plan; it is not started here.

# Last Implementation Handoff

## S1.4 final behavioral, concurrency, and rendered-client acceptance

### Base and branch

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `claude/s1-4-acceptance-completion`.
- Base SHA: `d704039ed59c76dc14daf4f191502d4513648d69` — current `main` exactly matched the expected PR #48 merge commit. No drift; no intervening commits to reconcile.
- PR #48 implementation head `8c01dbc4f1e851b3a5ba5eb4774f2c8a4d127ae0` confirmed an ancestor of the base.
- PR #47 implementation head `75afab4a98f2c6aa0f6ebfeae9dfeb3fe03cf284`, PR #47 merge `ce5532a55d62bf471840261d3878446916c89068`.

### What PR #48 actually supplied

- 12 negative/fail-closed database assertions in test 61 and 6 missing-target assertions in test 62.
- No successful payment, reversal, shipment, or transition lifecycle.
- No genuine concurrency; no overlapping dblink sessions.
- No rendered React Testing Library suite.
- No exact-head GitHub CI.
- Migration `20260806000500_acquisition_source_qualified_uuid_lookup.sql` omitted its `public.schema_migrations_log` entry and did not extend the ordered migration expectations in `supabase/tests/06_provenance_structure.sql`.

### Baseline database gate

`npm run db:reset` succeeded. The first `npm run db:test` **timed out** on `15_acquisition_digest_parity.sql` at the runner's 600 s per-file limit. Diagnosed as environmental, not a repository fault: this container's PostgreSQL ran with `fsync=on`, `synchronous_commit=on`, and 128 MB shared buffers against slow container storage, and that file stages 2 149 lines. After tuning the disposable local cluster only (`fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, 1 GB shared buffers) the full suite passed at **1 914 assertions** on the unmodified base. No repository file was changed for this; CI runners are unaffected.

### The defect that mattered most: the S1.4 mutation path could never succeed

`record_acquisition_payment`, `reverse_acquisition_payment`, `create_acquisition_shipment`, and `transition_acquisition_shipment` each computed their idempotency fingerprint with an **unqualified `digest()`**. All four are `SECURITY DEFINER` with `SET search_path = ''`, and pgcrypto is not installed in this database, so `digest()` resolved nowhere: every call raised `42883 undefined_function` the moment control reached the fingerprint assignment.

That assignment sits *after* the role, validation, and order-resolution checks. Every fail-closed path returned before reaching it and looked healthy, while no payment or shipment could ever be recorded. This is why S1.4 had no successful lifecycle to point at — not an untested feature, an unexecutable one. It surfaced only when test 61 was made to drive the operations to completion.

These eight `digest()` calls were the only ones in the repository; every other hash uses `encode(sha256(convert_to(..., 'UTF8')), 'hex')`. All four functions are restored in the corrective migration at their latest merged definitions — payment, reversal, and transition from 00300, shipment creation from 00400 — with the hash expression corrected and no other behavioral change. No S1.4 payment or shipment row can exist yet, so there was nothing to migrate.

### Corrective migration

`supabase/migrations/20260806000600_acquisition_s1_4_acceptance_completion.sql` (forward-only, additive).

- Physical migration count: **67 → 68**. Ledger entries: **66 → 68** (the backfilled 00500 plus its own 00600), verified against the directory rather than assumed.
- Backfills the missing `20260806000500_...` ledger entry with `on conflict (migration_name) do nothing`.
- Replaces `get_acquisition_line_detail_by_source` for exact root-row cardinality.
- Renames the two source-evidence fields.
- Restores the four mutation functions with resolvable hashing.
- Records its own ledger entry.

Merged migrations 00200, 00300, 00400, and 00500 were **not** edited.

### Detail root-row cardinality

The merged implementation counted `count(distinct acquisition_line_item_id)` and closed with an arbitrary `LIMIT 1`. `acquisition_line_overview` LEFT JOINs `acquisition_lot_lines` on `state='active'`, so a line with two active placements yields **two** overview rows while still counting **one** distinct line ID: the check passed, `select * into v` took an arbitrary row, and `LIMIT 1` picked an arbitrary lot — a split-brain placement reported as fact.

It now counts overview ROWS (every other join in the view is to a unique key, so row count is exactly active-placement count), proves the active-placement count separately by name, and builds the response from a literal one-row source through LEFT JOINs onto unique keys under `INTO STRICT`. No `LIMIT`. `TOO_MANY_ROWS`/`NO_DATA_FOUND` raise `acquisition_integrity_error`. Zero active placements now report `missing_active_placement` instead of an invented lot.

### Source-evidence naming

| Was | Now | Actual value |
| --- | --- | --- |
| `acquisitionImportPublicIdentity` | `sourceImportJobPublicId` | `public.import_jobs.public_id` — the SOURCE import job. `acquisition_import_jobs` has no governed public ID and none was invented. |
| `sourceRecordPublicIdentity` | `sourceRecordRowKey` | `public.source_records.source_row_key` — a raw source row key, never an RV-style governed identity. |

Updated consistently across the corrective migration, the JSON response, the client `AcquisitionDetail` interface, the rendered UI labels, pgTAP, and `docs/architecture.md`. Test 62 asserts both old names are absent.

### Evidence

**Database — full pgTAP suite: 2 152 assertions across 62 files, green.**

- `supabase/tests/61_acquisition_payment_shipment_behavior.sql` — **156 assertions** (from 12). Real committed two-workspace fixture: owner/operator/viewer/anonymous, two source systems, committed source and acquisition import jobs plus a preview job and a failed job, channels, suppliers, source records, orders, lots, placements.
  - Successful payment lifecycle: owner and operator creation, exact stored amount/currency/instrument, bigint minor units beyond 2^53, lowercase-currency normalization, same-workspace source evidence accepted, audit-event counts.
  - Successful reversal lifecycle: owner reversal, durable event row, payment linked to the exact event, original amount/currency/date/instrument unchanged, detail response carrying the event.
  - Successful shipment lifecycle: `expected` and `in_transit` creation, raw carrier/tracking retained, normalized duplicate-tracking refusal, untracked shipments, paired shipping reference amount.
  - Successful transition lifecycle: **all ten legal edges executed** — expected→in_transit/delivered/lost/cancelled, in_transit→delivered/lost/cancelled, lost→in_transit/delivered/cancelled — plus terminal-state and invalid-edge refusals, stale status, required evidence, durable no-op, and applied-edge history.
  - Idempotent replay and key-collision matrices for all four operations; rollback matrices proving a failed audit event, reversal-event insert, payment update, transition-event insert, or shipment update leaves nothing behind.
- `supabase/tests/62_acquisition_detail_addressing_concurrency.sql` — **89 assertions** (from 6). Source-collision fixture (one workspace, two source systems, same external line public ID), placement integrity, detail JSON content, and concurrency.
- `supabase/tests/06_provenance_structure.sql` — 56 assertions, ledger count and ordered list updated to 68 with an explicit maintenance contract.

**Genuine concurrency (5 races, overlapping dblink sessions).** Both calls are dispatched with `dblink_send_query` on two connections *before either result is collected*, then awaited under a bounded deadline — the backends are in flight together and must be serialized by the governed locks. No sequential statement is represented as concurrency anywhere.

| Race | Outcome |
| --- | --- |
| Two identical payment creates, one key | Exactly one payment row, one audit event, neither call an error |
| Two conflicting payment creates, one key | One winner; loser `ERR:23505`; no partial audit event |
| Two reversals of one payment, different keys | One reversal event; loser `ERR:23505`; payment points at the survivor; no half-updated row |
| Two normalized-equivalent tracked shipment creates | One shipment; loser `ERR:23505`; no row behind the loser's key |
| Two transitions out of one `expected` status | One applied transition; loser `ERR:40001` stale status; shipment is the winner's state; winner's key still replays |

**Server — `server/src/routes/acquisition.finalAcceptance.test.ts`: 92 tests (from 16); full server suite 555 passing.** Mounted Express approach preserved and expanded; no source-text inspection. Availability gate on reads and mutations, full viewer/operator/owner authority matrix, percent-encoded identity forwarding, payment and shipment validation tables, evidence trimming, `p_source_record_id` pinned to null so a client cannot attach unvalidated source evidence to money, every governed SQLSTATE bounded to its status (409s for stale/conflict/duplicate, 503 for a missing contract, 502 otherwise), no SQL text or constraint names in any body, empty mutation responses bounded as 502 while an empty detail read stays a truthful 404, and the caller-token client proved to be the only data path even with a service-role key present in the environment.

**Client — `client/src/pages/AcquisitionDetail.render.test.tsx`: 60 rendered tests; full client suite 643 passing.** React Testing Library with MemoryRouter, route params, QueryClient, mocked WorkspaceContext and token/Supabase transport. Role matrix, classification options and required reason, tracked pending/error/success, classification history with owner reason, form validation, raw carrier/tracking preservation, delivered never offered initially, transition evidence requirements, reversal and transition history, mixed-currency refusal, loading/not-found/unauthorized/dependency-unavailable/empty states, workspace switch without a stale flash, and the coverage notice.

**Retry-key evidence, all four operation classes** (payment, payment reversal, shipment, shipment transition): each fails once, renders Retry, and the retry is asserted to carry the **identical payload and identical idempotency key**; success clears the retained operation; Discard clears it with no request. A retained failure blocks further payment/shipment submission so two unresolved keys cannot coexist invisibly. A stale transition is never retained — it refetches and requires a new confirmation with a new key.

### Client structure

Refactored only as far as the rendered tests and state boundaries required: `useRetryableAcquisitionMutation` gained the durable single-unresolved-operation lock, `OperationRetryNotice` was extracted and now names the operation, and accessible labels were added to the forms and dialogs. `ClassificationSection`, `PaymentSection`, `ShipmentSection`, `PaymentHistory`, and `ShipmentHistory` boundaries were preserved. No visual redesign; S1.6 owns the governed UI foundation.

### Full repository verification

`npm ci` (root/client/server), `npm run lint`, `npm run typecheck`, `npm run build:ci`, `npm test`, `node --test scripts/db/guard.test.mjs`, `node --test scripts/ci/client-audit-gate.test.mjs`, `npm run db:reset`, `npm run db:test`, `git diff --check` — all clean. Lint reports only pre-existing warnings in files this work did not touch.

### Remaining risks

1. **Ledger drift is still caught only by a hand-maintained list.** Test 06 now turns red if a migration omits its ledger insert, but nothing compares the migrations *directory* to the ledger programmatically. A filesystem-vs-ledger check wired into CI would close this class permanently; adding a CI step was outside this work order's allowed scope.
2. **The transition ledger has no monotonic ordering column.** `created_at` defaults to `now()`, the transaction timestamp, so transitions written in one transaction share an instant and `order by created_at, id` is non-deterministic among them. Production writes land in separate transactions, so this is not a live defect, but detail history ordering and any future audit replay would benefit from a sequence.
3. `15_acquisition_digest_parity.sql` is genuinely slow and is the file most likely to hit the 600 s per-file limit on a loaded shared runner. It passes comfortably when not competing for CPU.
4. Hosted Supabase, Railway, and deployment were not touched or checked — not authorized by this work order. The corrective migration has not been applied to hosted Supabase.

### Authority and scope

Merged migrations 00200 through 00500 were not edited. No exclusions, receiving, discrepancy schema, cost basis, historical import, or marketplace work. No SQLite change. No Railway work, no hosted Supabase access, no hosted migration. S1.5 not started. `docs/ai/CURRENT_STATE.md` not edited.

### Rollback

Revert the branch commits. The corrective migration has not been applied to hosted Supabase, so no hosted rollback is required.

### Next decision

Do not merge until all four exact-head CI jobs (`build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, `dev-advisory-report`) are green on the final head. S1.5 begins only after this PR is green and merged.

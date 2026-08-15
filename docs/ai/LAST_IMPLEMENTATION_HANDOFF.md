# Last Implementation Handoff

## S2.4 — Governed Inventory Cost Basis

### Lineage and authority

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s2-4-governed-inventory-cost-basis`.
- Exact base SHA: `33d182eb787df76f0af3119af2d17402fc9975a7`.
- Release authority: draft PR only. No merge, hosted migration, Railway change,
  deployment, production restart, or production data action is authorized.
- `docs/ai/CURRENT_STATE.md` is untouched.

### Implemented database slice

One forward-only migration,
`20260812000100_governed_inventory_cost_basis.sql`, adds:

- versioned `inventory_cost_basis` unit layers at item-or-lot subject,
  receipt-inventory-link, source-unit ordinal, and currency grain;
- normalized `inventory_cost_basis_contributions`, retaining the independent
  cost component, optional confirmed allocation, receipt line, and inventory
  link for every contributed amount;
- append-only `inventory_cost_basis_events` for effective recompute runs and
  per-row creation/supersession history;
- `recompute_inventory_cost_basis(uuid)`, protected by workspace role checks,
  an advisory transaction lock, a deterministic SHA-256 input hash, algorithm
  version `1.0.0`, guarded derived-table writes, and a unique partial index that
  forbids competing current truths;
- RLS member reads with no authenticated direct writes;
- `inventory_cost_basis_current` and
  `unresolved_inventory_cost_basis` read models.

Only `reconciled` receiving links contribute. Direct line costs retain a null
allocation identity; shared cost contributes only through confirmed, active
allocations. Candidate/reversed inputs do not contribute. Discounts are signed
negative and other component types positive. Authoritative arithmetic is bigint
minor units only.

Lot-managed layers use stable receipt-ordered FIFO. FIFO is an accounting
convention, not evidence of physical unit movement. Serialized lines use a
conserving `specific_unit_costs_minor` source-evidence array when present;
otherwise their aggregate line costs use deterministic equal attribution in
stable item order. Remainders go to earlier governed unit ordinals (100/3 =
34,33,33). Currency layers never blend.

The acquisition line's expected quantity is always the denominator. A 6-of-10
reconciled receipt receives 60% of each eligible component, not 100%. Remaining
expected quantity stays pending in the unresolved read model. Overreceipt units
receive explicit unresolved basis rows with null money, never zero or a diluted
share of source cost.

### Tests and evidence

- Mandated standalone test 15 passed: 4/4 assertions.
- New `67_governed_inventory_cost_basis.sql`: 28/28 assertions, including RLS,
  direct-write guards, reconciled-only derivation, cost eligibility, discounts,
  the partial-receipt regression, deterministic remainder, FIFO, both serialized
  attribution modes, unresolved/overage, currency separation, provenance and
  quantity conservation, no-op hashing, supersession, and genuine overlapping
  password-aware dblink calls.
- Full plain-PostgreSQL suite: 67 files, 2579 assertions, all passed.
- The stale phase-boundary assertions in tests 06 and 64 now recognize S2.4.
- Test 66's pre-existing race-H timestamp assertion used transaction timestamps
  as if they were lock order and failed intermittently. It now asserts the
  durable invariant: receiving evidence exists exactly when that concurrent
  receiving caller succeeded. Focused 58/58 and the subsequent full suite pass.
- `npm run typecheck`: passed.
- `npm test`: server 686, client 1431, node guards 23; all passed.
- `npm run build:ci`: passed (existing Vite chunk-size warning only).
- `git diff --check`: passed.

Earlier validation attempts and limitations are recorded honestly: the first
`npm run typecheck` failed because the work order's root-only `npm ci` does not
install client/server dependencies; `npm ci --prefix client` and
`npm ci --prefix server` repaired the environment without repository changes.
Two earlier full DB attempts exposed stale phase assertions and the race-H test
flaw; both were corrected and the final full run is green.

### Delivery status

- Draft PR and exact-head CI: to be recorded after commit/push.
- Live Supabase migration count/parity: not checked; not authorized.
- Railway deployment and `/api/version`: not checked; not authorized.
- Hosted acceptance: not applicable (no client/server route) and not authorized.
- Production data touched: none.
- Rollback: revert the feature commit before merge; after any separately
  authorized deployment, use a new forward migration rather than editing this
  migration.

### Exact next owner decision

After the draft PR has fresh exact-head success for `build-and-verify`,
`shadow-db-postgres-shim`, `shadow-db-supabase-stack`, and
`dev-advisory-report`, decide whether to merge S2.4. Do not begin S2.5 from this
handoff.

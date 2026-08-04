# Commercial Core & Legacy Retirement — Program Charter

Phase 0 deliverable 1 of 8. Analysis and architecture only; no runtime behavior,
hosted system, or business data was changed to produce it.

Base commit audited: `885db791f98ef036ba5d6a028b5370802476c5d8` (`origin/main`).
Repository migration count at that commit: **60** (counted from
`supabase/migrations/*.sql`, not quoted from a document).

---

## 1. Mission

Replace every remaining useful SQLite capability with a governed,
Supabase-native capability that is measurably better than the one it retires,
reconcile the historical data record-by-record rather than by totals, and then
remove `better-sqlite3` from the production runtime under a stated, checkable
condition for each surface.

Removal is the *last* step of each domain, never the first. A legacy page is
deleted because something better already carries its work and the evidence
proves it — not because it looks old.

## 2. The two-system problem, stated precisely

This repository runs two persistence systems in one Express process.

| | Legacy | Governed |
|---|---|---|
| Store | SQLite `vault.db` via `better-sqlite3` (`server/src/db.ts`) | hosted Supabase PostgreSQL |
| Reached through | `server/src/routes/{inventory,purchases,costLinks,listings,sales,dashboard,checks,lookups}.ts` | `server/src/routes/{provenance,acquisition,inventoryIdentity,intake,locations,cycleCounts,media,listingPrep,operationsDashboard}.ts` |
| Authorization | none beyond `legacyWriteGuard` | caller JWT → workspace membership → role → RLS → `SECURITY DEFINER` |
| Money | SQLite `REAL` (float) | `bigint` minor units + explicit ISO-4217 currency |
| Identity | string ids minted by `nextId()` scanning the table | governed `RV-*` public ids minted in the database |
| History | overwritten in place | append-only |
| Reachability | **always mounted, no flag** | only when `VITE_SHADOW_AUTH=supabase` + `VITE_SHADOW_IMPORT=repository-fixtures` + Supabase URL/key are all present |

The asymmetry in the last row is the load-bearing problem. The governed system
is optional; the legacy system is not. A deployment that loses its shadow
configuration silently falls back to an unauthenticated, unaudited,
float-money application that still accepts writes at boot (see
§ "Boot-time writes" in `01_LEGACY_SURFACE_CENSUS.md`).

The two systems are also **not** connected. Nothing in the repository migrates a
legacy row into the governed model. The governed model has no listing
publication, no order, no fee, no payout, and no realized-profit concept at all;
the legacy model has all of them, badly. So today the business's *commercial*
lifecycle is served only by the non-authoritative system, and its *inventory*
lifecycle only by the authoritative one. Neither is complete.

## 3. Target end state

One system. Supabase is authoritative for the entire commercial lifecycle.
`better-sqlite3` is not a dependency of `server/package.json`. `vault.db` is not
created, read, or written by the running service. The legacy client routes do
not exist. Every capability that was worth keeping exists in a governed form
that is workspace-scoped, RLS-protected, append-only where it records history,
and denominated in integer minor units.

## 4. Commercial lifecycle to be supported

The program is scoped by this lifecycle. Every proposed entity in
`03_TARGET_COMMERCIAL_ARCHITECTURE.md` must attach to at least one step; an
entity that attaches to none is out of scope.

```
Acquire
  └─ Receive
      └─ Identify
          └─ Allocate cost
              └─ Photograph
                  └─ Prepare listing
                      └─ Generate listing
                          └─ Publish
                              └─ Synchronize
                                  └─ Sell
                                      └─ Pick and pack
                                          └─ Ship
                                              └─ Reconcile fees and payout
                                                  └─ Handle cancellations, refunds, returns
                                                      └─ Exit or restore inventory
                                                          └─ Calculate realized profit
                                                              └─ Produce recommendations
```

Current coverage against that chain, from repository evidence:

| Step | Governed today | Legacy today | Gap |
|---|---|---|---|
| Acquire | `acquisition_orders`, `acquisition_line_items`, staging RPCs | `whatnot_purchases` (browse + type tag) | no owner-facing acquisition entry; no supplier performance |
| Receive | — | — | **absent in both** |
| Identify | `product_catalog` → `sellable_skus` → `inventory_lots` → `inventory_items` | `inventory_lots` flat table | governed side complete |
| Allocate cost | `acquisition_cost_components`, `acquisition_cost_allocations`, `propose_/confirm_/reverse_cost_allocation` | `cost_links` | no inventory-level cost basis / COGS read model |
| Photograph | `inventory_media` + readiness + issues | `photos_complete` text column | governed side complete |
| Prepare listing | `listing_prep` + checks + readiness + presets | `ebay_listings` Draft rows | governed side complete |
| Generate listing | — | — | **absent in both** |
| Publish | — | manual `listing_status` text edit | **absent in both** |
| Synchronize | — | — | **absent in both** |
| Sell | — | `sales` table | legacy only, non-authoritative |
| Pick / pack / ship | — | `fulfillment_status`, `tracking_number` text | legacy only |
| Fees / payout | — | `ebay_fees`, `promotion_fees` floats | legacy only, no payout concept |
| Cancellations / refunds / returns | — | `refund_amount`, `return_status` text, not editable after creation | legacy only, materially broken |
| Inventory exit / restore | `record_inventory_item_loss`, `adjust_lot_quantity` | `sold_quantity` arithmetic | no sale-driven exit |
| Realized profit | — | `profit_after_known_costs` snapshot | legacy only, materially broken |
| Recommendations | `get_operations_inventory_health`, `inventory_work_queue` | — | operational only, no commercial |

## 5. Governance principles

These are inherited from `docs/architecture.md` and
`docs/ai/ENGINEERING_RULES.md` and are not renegotiated by this program.

1. **Workspace-scoped data.** `workspace_id` is `NOT NULL` on every business
   table and participates in composite foreign keys so cross-workspace
   references are impossible at the constraint level.
2. **Caller-token authorization.** Every read and mutation runs under the
   caller's own JWT. `SECURITY DEFINER` functions re-derive the caller and check
   membership and role; a client-supplied workspace id is never trusted
   unchecked.
3. **RLS on every table.**
4. **Database-enforced multi-row invariants.** Conservation of a source total
   across its allocations, non-oversale of a lot, one active listing per
   sellable unit — all enforced in PostgreSQL, never only in TypeScript.
5. **Append-only evidence.** Corrections are supersessions and reversals, not
   `UPDATE`s over history.
6. **Explicit state machines** with transition functions, not free-text status
   columns.
7. **Integer money in minor units, plus an explicit currency column,** on every
   priced row. Never a float. Never an implied currency.
8. **Database-held idempotency keys.** A key held in browser memory proves
   nothing.
9. **Stable public ids.** `RV-*`, minted in the database. No raw UUID in
   owner-facing UI.
10. **Revoke, don't drop.** A deprecated function is revoked from every
    application role so a hosted database that already has it is unchanged while
    nothing can still call it.
11. **Visible dependency failure.** A missing function or unreachable dependency
    renders as a named failure, never as a fabricated `0`.
12. **Current work separated from history.** Operational queues contain only
    current stock; historical detail resolves through its own functions.
13. **No service-role key in the browser.**

## 6. The no-dual-write rule

**At no point may SQLite and Supabase both be able to mutate the same business
fact.**

The cutover pattern for every domain is therefore three-state, never two:

```
 legacy authoritative      →  governed authoritative      →  governed only
 governed absent/shadow       legacy READ-ONLY               legacy removed
```

Transition 1 is a single atomic change per domain: the governed write path is
enabled *and* the legacy write path is revoked in the same pull request. There
is no interval in which both accept writes.

"Legacy read-only" is implemented by **removing the route handler for every
non-safe method on that domain's router**, not by relying on
`ALLOW_LEGACY_WRITES`. The environment variable is an operator switch that can
be flipped back; a deleted handler cannot. `ALLOW_LEGACY_WRITES` is
insufficient today for an additional reason recorded in the census: the boot
sequence writes to SQLite before the guard is ever installed.

Shadow comparison — running both systems and diffing their outputs — is
permitted and encouraged, but only in the direction *governed reads compared
against legacy reads*. A shadow **write** to both stores is prohibited.

## 7. Data preservation rules

1. **No imported source row is ever deleted.** The destructive startup `DELETE`
   that removed rows from production was replaced by an `is_excluded` flag
   (`server/src/db.ts:230` `flagFoodPurchases`). That fix stops further loss; it
   restores nothing.
2. **Aggregate agreement is not reconciliation.** Two systems reporting the same
   total is not evidence that the same rows are present. Every import is
   reconciled by key and by content.
3. **The 2,149 / 2,119 difference is unadjudicated.** The repository seed
   `server/seed/whatnot_purchases.json` has 2,149 rows with 2,149 distinct
   `acquisition_line_id` values, of which exactly 30 carry
   `business_vertical = 'Food / consumables'`. The owner-verified production
   backup has 2,119 rows. The difference is 30, and the food-row count is 30.
   **These two facts have not been connected by any row-level comparison, and
   this program does not assume they refer to the same 30 rows.** They may
   overlap fully, partially, or not at all.
4. **Restoration requires prior adjudication.** The seed may be used as a
   restoration source only after an exact `acquisition_line_id` and content
   reconciliation against the backup, as a separate, backup-protected,
   idempotent, owner-reviewed procedure.
5. **Import is idempotent.** Re-running an import produces the same governed
   rows, never duplicates. Idempotency is held in the database.
6. **Evidence outlives its subject.** Source records, marketplace request and
   response payloads, and reconciliation outcomes are retained after the
   operational row they justify has been superseded.

## 8. Marketplace action rules

1. Every outbound marketplace call records a durable request and response
   record before its effect is treated as real.
2. Every marketplace mutation carries a database-held idempotency key. A
   timeout is resolved by replay against that key, never by re-issuing a fresh
   request.
3. **Publication is owner-approved.** No automated process publishes, revises
   the price of, ends, or relists an item without an explicit owner approval
   recorded against that specific action.
4. Credentials live server-side only. No OAuth token, refresh token, or client
   secret is ever sent to the browser.
5. Marketplace state is *reconciled*, not assumed. A local listing status is a
   claim about the marketplace that must be re-verified on a schedule and on
   conflict.
6. A marketplace conflict (the remote state disagrees with the local state)
   raises an exception record for owner adjudication. It is never silently
   overwritten in either direction.

## 9. AI approval and provenance rules

1. **Evidence-bound generation.** Every generated statement records which
   governed facts supported it — the specific item, lot, media, cost, and
   valuation rows read. A claim with no supporting governed fact is not
   emitted.
2. **Model and prompt provenance.** Model identifier, prompt version, and
   parameters are recorded on every generation request.
3. **Missing evidence is stated, not filled.** When a required fact is absent,
   the generation records it as missing. It never invents condition, grade,
   authenticity, completeness, provenance, or measurement.
4. **Human approval before external effect.** Generated content becomes listing
   content only through an explicit owner approval. Rejections are retained with
   their reason — a rejected generation is training evidence, not garbage.
5. **Prohibited autonomous actions**, enumerated and enforced: publishing,
   repricing, ending, relisting, refunding, accepting an offer, issuing a
   return authorization, or altering an inventory quantity.
6. **No silent assertion.** AI-authored text is labeled as such in every surface
   that renders it before approval.

## 10. Cutover philosophy

- **Domain by domain, never big-bang.** Each domain crosses independently.
- **Schema before behavior.** A migration that only adds structure ships and
  soaks before the functions that write through it.
- **Dangerous writes are their own pull request.** Anything that calls an
  external marketplace with financial effect is separated from the schema work
  that enables it, so a revert is narrow.
- **Import before cutover.** Historical data is imported and reconciled while
  the legacy system is still authoritative, so the comparison has a control.
- **Shadow read comparison is the gate,** not a smoke test. A domain crosses
  when governed reads reproduce legacy reads record-for-record on the agreed
  key set, and the differences that remain are individually explained.
- **The rollback is a revert, not a restore.** Because import is additive and
  idempotent and the legacy store is untouched until read-only, backing out a
  cutover means reverting the pull request that revoked the legacy write path.
- **Retention outlives removal.** Legacy tables are retained read-only for an
  owner-approved period after the governed system is authoritative, and are
  dropped only after that period elapses with no adjudication outstanding.

## 11. Definition of completion

The program is complete when **all** of the following are simultaneously true
and each is independently checkable:

1. `better-sqlite3` does not appear in `server/package.json` dependencies.
2. No file under `server/src/` imports `./db.js`.
3. `server/src/index.ts` mounts no router backed by SQLite, and
   `seedIfEmpty()` / `migrateProductType()` are not called at boot.
4. `client/src/App.tsx` declares no route in the legacy set
   (`/inventory`, `/purchases`, `/cost-links`, `/listings`, `/sales`,
   `/checks`) and no `LEGACY_NAV` / `LEGACY_ONLY_NAV` array.
5. Every row in `02_LEGACY_REPLACEMENT_MATRIX.md` has reached its stated
   removal condition, with the evidence recorded.
6. Every legacy financial figure the owner still relies on is reproducible from
   governed data, in integer minor units, with a stated currency, and its
   derivation is documented.
7. The historical reconciliation ledger has no unadjudicated rows.
8. The retention period for each legacy table has elapsed and the owner has
   approved its drop.
9. CI is green on all four required jobs, and the hosted Supabase migration
   ledger has been verified at parity by the owner through
   `docs/runbooks/hosted-migration-parity.md`.
10. The lifecycle in § 4 has no row whose "Gap" column still reads "absent in
    both".

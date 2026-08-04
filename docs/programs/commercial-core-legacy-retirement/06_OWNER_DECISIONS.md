# Owner Decisions

Phase 0 deliverable 7 of 8.

Twenty decisions that genuinely require the owner: they turn on business facts,
financial policy, irreversible consequences, or physical knowledge that no
amount of code reading can supply. Ordinary engineering choices are **not**
listed here — § 3 records what was deliberately kept off this list, so the
filter is visible.

Each decision carries a recommendation. The recommendation is not the decision.

---

## 1. Blocking decisions, in the order they are needed

| ID | Question | Blocks | Latest safe point |
|---|---|---|---|
| **D-17** | Gate reseed-on-empty? | S0 | before S0 merges |
| **D-1** | How to adjudicate the seed↔backup difference | S3 | before S3 import |
| **D-2** | Restore adjudicated-missing rows, or not | S3 | with D-1 |
| **D-4** | Which of the 1,487 legacy lots are still physically held | S3 | before S3 inventory import |
| **D-5** | How the 279 "Serialized" legacy lots resolve | S3 | with D-4 |
| **D-8** | Cost basis method | S2 | before S2.4 merges |
| **D-7** | How legacy `Candidate` cost links are treated | S3 | before S3.7 |
| **D-12** | Sales-tax treatment in realized revenue | S8 | before S8.4 |
| **D-9** | Marketplace integration scope and account | S4 | before S4 |
| **D-10** | Publication approval model | S5 | before S5.3 |
| **D-16** | Retention period for legacy tables | S12 | before S12.2 |
| **D-19** | Volume decommission | S12 | after S12 retention |

Non-blocking: D-3, D-6, D-11, D-13, D-14, D-15, D-18, D-20 — each has a
defensible default the team will apply unless the owner says otherwise.

---

## 2. The decisions

---

### D-17 — Should reseed-on-empty be gated?

**Question.** Today, if the SQLite database is empty at boot — a lost volume, a
remount, a fresh container without persistent storage — the server silently
repopulates five tables from the repository JSON: 1,487 inventory lots, 2,149
purchase lines, 287 cost links, 20 listings, 7 checks. Should that stop?

**Why it matters.** This is the single largest live risk to the whole program.
A silent reseed would overwrite production state with the initial import, and
would reinstate the 30 food rows the production database may not contain —
destroying the exact comparison D-1 depends on. It would *not* restore the
`sales` table, which has no seeder, so recorded sales would be lost outright
while everything else looked superficially fine. That combination — most data
plausibly restored, one table silently gone — is the worst possible failure
mode, because it does not look like a failure.

**Options.**
1. Gate it behind an explicit opt-in that production does not set. A lost volume
   then yields a visibly empty app.
2. Leave it as is.
3. Remove the seeder entirely.

**Recommendation: option 1.** An empty app is an obvious, recoverable problem.
A silently reseeded app is an invisible, unrecoverable one. Option 3 breaks
local development and eleven tests for no additional safety.

**Consequences.** If the volume is lost, the app shows no legacy data until the
owner restores from backup. That is the intended behaviour.

**Blocks:** S0. **Latest safe point:** before S0 merges — and S0 blocks
everything.

---

### D-1 — How should the seed↔backup difference be adjudicated?

**Question.** The repository seed holds 2,149 Whatnot purchase rows; the verified
production backup holds 2,119. Exactly 30 seed rows are `Food / consumables`.
The difference is also 30. **Whether these are the same 30 rows has never been
checked.** How should this be settled?

**Why it matters.** Every acquisition, cost, and profit figure downstream
depends on which purchase lines exist. If 30 non-food rows were lost and 30 food
rows are still present, the production spend record is wrong in both directions
and the error propagates into every cost allocation built on it.

**Options.**
1. Run the full key-level comparison in `04_RECONCILIATION_AND_CUTOVER_PLAN.md`
   § 3 and report all five figures, whatever they show.
2. Assume the coincidence, treat the 30 as food, and import the 2,119.
3. Import all 2,149 and mark the extra 30 excluded.

**Recommendation: option 1.** It is a bounded, read-only comparison over two
files, and it is the only option that produces an answer rather than an
assumption. `docs/architecture.md:46-52` already records that the question is
open; option 2 would be the first document in the repository to close it without
evidence.

**Consequences.** Option 1 costs one comparison run and an owner review session.
Option 2 risks silently propagating a wrong acquisition record into every cost
figure the business relies on. Option 3 pollutes the governed record with rows
production deliberately or accidentally does not have.

**Blocks:** S3. **Latest safe point:** before the S3 acquisition import.

---

### D-2 — Should adjudicated-missing rows be restored?

**Question.** Once D-1 identifies which keys are in the seed and not the backup,
should those rows be imported into the governed model?

**Why it matters.** Restoring a row that was deliberately removed re-introduces
noise into spend totals. Not restoring a row that was accidentally deleted
permanently loses a real acquisition — and with it, the cost basis of whatever
stock it bought.

**Options.**
1. Restore per key, on an owner verdict each.
2. Restore all missing keys.
3. Restore none.

**Recommendation: option 1**, because the answer almost certainly differs per
row. Food rows the owner ate are noise; a genuine card purchase deleted by the
old startup `DELETE` is a real loss. A blanket rule gets one of the two wrong.

**Consequences.** Per-key adjudication needs owner time proportional to the size
of the difference set — likely 30 rows, likely one session.

**Blocks:** S3. **Latest safe point:** with D-1.

---

### D-4 — Which of the 1,487 legacy inventory lots are still physically held?

**Question.** All 1,487 rows carry `record_origin = 'Imported Legacy'` and were
a point-in-time spreadsheet snapshot. Which represent stock that still exists?

**Why it matters.** Importing all 1,487 unconditionally creates governed
inventory for items that may have been sold, given away, or discarded before the
Vault existed. Governed inventory that does not physically exist corrupts every
count, every valuation, and every cycle count from that day forward — and cycle
count is already shipped and in use.

**Options.**
1. Owner triages every row: still held / disposed / unknown. Only *still held*
   imports as current; the rest import as historical evidence with zero current
   quantity.
2. Import all as current and correct by cycle count afterwards.
3. Import none as current; treat all 1,487 as history and re-enter real stock
   through governed intake.

**Recommendation: option 1 for high-value rows, option 3 for the long tail.**
A defensible split: the owner triages rows above an agreed value threshold
individually; everything below it imports as historical evidence and is
re-entered through intake if it turns up. This bounds the owner's time to the
rows where being wrong is expensive.

**Consequences.** Option 2 pushes the problem into cycle count, which is
designed to find discrepancies in real stock, not to delete phantom records —
it would generate a large volume of unresolvable discrepancies. Option 3 alone
loses the location and attribute data already captured for genuinely held stock.

**Blocks:** S3. **Latest safe point:** before the S3 inventory import.

---

### D-5 — How should the 279 "Serialized" legacy lots resolve?

**Question.** 279 of the 1,487 seed rows carry `tracking_mode = 'Serialized'`,
but the legacy schema has no per-unit rows at all —
`reserved_child_id` / `active_child_id` are placeholders nothing populates.
Should each become *n* governed `inventory_items`, or a `lot_managed` lot?

**Why it matters.** The governed model counts serialized items and lot-managed
quantities on different grains and deliberately never sums both for the same
physical stock. Getting this wrong either double-counts inventory or loses the
per-unit identity (grade, certification number, serial) that makes a graded slab
individually sellable.

**Options.**
1. Every serialized legacy lot becomes *n* governed items.
2. All become lot-managed; serialize later on demand.
3. Serialize only rows carrying a `certification_number` or `serial_number`;
   the rest become lot-managed.

**Recommendation: option 3.** It uses the evidence already in the data. A row
with a certification number is a specific graded object and needs an identity; a
row with `quantity = 6` and no per-unit identifiers has no serial information to
preserve and gains nothing from being split into six anonymous items.

**Consequences.** Option 1 creates hundreds of items with no distinguishing
attributes, which the owner then has to tell apart physically. Option 2 loses
grading identity for slabs, which is the most commercially significant attribute
in the collection.

**Blocks:** S3. **Latest safe point:** with D-4.

---

### D-8 — What cost basis method?

**Question.** When a lot receives cost from several acquisitions at different
prices, and units are sold over time, which cost applies to a sale?

**Why it matters.** This determines every COGS figure and every realized-profit
number the business will ever report. It is the most consequential single
technical decision in the program, and in practice it is irreversible: once
historical data is imported under one method and profit has been reported,
changing it restates history.

Legacy uses `confirmed_cost_basis / lot.quantity × quantity_sold` — a lot
average, and a broken one, because it divides by the *total* quantity even when
only part of the lot is costed (defect C-6).

**Options.**
1. **FIFO layers** — each receipt is a layer; sales consume oldest first.
2. **Weighted average** — one blended cost per lot, recomputed on each receipt.
3. **Specific identification** — each unit carries its own acquisition cost.

**Recommendation: FIFO for lot-managed stock, specific identification for
serialized items.** Serialized units already have identity, so the specific cost
is knowable and is the most accurate figure available. FIFO for lot-managed
stock matches how the inventory physically moves and how a small resale business
is normally reported. The `inventory_cost_basis` design in
`03_TARGET_COMMERCIAL_ARCHITECTURE.md` § 2.2 already carries `layer_seq`, so
this recommendation is what the schema is shaped for.

**Consequences.** Weighted average is simpler but blurs the margin on a
individually-sourced item, which is exactly the figure this business needs.
Specific identification for everything is impossible for lot-managed stock where
units are interchangeable.

**Blocks:** S2. **Latest safe point:** before S2.4 merges — it defines the
schema.

---

### D-7 — How should legacy `Candidate` cost links be treated?

**Question.** The seed holds 287 cost links, all `Candidate`; production may hold
`Confirmed` and `Rejected` rows too. `Confirmed` clearly imports as confirmed
allocations and `Rejected` as historical evidence. What about `Candidate`?

**Why it matters.** A candidate is an unreviewed proposal. Importing it as a
governed candidate carries forward matching work; discarding it loses it. But
legacy candidates were produced by a matcher whose confidence and method are
recorded as free text, so their quality is unknown.

**Options.**
1. Import as governed `candidate` allocations, preserving the original
   `match_confidence` and `match_method` as evidence.
2. Discard; re-propose using the governed matcher.
3. Import as evidence only, and re-propose.

**Recommendation: option 3.** The original proposals are preserved and
inspectable, but the active queue is generated by the governed matcher whose
confidence semantics are defined. This avoids the owner confirming a
governed-looking allocation whose confidence actually came from an undocumented
legacy heuristic.

**Consequences.** Option 1 makes legacy matching quality look governed. Option 2
loses the record of what was proposed and why.

**Blocks:** S3. **Latest safe point:** before S3.7.

---

### D-12 — Should marketplace-collected sales tax count as revenue?

**Question.** Legacy adds `sales_tax_collected` into net proceeds as income
(`server/src/routes/sales.ts:62`). eBay collects and remits marketplace
facilitator tax; the seller never receives it. Should governed realized revenue
exclude it?

**Why it matters.** Including it overstates revenue and overstates profit by the
full tax amount on every sale. Every historical figure the owner has seen from
the legacy Sales page is inflated by this. Correcting it will make the new
numbers look *worse* than the old ones, and the owner should understand why
before that happens rather than after.

**Options.**
1. Exclude marketplace-remitted tax from revenue; report it separately as a
   pass-through.
2. Keep legacy behaviour for continuity.
3. Exclude going forward; leave historical archived figures as they were, marked
   as a legacy assertion.

**Recommendation: option 1, with option 3's archival treatment.** Exclude it
everywhere in governed figures, and preserve the legacy figures verbatim in
`legacy_sale_archive` labelled as what the legacy system asserted — so the
difference is explainable rather than mysterious.

**Consequences.** Reported profit drops. That is a correction, not a regression,
and the comparison report in S8.6 attributes each sale's difference to this
defect by name.

**Blocks:** S8. **Latest safe point:** before S8.4.

---

### D-9 — What is the marketplace integration scope, and which account?

**Question.** Which marketplace(s), which specific selling account, and which
API scopes should the system be granted?

**Why it matters.** It determines the credential boundary, what the system can
do on the owner's behalf, and the blast radius of a bug. A token with selling
scopes on a live account can create real obligations.

**Options.**
1. eBay only, one account, read scopes first; selling scopes added at S5.
2. eBay only, full scopes from S4.
3. Multiple marketplaces from the start.

**Recommendation: option 1.** It matches the S4→S6→S5 execution order: the
integration is proven read-only against real data before it can write anything.
Option 3 multiplies the surface before any of it is proven once.

**Consequences.** Option 1 requires a second owner authorization at S5, which is
a feature. Option 2 means a bug in S4 or S6 could write to eBay.

**Blocks:** S4. **Latest safe point:** before S4.

---

### D-10 — What is the publication approval model?

**Question.** Publishing, revising a price, ending, and relisting each create or
alter a public commercial offer. What must the owner approve, and at what
granularity?

**Why it matters.** This is the boundary between a tool that helps and a tool
that acts. It is also the hardest thing to loosen safely later and the easiest
to tighten, so starting strict is cheap.

**Options.**
1. Every action individually owner-approved.
2. Batch approval — approve a set of listings at once.
3. Standing approval within owner-set bounds (e.g. price changes within ±10%).

**Recommendation: option 1 for S5, revisit after real use.** The charter's
prohibited-autonomous-action list is enforced by
`marketplace_publish_requests.approved_by` being non-null before dispatch, which
is a simple, testable, hard boundary. Option 2 is a reasonable second step once
the owner has published enough items to know the failure modes. Option 3 should
not be considered until there is operating history.

**Consequences.** Option 1 is more clicks. Options 2 and 3 create a window where
an automated process alters a live commercial offer without a contemporaneous
human decision.

**Blocks:** S5. **Latest safe point:** before S5.3 (the approval gate PR).

---

### D-16 — How long are legacy tables retained after cutover?

**Question.** After a domain crosses and its legacy write path is deleted, how
long do the legacy tables stay before removal?

**Why it matters.** Retention is what makes a late rollback possible. Removing
early saves nothing meaningful; removing late costs nothing but a little
storage.

**Options.**
1. 90 days after the last domain cuts over.
2. 30 days.
3. Indefinite; archive only, never drop.

**Recommendation: option 1, plus a permanent archived backup.** Ninety days
covers a full quarter of operation, which is long enough for a
seasonal or accounting-cycle problem to surface. The verified backup archive
(D-19) is permanent regardless, so option 3's benefit is already obtained
without keeping a live database around.

**Blocks:** S12. **Latest safe point:** before S12.2.

---

### D-19 — When is the Railway volume decommissioned?

**Question.** After SQLite is removed from the code, when is the persistent
volume detached?

**Why it matters.** **This is the one irreversible infrastructure action in the
program.** Detaching the volume destroys the live SQLite database. After that,
only the archived backup exists.

**Options.**
1. Detach only after the D-16 retention period elapses, and only after a final
   backup is captured, verified with `scripts/verify-sqlite-backup.mjs`, and
   archived with a recorded SHA-256.
2. Detach with the code removal.
3. Keep the volume indefinitely.

**Recommendation: option 1.** Code removal and volume detachment are separated
by the full retention period, so a rollback during retention still has live data
to work from. Option 3 pays a small ongoing cost for an option the archived
backup already provides.

**Consequences.** Option 2 makes the code-removal PR irreversible, which is
exactly the coupling the program's rollback design avoids.

**Blocks:** S12 completion. **Latest safe point:** after the retention period.

---

### D-3 — Should free-field legacy inventory editing be discontinued?

**Question.** `PATCH /api/inventory/:id` lets the owner edit 28 fields directly.
The governed model replaces this with correction requests, review, and
supersession. Should direct editing be discontinued rather than reproduced?

**Why it matters.** It is a real reduction in immediacy in exchange for a real
gain in auditability. The owner should choose it knowingly rather than discover
it.

**Options.** 1. Discontinue; governed corrections only. 2. Reproduce
free-field editing in the governed model. 3. Allow direct edits on
non-identity fields, corrections for identity fields.

**Recommendation: option 1.** Every legacy edit is invisible — no history, no
reason, no reviewer. The governed correction workflow already exists, is
shipped, and is in use. Option 3 sounds like a compromise but requires drawing
a line between "identity" and "non-identity" fields that will not survive
contact with real cases.

**Non-blocking.** Default: option 1. **Latest safe point:** before S3 cutover.

---

### D-6 — What is the acquisition classification taxonomy?

**Question.** `server/src/classify.ts` produces ten types: `Slab`, `Single`,
`Sealed`, `Sneakers`, `Apparel`, `Accessories`, `Electronics`, `Collectibles`,
`Other`, `Unreviewed`. Is that the taxonomy going forward, and are the three
hardcoded seller specializations still accurate?

**Why it matters.** It drives spend reporting and is owner-asserted ground truth
that lives in a code constant today (`classify.ts:48-52`) with no record of who
asserted it or when.

**Options.** 1. Keep the ten as governed reference options; migrate the seller
specializations to `classification_rules` with recorded rationale.
2. Redesign the taxonomy. 3. Keep, and freeze the specializations as they are.

**Recommendation: option 1.** The taxonomy is settled and working; what needs
fixing is where it lives, not what it says. Making it reference data means the
owner can extend it without a deploy.

**Non-blocking.** Default: option 1. **Latest safe point:** before S1.1.

---

### D-11 — What is the order-ingestion source and backfill horizon?

**Question.** Should governed orders be ingested only going forward, or
backfilled from eBay history? If backfilled, how far?

**Why it matters.** Backfill determines whether historical sales can be
reconstructed from marketplace truth or remain archive-only assertions. eBay's
order history retention is finite, so the window is not entirely the owner's to
choose.

**Options.** 1. Backfill as far as the eBay API allows; forward-only beyond
that. 2. Forward-only. 3. Backfill a fixed period (e.g. 24 months).

**Recommendation: option 1.** Every reconstructable order is one more legacy
sale whose profit can be independently verified rather than merely archived.

**Non-blocking.** Default: option 1. **Latest safe point:** before S6.3.

---

### D-13 — What is the return disposition policy?

**Question.** When a returned item arrives, what are the allowed outcomes and
who decides?

**Why it matters.** It determines whether returned stock re-enters at its
original cost basis, impaired, or not at all — which flows into COGS and
realized profit.

**Options.** 1. Owner decides per return from a fixed set (`restock_sellable`,
`restock_damaged`, `dispose`, `return_to_supplier`, `keep_for_parts`).
2. Automatic restock unless flagged. 3. Owner decides, with a default by
return reason.

**Recommendation: option 3.** A defaulted decision the owner can override keeps
the common case fast without making an automatic assumption about physical
condition — which nothing in software can observe.

**Non-blocking.** Default: option 3. **Latest safe point:** before S7.3.

---

### D-14 — Where should data-quality exceptions reach the owner?

**Question.** In-app queue only, or also email / push?

**Why it matters.** An exception nobody sees is not a control. But an alert
channel that fires too often gets muted, which is worse than no alert.

**Options.** 1. In-app queue only. 2. In-app plus daily digest. 3. In-app plus
immediate alerts for `financial`-materiality findings only.

**Recommendation: option 3.** Financial findings are rare and consequential;
everything else waits for the queue.

**Non-blocking.** Default: option 3. **Latest safe point:** before S10.3.

---

### D-15 — Which legacy dashboard figures actually matter?

**Question.** The legacy dashboard shows lot count, available units, recorded
value, confirmed cost basis, uncosted/costed counts, active listings, draft
count, recorded sales, net proceeds, profit, units sold, purchase totals,
remaining cost, reconciliation counts, allocation counts, check counts, recent
sales, recent purchases, and value by vertical. Which does the owner actually
use?

**Why it matters.** Reproducing all of them wastes effort on figures nobody
reads, and several are computed on inconsistent populations
(C-11) so reproducing them faithfully would carry the inconsistency forward.

**Options.** 1. Owner nominates the figures they use; the rest are dropped and
the replacements get stated population rules. 2. Reproduce all. 3. Design fresh
from the target lifecycle and let the owner flag anything missing.

**Recommendation: option 1 combined with option 3** — the owner nominates what
they use, the team designs the rest from the lifecycle, and nothing is
reproduced merely because it exists today.

**Non-blocking.** Default: ask at S11 planning. **Latest safe point:** before
S11.2.

---

### D-18 — Who owns the reference lists, and can their values change?

**Question.** `server/seed/lookups.json` holds 13 fixed lists (business
verticals, categories, tracking modes, statuses). In the governed model these
become `reference_lists` / `reference_options` that can be edited without a
deploy. Should the owner be able to add and retire values?

**Why it matters.** Editable reference data is more useful and more dangerous:
retiring a value that historical rows still reference must not orphan them.

**Options.** 1. Owner may add; retiring requires no historical references.
2. Fixed, migration-only. 3. Fully owner-editable including deletion.

**Recommendation: option 1.** Additive change is safe and useful; deletion is
not, and retirement-with-a-reference-check gives the same benefit without the
risk. This is the pattern `retire_storage_location` already uses.

**Non-blocking.** Default: option 1. **Latest safe point:** before S3.

---

### D-20 — Is more than one currency in use?

**Question.** Every legacy money field is a bare `REAL` with no currency. Does
the business transact in more than one currency — buying, selling, or being paid
out?

**Why it matters.** The answer determines whether an `fx_rates` entity and
conversion semantics are needed. Building multi-currency machinery for a
single-currency business is waste; retrofitting it later is expensive.

**Options.** 1. Single currency; every amount carries its explicit code, no
conversion machinery. 2. Multi-currency with recorded FX rates and explicit
conversion. 3. Single currency now, structured so option 2 is additive.

**Recommendation: option 3**, which is what the design already does: every
priced row carries its own currency, so a second currency becomes possible
without a migration to the money columns. Only the conversion layer would be
new.

**Non-blocking.** Default: option 3. **Latest safe point:** before S2.4.

---

## 3. Deliberately not escalated

Recorded so the filter applied to this document is visible. These were
considered and are **engineering choices the implementation team should make**,
not owner decisions.

| Choice | Team's default |
|---|---|
| FIFO layer implementation (one row per layer vs. a running ledger) | one row per layer, per `03_TARGET_COMMERCIAL_ARCHITECTURE.md` § 2.2 |
| Public-id prefixes for new entities | follow the existing `RV-*` convention |
| Whether cost basis is a table or a view | derived-but-stored, so COGS can reference a stable row |
| Polling interval for marketplace sync | start conservative; tune from observed rate limits |
| How `marketplace_categories` staleness is surfaced | `fetched_at` shown next to the value |
| Which pgTAP tier a new assertion targets | both, always — a single-tier assertion is a defect |
| Client state management for new pages | match the existing TanStack Query patterns |
| Whether to keep `scripts/verify-sqlite-backup.mjs` after removal | keep — it is how the archived backup stays checkable |
| Naming of the reconciliation ledger tables | team's choice |
| Page layout and navigation grouping for new surfaces | follow the existing shell conventions |

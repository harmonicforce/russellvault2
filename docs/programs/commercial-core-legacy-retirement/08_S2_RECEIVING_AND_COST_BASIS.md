# S2 — Receiving and Inventory Cost Basis

> **HISTORICAL — DESIGN-ONLY.** This is a point-in-time program design document,
> preserved as written. It is **not** a statement of current state. Its base
> commit, migration counts, phase status, and "not implemented" notes were true
> when written and have since moved on — much of the S1/S2/S3 work described here
> as future has shipped.
>
> For present state use `docs/ai/CURRENT_STATE.md` and the machine-readable
> `docs/ai/CURRENT_STATE.attestation.json`. For sequence use
> `docs/ai/PROJECT_ROADMAP.md`. Do not cite this file as evidence of what exists
> today, and do not rewrite its history to match the present.

Slice-level implementation note for **S2 — Landed cost and inventory cost
basis**. `05_IMPLEMENTATION_SEQUENCE.md` § S2 remains the authority on the
slice's objective, acceptance, and risk. This document records only the
decisions the implementation makes as each PR lands, so the next agent does not
have to re-derive them from SQL.

## 1. The six-PR sequence

| PR | Scope | State |
|---|---|---|
| **S2.1** | Governed receiving schema — `acquisition_receipts`, `acquisition_receipt_lines`, `acquisition_discrepancies` | complete |
| **S2.2** | Receiving mutation functions + behavioural pgTAP | **implemented** |
| S2.3 | Receiving UI (`/receiving`) | not started |
| S2.4 | Cost-basis schema + `recompute_inventory_cost_basis` + pgTAP (**the critical PR**) | implemented on `codex/s2-4-governed-inventory-cost-basis`; awaiting exact-head CI and owner merge decision |
| S2.5 | Cost-allocation owner surface (`/cost`) | not started |
| S2.6 | Unresolved-cost queue | not started |

Receiving is delivered before cost basis because a cost basis with no governed
receipt is exactly the legacy `cost_links` design the program exists to retire.

**D-8 (cost basis method) is resolved for S2.4.** Nothing in the receiving
schema presumes FIFO, weighted average, or specific identification.

## 2. What S2.1 establishes

Migration `20260807000100_s2_receiving_schema.sql`. Schema only.

### 2.1 The three facts

| Fact | Owner | Table |
|---|---|---|
| **EXPECTED** | acquisition import | `acquisition_line_items.quantity` |
| **OBSERVED** | receiving | `acquisition_receipt_lines.quantity_received` |
| **DIFFERENCE** | receiving | `acquisition_discrepancies` |

A difference is recorded as a new downstream fact. It never edits EXPECTED.

### 2.2 Grain

```
one acquisition order  ->  many receipts        (multiple physical deliveries)
one receipt            ->  many receipt lines   (several lines per delivery)
one acquisition line   ->  many receipt lines   (partial receiving; at most
                                                 one row per receipt)
```

The canonical receipt-line grain is `(receipt, acquisition line)`, pinned by
`acquisition_receipt_lines_receipt_line_uniq`. This is the idempotency key
`03_TARGET_COMMERCIAL_ARCHITECTURE.md` § 1.2 states for the table. Partial
receiving is expressed by *more receipts*, never by duplicated rows inside one
receipt.

### 2.3 Receipt is not shipment

S1.4's `acquisition_shipments` owns transport truth: carrier, tracking number,
shipped/expected/received timestamps, status, and transition history. None of
it is copied onto a receipt. A receipt that corresponds to a shipment carries
`acquisition_shipment_id` and nothing more.

- **Receipt** — what physically arrived.
- **Shipment** — transport and tracking state.

The association is enforced by a three-column composite foreign key
`(acquisition_shipment_id, acquisition_order_id, workspace_id)`, so a receipt
can never borrow another workspace's *or another order's* shipment. This
required one purely additive constraint on `acquisition_shipments`
(`acquisition_shipments_order_scoped_uniq`); `id` is already its primary key,
so every existing row satisfies it and no behaviour changed.

### 2.4 Receipt lifecycle

`open → submitted → reconciled`, with `cancelled` as the abandonment terminal —
the vocabulary the target architecture states, and nothing more. No speculative
warehouse-management states were added. A `submitted` or `reconciled` receipt
must carry `received_at`: a completed receipt asserting an arrival with no
arrival time is not evidence. A `cancelled` session may have none.

The lifecycle values exist in S2.1; the transitions between them are S2.2's.

### 2.5 Discrepancy evidence

`kind` and `status` are the approved architecture vocabularies exactly. No
`severity` column was created, because no severity vocabulary has been approved
and `06_OWNER_DECISIONS.md` escalates no discrepancy-taxonomy question.

A discrepancy always names an order, and optionally narrows to a receipt, a
receipt line, and an affected acquisition line. `never_arrived` therefore needs
no receipt at all.

`quantity_expected` and `quantity_observed` are deliberately **unordered**:
`observed > expected` is legitimate overage evidence and the schema must be able
to record the physical truth. *Being able to record evidence* and *being allowed
to turn that evidence into inventory* are separate questions; S2.2 owns the
second.

Recording a discrepancy is evidence, never a repair. It does not correct the
acquisition line, alter the receipt line it describes, or delete anything.

### 2.6 Same-workspace and same-relationship integrity

Every relationship fails closed at the constraint level, independently of RLS.
A privileged internal statement with no RLS over it still cannot corrupt these
relationships.

| Relationship | Enforced by |
|---|---|
| receipt → order | composite FK on `(id, workspace_id)` |
| receipt → shipment | composite FK on `(id, acquisition_order_id, workspace_id)` — same workspace **and** same order |
| receipt line → receipt | composite FK on `(id, workspace_id)` |
| receipt line → acquisition line | composite FK on `(id, workspace_id)` |
| discrepancy → order | composite FK on `(id, workspace_id)` |
| discrepancy → receipt | composite FK on `(id, acquisition_order_id, workspace_id)` — same order |
| discrepancy → receipt line | composite FK on `(id, acquisition_receipt_id, workspace_id)` — the line belongs to the named receipt |
| discrepancy → receipt line ↔ acquisition line | composite FK on `(id, acquisition_line_item_id, workspace_id)` — the line concerns the named acquisition line |
| discrepancy → acquisition line | composite FK on `(id, workspace_id)` |

**One relationship is deliberately not a static foreign key.** A receipt line's
acquisition line must belong to the receipt's *order*, but
`acquisition_line_items` carries no `order_id`: the link runs through
`acquisition_lot_lines`, whose placements are supersedable by design. A static
constraint would either freeze re-homing or go stale. **S2.2 must prove this
membership transactionally in its receipt-line function.**

### 2.7 Exclusion boundary — deferred to S2.2 by design

Receiving is a downstream workflow, so S1.5's
`app.assert_acquisition_line_eligible_for_downstream(workspace, line)` governs
whether a receipt line may be accepted.

That verdict is **not** encoded in this schema — not as a foreign key, a
generated column, a CHECK constraint, or a copied column — because an exclusion
decision can be superseded at any time and any cached copy would go stale.

**S2.2's receipt-line mutation function MUST call
`app.assert_acquisition_line_eligible_for_downstream` before accepting a new
receipt line.** This is recorded in the `acquisition_receipts` table comment and
asserted in `supabase/tests/64_acquisition_receiving_schema.sql`.

### 2.8 Direct-write security

- RLS enabled on all three tables.
- Same-workspace members (owner, operator, viewer) hold `SELECT` only, matching
  the governed read model S1 established for acquisition evidence.
- No role holds a direct `INSERT`/`UPDATE`/`DELETE` grant; `anon` holds nothing.
- `app.guard_acquisition_receiving_rows` additionally refuses every `UPDATE` and
  `DELETE` from a session that has not declared
  `app.governed_receiving_mutation = 'on'`. S2.2's `SECURITY DEFINER` functions
  set it; nothing else does.
- `TRUNCATE` is refused outright by `app.forbid_update_delete`.

> **Note for S1 forensic follow-up (not repaired here).** The S1.4 guard
> `app.guard_acquisition_event_rows` compares
> `current_setting('app.governed_acquisition_mutation', true) <> 'on'` without a
> `coalesce`. For a session that never set the GUC, `current_setting(…, true)`
> returns `NULL`, `NULL <> 'on'` is `NULL`, and plpgsql's `IF` treats that as
> false — so the bare comparison lets exactly the session the guard exists to
> stop pass straight through. Table grants still deny `authenticated`, so this
> is a defence-in-depth gap rather than a live hole. The S2.1 guard uses
> `coalesce(…, '') <> 'on'` and fails closed; `supabase/tests/64` pins that.
> Repairing S1.4's spelling is out of S2.1's scope.

### 2.9 Indexes

| Index | Access pattern |
|---|---|
| `acquisition_receipts_order_idx` | receipts for one acquisition |
| `acquisition_receipts_received_at_idx` | receiving activity over time |
| `acquisition_receipts_status_idx` | open receiving sessions (S2.3) |
| `acquisition_receipts_shipment_idx` | receipts for one shipment (partial) |
| `acquisition_receipt_lines_line_item_idx` | cumulative received quantity for one acquisition line — the central S2.2/S2.4 query |
| `acquisition_discrepancies_order_idx` | discrepancies for one acquisition |
| `acquisition_discrepancies_receipt_idx` | discrepancies for one receipt (partial) |
| `acquisition_discrepancies_line_item_idx` | discrepancies for one acquisition line (partial) |
| `acquisition_discrepancies_open_idx` | the unresolved queue (partial, S2.3/S2.6) |

Receipt-prefix lookups on receipt lines are served by
`acquisition_receipt_lines_receipt_line_uniq`; a separate index would be
redundant.

### 2.10 Governed public IDs

All three records are independently addressable governed entities and mint
`RV-*` identities per the existing convention:

| Table | Prefix |
|---|---|
| `acquisition_receipts` | `RV-ARCPT-` |
| `acquisition_receipt_lines` | `RV-ARL-` |
| `acquisition_discrepancies` | `RV-ADISC-` |

These are the prefixes `03_TARGET_COMMERCIAL_ARCHITECTURE.md` § 1.2 assigns. A
receipt line needs one because S2.3 must address a single arrival line without
exposing a UUID, and a discrepancy needs one because it is the subject of its
own resolution workflow.

## 3. What S2.1 deliberately does not implement

- No receiving mutation function, RPC, or HTTP route — S2.2.
- No receiving UI — S2.3.
- No inventory creation from receipt lines, and no trigger that could cause it.
- **No `inventory_lot_id` / `inventory_item_id` on receipt lines.** The
  architecture's sketch carries a single nullable pair, but that pair cannot
  express the case it exists for — *n* serialized units received against one
  acquisition line in one receipt — without either breaking the
  `(receipt, acquisition line)` idempotency key the same section states, or
  forcing a second grain. The acquisition→inventory link belongs with S2.2,
  which owns inventory creation and can add it additively without redesigning
  this grain.
- No cumulative received-quantity ceiling. Over-receipt must stay recordable;
  S2.2 owns the transactional decision about accepting it.
- No `inventory_cost_basis`, `inventory_cost_basis_events`, or
  `unresolved_cost_queue` — S2.4 and S2.6.
- No `audit_events` event types. S2.1 emits no events; S2.2 registers the types
  it actually emits.
- No historical import or legacy reconciliation — S3.

## 4. Tests

`supabase/tests/64_acquisition_receiving_schema.sql` — 168 assertions against a
real committed acquisition fixture in two workspaces. Beyond structure it
proves: partial receiving across two receipts summing to the expected quantity;
one receipt holding several distinct acquisition lines; zero and negative
arrivals refused and a positive arrival accepted; a recorded overage surviving
as the physical truth; every cross-workspace and cross-order relationship
failing closed under a privileged session; discrepancy evidence attaching to
valid receiving evidence without mutating the acquisition source quantity;
direct `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` denied for `authenticated` and for
undeclared privileged sessions alike; foreign-workspace and anonymous reads
returning nothing; and the acquisition, classification, exclusion, payment, and
shipment evidence being byte-identical after all receiving activity.

## 5. S2.2 governed receiving behavior

Migration `20260808000100_s2_receiving_functions.sql` adds the public receiving
contract: `open_acquisition_receipt`, `record_acquisition_receipt_line`,
`correct_acquisition_receipt_line`, `submit_acquisition_receipt`,
`cancel_acquisition_receipt`, `link_acquisition_receipt_inventory`,
`reconcile_acquisition_receipt`, `raise_acquisition_discrepancy`, and
`transition_acquisition_discrepancy`. Every entry point re-derives the actor
from `auth.uid()`. Owners and operators may receive; reconciliation and terminal
discrepancy decisions require an owner; viewers and anonymous callers cannot
mutate.

The receipt graph is exactly `open -> submitted -> reconciled` or
`open -> cancelled`. Receipt lines can be corrected only while open, using an
expected/current compare-and-set contract with a required reason. An already
applied desired quantity is a response-loss replay and does not emit a second
audit event. Submitted line evidence is frozen, and reconciled/cancelled
receipts are terminal. Discrepancies enforce `open -> claimed` and
`open|claimed -> resolved|written_off` below the public functions; resolution
and write-off require a note, actor, and timestamp.

Line addressing remains source-qualified. The mutation takes the source-system
public identity and acquisition-line public identity, resolves exactly one
line, then obtains the same workspace/line advisory lock used by S1.5 exclusion.
Under that lock it proves exactly one active placement, follows the placement
through its acquisition lot to the receipt's exact order, and invokes
`app.assert_acquisition_line_eligible_for_downstream`. Record, submit, and
reconcile repeat this proof, so a missing, ambiguous, cross-order, or excluded
placement fails closed.

### 5.1 Inventory provenance and conservation

`acquisition_receipt_line_inventory_links` is the dedicated child relation at
the grain `receipt line x governed inventory subject`. A link names exactly one
existing `inventory_lot` or `inventory_item`; receiving never creates a Product,
SKU, Lot, Item, tracking mode, condition, or location from incomplete purchase
evidence. Lot-managed subjects accept attributed quantities, while serialized
items accept exactly one unit and can have only one acquisition origin.
Same-workspace composite foreign keys protect every relationship.

A row trigger locks the parent receipt line before calculating its linked sum.
Consequently direct privileged SQL and concurrent inserts cannot make the sum
exceed `quantity_received`. Reconciliation locks the receipt and all lines and
requires every line's linked sum to equal its observed quantity. A cumulative
over-receipt additionally requires explicit `over_shipped` discrepancy evidence;
it is never clamped or silently treated as expected. Link rows cannot change or
be deleted after reconciliation.

### 5.2 Idempotency and audit

Open uses a normalized payload fingerprint behind its workspace/key unique
constraint and advisory key lock: exact retries return the original receipt;
changed payloads raise `idempotency_conflict`. Receipt-line natural retries
compare all stored payload, corrections use compare-and-set, and receipt/link
transitions return replay results without duplicate state or audit. Human-raised
discrepancies intentionally have no artificial idempotency key.

The emitted vocabulary is: `acquisition_receipt_opened`,
`acquisition_receipt_line_recorded`, `acquisition_receipt_line_corrected`,
`acquisition_receipt_submitted`, `acquisition_receipt_cancelled`,
`acquisition_receipt_inventory_linked`, `acquisition_receipt_reconciled`,
`acquisition_discrepancy_raised`, `acquisition_discrepancy_claimed`,
`acquisition_discrepancy_resolved`, and
`acquisition_discrepancy_written_off`. Metadata carries governed public
identities, transition facts, actor (through the audit row), and human reasons.

`supabase/tests/65_acquisition_receiving_behavior.sql` begins with the complete
public success path: open and replay, record two lines, correct and replay,
submit, select existing governed inventory, link exact quantities, reconcile
and replay, then prove source acquisition and shipment evidence stayed intact.
It also exercises changed-payload conflicts, terminal freezes, direct-SQL
quantity conservation, audit uniqueness, and direct-grant denial.

S2.3 must provide the owner-facing selection/creation workflow for governed
inventory subjects before reconciliation, discrepancy raise/claim/resolution
surfaces, visible shortage/overage evidence, stable error mapping, and retry
states. It must not guess identity or expose internal UUIDs. The pre-existing
S1.4 NULL-GUC defect in `app.guard_acquisition_event_rows` remains documented
debt and is intentionally not repaired by S2.2.

## 6. S2.2 post-merge acceptance hardening

PR #61 was an implementation checkpoint, not complete S2.2 acceptance. Its
25-assertion lifecycle established a useful happy path, but did not execute the
required adversarial matrix or eight overlapping-session races. Against
unmodified `e6a6024b16f88935558d511f0734e52f2c2fc5a5`, executable reproductions
proved: correction versus submit could deadlock with `40P01`; an open receipt
could link five units and then be corrected to four; a linked open receipt could
be cancelled with its link retained; a reconciled link could be reparented to
an open line; a submitted line could be deleted; and discrepancy kind,
quantities, and detail could be rewritten.

Migration `20260809000100_s2_receiving_acceptance_hardening.sql` repairs those
behaviours additively. The canonical lock order is **receipt, receipt lines in
stable ID order, downstream acquisition-line/exclusion decision lock, then
inventory-link rows where needed**. Correction now locks and revalidates the
receipt before its line and then takes the same S1.5 `:exclusion-line:` advisory
identity used by exclusion decisions.

Inventory provenance can be linked only while a receipt is `submitted`, after
observed quantities freeze. An `open` receipt therefore remains safely
cancellable without an inventory-origin claim. Link workspace, receipt-line,
lot/item subject, public identity, creator, and creation time are immutable
below the API; receipt-line locking preserves quantity conservation under
concurrent links; and reconciled/cancelled provenance remains terminal.

Wrong subject selection has one narrow recovery path:
`unlink_acquisition_receipt_inventory(workspace, linkPublicId, reason)`. Owners
and operators may use it only while the parent is `submitted`. It requires a
reason, emits exactly one `acquisition_receipt_inventory_unlinked` audit event,
accepts an exact response-loss retry, rejects a changed-reason retry, and never
deletes reconciled provenance. The operator can then link the correct governed
subject.

Cancellation is `open -> cancelled` only, requires and audits its reason,
preserves receipt/line evidence, replays only with the same reason, and rejects
changed-reason replay. Submitted receipt lines cannot be updated, reparented,
have their acquisition line exchanged, or be deleted even by privileged SQL
with the governed mutation setting.

Discrepancy order/receipt/line identity, kind, quantities, value evidence,
currency, detail, creator, and creation time are immutable. Only approved
lifecycle/resolution fields can change. Owners retain terminal resolve/write-off
authority; operators may raise and claim; viewers and anonymous callers cannot
mutate. Exact terminal replay succeeds while a changed resolution note
conflicts.

The focused acceptance fixture uses the existing Product -> SKU -> Lot -> Item
model for lot-managed and serialized stock. Serialized provenance requires one
real Item per unit, link quantity one, a serialized parent Lot, workspace
parity, and one acquisition origin per Item; a quantity-managed Lot cannot
masquerade as a serialized Item.

`66_acquisition_receiving_acceptance_hardening.sql` executes the role, direct
write, wrong-order, exclusion, cancellation, discrepancy, serialized,
immutability, replay, and audit matrices plus all eight races. Every race opens
two `dblink` sessions, sets bounded statement/lock timeouts, dispatches both
queries before waiting for or collecting either result, and asserts final
invariants. Coverage includes same/conflicting receipt create,
same/conflicting line record, correction versus submit, joint over-link, double
reconcile, and exclusion versus receiving with the exact S1.5 advisory lock
identity.

S2.3 may safely assume quantities freeze at submission; linking and governed
wrong-link recovery occur in the submitted review stage; cancellation is
open-only; reconciled provenance cannot move; and database locks serialize
conservation and exclusion decisions. S2.3 remains the next checkpoint and is
not implemented here.

## S2.3 Batch 1 checkpoint — governed receiving UI

Batch 1 turns the S2.2 database contract into the first owner-usable receiving
workflow. It adds ZERO migrations, ZERO schema changes, and ZERO receiving
function changes. S2.2 remains the sole owner of receiving semantics.

### Server read/transport architecture

`server/src/receiving/contract.ts` is pure assembly and classification, tested
directly. `server/src/routes/receiving.ts` is transport only and is mounted at
`/api/receiving` behind the same two gates as the acquisition router:
availability (the surface 404s unless the governed deployment is configured) and
per-request authentication plus workspace authorization through a Supabase
client bound to the caller's own JWT. There is no service-role key.

No governed receiving READ function exists, and Batch 1 was forbidden to add
SQL. It was not needed: `acquisition_line_overview`, `acquisition_receipts`,
`acquisition_receipt_lines`, `acquisition_shipments` and `acquisition_orders`
are all `select`-granted to `authenticated` under same-workspace RLS, so the
queue and receipt views are assembled in the application from governed,
RLS-enforced reads. Internal ids are used as join keys and never emitted; every
payload carries governed public identities only, and `containsInternalId` proves
it over whole response bodies in the route tests.

Reads are bounded at 2000 rows per assembly. Reaching a bound sets
`complete: false`, which the UI renders as the S1.6 `partial` state rather than
as a short list indistinguishable from a complete one.

### `/receiving` landing contract

`GET /api/receiving/queue` returns one row per acquisition order that has at
least one receivable line, with `expectedQuantityTotal` (acquisition evidence),
`observedQuantityTotal` (receiving evidence, excluding cancelled sessions),
`workflowState`, the order's receipts, and its shipments.

`workflowState` is a fold over authoritative receipt statuses only:
`not_started`, `receiving_in_progress`, `submitted_pending_review`,
`reconciled`, `cancelled_only`. There is deliberately NO "needs receiving"
state. Nothing in the governed contract establishes that a delivery is expected,
so a state derived from "expected exceeds observed" would be a guess presented
as a fact.

The page is a fixed operational surface using `DataTable` above `lg` and
`ResponsiveRecordList` below it, built from one row model.

### Workflows

- **Open** — `POST /api/receiving/orders/:orderPublicId/receipts` →
  `open_acquisition_receipt`. `receivedAt` is REQUIRED by the transport: S2.2
  sets it only at open time and `submit` refuses a receipt whose `received_at`
  is null, so a receipt opened without one is permanently unsubmittable. The
  shipment is chosen from the order's own shipments or the explicit
  shipment-null path; free-text shipment identity is not accepted.
- **Record** — `POST /api/receiving/receipts/:id/lines` →
  `record_acquisition_receipt_line`, addressed source-qualified.
- **Correct** — `POST /api/receiving/receipt-lines/:id/correct` →
  `correct_acquisition_receipt_line`, sending the compare-and-set value the
  operator was looking at.
- **Cancel** — `POST /api/receiving/receipts/:id/cancel` →
  `cancel_acquisition_receipt`, reason required.
- **Submit** — `POST /api/receiving/receipts/:id/submit` →
  `submit_acquisition_receipt`.

### Expected, observed, difference

EXPECTED (`acquisition_line_items.quantity`) and OBSERVED
(`acquisition_receipt_lines.quantity_received`) are separate fields end to end
and neither is derived from the other. The difference is DISPLAYED for operator
awareness and recorded nowhere: Batch 1 creates no discrepancy record and never
rewrites EXPECTED because OBSERVED disagreed.

An overage is legitimate physical truth. The observed-quantity input carries no
`max`, the transport applies no ceiling, and an overage produces an informational
notice that does not block confirmation.

### Receipt is not shipment

A receipt references a governed shipment identity and copies no transport truth.
The shipment's own timestamp is carried as `carrierReceivedAt` so it cannot be
read as a receipt's `receivedAt`, and the workspace states in words that a
carrier reporting delivered establishes neither verified quantities, nor
submission, nor inventory, nor reconciliation.

### Role behaviour

`requireOperator` (owner or operator) guards every mutation, mirroring the
`array['owner','operator']` assertion inside each S2.2 function; the database
gate still runs and is the one that counts. Viewers read only. The UI derives
capability from the server-reported role, never from a client-side guess.

### Retry and error behaviour

The bounded governed vocabulary is preserved through transport with meaning-
preserving statuses (`receipt_not_open`, `receipt_terminal`,
`receipt_line_conflict`, `idempotency_conflict`,
`acquisition_line_not_in_receipt_order`, `acquisition_line_excluded`,
`acquisition_integrity_error`, the `_not_found` family, `invalid_request`,
`unauthorized_workspace`). A missing S2.2 migration becomes
`receiving_contract_missing` (503), never a 500, and the database's own sentence
never reaches the browser.

An idempotency key is minted once per confirmed intent — only opening a receipt
needs one — and reused on retry, never minted inside a retry path. The other
operations already carry governed replay semantics: recording is keyed on the
(receipt, acquisition line) grain, correction is a compare-and-set, and
cancel/submit report `replayed` when the receipt already holds the target
status. A stale correction refreshes authoritative state and requires a fresh
confirmation; it is never silently resent or overwritten.

Submission copy states both halves: it freezes observed quantities and moves the
receipt to submitted review; it does NOT create inventory, resolve discrepancies,
complete owner reconciliation, or establish cost basis.

### Responsive and browser coverage

`/receiving` and `/receiving/:receiptPublicId` join the canonical browser
surfaces, so the existing overflow, axe, and screenshot suites cover them at the
five approved reference viewports without a new harness. The WebKit iPad
overflow smoke covers them too. Visual baselines grew from 40 to 60.

### Remaining Batch 2 work

Inventory linking UI, unlink recovery UI, inventory-subject selection,
discrepancy creation and lifecycle UI, owner reconciliation UI, cost allocation
and inventory cost basis. None of it is exposed in Batch 1, and the transport
calls none of the corresponding governed functions.

## S2.3 Batch 2 checkpoint — provenance, discrepancies, reconciliation

Batch 2 completes S2.3. Like Batch 1 it adds ZERO migrations, ZERO schema
changes, ZERO receiving-function changes, and modifies no Supabase file. Every
mutation is a thin call into an existing S2.2 governed function.

### The six states S2.3 keeps distinguishable

`carrier delivered` · `physical receipt recorded` · `receipt submitted` ·
`inventory linked` · `discrepancy recorded/resolved` · `owner reconciled`.
None is shorthand for another, and each is named in words on the surface where
an operator could otherwise confuse it with its neighbour.

### Inventory subject read architecture

`/api/inventory-identity/overview` was inspected first and is not reusable here:
it searches `inventory_item_overview` ONLY (it cannot find a lot-managed lot at
all), declares itself `authoritative: false` as a diagnostic surface, and
returns raw view rows carrying `item_id`, `lot_id`, `sku_id`, `product_id` and
`location_id`.

`GET /api/receiving/inventory-subjects?q=&mode=` is therefore the minimum
additional governed read: both `inventory_lot_overview` and
`inventory_item_overview` under the caller's own JWT, filtered to what S2.2 will
actually accept (an active `lot_managed` lot, or an active item under a
`serialized` lot), projected to public identities with the product, condition and
location an operator needs to recognise the subject. Capped at 100 per side with
a truthful `complete` flag.

### Inventory creation dependency

A governed creation workflow EXISTS — `commit_intake_group` behind Quick Add —
so Receiving does not duplicate it. When the governed search proves no matching
subject exists, the link dialog says receiving does not create Products, SKUs,
Lots or Items from acquisition text and links to `/quick-add`. This is a
navigation handoff: Quick Add keeps its own validation and truth model intact.

### Link and unlink

`POST /api/receiving/receipt-lines/:id/links` →
`link_acquisition_receipt_inventory`. Exactly one subject; a serialized item is
sent as quantity 1 and the transport refuses anything else. Conservation is NOT
pre-checked in TypeScript — the database holds a row lock while it checks, and a
second opinion computed from a stale read could only disagree.

`POST /api/receiving/inventory-links/:id/unlink` →
`unlink_acquisition_receipt_inventory`, reason required. The confirmation states
that this removes the provenance link, does NOT delete the lot or item, does NOT
rewrite acquisition evidence, and is possible only before reconciliation.

Per receipt line the UI states four separate facts — expected, observed, linked,
and the remainder — and the remainder is phrased "still needs an inventory
subject", never "missing inventory".

### Discrepancy lifecycle

`POST /api/receiving/orders/:id/discrepancies` →
`raise_acquisition_discrepancy`; `POST /api/receiving/discrepancies/:id/transition`
→ `transition_acquisition_discrepancy`. Kinds are validated against the closed
enum before the call. `never_arrived` is raised from the ORDER with no receipt,
because manufacturing a receipt to report an absence would record an arrival
that did not happen. `price_mismatch` collects no monetary fields, because the
governed function persists none.

Claim is owner or operator; resolve and write-off are OWNER ONLY and refused by
the transport before any RPC. Write-off copy states it closes the discrepancy
without claiming the expected and observed evidence became equal.

### Non-idempotent creation recovery

`raise_acquisition_discrepancy` has no idempotency key and returns no `replayed`
flag, so a lost response CANNOT be retried — a second press could create a second
durable record. `client/src/pages/receiving/discrepancyCreation.ts` implements
verify-first recovery: the intent and the identities known before the attempt are
retained, creation is locked with no retry control, and only an authoritative
re-read settles it. A matching new record means it committed (do not resend); a
complete read with no match permits a NEW attempt; a FAILED verification leaves
the outcome unknown and keeps creation locked. Nothing ever says "nothing was
sent".

### Reconciliation

`POST /api/receiving/receipts/:id/reconcile` → `reconcile_acquisition_receipt`,
guarded by `requireOwner` and by the database. It takes no reason, so none is
collected — the confirmation is a `Dialog`, not a `MutationConfirmation`, rather
than collecting a reason the contract would discard.

`reconciliationReadiness` mirrors the two conditions the governed function
actually checks — every receipt line's linked total must equal its observed
quantity, and a cumulative overage requires an `over_shipped` discrepancy on that
line — and reports them as named blockers with per-line observed/linked/difference
figures. There is deliberately no single "Ready" badge. Open and claimed
discrepancies of other kinds are counted and shown but are NOT blockers, because
S2.2 does not make them one.

Reconciliation copy states it means owner acceptance, terminality and immutable
provenance; and that it does NOT mean acquisition or shipment evidence was
rewritten, that cost basis was calculated, or that anything is listed or sold.

### Role matrix

| | read | link | unlink | raise | claim | resolve | write off | reconcile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| anonymous | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Server authority is tested separately from control visibility: viewer and
operator refusals are asserted to happen BEFORE any RPC.

### Terminal behaviour

A reconciled receipt offers no record, correct, cancel, submit, link, unlink or
reconcile control; provenance stays visible and is stated to be immutable.
A cancelled receipt keeps its Batch 1 historical display, and since open receipts
cannot carry links under the S2.2 contract it shows no inventory provenance.

### Browser acceptance

`receiving-provenance.spec.ts` — 17 Chromium tests over a stateful world
covering submitted linking, lot-managed and serialized linking, over-capacity
refusal, unlink, discrepancy raise/claim/resolve/write-off, the commit-then-lost-
response recovery, blocked and successful reconciliation, terminality, never-
arrived, and overflow. Axe covers representative submitted and reconciled states
in both themes. The WebKit iPad smoke adds the submitted receipt and its linking
dialog. Screenshot baselines stay at 60; only the two receiving surfaces changed.

### S2.3 completion boundary

S2.3 ends at governed owner reconciliation. S2.4 additively derives stored,
history-preserving basis only from reconciled receipt-inventory links. Direct
components and confirmed shared allocations remain distinct contribution rows;
candidate/reversed inputs are excluded. Expected quantity remains the denominator
for partial receipts, overage remains unresolved, and currencies remain separate.
S2.4 includes no allocation UI, `/cost` route, COGS, sales, returns, or FX.

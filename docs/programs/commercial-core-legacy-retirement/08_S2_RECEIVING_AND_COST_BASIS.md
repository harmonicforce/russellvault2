# S2 — Receiving and Inventory Cost Basis

Slice-level implementation note for **S2 — Landed cost and inventory cost
basis**. `05_IMPLEMENTATION_SEQUENCE.md` § S2 remains the authority on the
slice's objective, acceptance, and risk. This document records only the
decisions the implementation makes as each PR lands, so the next agent does not
have to re-derive them from SQL.

## 1. The six-PR sequence

| PR | Scope | State |
|---|---|---|
| **S2.1** | Governed receiving schema — `acquisition_receipts`, `acquisition_receipt_lines`, `acquisition_discrepancies` | **this PR** |
| S2.2 | Receiving mutation functions + behavioural pgTAP | not started |
| S2.3 | Receiving UI (`/receiving`) | not started |
| S2.4 | Cost-basis schema + `recompute_inventory_cost_basis` + pgTAP (**the critical PR**) | not started |
| S2.5 | Cost-allocation owner surface (`/cost`) | not started |
| S2.6 | Unresolved-cost queue | not started |

Receiving is delivered before cost basis because a cost basis with no governed
receipt is exactly the legacy `cost_links` design the program exists to retire.

**D-8 (cost basis method) blocks S2.4, not S2.1.** Nothing in the receiving
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

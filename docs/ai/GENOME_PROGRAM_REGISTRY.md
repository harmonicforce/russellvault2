# Genome Repair Program Registry

Two sequences run in this repository and they must not be confused:

| Track | What it is | Where it lives |
| --- | --- | --- |
| **Genome Repair program** | The active ordered reliability/control-plane program. Repairs how the repository tells the truth about itself and protects live systems. | This file. |
| **Commercial product roadmap** | The owner-facing feature sequence (S1…S3.8, then Listing Prep, Media, Sales, Dashboard). | `PROJECT_ROADMAP.md`. |

The Genome Repair program is currently **ahead of** the product roadmap: product slices resume once their prerequisite hardening lands. Neither track erases the other, and neither is permission to begin, merge, migrate, or deploy without a work order.

## Current position

- **Active slice:** WO1 — Production Identity and Control-Plane Truth. Delivered as **PR #79**, draft, base `a647b77a0f88fbaac9abc86430be58502a562bf9`.
- **Next after PR #79 merges:** **WO2 — Legacy Confidentiality Membrane.**

## Ordered work orders

Titles and prerequisites only. The full work-order prompts are owner-held and are deliberately not copied here — a second copy would go stale, which is the failure class this program exists to remove.

| # | Work order | Prerequisites |
| --- | --- | --- |
| 1 | Production Identity and Control-Plane Truth | — (active: PR #79) |
| 2 | Legacy Confidentiality Membrane | WO1 |
| 3 | Governed Health / Legacy Health Decoupling | WO1–2 |
| 4 | Generated DB Contracts and Typed RPC Boundary | WO1–3 |
| 5 | SECURITY DEFINER, Grants, and RLS Guard Genome | WO4 |
| 6 | Cost-Basis Currentness Proof | WO5 |
| 7 | Financial and Reconciliation Numeric Safety | WO6 |
| 8 | Inventory Public-ID Membrane | WO7 |
| 9 | Remaining Public-ID Boundary and UUID Guard | WO8 |
| 10 | Authority Registry and Environment Alias Repair | WO1, WO9 |
| 11 | CI Timeout Ownership and Diagnostic Quality | current `main` green |
| 12 | Workload-Based PostgreSQL Fitness | WO4–5 |
| 13 | Reconciliation Review and Cutover Safety Loop | WO4, WO5, WO7, WO9, WO11 |
| 14 | Evidence-Gated Legacy Retirement Tranche | WO13 + verified production export |
| 15 | Authority-Preserving Module Decomposition | WO4, WO5, WO8, WO9 |
| 16 | Evidence-Bound Operational Intelligence | WO6, WO7, WO10, WO13 |
| 17 | Full Genome Re-Sequencing and Closure | selected work orders merged or explicitly deferred |

Note that the prerequisite graph is not a straight line: WO11 gates on `main` being green rather than on a predecessor work order, and WO10, WO12, WO15 and WO16 each fan in from several earlier ones. Read the prerequisite column, not the numbering, before starting anything.

## Relationship to product slice S3.3

`S3.3 — Reconciliation Review UI` remains a real, planned product slice. It is **not** the next thing to build: it is carried by **WO13 — Reconciliation Review and Cutover Safety Loop**, which waits on WO4, WO5, WO7, WO9 and WO11. Earlier revisions of `CURRENT_STATE.md` and `PROJECT_ROADMAP.md` named S3.3 as the immediate next slice; that was written before this program was sequenced, and both files are corrected.

Its product scope, when reached, is unchanged and recorded in `PROJECT_ROADMAP.md`.

## Maintenance

Update this file when a work order is issued, starts, or completes. It is narrative program state, so it is steward-controlled under the same rule as `CURRENT_STATE.md`: implementation agents change it only under an explicit work-order exception.

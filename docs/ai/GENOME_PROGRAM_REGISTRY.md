# Genome Repair Program Registry

Two sequences run in this repository and they must not be confused:

| Track | What it is | Where it lives |
| --- | --- | --- |
| **Genome Repair program** | The active ordered reliability/control-plane program. Repairs how the repository tells the truth about itself and protects live systems. | This file. |
| **Commercial product roadmap** | The owner-facing feature sequence (S1…S3.8, then Listing Prep, Media, Sales, Dashboard). | `PROJECT_ROADMAP.md`. |

The Genome Repair program is currently **ahead of** the product roadmap: product slices resume once their prerequisite hardening lands. Neither track erases the other, and neither is permission to begin, merge, migrate, or deploy without a work order.

## Current position

- **Active slice:** Genome Repair Work Order 1 — Production Identity, Current-State Truth, and Freshness Guards. Delivered as **PR #79**, draft, base `a647b77a0f88fbaac9abc86430be58502a562bf9`.
- **Next after PR #79 merges:** **Work Order 2 — Legacy Confidentiality Membrane.**

## Known ordered work orders

Only entries confirmed by an issued work order are listed. The intermediate sequence between WO2 and WO13 has **not** been enumerated in this repository, and is deliberately left blank rather than invented — do not populate it from memory or inference.

| # | Work order | Status |
| --- | --- | --- |
| 1 | Production Identity, Current-State Truth, and Freshness Guards | Active — PR #79, draft, not merged |
| 2 | Legacy Confidentiality Membrane | Next after WO1 merges |
| 3–12 | Not enumerated in this repository | Unknown here; the program owner holds the sequence |
| 13 | Reconciliation Review UI (the slice previously tracked as product **S3.3**) | Planned, after prerequisite hardening |

This registry records sequence and position only. It intentionally does not reproduce the full program prompt document; that stays with the program owner, and copying it here would create another stale copy of exactly the kind this program exists to eliminate.

## Relationship to S3.3

`S3.3 — Reconciliation Review UI` remains a real, planned product slice. It is **not** the next thing to build: it maps to **Work Order 13** and waits on the prerequisite hardening ahead of it. Earlier revisions of `CURRENT_STATE.md` and `PROJECT_ROADMAP.md` named S3.3 as the immediate next slice; that was written before the Genome Repair program was sequenced and is corrected in both files.

Its scope, when it is reached, is unchanged and recorded in `PROJECT_ROADMAP.md`.

## Maintenance

Update this file when a work order is issued, starts, or completes. It is narrative program state, so it is steward-controlled under the same rule as `CURRENT_STATE.md`: implementation agents change it only under an explicit work-order exception.

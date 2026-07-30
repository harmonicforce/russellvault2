# Project Context

## Product

The Russell Vault Operations application supports a resale business spanning Pokémon TCG, sneakers, apparel, electronics, listings, sales, purchasing, and cost-basis workflows.

## Current architecture

The repository contains two materially different data planes:

1. **Legacy SQLite application**
   - Deployed on Railway.
   - Currently authoritative for operational inventory.
   - Production writes are guarded and must not be casually enabled.

2. **Supabase/PostgreSQL target model**
   - Built as a shadow, non-authoritative system.
   - Includes workspace/RLS foundations, provenance/import review, acquisition/cost foundations, Product → SKU → Lot → Item identity, and the Phase 6A intake kernel plus Quick Add UI.
   - Must remain dark/non-authoritative unless the owner explicitly approves a later authority transition.

## Repository branch reality

The GitHub default branch `Beginner` contains only the original skeleton and is not the application branch. The canonical application line has historically been `claude/ui-better-spreadsheet-cjhwjb`. Always use the exact branch and verified head recorded in `docs/ai/CURRENT_STATE.md`.

Changing the default branch or Railway deployment branch is deployment-affecting and requires explicit owner approval.

## Governance model

- Implementation agents: Claude and Codex.
- Independent reviewer: ChatGPT or another explicitly designated reviewer.
- Implementation agents write code, tests, technical docs, and `LAST_IMPLEMENTATION_HANDOFF.md`.
- The independent reviewer verifies repository state and alone updates `CURRENT_STATE.md`.
- Owner-run gates, deployment actions, timing studies, and authority transfers cannot be simulated by an agent.

## Current program position

Phases completed before Phase 6A established:

- Phase 0 safety and backup preflight foundation
- Supabase shadow workspace/RLS foundation
- deterministic provenance/import review
- acquisition/source-cost staging foundation
- Product/SKU/Lot/Item/storage identity foundation
- concurrency and registrar acceptance corrections

Phase 6A added:

- server-authoritative intake state machine
- transactional commit kernel
- graded-slab Quick Add UI
- session resume and stale reload
- duplicate recovery contract
- rendered component tests

Phase 6A remains subject to the owner-run UB-01 timing gate. No timing result may be invented.

## Safety invariants

- No hidden second inventory truth.
- No dual-write without explicit authorization.
- No authority transfer by implication.
- No production deployment merely because code is merged.
- No fabricated data, timing evidence, acceptance result, or hosted verification.
- Corrections must preserve immutable/audited history where the target model requires it.

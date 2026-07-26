# UB-01 — Quick Add owner timing test (graded slabs)

**Status: PENDING OWNER EXECUTION.** This procedure is prepared for Kyle Miller
to run manually. No timings are simulated or fabricated; the acceptance
statistics are computed only after Kyle performs the test.

Quick Add is **SHADOW / NON-AUTHORITATIVE**. Legacy SQLite remains the
authoritative deployed inventory. This test creates shadow Product/SKU/Lot/Item
records only; it deploys nothing and changes no production data.

## Acceptance targets

- Median completion time **≤ 60 seconds**
- P90 completion time **≤ 90 seconds**
- **Zero** duplicate inventory
- **Zero** invented factual defaults

## Preconditions

1. A local build with the shadow-intake flags on:
   - `VITE_SHADOW_AUTH=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `VITE_SHADOW_IMPORT=repository-fixtures`
   (With any of these unset, Quick Add is dark and the route does not exist.)
2. The server running against a local/Docker-local Supabase stack with the
   Phase 6A migrations applied (`npm run db:reset`), and the same shadow flags
   set on the server (`SHADOW_IMPORT=repository-fixtures`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`).
3. Signed in as an **operator or owner** of a workspace.
4. Any storage-location codes you intend to use already exist and are active
   (Quick Add never creates a location).
5. **10 known CGC or PSA slabs**, each with a **unique** certificate number, and
   a known real source for each.

## Local run steps

1. `npm run db:reset` (Supabase-local tier), then start the app: `npm run dev`.
2. Open **Quick Add** in the sidebar. Enter the workspace id and
   **Start intake session** once. Keep the same session for all 10 slabs.
3. For each slab, do one practice run first, then time the 10 real slabs:
   - Note the **start timestamp** the instant you begin entering the slab.
   - Scan or type the **certificate number** (it has initial focus).
   - Enter grading company, numeric grade, optional grade designation, card
     name / featured subject, set name, card number, and the governed source.
     Leave anything genuinely unknown **blank** — never guess.
   - Press **Check readiness** (or Enter). Resolve any server blockers the panel
     lists (each links to its field).
   - When the panel shows **Ready to commit**, press **Commit slab** (or
     Ctrl/Cmd+Enter).
   - Note the **committed timestamp** when the receipt appears.
   - Record the resulting **Item public id** and **certificate number** from the
     receipt, and whether any correction was required.
   - Press **Add another slab** (keeps the session; focus returns to the
     certificate field).

## Capture (per slab)

Record one row per slab:

| # | start | committed | elapsed_s | outcome (success/blocker) | item_public_id | certificate | correction_needed |
|---|-------|-----------|-----------|---------------------------|----------------|-------------|-------------------|
| 1 | | | | | | | |
| … | | | | | | | |
| 10| | | | | | | |

## Compute (only after Kyle runs it)

- **median** elapsed_s across the 10 slabs
- **P90** elapsed_s
- **duplicate count** — distinct committed lots/items beyond the 10 intended
  (retries must replay the same receipt, never create a second item)
- **invented-default count** — any factual value that was auto-filled rather
  than entered (target: 0)

## Recording the result

Do **not** claim UB-01 passed until Kyle has executed it. When he has, paste the
table and the four computed numbers into PR #8 and state pass/fail against the
targets above. If Kyle is unavailable, UB-01 remains **PENDING OWNER
EXECUTION** and the Quick Add workflow is not pilot-ready.

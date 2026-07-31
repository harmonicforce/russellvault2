# Last implementation handoff

## Checkpoint: fixture-heavy governed recount and legacy-test correction

Corrective migrations `20260730000100` through `20260731000100` remain unapplied
to live Supabase.

### Implemented

- Updated the pre-existing end-to-end cycle-count pgTAP fixture to call only the
  governed keyed observation, explicit-round submit, two-stage resolution, and
  latest-result completion contracts. It no longer calls authenticated RPC
  signatures that the corrective migrations deliberately revoked.
- Updated expectations to the structured outcomes: accepted, idempotent replay,
  unknown subject, out of scope, blocked completion, and current-result conflict.
- Frozen expected snapshot assertions now switch to the test-owner role. Caller
  assertions prove authenticated users cannot directly select expected rows.
- Added a fixture-heavy multi-subject recount: two discrepancies are selected in
  review, exactly one recount round freezes both, the item is corrected, the lot
  shortage magnitude changes, both rounds remain evidence, the item becomes
  matched-after-recount, the lot gets a latest-quantity successor, resolution
  applies that successor quantity, and completion succeeds only afterward.
- Existing blind, cancellation, workspace-isolation, movement, adjustment, and
  terminal-evidence assertions remain in the same governed flow.

### Validation status

Static diff checks and dependency-free guards pass. Client TypeScript still
passes. An attempt to install local PostgreSQL, psql, and pgTAP through apt was
blocked by the environment proxy with HTTP 403, just like npm. Therefore the SQL
suite still has not executed and no database assertion success is claimed.

### Exact next step

Run `node scripts/db/test.mjs` on a PostgreSQL-capable runner. Treat the first
runtime SQL error as the next correction target, rerun from a clean reset, and
continue until all pgTAP files pass. Then add and execute genuine cycle-count
dblink concurrency proofs, rendered tests, and six Playwright flows.

### Still incomplete

Generated Supabase types, actual pgTAP execution, genuine concurrency proofs,
rendered tests, Playwright, full build/audits, CI publication, and hosted
validation remain. Do not ship. No merge, deployment, live migration, Railway
operation, branch-protection change, or production change was performed.

# Last Implementation Handoff

## S3.1 — Historical Reconciliation Ledger Schema

### Lineage and authority

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s3-1-reconciliation-ledger-schema`.
- Exact base SHA: `2a858591c12b0b2a1a13bd186eadfd2baaaafbe3`.
- Release authority: branch/commit only. The work order forbids merge, push,
  hosted migration, deployment, production reconciliation, and production data
  actions, and reserves PR creation for the owner's Create PR button.
- `client/**`, `server/**`, and `docs/ai/CURRENT_STATE.md` are untouched.

### Implemented database contract

One forward-only additive migration,
`20260815000300_reconciliation_ledger.sql`, adds:

- `reconciliation_runs`: one immutable execution of one comparison, addressed by
  `RV-RECON-*`, scoped to one workspace and domain, with source SHA, target
  scope, comparison key, lifecycle timestamps, object-shaped L1 result, tool and
  actor provenance, and replay-safe request identity;
- `reconciliation_findings`: one immutable L2 verdict for one comparison key in
  the source/target union, uniquely constrained per run/key, addressed by
  `RV-RECONF-*`, with typed verdict/materiality and an exact array of
  `{field, source, target}` differences;
- `reconciliation_finding_adjudications`: append-only `RV-RECONA-*` events. The
  latest `(adjudicated_at,id)` event is current; absence means `open`. Later
  events supersede without rewriting findings or prior review evidence;
- governed owner/operator begin, finding-record, complete, and fail functions;
  owner-only adjudication; idempotent replay with conflict detection;
- `reconciliation_cutover_eligibility`, a read-only owner/operator/viewer gate.
  It fails closed unless the run is completed and no current material/financial
  finding is `open` or `deferred`. Cosmetic/none never block. Accepted,
  corrected, and rejected do not block. Domain lookup uses the latest run.
- composite same-workspace evidence FKs, restrictive deletes, immutable/append-
  only triggers, NULL-safe governed mutation GUC enforcement, RLS on all three
  tables, authenticated same-workspace SELECT only, no anon access, and governed
  functions as the only authenticated mutation path.

No source was connected, no legacy data was imported, no comparison was run,
and no cutover was performed.

### Tests and verification

- New `68_reconciliation_ledger.sql`: 47/47 assertions covering schema/FKs,
  RLS, anon and cross-workspace denial, direct DML denial, all enum values,
  exact JSON preservation/shape rejection, lifecycle, immutable evidence,
  idempotency, unique IDs/run keys, append-only adjudication, and every requested
  cutover-gate case.
- `06_provenance_structure.sql` now proves the exact 77-file migration ledger.
- `PGOPTIONS='-c jit=off' npm run db:reset`: passed.
- `PGOPTIONS='-c jit=off' npm run db:test`: 68 files, 2639 assertions, all passed.
- `npm run typecheck`: passed.
- `npm test`: server 686, client 1431, Node guards 23; 2140 total passed.
- `npm run build:ci`: passed with the existing Vite chunk-size warning.
- `git diff --check`: passed.
- Environment setup only: the local PostgreSQL 16 cluster was initially down
  and lacked the local `root` superuser expected by the test scripts. Starting
  the local cluster and creating that local-only role allowed the mandated
  commands to run. No hosted database was contacted.

### Delivery status

- Final SHA: recorded after commit in the final response.
- PR: not created; owner must use Codex's Create PR button as explicitly ordered.
- Exact-head hosted CI: not checked because the branch was not pushed.
- Live Supabase migration count/parity: not checked; not authorized.
- Railway deployment and `/api/version`: not checked; not authorized.
- Hosted acceptance: not applicable to this evidence-schema-only slice.
- Production data touched: none.
- Rollback before deployment: revert the feature commit. If separately deployed,
  preserve forward-only practice with a new migration rather than editing this one.

### Exact next owner decision

Use Codex's Create PR button for this committed branch and obtain green exact-head
CI. Then decide whether S3.1 may merge and whether the migration may later be
applied. Do not begin S3.2 or any historical reconciliation/import until S3.1 is
accepted and the still-open owner decisions for S3 execution are resolved.

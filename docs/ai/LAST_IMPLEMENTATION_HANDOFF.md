# Last Implementation Handoff

## Emergency Genome Repair Work Order 11 — repair the Supabase-stack CI timeout without weakening verification

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/wo11-supabase-stack-ci-timeout` (cut from `main` at the SHA below).
- Base SHA: `77a019acad6a207c57f45ed9c78a4fa51e3ac55f` (merge of PR #80).
- Release authority: branch and draft PR only. No merge, no deploy, no Railway change, no Supabase
  mutation. PR #81 untouched, per the work order.
- Status: **implemented** and **validated locally**. Not merged, not deployed.

### Baseline investigation

Run `32613907298`, job `shadow-db-supabase-stack`, **attempt 1** (job `97131261144`) and
**attempt 2** (job `97133819224`). Both failed identically:

| | attempt 1 | attempt 2 |
| --- | --- | --- |
| step `Run pgTAP suite inside the local stack` | 02:54:42 → 03:06:54 (12m12s) | 03:17:52 → 03:30:04 (12m12s) |
| terminating event | `##[error]The action ... has timed out after 12 minutes` | identical |
| last output | a NOTICE from line 11 of `15_acquisition_digest_parity.sql` | identical |
| orphans reported by the runner's own cleanup | 8 | 8 |

The orphan chain in both: `npm run db:test` → `sh` → `node` → `npm exec supabase@2.109.1 test db
--local` → `sh` → `node` → `supabase` → `docker`.

**Comparison runs, same commit or adjacent:**

- `shadow-db-postgres-shim` on the same SHA `77a019a` (job `97133831332`): **passed**, whole suite in
  **28.5 s**, `15_acquisition_digest_parity.sql` in **6.7 s**, `all test files passed (2673 assertions)`.
- `shadow-db-supabase-stack` on the previous main `fac90b3` (run `32564005696`, job `97009820870`):
  **passed**, pgTAP step **58 s**, pg_prove reporting `Files=70, Tests=2673, 23 wallclock secs`.
- `git diff --stat fac90b3 77a019a -- supabase/ scripts/db/ package.json package-lock.json` is
  **empty**. `15_acquisition_digest_parity.sql` is byte-identical since 2026-07-31 (PR #21) and the
  CLI pin `2.109.1` is unchanged since the same commit.
- Locally, against PostgreSQL 16 + the shim: whole suite **39 s**, file 15 in **7.2 s**.

### Where the stall occurred, and what that does and does not establish

Files 00–14 completed in **2.2 s total**. `15_acquisition_digest_parity.sql` then emitted its
`create extension` NOTICE and produced nothing for **693 s**. Files 16–70 never started.

Established:

- The stall began **inside file 15's execution window** — after psql began the file, before any TAP
  result. This is not inferred from filename order: the NOTICE originates from line 11 of that file,
  so the file had started.
- It is a **hard stall, not slowness**. The same lane runs all 70 files in 23 s; 693 s is ~30x the
  whole suite for one file that costs under 7 s elsewhere.
- It is **not a property of file 15's SQL**. The identical bytes passed in the same lane 17 hours
  earlier, and pass in the shim lane on the same SHA. Something environmental changed; nothing in the
  repository did.

Not established, and deliberately not claimed: whether the cause was a lock wait, a wedged
client/server socket, container I/O, or resource pressure. **The runner captured no evidence, so the
cause cannot be named.** That absence of evidence is the defect this work order actually owns.

### The four defects that made the failure uninformative

1. **Inverted timeout hierarchy.** `DB_TEST_SUITE_TIMEOUT_MS` defaulted to 900,000 ms under a
   720,000 ms step. The runner's own guard was unreachable code; GitHub's opaque step kill always
   won. The shim lane had the same shape (600,000 ms per file under a 600,000 ms step — equal, so
   still no room to react).
2. **No observation.** `stdio: 'inherit'` meant the parent never saw a byte, so nothing could notice
   that output had stopped or photograph the stall while it was happening.
3. **No process-group cleanup.** `spawnSync`'s timeout kills only the direct child; the step timeout
   kills only the step shell. Eight descendants survived both.
4. **No progress records in the stack lane.** One opaque spawn, versus the shim lane's per-file
   logging.

### What changed

New: `scripts/db/budgets.mjs` (the hierarchy and its invariant), `scripts/db/processGroup.mjs`
(TERM → bounded KILL of a whole group), `scripts/db/supervisor.mjs` (bounded, observed child),
`scripts/db/progress.mjs` (unambiguous position from completion order), `scripts/db/diagnostics.mjs`
+ `scripts/db/diagnose.mjs` (the evidence bundle), `scripts/db/suiteManifest.mjs` +
`scripts/db/suite-manifest.json` (the inventory contract), `scripts/db/runner-proof.mjs`, four
`node --test` suites, and `docs/runbooks/shadow-database-ci-lanes.md`.

Changed: `scripts/db/test.mjs` (rewritten around the above), `.github/workflows/ci.yml` (budgets
declared to the runner, a failure-diagnostics step per lane, forced container removal, the new
self-tests, the runner proof), `package.json` (test script plus `db:manifest`, `db:diagnose`,
`db:proof`).

**No SQL, no migration, no application code, no client code.**
`git diff --stat 77a019a -- supabase/ server/ client/` is empty. WO3 behaviour and PR #81 are
untouched.

### The hierarchy, and why it cannot invert again

```
per-file  <  suite deadline  <  reset + suite + reserve  <=  step  <  job
```

| | stack lane | shim lane |
| --- | --- | --- |
| per-file / suite / reset | n/a / 300 s / 120 s | 240 s / 330 s / 90 s |
| silence probe / kill grace / reserve | 90 s / 15 s / 240 s | n/a / 10 s / 120 s |
| step → job (`ci.yml`) | 12 min → 25 min | 10 min → 15 min |

**No timeout was raised.** The step and job caps are exactly what they were; the inner bounds were
brought *below* them and a reserve was carved out for diagnostics and cleanup. The runner checks the
invariant and refuses to run before touching the database if it is violated. CI passes its real caps
in as `DB_TEST_STEP_BUDGET_MS` / `DB_TEST_JOB_BUDGET_MS`, and `scripts/db/budgets.test.mjs` asserts
those still equal the `timeout-minutes` in `ci.yml` — so editing one without the other fails the
build.

### Verification preserved

- 70 files, **2,673 assertions**, unchanged. Nothing deleted, skipped, quarantined or weakened;
  `15_acquisition_digest_parity.sql` and its 4 assertions are asserted present by name in
  `scripts/db/suiteManifest.test.mjs`.
- Both lanes keep their harnesses: the stack lane still runs `supabase test db --local` (pg_prove
  inside the real stack) and the shim lane still runs psql per file. The suite is supervised, not
  replaced.
- **No partitioning.** The suite costs 23 s; splitting it would have added a failure mode for no gain.
- The concurrency assertions and `scripts/db/concurrency-deadline-proof.mjs` are untouched. No sleep
  replaced a durable assertion.
- New: the inventory contract catches a dropped file, a shortened file, **and assertions moved
  between files** (a bare total cannot see the last one).

### Evidence

Local, against PostgreSQL 16 + `scripts/db/shim` (Docker unavailable in this environment):

- `node scripts/db/test.mjs` → `70 files, 2673 assertions, matching the manifest`, 39.0 s, exit 0.
- `node scripts/db/runner-proof.mjs` → **32 proofs, all ok**, exit 0.
- `node --test` across the eight root suites → **135 tests, 135 pass**.
- `npm run test --prefix server` → 37 files, 1057 tests, pass.
- `npm run test --prefix client` → 68 files, 1626 tests, pass.
- `npm run typecheck` → clean. `node scripts/ci/current-state-guard.mjs` → OK.

`runner-proof.mjs` covers: an injected failing assertion attributed to its exact file; a file that
blocks inside the server, ended by the runner in 13.8 s and its abandoned backend swept; a file
omitted from the suite, refused before the database is touched; and — with the pinned CLI stubbed by
a transcript recorded verbatim from the green run `32564005696` — the Supabase lane's clean path, a
pg_prove run that exits 0 while silently dropping a file, and **the 2026-08-23 stall shape
reproduced**, ended by the runner in 13.9 s with a stall warning, the executing file named, the
process group killed with nothing surviving, and the stack stopped.

`supervisor.test.mjs` spawns real processes and proves a grandchild that ignores SIGTERM is still
dead after the group kill — the exact orphan defect CI observed.

### Limits of this work — read before claiming the risk is closed

- **The Supabase lane has not been executed against a real Docker stack by this agent.** No Docker
  daemon is available here. Its code path is proved against a recorded pg_prove transcript, which
  exercises the runner but not Docker, the CLI, or the stack. CI on this branch is the first real
  execution.
- **The underlying stall is not fixed and may recur.** Its cause was environmental and was never
  captured. What is now bounded and observable: a file or suite blocking in the database, a runner
  that stops producing output, a process tree that ignores SIGTERM, a runner exiting 0 with fewer
  files or assertions than declared, and a reset that never finishes. What is *not* eliminated:
  whatever produced the original stall, and Docker / registry / shared-runner behaviour generally.
- One green run on this branch would prove the repair does not break the lane. It would **not** prove
  the intermittent risk is gone. The claim this work supports is narrower and exact: the next
  occurrence produces named, timestamped evidence instead of twelve minutes of silence.

### Not done, deliberately

No merge. No deploy. No Railway or Supabase mutation. No change to PR #81, to WO3 behaviour, to any
migration, or to any SQL semantics. No test skipped, disabled or quarantined. No timeout raised as a
repair. No empty commit or reopen used to kick CI.

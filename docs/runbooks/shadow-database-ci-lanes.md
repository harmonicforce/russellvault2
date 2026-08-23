# Runbook: the shadow-database CI lanes

**Purpose:** what the two database lanes verify, how their timeouts are ordered,
and what to do when one of them hangs.

**Who runs this:** anyone debugging a red `shadow-db-supabase-stack` or
`shadow-db-postgres-shim` job.

## The two lanes

| Lane | Job | Database | Harness | Authority |
| --- | --- | --- | --- | --- |
| Supabase stack | `shadow-db-supabase-stack` | real Supabase stack in Docker | `supabase test db --local` (pg_prove) | **authoritative** |
| Postgres shim | `shadow-db-postgres-shim` | runner's plain PostgreSQL + `scripts/db/shim` | `scripts/db/test.mjs` per file via psql | fast supplement, **not** Supabase parity |

Both execute the identical 70 files in `supabase/tests`. Neither may skip one.

## The inventory contract

`scripts/db/suite-manifest.json` declares every test file and the exact number
of assertions it produces (currently 70 files, 2,673 assertions). Both lanes
check their run against it:

- the shim lane compares **per file**, so assertions moved between files are
  caught, not just assertions deleted;
- the stack lane compares pg_prove's `Files=…, Tests=…` roll-up, and separately
  requires one completion line per declared file.

Changing what the suite verifies is normal. Doing it without the manifest change
appearing in the diff is what this prevents. Regenerate with:

```bash
npm run db:manifest      # psql lane only — it is the lane that sees per-file counts
```

## The timeout hierarchy

`scripts/db/budgets.mjs` states it, and the runner refuses to start if it is
violated:

```
per-file  <  suite deadline  <  reset + suite + reserve  <=  step  <  job
```

| | stack lane | shim lane |
| --- | --- | --- |
| per-file bound | n/a (one child) | 240 s |
| suite deadline | 300 s | 330 s |
| reset bound | 120 s | 90 s |
| silence probe | 90 s | n/a |
| kill grace (TERM→KILL) | 15 s | 10 s |
| reserve | 240 s | 120 s |
| **step** (`ci.yml`) | **12 min** | **10 min** |
| **job** (`ci.yml`) | **25 min** | **15 min** |

`reserve` is the part that used to be missing: when the suite deadline fires the
step must still have time to photograph the stall, kill the process group and
stop the stack. CI passes its real step and job caps in as
`DB_TEST_STEP_BUDGET_MS` / `DB_TEST_JOB_BUDGET_MS`, and
`scripts/db/budgets.test.mjs` asserts those still equal the `timeout-minutes` in
`.github/workflows/ci.yml`. **Editing a timeout in `ci.yml` without editing
`budgets.mjs` fails the build.**

For reference, the measured cost of the whole suite is ~23 s in the stack lane
and ~30 s in the shim lane. Every bound above is at least an order of magnitude
larger; none of them is meant to be reached.

## What a hang looks like now

Before: the log stopped mid-file and, twelve minutes later, said
`The action ... has timed out after 12 minutes`. No file, no exit status, no
database state, and eight orphaned processes.

Now, in order:

1. **`STALL WARNING — no output for 90s`** with the suite position, followed by
   a full diagnostics bundle taken *while the stack is still up*: sanitized
   process tree, container status, `pg_stat_activity`, blocked locks with
   `pg_blocking_pids`, recent database container logs, disk/memory/load.
2. Further warnings at 180 s and 360 s (the interval doubles, capped).
3. At the suite deadline: a second bundle, then the whole process **group** is
   terminated — SIGTERM, a bounded grace, then SIGKILL — and the signal sequence
   is printed along with whether anything survived.
4. A failure line naming the executing file, the last completed file, how many
   files ran and how many never started.
5. Cleanup stops the stack; CI's `if: always()` step force-removes any container
   the clean stop left behind.

The executing file is derived from **completion order**, not from whichever
filename was printed last. When the two indicators disagree the report says so
rather than picking one.

## Reading the diagnostics

- **`suite position`** — start here. It is the only section no external command
  can supply.
- **`PostgreSQL activity`** — a backend in `active` with a large `xact_secs` is
  the suite; one in `idle in transaction` is a leak.
- **`PostgreSQL blocked locks`** — non-empty means a lock wait, and
  `blocked_by` names the holder.
- **empty activity while the runner is still waiting** — the database finished
  and the stall is above it: the CLI wrapper, the container boundary, or output
  transport.
- **`resource pressure`** — a full disk or exhausted memory on a shared runner
  looks exactly like a hang from inside the process.

## Reproducing and proving the runner locally

```bash
node scripts/db/runner-proof.mjs      # or: npm run db:proof
```

Injects a failing assertion, a file that blocks inside the server, a suite that
silently loses a file, and a replayed pg_prove stall, then asserts the runner
names the file, ends the run itself, sweeps the abandoned backend and leaves
nothing behind. It stubs the pinned CLI with a recorded transcript, so it needs
a local PostgreSQL but **not** Docker.

`node scripts/db/diagnose.mjs` prints the bundle on demand.

`DB_TEST_TESTS_DIR` / `DB_TEST_MANIFEST_PATH` exist only for that proof. A run
that sets them prints a `NON-CANONICAL SUITE` banner and marks every summary
line, so such a run can never be mistaken for the governed suite.

## What is bounded now, and what is not

Bounded and observable:

- a file, or the whole suite, that blocks in the database;
- a runner or CLI that stops producing output;
- a child process tree that ignores SIGTERM;
- a runner that exits 0 having run fewer files or assertions than declared;
- a database reset that never finishes.

**Not** eliminated — and not claimable as eliminated:

- whatever caused the underlying 2026-08-23 stall. The suite bytes were
  identical to the run that passed 17 hours earlier, so the cause was
  environmental; the runner captured nothing, so it cannot be named. The repair
  makes the *next* occurrence produce evidence instead of silence. It does not
  make the occurrence less likely.
- Docker, image-registry, and shared-runner behaviour generally. These sit
  outside the repository.

If the stack lane hangs again, the diagnostics bundle in the log is the
artefact: attach it to the follow-up rather than re-running and hoping.

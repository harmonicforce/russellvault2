// The time budgets for the shadow-database lanes, and the invariant that keeps
// them ordered.
//
// The defect
// ----------
// scripts/db/test.mjs defaulted DB_TEST_SUITE_TIMEOUT_MS to 900_000 ms while
// the CI step that invoked it was capped at 12 minutes (720_000 ms). The inner
// guard therefore could NEVER fire: GitHub always killed the step first. That
// is why the 2026-08-23 failures produced no file attribution, no exit status
// and no diagnostics -- the code that would have produced them was unreachable.
// The shim lane was the same shape, with a 600_000 ms per-file bound under a
// 600_000 ms step: equal, so still no room to react.
//
// The repair is not "make the number bigger". It is to state the hierarchy
// explicitly, check it before a single test runs, and fail loudly if anyone
// inverts it again:
//
//     per-file  <  suite deadline  <  suite + reserve  <=  step  <  job
//
// `reserve` is the part that was missing entirely. When the suite deadline
// fires, the step must still have time left to photograph the stall, kill the
// process group, and stop the stack. A deadline that leaves no room for its own
// aftermath just relocates the silent kill.
//
// CI passes its real step and job caps in through the environment, and
// scripts/db/budgets.test.mjs asserts those match .github/workflows/ci.yml, so
// the numbers here cannot drift away from the numbers that actually apply.

export const LANES = ['supabase-cli', 'psql'];

/**
 * stepMinutes/jobMinutes mirror .github/workflows/ci.yml. They are the
 * DOCUMENTED expectation; the environment values CI passes are the operative
 * ones. A unit test proves the two agree.
 */
export const LANE_BUDGETS = Object.freeze({
  'supabase-cli': Object.freeze({
    lane: 'supabase-cli',
    // One opaque child (the Supabase CLI running pg_prove), so there is no
    // per-file bound to set; the silence detector provides the early warning.
    fileMs: null,
    suiteMs: 300_000,   //  5 min. The whole suite has been measured at 23 s.
    resetMs: 120_000,   //  2 min for `supabase db reset --local` (measured 31 s).
    silenceMs: 90_000,  // photograph a stall long before the deadline.
    graceMs: 15_000,    // SIGTERM head start so docker can unwind cleanly.
    reserveMs: 240_000, //  4 min for diagnostics + group kill + stack stop. Sized
                        //  against the WORST case where every probe times out.
    stepMinutes: 12,
    jobMinutes: 25,
  }),
  psql: Object.freeze({
    lane: 'psql',
    fileMs: 240_000,    //  4 min per file; the slowest measured file is 7.2 s,
                        //  and the historical worst case under load was ~180 s.
    suiteMs: 330_000,   //  5.5 min for all 70 files (measured ~30 s).
    resetMs: 90_000,
    silenceMs: 0,       // per-file logging already names the file; not needed.
    graceMs: 10_000,
    reserveMs: 120_000, //  2 min for diagnostics + the backend sweep.
    stepMinutes: 10,
    jobMinutes: 15,
  }),
});

const OVERRIDES = Object.freeze({
  fileMs: 'DB_TEST_FILE_TIMEOUT_MS',
  suiteMs: 'DB_TEST_SUITE_TIMEOUT_MS',
  resetMs: 'DB_TEST_RESET_TIMEOUT_MS',
  silenceMs: 'DB_TEST_SILENCE_MS',
  graceMs: 'DB_TEST_KILL_GRACE_MS',
  reserveMs: 'DB_TEST_RESERVE_MS',
});

function positiveNumber(name, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name}=${JSON.stringify(raw)} is not a non-negative number of milliseconds`);
  }
  return value;
}

/**
 * Resolve a lane's budgets, applying environment overrides and reading the CI
 * step/job caps when they are supplied.
 */
export function resolveBudgets(lane, env = process.env) {
  const base = LANE_BUDGETS[lane];
  if (!base) throw new Error(`unknown shadow-database lane ${JSON.stringify(lane)}`);

  const resolved = { ...base };
  for (const [key, variable] of Object.entries(OVERRIDES)) {
    const raw = env[variable];
    if (raw === undefined || raw === '') continue;
    if (base[key] === null) continue; // this lane has no such bound to override
    resolved[key] = positiveNumber(variable, raw);
  }

  resolved.stepMs = env.DB_TEST_STEP_BUDGET_MS
    ? positiveNumber('DB_TEST_STEP_BUDGET_MS', env.DB_TEST_STEP_BUDGET_MS)
    : base.stepMinutes * 60_000;
  resolved.jobMs = env.DB_TEST_JOB_BUDGET_MS
    ? positiveNumber('DB_TEST_JOB_BUDGET_MS', env.DB_TEST_JOB_BUDGET_MS)
    : base.jobMinutes * 60_000;
  resolved.stepBudgetDeclared = Boolean(env.DB_TEST_STEP_BUDGET_MS);

  return resolved;
}

/**
 * The invariant. Returns every violation rather than the first, because a
 * misconfigured hierarchy usually breaks in more than one place at once and
 * fixing them one CI round at a time is how the original defect survived.
 */
export function checkHierarchy(budgets) {
  const problems = [];
  const seconds = (ms) => `${(ms / 1000).toFixed(0)}s`;

  if (budgets.fileMs !== null && budgets.fileMs >= budgets.suiteMs) {
    problems.push(
      `per-file bound ${seconds(budgets.fileMs)} is not less than the suite deadline `
      + `${seconds(budgets.suiteMs)}: a single stuck file could never be attributed before the suite gave up`,
    );
  }
  if (budgets.resetMs + budgets.suiteMs + budgets.reserveMs > budgets.stepMs) {
    problems.push(
      `reset ${seconds(budgets.resetMs)} + suite ${seconds(budgets.suiteMs)} + reserve `
      + `${seconds(budgets.reserveMs)} exceeds the step budget ${seconds(budgets.stepMs)}: the step would be `
      + 'killed by CI before this runner could report, which is the exact defect this hierarchy exists to prevent',
    );
  }
  if (budgets.reserveMs <= budgets.graceMs) {
    problems.push(
      `reserve ${seconds(budgets.reserveMs)} leaves no room beyond the kill grace period `
      + `${seconds(budgets.graceMs)}: diagnostics and cleanup would be cut off`,
    );
  }
  if (budgets.stepMs >= budgets.jobMs) {
    problems.push(
      `step budget ${seconds(budgets.stepMs)} is not less than the job budget ${seconds(budgets.jobMs)}: `
      + 'a step overrun would surface as a cancelled job rather than a failed step',
    );
  }
  if (budgets.silenceMs > 0 && budgets.silenceMs >= budgets.suiteMs) {
    problems.push(
      `silence probe ${seconds(budgets.silenceMs)} is not less than the suite deadline `
      + `${seconds(budgets.suiteMs)}: a stall would never be photographed`,
    );
  }

  return { ok: problems.length === 0, problems };
}

/** A one-block description for the top of the CI log. */
export function describeBudgets(budgets) {
  const s = (ms) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(0)}s`);
  return [
    `db:test — lane ${budgets.lane}; bounds: per-file ${s(budgets.fileMs)} < suite ${s(budgets.suiteMs)}`,
    `db:test — reset ${s(budgets.resetMs)}, silence probe ${s(budgets.silenceMs)}, kill grace ${s(budgets.graceMs)}`,
    `db:test — reserve ${s(budgets.reserveMs)} held back inside step ${s(budgets.stepMs)}`
      + `${budgets.stepBudgetDeclared ? ' (declared by CI)' : ' (assumed from ci.yml; CI did not declare one)'}`
      + `, job ${s(budgets.jobMs)}`,
  ].join('\n');
}

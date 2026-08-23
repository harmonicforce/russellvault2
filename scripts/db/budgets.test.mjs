// The timeout hierarchy, and its agreement with the CI file that enforces it.
//
// The 2026-08-23 failure was not a slow test. It was an inverted hierarchy: the
// runner's suite bound (900 s) sat OUTSIDE the CI step (720 s), so the runner's
// own guard was unreachable code and GitHub's opaque step kill always won.
// These tests exist so that inversion cannot come back — including by way of
// somebody editing ci.yml and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANES, LANE_BUDGETS, resolveBudgets, checkHierarchy, describeBudgets } from './budgets.mjs';
import { ROOT } from './suiteManifest.mjs';

const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** Extract one job's YAML block by name (up to the next job at the same indent). */
function jobBlock(name) {
  const start = CI.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `job ${name} is missing from ci.yml`);
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The job-level timeout-minutes (four-space indent, directly under the job). */
function jobTimeoutMinutes(block) {
  const match = /\n {4}timeout-minutes: (\d+)\n/.exec(block);
  assert.notEqual(match, null, 'the job declares no timeout-minutes');
  return Number(match[1]);
}

/** The timeout-minutes and declared budgets of the step running a lane's command. */
function laneStep(block, commandPattern) {
  const steps = block.split(/\n {6}- name: /).slice(1);
  // The split consumes the trailing newline of the last line, so anchor on
  // end-of-line rather than requiring one.
  const step = steps.find((body) => commandPattern.test(body));
  assert.notEqual(step, undefined, `no step in this job runs a command matching ${commandPattern}`);
  const timeout = /\n {8}timeout-minutes: (\d+)\n/.exec(step);
  assert.notEqual(timeout, null, 'the db:test step declares no timeout-minutes');
  const stepBudget = /DB_TEST_STEP_BUDGET_MS: '(\d+)'/.exec(step);
  const jobBudget = /DB_TEST_JOB_BUDGET_MS: '(\d+)'/.exec(step);
  assert.notEqual(stepBudget, null, 'the db:test step does not declare DB_TEST_STEP_BUDGET_MS');
  assert.notEqual(jobBudget, null, 'the db:test step does not declare DB_TEST_JOB_BUDGET_MS');
  return {
    timeoutMinutes: Number(timeout[1]),
    stepBudgetMs: Number(stepBudget[1]),
    jobBudgetMs: Number(jobBudget[1]),
  };
}

/**
 * Which CI job and step each lane's budgets describe. A lane may share a job
 * with another lane (type generation runs in the Supabase job, against the
 * stack that job already started) but always owns its own step and its own
 * declared budgets.
 */
const CI_LANES = {
  'supabase-cli': { job: 'shadow-db-supabase-stack', command: /^\s*\S*\s*npm run db:test\s*$/m },
  psql: { job: 'shadow-db-postgres-shim', command: /^\s*\S*\s*npm run db:test\s*$/m },
  // Matched by what the step DOES rather than by one exact command line: the
  // type-generation step is invoked as `npm run db:types:*` in steady state
  // and as a direct CLI call during the Work Order 4 bootstrap, and both are
  // the step whose budgets this lane describes.
  'gen-types': {
    job: 'shadow-db-supabase-stack',
    command: /npm run db:types:(check|write)\b|gen types typescript --local/,
  },
};

test('no step name carries an unquoted colon, which silently breaks the whole workflow', () => {
  // A `- name: Test (runner: budgets)` line parses as a nested mapping, and
  // GitHub rejects the entire file: the run completes as a failure with ZERO
  // jobs, which looks nothing like a test failure. Caught here because these
  // tests read ci.yml anyway, and adding a YAML parser as a dependency to
  // catch one syntax class is not worth it.
  const offenders = CI.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const match = /^\s*- name: (?!['"])(.*)$/.exec(line);
      return match !== null && match[1].includes(': ');
    });
  assert.deepEqual(offenders, [],
    `quote these step names in ci.yml: ${offenders.map((o) => `line ${o.number}`).join(', ')}`);
});

test('every lane satisfies the hierarchy with its shipped defaults', () => {
  for (const lane of LANES) {
    const result = checkHierarchy(resolveBudgets(lane, {}));
    assert.equal(result.ok, true, `${lane}: ${result.problems.join('; ')}`);
  }
});

test('the declared step and job budgets match ci.yml exactly', () => {
  for (const lane of LANES) {
    const block = jobBlock(CI_LANES[lane].job);
    const step = laneStep(block, CI_LANES[lane].command);
    const declared = LANE_BUDGETS[lane];

    assert.equal(step.timeoutMinutes, declared.stepMinutes,
      `${lane}: ci.yml caps the db:test step at ${step.timeoutMinutes} min but budgets.mjs assumes ${declared.stepMinutes}`);
    assert.equal(jobTimeoutMinutes(block), declared.jobMinutes,
      `${lane}: ci.yml caps the job at a different value than budgets.mjs assumes`);
    assert.equal(step.stepBudgetMs, declared.stepMinutes * 60_000,
      `${lane}: DB_TEST_STEP_BUDGET_MS does not equal the step's own timeout-minutes`);
    assert.equal(step.jobBudgetMs, declared.jobMinutes * 60_000,
      `${lane}: DB_TEST_JOB_BUDGET_MS does not equal the job's own timeout-minutes`);
  }
});

test('the hierarchy holds against the budgets CI actually passes in', () => {
  for (const lane of LANES) {
    const step = laneStep(jobBlock(CI_LANES[lane].job), CI_LANES[lane].command);
    const budgets = resolveBudgets(lane, {
      DB_TEST_STEP_BUDGET_MS: String(step.stepBudgetMs),
      DB_TEST_JOB_BUDGET_MS: String(step.jobBudgetMs),
    });
    assert.equal(budgets.stepBudgetDeclared, true);
    const result = checkHierarchy(budgets);
    assert.equal(result.ok, true, `${lane}: ${result.problems.join('; ')}`);
  }
});

test('the exact defect that broke main is rejected, with a message naming it', () => {
  // The shipped value on 2026-08-23: a 900 s suite bound under a 720 s step.
  const budgets = resolveBudgets('supabase-cli', {
    DB_TEST_SUITE_TIMEOUT_MS: '900000',
    DB_TEST_STEP_BUDGET_MS: '720000',
  });
  const result = checkHierarchy(budgets);
  assert.equal(result.ok, false, 'the original inverted hierarchy must not be accepted');
  assert.match(result.problems.join(' '), /exceeds the step budget/);
});

test('a per-file bound at or above the suite bound is rejected', () => {
  // The shim lane's other latent inversion: a 600 s per-file bound under a
  // 600 s step left no room to attribute anything.
  const equal = checkHierarchy(resolveBudgets('psql', {
    DB_TEST_FILE_TIMEOUT_MS: '330000', DB_TEST_STEP_BUDGET_MS: '600000',
  }));
  assert.equal(equal.ok, false);
  assert.match(equal.problems.join(' '), /per-file bound .* is not less than the suite deadline/);
});

test('a reserve too small to survive the kill grace is rejected', () => {
  const result = checkHierarchy(resolveBudgets('psql', { DB_TEST_RESERVE_MS: '5000' }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /leaves no room beyond the kill grace period/);
});

test('a step budget at or above the job budget is rejected', () => {
  const result = checkHierarchy(resolveBudgets('psql', {
    DB_TEST_STEP_BUDGET_MS: '900000', DB_TEST_JOB_BUDGET_MS: '900000',
  }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /not less than the job budget/);
});

test('a silence probe that could never fire before the deadline is rejected', () => {
  const result = checkHierarchy(resolveBudgets('supabase-cli', { DB_TEST_SILENCE_MS: '600000' }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /a stall would never be photographed/);
});

test('every violation is reported at once, not one per CI round', () => {
  const result = checkHierarchy(resolveBudgets('psql', {
    DB_TEST_FILE_TIMEOUT_MS: '400000',
    DB_TEST_RESERVE_MS: '1000',
    DB_TEST_STEP_BUDGET_MS: '900000',
    DB_TEST_JOB_BUDGET_MS: '900000',
  }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.length >= 3, `expected several problems, got ${result.problems.length}`);
});

test('a malformed override is refused rather than silently coerced', () => {
  assert.throws(() => resolveBudgets('psql', { DB_TEST_SUITE_TIMEOUT_MS: 'soon' }), /not a non-negative number/);
  assert.throws(() => resolveBudgets('psql', { DB_TEST_SUITE_TIMEOUT_MS: '-1' }), /not a non-negative number/);
  assert.throws(() => resolveBudgets('nonexistent-lane', {}), /unknown shadow-database lane/);
});

test('the description states the hierarchy in the order it must hold', () => {
  const text = describeBudgets(resolveBudgets('psql', {}));
  assert.match(text, /per-file 240s < suite 330s/);
  assert.match(text, /reserve 120s held back inside step 600s/);
});

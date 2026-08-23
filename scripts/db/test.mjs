#!/usr/bin/env node
// Local shadow-database SQL test runner.
//
// Two lanes, both bounded, both observable, both proved against the same
// declared inventory:
//
//   psql (default)        — resets the local shadow database, then runs every
//                           pgTAP file in supabase/tests through psql and parses
//                           the TAP output. Connections go through
//                           scripts/db/guard.mjs, which refuses every setting
//                           that could redirect psql off the local machine.
//   SHADOW_DB_RUNNER=
//     supabase-cli        — resets the LOCAL Supabase stack with the pinned CLI
//                           and runs the same suite against that same database
//                           via `supabase test db --local` (pg_prove inside the
//                           stack). Requires Docker; never touches a linked or
//                           remote project.
//
// What changed in Work Order 11, and why
// --------------------------------------
// On 2026-08-23 the Supabase lane hung and CI learned nothing from it. The
// suite normally finishes in 23 seconds; the step ran for 12 minutes and was
// killed by GitHub with one line of output, no file attribution, no exit
// status, and eight orphaned processes. Both attempts failed identically, so
// re-running was never going to produce evidence.
//
// Four defects made that outcome inevitable, and all four are addressed here:
//
//   1. The inner suite timeout (900 s) was LONGER than the CI step (720 s), so
//      the runner's own guard was unreachable code. scripts/db/budgets.mjs now
//      states the hierarchy and refuses to start if it is inverted.
//   2. The child ran with `stdio: 'inherit'`, so nothing could notice that
//      output had stopped. Output is now observed as it streams (and still
//      forwarded verbatim), which drives both progress records and a silence
//      detector that photographs a stall long before the deadline.
//   3. Killing the child killed only the child. Every child is now spawned in
//      its own process group and terminated as a group, TERM then bounded KILL.
//   4. Nothing was ever captured about the database, the containers, or the
//      machine. scripts/db/diagnostics.mjs now does that on every stall and
//      every failure.
//
// The suite itself is untouched: same 70 files, same 2,673 assertions, same
// pg_prove harness inside the same stack. This changes what we can SEE when it
// misbehaves, not what it verifies.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { buildLocalConnection } from './guard.mjs';
import { pinnedCliVersion } from './reset.mjs';
import { resolveBudgets, checkHierarchy, describeBudgets } from './budgets.mjs';
import { superviseProcess, OUTCOME } from './supervisor.mjs';
import { terminateGroup, isGroupAlive } from './processGroup.mjs';
import { createProgressTracker } from './progress.mjs';
import { collectDiagnostics, renderDiagnostics } from './diagnostics.mjs';
import {
  ROOT, resolveSuitePaths, listTestFiles, readManifest, writeManifest,
  checkInventory, checkExecution, checkSummary,
} from './suiteManifest.mjs';

const LANE = process.env.SHADOW_DB_RUNNER === 'supabase-cli' ? 'supabase-cli' : 'psql';
const WRITE_MANIFEST = process.argv.includes('--write-manifest');
const SUITE = resolveSuitePaths(process.env);
/** Appended to every summary line when the suite under test is not the real one. */
const SUITE_MARK = SUITE.overridden ? ' [NON-CANONICAL SUITE DIRECTORY]' : '';

const log = (message) => console.log(`db:test — ${message}`);
const logError = (message) => console.error(`db:test — ${message}`);

/** Process groups this run has started and has not yet reaped. */
const liveGroups = new Set();

function fail(message) {
  logError(message);
  cleanup('failure');
  process.exit(1);
}

/**
 * Always-run cleanup: terminate anything this run started that is still alive,
 * and, in the Supabase lane, stop the stack. Both are bounded. This runs on the
 * success path too, where it is a no-op that PROVES nothing was left behind.
 */
function cleanup(reason) {
  const survivors = [...liveGroups].filter((pgid) => isGroupAlive(pgid));
  if (survivors.length > 0) {
    logError(`cleanup (${reason}) — ${survivors.length} process group(s) still alive: ${survivors.join(', ')}`);
    for (const pgid of survivors) {
      // Synchronous last resort: cleanup may run from an exit path where no
      // further awaiting is possible.
      try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  liveGroups.clear();

  if (LANE === 'supabase-cli' && reason !== 'success') {
    const pinned = pinnedCliVersion();
    log('cleanup — stopping the local Supabase stack');
    const stopped = spawnSync('npx', ['--yes', `supabase@${pinned}`, 'stop'], {
      cwd: ROOT, stdio: 'inherit', timeout: 90_000, killSignal: 'SIGKILL',
    });
    if (stopped.status !== 0) {
      logError('cleanup — `supabase stop` did not exit cleanly; CI\'s always() stop step is the backstop');
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logError(`received ${signal}`);
    cleanup(signal);
    process.exit(1);
  });
}

function emitDiagnostics({ budgets, phase, reason, position, elapsedMs, psqlConnection }) {
  const sections = collectDiagnostics({
    lane: budgets.lane, phase, reason, position, elapsedMs, psqlConnection,
  });
  console.error(renderDiagnostics(sections, { heading: `db:test diagnostics (${phase})` }));
}

// --- shared: run a child under the hierarchy, with group cleanup ------------

async function supervised({ command, args, budgets, deadlineMs, phase, onLine, onSilence, onDeadline, stdout, stderr }) {
  let pgid = null;
  const result = await superviseProcess({
    command,
    args,
    cwd: ROOT,
    deadlineMs,
    silenceMs: budgets.silenceMs,
    graceMs: budgets.graceMs,
    onLine,
    onSilence,
    onDeadline,
    stdout,
    stderr,
    // Wrapped only to record the group id, so cleanup can prove afterwards
    // that nothing this run started is still alive.
    spawn: (cmd, argv, options) => {
      const child = spawn(cmd, argv, options);
      pgid = child.pid;
      if (pgid) liveGroups.add(pgid);
      return child;
    },
  });
  if (pgid) liveGroups.delete(pgid);
  return { ...result, phase };
}

// --- phase: reset ------------------------------------------------------------

async function resetFirst(budgets) {
  log('phase reset — starting');
  const startedAt = Date.now();
  const result = await supervised({
    command: process.execPath,
    args: [join(ROOT, 'scripts', 'db', 'reset.mjs')],
    budgets: { ...budgets, silenceMs: 0 },
    deadlineMs: budgets.resetMs,
    phase: 'reset',
    onDeadline: ({ elapsedMs }) => emitDiagnostics({
      budgets, phase: 'reset', reason: `reset exceeded ${budgets.resetMs} ms`,
      position: 'the database reset never completed; no test file had started', elapsedMs,
    }),
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.outcome === OUTCOME.deadline) {
    fail(`phase reset — exceeded ${budgets.resetMs} ms and the process group was terminated `
      + `(${describeTermination(result.termination)}) — treated as a FAILURE`);
  }
  if (result.outcome === OUTCOME.spawnFailed) fail(`phase reset — could not start: ${result.spawnError?.message}`);
  if (result.status !== 0) fail(`phase reset — exited with status ${result.status} after ${seconds}s; aborting tests`);
  log(`phase reset — complete (${seconds}s)`);
}

function describeTermination(termination) {
  if (!termination) return 'no termination was attempted';
  const steps = termination.steps.map((step) => `${step.signal}:${step.result}`).join(' → ');
  const outcome = termination.survived
    ? 'PROCESSES SURVIVED THE KILL'
    : `group gone after ${(termination.waitedMs / 1000).toFixed(1)}s`;
  return `${steps || 'no signal needed'}; ${outcome}`;
}

// --- lane: Supabase local stack ---------------------------------------------

async function runWithSupabaseCli(budgets, manifest, files) {
  const pinned = pinnedCliVersion();
  await resetFirst(budgets);

  const tracker = createProgressTracker(files);
  log(`phase suite — running ${files.length} pgTAP files inside the local Supabase stack (CLI ${pinned})`);
  const startedAt = Date.now();
  let lastReportAt = startedAt;

  const onLine = (line) => {
    const completion = tracker.observe(line);
    if (!completion) return;
    const state = tracker.state();
    const now = Date.now();
    // An explicit, machine-greppable progress record per file. pg_prove reports
    // only on completion, so the interval is the time since the previous
    // completion — labelled as such rather than presented as the file's cost.
    log(
      `progress ${String(state.completedCount).padStart(2, '0')}/${state.totalFiles} `
      + `completed ${completion.file} [${completion.verdict}] `
      + `(+${((now - lastReportAt) / 1000).toFixed(1)}s, ${((now - startedAt) / 1000).toFixed(1)}s elapsed)`
      + `${state.currentFile ? ` → now running ${state.currentFile}` : ' → suite finishing'}`,
    );
    lastReportAt = now;
  };

  const result = await supervised({
    command: 'npx',
    args: ['--yes', `supabase@${pinned}`, 'test', 'db', '--local'],
    budgets,
    deadlineMs: budgets.suiteMs,
    phase: 'suite',
    onLine,
    onSilence: ({ silentMs, elapsedMs }) => {
      logError(
        `STALL WARNING — no output for ${(silentMs / 1000).toFixed(0)}s `
        + `(${(elapsedMs / 1000).toFixed(0)}s into the suite). Position: ${tracker.describePosition()}`,
      );
      // Photographed while the stack is still up. This is the evidence the
      // 2026-08-23 failures could not produce.
      emitDiagnostics({
        budgets, phase: 'suite', reason: `no output for ${(silentMs / 1000).toFixed(0)}s`,
        position: tracker.describePosition(), elapsedMs,
      });
    },
    onDeadline: ({ elapsedMs }) => emitDiagnostics({
      budgets, phase: 'suite', reason: `suite exceeded ${budgets.suiteMs} ms`,
      position: tracker.describePosition(), elapsedMs,
    }),
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const state = tracker.state();

  if (result.outcome === OUTCOME.deadline) {
    fail(
      `phase suite — exceeded ${budgets.suiteMs} ms after ${elapsed}s and the process group was terminated `
      + `(${describeTermination(result.termination)}). Position: ${tracker.describePosition()}. `
      + `Completed ${state.completedCount}/${state.totalFiles}; not started: ${state.notStarted.length} file(s). `
      + 'Treated as a FAILURE, never a pass.',
    );
  }
  if (result.outcome === OUTCOME.spawnFailed) fail(`phase suite — supabase CLI failed to start: ${result.spawnError?.message}`);

  if (result.signal) {
    emitDiagnostics({ budgets, phase: 'suite', reason: `killed by ${result.signal}`, position: tracker.describePosition(), elapsedMs: Date.now() - startedAt });
    fail(`phase suite — supabase test db was killed by ${result.signal} after ${elapsed}s — treated as a FAILURE`);
  }
  if (result.status !== 0) {
    emitDiagnostics({ budgets, phase: 'suite', reason: `exit status ${result.status}`, position: tracker.describePosition(), elapsedMs: Date.now() - startedAt });
    const named = state.failures.length > 0
      ? ` Failing file(s): ${state.failures.map((f) => `${f.file} (${f.verdict})`).join(', ')}.`
      : ' pg_prove named no failing file; see the output above.';
    fail(`phase suite — supabase test db exited with ${result.status} after ${elapsed}s.${named}`);
  }

  // pg_prove exited 0. Prove that it actually ran the declared suite.
  const summary = checkSummary(manifest, state.summary);
  if (!summary.ok) fail(`phase verify — ${summary.problems.join('; ')}`);
  if (state.completedCount !== files.length) {
    fail(
      `phase verify — the runner exited successfully but reported ${state.completedCount} of `
      + `${files.length} file completions; ${files.length - state.completedCount} file(s) produced no result line`,
    );
  }

  log(`phase suite — passed in ${elapsed}s: ${state.summary.files} files, ${state.summary.tests} assertions, matching the manifest${SUITE_MARK}`);
}

// --- lane: plain psql --------------------------------------------------------

async function runWithPsql(budgets, manifest, files) {
  await resetFirst(budgets);
  const conn = buildLocalConnection(process.env);

  const observed = {};
  let failed = false;
  const suiteStartedAt = Date.now();
  const suiteDeadlineAt = suiteStartedAt + budgets.suiteMs;

  log(`phase suite — running ${files.length} pgTAP files through psql`);

  for (const [index, file] of files.entries()) {
    const position = () =>
      `file ${index + 1}/${files.length} ${file}, `
      + `${index} completed, ${files.length - index - 1} not started`;

    const remaining = suiteDeadlineAt - Date.now();
    if (remaining <= 0) {
      emitDiagnostics({
        budgets, phase: 'suite', reason: `suite exceeded ${budgets.suiteMs} ms`,
        position: position(), elapsedMs: Date.now() - suiteStartedAt, psqlConnection: conn,
      });
      sweepBackends(conn);
      fail(
        `phase suite — the suite deadline (${budgets.suiteMs} ms) elapsed before ${file} could start; `
        + `${files.length - index} file(s) were not run — treated as a FAILURE`,
      );
    }

    // Announced BEFORE the run: a blocked file must name itself in the log.
    log(`progress ${String(index + 1).padStart(2, '0')}/${files.length} started ${file}`);
    const startedAt = Date.now();
    const out = [];
    const sink = { write: (text) => { out.push(text); } };

    const result = await supervised({
      command: 'psql',
      args: ['-X', '-v', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet',
        ...conn.hostArgs, '-d', conn.dbName, '-f', join(SUITE.testsDir, file)],
      budgets: { ...budgets, silenceMs: 0 },
      // A file may never outlive the suite: take whichever bound bites first.
      deadlineMs: Math.min(budgets.fileMs, Math.max(1, suiteDeadlineAt - Date.now())),
      phase: 'suite',
      stdout: sink,
      stderr: sink,
      onDeadline: ({ elapsedMs }) => emitDiagnostics({
        budgets, phase: 'suite', reason: `${file} produced no result within its bound`,
        position: position(), elapsedMs, psqlConnection: conn,
      }),
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const text = out.join('');

    if (result.outcome === OUTCOME.deadline) {
      logError(`TIMEOUT ${file} after ${seconds}s (${describeTermination(result.termination)}) — a FAILURE, not a pass`);
      logError(text.trim());
      // Killing psql does NOT stop the statement it submitted: that backend
      // keeps running and holds its locks, so every later file touching the
      // same fixtures blocks behind it and one timeout becomes a cascade of
      // unrelated ones. Sweep what the abandoned file left behind, then stop —
      // once a file has been killed mid-transaction the database is no longer
      // in a state the remaining files can be trusted against.
      sweepBackends(conn);
      fail(`aborted after ${file} timed out; ${files.length - index - 1} remaining file(s) were not run`);
    }
    if (result.outcome === OUTCOME.spawnFailed) fail(`psql failed to start for ${file}: ${result.spawnError?.message}`);

    const okCount = (text.match(/^ok \d+/gm) || []).length;
    const notOk = text.match(/^not ok .*$/gm) || [];
    const skipped = /^1\.\.0(\s|$)/m.test(text);

    if (result.status !== 0 || notOk.length > 0 || (okCount === 0 && !skipped)) {
      failed = true;
      logError(`FAIL ${file} (exit ${result.status}, ${okCount} ok, ${notOk.length} not ok, ${seconds}s)`);
      logError(text.trim());
    } else {
      observed[file] = okCount;
      log(`progress ${String(index + 1).padStart(2, '0')}/${files.length} passed ${file} `
        + `(${skipped ? 'skipped' : `${okCount} assertions`}, ${seconds}s)`);
    }
  }

  if (failed) {
    emitDiagnostics({
      budgets, phase: 'verify', reason: 'one or more test files failed',
      position: `${Object.keys(observed).length}/${files.length} files passed`,
      elapsedMs: Date.now() - suiteStartedAt, psqlConnection: conn,
    });
    fail('one or more test files failed');
  }

  if (WRITE_MANIFEST) {
    const written = writeManifest(observed, SUITE.manifestPath);
    log(`wrote suite manifest: ${written.fileCount} files, ${written.totalAssertions} assertions`);
    return;
  }

  const execution = checkExecution(manifest, observed);
  if (!execution.ok) fail(`phase verify — ${execution.problems.join('; ')}`);

  const elapsed = ((Date.now() - suiteStartedAt) / 1000).toFixed(1);
  log(`phase suite — passed in ${elapsed}s: ${files.length} files, ${execution.observedTotal} assertions, matching the manifest${SUITE_MARK}`);
}

function sweepBackends(conn) {
  const swept = spawnSync(
    'psql',
    ['-X', '--no-align', '--tuples-only', '--quiet', ...conn.hostArgs, '-d', conn.dbName,
      '-c', 'select pg_terminate_backend(pid) from pg_stat_activity '
        + 'where datname = current_database() and pid <> pg_backend_pid()'],
    { encoding: 'utf8', env: conn.env, timeout: 30_000, killSignal: 'SIGKILL' },
  );
  if (swept.status !== 0) logError('WARNING: could not sweep backends left by the timed-out file');
}

// --- entry point -------------------------------------------------------------

async function main() {
  const budgets = resolveBudgets(LANE, process.env);
  const hierarchy = checkHierarchy(budgets);
  console.log(describeBudgets(budgets));
  if (!hierarchy.ok) {
    // Refuse BEFORE spending a single second of the step. An inverted hierarchy
    // means any failure would be reported by CI as an opaque timeout, which is
    // strictly worse than not running at all.
    fail(`refusing to run — the timeout hierarchy is inverted:\n  - ${hierarchy.problems.join('\n  - ')}`);
  }

  if (SUITE.overridden) {
    logError('=================================================================');
    logError('NON-CANONICAL SUITE: DB_TEST_TESTS_DIR / DB_TEST_MANIFEST_PATH are set.');
    logError(`  tests:    ${SUITE.testsDir}`);
    logError(`  manifest: ${SUITE.manifestPath}`);
    logError('This run does NOT verify the governed pgTAP suite. Only the runner\'s');
    logError('own self-proof sets these; a CI lane that does is misconfigured.');
    logError('=================================================================');
  }

  const files = listTestFiles(SUITE.testsDir);
  if (files.length === 0) fail(`no test files found in ${SUITE.testsDir}`);

  let manifest = null;
  if (!WRITE_MANIFEST) {
    manifest = readManifest(SUITE.manifestPath);
    const inventory = checkInventory(manifest, files);
    if (!inventory.ok) fail(`phase verify — ${inventory.problems.join('; ')}`);
    log(`inventory verified — ${files.length} declared test files present${SUITE_MARK}`);
  } else if (LANE !== 'psql') {
    fail('--write-manifest requires the psql lane: only it observes per-file assertion counts');
  }

  if (LANE === 'supabase-cli') await runWithSupabaseCli(budgets, manifest, files);
  else await runWithPsql(budgets, manifest, files);

  cleanup('success');
}

main().catch((error) => {
  logError(`unexpected runner failure: ${error?.stack ?? error}`);
  cleanup('exception');
  process.exit(1);
});

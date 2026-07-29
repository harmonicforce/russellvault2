#!/usr/bin/env node
// Local shadow-database SQL test runner.
//
// Default runner: resets the local shadow database (scripts/db/reset.mjs),
// then runs every pgTAP file in supabase/tests against it via psql and parses
// the TAP output. Fails on any `not ok`, any SQL error, or a file that
// produces no `ok` lines. Connections go through scripts/db/guard.mjs, which
// refuses every setting that could redirect psql off the local machine.
//
// SHADOW_DB_RUNNER=supabase-cli: resets the LOCAL Supabase stack with the
// pinned CLI and then runs the same pgTAP suite against that same stack
// database via `supabase test db --local` (pg_prove inside the stack).
// Requires Docker and a started local stack; never touches a linked or
// remote project.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalConnection } from './guard.mjs';
import { pinnedCliVersion } from './reset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TESTS_DIR = join(ROOT, 'supabase', 'tests');

// Every test process must be bounded. Without this a file that blocks -- for
// example a concurrency harness waiting on a peer session that can never
// finish -- holds the runner open until the CI job's own timeout fires, which
// reports as a cancelled job rather than a failed test. A timeout here is
// always a FAILURE, never a pass.
//
// Deliberately generous. This is the last-resort net, not the primary defence:
// the concurrency harness bounds its own waits at 60s and fails in seconds, so
// nothing here should ever reach this limit. Set too tight it would instead
// convert a merely slow file into a spurious failure --
// 15_acquisition_digest_parity runs in ~10s alone but has been measured past
// 180s under load on a shared runner. The CI steps that invoke this are capped
// at 10-12 minutes, so the job still fails promptly either way.
const FILE_TIMEOUT_MS = Number(process.env.DB_TEST_FILE_TIMEOUT_MS ?? 600_000);
const SUITE_TIMEOUT_MS = Number(process.env.DB_TEST_SUITE_TIMEOUT_MS ?? 900_000);

function fail(message) {
  console.error(`db:test — ${message}`);
  process.exit(1);
}

function resetFirst() {
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'db', 'reset.mjs')], {
    stdio: 'inherit',
  });
  if (res.status !== 0) fail('reset failed; aborting tests');
}

function runWithSupabaseCli() {
  const pinned = pinnedCliVersion();
  resetFirst(); // reset.mjs honors SHADOW_DB_RUNNER and resets the stack DB
  console.log(`db:test — running pgTAP suite inside the local Supabase stack (CLI ${pinned})`);
  const res = spawnSync('npx', ['--yes', `supabase@${pinned}`, 'test', 'db', '--local'], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: SUITE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    fail(`supabase test db exceeded ${SUITE_TIMEOUT_MS} ms and was killed — treated as a FAILURE`);
  }
  if (res.error) fail(`supabase CLI failed to start: ${res.error.message}`);
  if (res.signal) fail(`supabase test db was killed by ${res.signal} — treated as a FAILURE`);
  if (res.status !== 0) fail(`supabase test db exited with ${res.status}`);
  console.log('db:test — supabase local-stack suite passed');
}

function runWithPsql() {
  resetFirst();
  const conn = buildLocalConnection(process.env);

  const files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) fail('no test files found in supabase/tests');

  let totalOk = 0;
  let failed = false;

  for (const file of files) {
    // Announced BEFORE the run: if a file blocks, the log has to name which one.
    console.log(`db:test — running ${file}`);
    const startedAt = Date.now();
    const res = spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet',
        ...conn.hostArgs, '-d', conn.dbName, '-f', join(TESTS_DIR, file)],
      { encoding: 'utf8', env: conn.env, timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' }
    );

    const timedOut = res.error?.code === 'ETIMEDOUT' || Boolean(res.signal);
    if (timedOut) {
      console.error(
        `db:test — TIMEOUT ${file} after ${FILE_TIMEOUT_MS} ms `
        + `(killed by ${res.signal ?? 'timeout'}) — treated as a FAILURE, not a pass`
      );
      console.error(`${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim());
      // Killing psql does NOT stop the statement it submitted: that backend
      // keeps running and holds its locks, so every later file touching the
      // same fixtures blocks behind it and one timeout becomes a cascade of
      // unrelated ones. Sweep what the abandoned file left behind, then stop --
      // once a file has been killed mid-transaction the database is no longer
      // in a state the remaining files can be trusted against.
      const swept = spawnSync(
        'psql',
        ['-X', '--no-align', '--tuples-only', '--quiet', ...conn.hostArgs, '-d', conn.dbName,
          '-c', 'select pg_terminate_backend(pid) from pg_stat_activity '
            + 'where datname = current_database() and pid <> pg_backend_pid()'],
        { encoding: 'utf8', env: conn.env, timeout: 30_000, killSignal: 'SIGKILL' }
      );
      if (swept.status !== 0) {
        console.error('db:test — WARNING: could not sweep backends left by the timed-out file');
      }
      fail(`aborted after ${file} timed out; remaining files were not run`);
    }

    const out = `${res.stdout}\n${res.stderr}`;
    const okCount = (res.stdout.match(/^ok \d+/gm) || []).length;
    const notOk = res.stdout.match(/^not ok .*$/gm) || [];
    const skipped = /^1\.\.0(\s|$)/m.test(res.stdout);

    if (res.status !== 0 || notOk.length > 0 || (okCount === 0 && !skipped)) {
      failed = true;
      console.error(`db:test — FAIL ${file}`);
      console.error(out.trim());
    } else {
      totalOk += okCount;
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `db:test — pass ${file} (${skipped ? 'skipped' : `${okCount} assertions`}, ${seconds}s)`
      );
    }
  }

  if (failed) fail('one or more test files failed');
  console.log(`db:test — all test files passed (${totalOk} assertions)`);
}

if (process.env.SHADOW_DB_RUNNER === 'supabase-cli') runWithSupabaseCli();
else runWithPsql();

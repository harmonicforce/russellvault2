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
  });
  if (res.error) fail(`supabase CLI failed to start: ${res.error.message}`);
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
    const res = spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet',
        ...conn.hostArgs, '-d', conn.dbName, '-f', join(TESTS_DIR, file)],
      { encoding: 'utf8', env: conn.env }
    );

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
      console.log(`db:test — pass ${file} (${skipped ? 'skipped' : `${okCount} assertions`})`);
    }
  }

  if (failed) fail('one or more test files failed');
  console.log(`db:test — all test files passed (${totalOk} assertions)`);
}

if (process.env.SHADOW_DB_RUNNER === 'supabase-cli') runWithSupabaseCli();
else runWithPsql();

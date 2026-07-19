#!/usr/bin/env node
// Local shadow-database SQL test runner.
//
// Resets the local shadow database (scripts/db/reset.mjs), then runs every
// pgTAP test file in supabase/tests against it and parses the TAP output.
// Fails on any `not ok`, any SQL error, or a file that produces no `ok` lines.
//
// Local-only: inherits the same locality guard as reset. Never connects to a
// remote Supabase project or production database.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TESTS_DIR = join(ROOT, 'supabase', 'tests');
const DB_NAME = process.env.SHADOW_DB_NAME || 'russellvault_shadow';

function fail(message) {
  console.error(`db:test — ${message}`);
  process.exit(1);
}

// Reset first so tests always run against a fresh, fully migrated database.
{
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'db', 'reset.mjs')], {
    stdio: 'inherit',
  });
  if (res.status !== 0) fail('reset failed; aborting tests');
}

const files = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (files.length === 0) fail('no test files found in supabase/tests');

let totalOk = 0;
let failed = false;

for (const file of files) {
  const res = spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet', '-d', DB_NAME, '-f', join(TESTS_DIR, file)],
    { encoding: 'utf8' }
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

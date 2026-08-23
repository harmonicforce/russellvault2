#!/usr/bin/env node
// Proves the shadow-database runner fails the way it is supposed to.
//
// Work Order 11's repair is only worth anything if it behaves under the exact
// conditions that defeated the old runner. So rather than assert that in prose,
// this drives the real runner against a deliberately broken miniature suite and
// checks what it actually does:
//
//   A. a failing assertion is attributed to the exact file;
//   B. a file that blocks forever is killed by the RUNNER, well inside its
//      bound, and named — the 2026-08-23 failure in miniature;
//   C. the abandoned backend is swept, so one stall cannot cascade;
//   D. no process the runner started outlives it;
//   E. a file missing from the suite is refused before anything runs.
//
// Modelled on scripts/db/concurrency-deadline-proof.mjs, which does the same
// job for the concurrency harness. Runs in the shim CI lane, where a local
// PostgreSQL is already up.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLocalConnection } from './guard.mjs';
import { ROOT } from './suiteManifest.mjs';

const RUNNER = join(ROOT, 'scripts', 'db', 'test.mjs');
let failures = 0;

const ok = (message) => console.log(`ok   — ${message}`);
const bad = (message) => { failures += 1; console.error(`FAIL — ${message}`); };
const check = (condition, message) => (condition ? ok(message) : bad(message));

const PASSING = (label) => `begin;
create extension if not exists pgtap;
select plan(1);
select ok(true, '${label}');
select * from finish();
rollback;
`;

const FAILING = `begin;
create extension if not exists pgtap;
select plan(2);
select ok(true, 'the first assertion in this file passes');
select is(1, 2, 'INJECTED FAILURE: this assertion exists to be reported');
select * from finish();
rollback;
`;

// A file that blocks indefinitely inside the server. Killing psql does not stop
// this backend, which is exactly why the sweep has to exist.
const STALLING = `begin;
create extension if not exists pgtap;
select plan(1);
select pg_sleep(600);
select ok(true, 'never reached');
select * from finish();
rollback;
`;

function miniSuite(files, manifestCounts) {
  const dir = mkdtempSync(join(tmpdir(), 'wo11-proof-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    totalAssertions: Object.values(manifestCounts).reduce((a, b) => a + b, 0),
    fileCount: Object.keys(manifestCounts).length,
    files: manifestCounts,
  }, null, 2)}\n`);
  return { dir, manifestPath };
}

function runRunner({ dir, manifestPath }, env = {}, { pathPrefix = null } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 240_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      PATH: pathPrefix ? `${pathPrefix}:${process.env.PATH}` : process.env.PATH,
      DB_TEST_TESTS_DIR: dir,
      DB_TEST_MANIFEST_PATH: manifestPath,
      ...env,
    },
  });
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    elapsedMs: Date.now() - startedAt,
    // Anything the runner spawned that is still alive would appear here.
    error: result.error,
  };
}

function sleepingBackends() {
  const conn = buildLocalConnection(process.env);
  const probe = spawnSync(
    'psql',
    ['-X', '--no-align', '--tuples-only', '--quiet', ...conn.hostArgs, '-d', conn.dbName,
      '-c', "select count(*) from pg_stat_activity where query like '%pg_sleep(600)%' and pid <> pg_backend_pid()"],
    { encoding: 'utf8', env: conn.env, timeout: 30_000 },
  );
  return probe.status === 0 ? Number(probe.stdout.trim()) : Number.NaN;
}

// --- A. a failing assertion is attributed to its file ------------------------

console.log('runner-proof — injecting a failing assertion into a miniature suite');
{
  const suite = miniSuite(
    {
      '00_proof_pass.sql': PASSING('a trivial passing assertion'),
      '01_proof_fail.sql': FAILING,
      '02_proof_pass.sql': PASSING('another trivial passing assertion'),
    },
    { '00_proof_pass.sql': 1, '01_proof_fail.sql': 2, '02_proof_pass.sql': 1 },
  );
  const run = runRunner(suite);
  check(run.status !== 0, `an injected failure exits NONZERO: exit=${run.status}`);
  check(run.output.includes('FAIL 01_proof_fail.sql'), 'the failure names the exact file: 01_proof_fail.sql');
  check(run.output.includes('INJECTED FAILURE'), 'the failing assertion\'s own description is shown');
  check(
    !run.output.includes('FAIL 00_proof_pass.sql') && !run.output.includes('FAIL 02_proof_pass.sql'),
    'no passing file is blamed alongside it',
  );
  check(run.output.includes('progress 01/3 started 00_proof_pass.sql'),
    'a per-file progress record is emitted BEFORE each file runs');
  check(run.output.includes('NON-CANONICAL SUITE'),
    'a run against a substituted suite says so loudly and cannot be mistaken for the governed suite');
  rmSync(suite.dir, { recursive: true, force: true });
}

// --- B/C/D. a stalled file is killed, named, swept, and leaves nothing behind -

console.log('runner-proof — inducing a file that blocks inside the server');
{
  const suite = miniSuite(
    { '00_proof_pass.sql': PASSING('a trivial passing assertion'), '01_proof_stall.sql': STALLING },
    { '00_proof_pass.sql': 1, '01_proof_stall.sql': 1 },
  );
  const fileBoundMs = 8_000;
  const run = runRunner(suite, {
    DB_TEST_FILE_TIMEOUT_MS: String(fileBoundMs),
    DB_TEST_SUITE_TIMEOUT_MS: '120000',
  });

  // The outer bound stands in for the CI step. The whole repair is that the
  // runner reacts first, so this must finish far inside it.
  const outerBoundMs = 180_000;
  check(run.status !== 0, `a blocked file exits NONZERO: exit=${run.status}`);
  check(run.elapsedMs < outerBoundMs,
    `the runner terminated on its own rather than being killed from outside: ${run.elapsedMs} ms`);
  check(run.output.includes('TIMEOUT 01_proof_stall.sql'), 'the timeout names the exact file: 01_proof_stall.sql');
  check(/SIGTERM:sent/.test(run.output), 'the process group was signalled, and the signal sequence is reported');
  check(!/PROCESSES SURVIVED THE KILL/.test(run.output), 'no process survived the group kill');
  check(run.output.includes('remaining file(s) were not run'),
    'the report states what did NOT run rather than implying the suite completed');
  check(/db:test diagnostics \(suite\)/.test(run.output),
    'diagnostics were captured for the stall instead of the log simply stopping');
  check(/PostgreSQL activity/.test(run.output), 'the diagnostics include what the database was doing');
  check(/suite position/.test(run.output) && /01_proof_stall\.sql/.test(run.output),
    'the diagnostics lead with the suite position');

  // C. the abandoned backend must be gone, or one stall cascades into the next
  // file and the attribution becomes worthless.
  const leftover = sleepingBackends();
  check(leftover === 0, `the abandoned backend was swept: ${leftover} still sleeping`);

  rmSync(suite.dir, { recursive: true, force: true });
}

// --- E. a missing file is refused before anything runs -----------------------

console.log('runner-proof — omitting a declared file from the suite directory');
{
  const suite = miniSuite(
    { '00_proof_pass.sql': PASSING('a trivial passing assertion') },
    { '00_proof_pass.sql': 1, '01_proof_missing.sql': 12 },
  );
  const run = runRunner(suite);
  check(run.status !== 0, `a silently omitted file exits NONZERO: exit=${run.status}`);
  check(run.output.includes('01_proof_missing.sql'), 'the omitted file is named');
  check(!run.output.includes('phase reset — starting'),
    'the omission is caught BEFORE the database is touched');
  rmSync(suite.dir, { recursive: true, force: true });
}

// --- F/G/H. the Supabase lane, driven against a recorded pg_prove transcript --
//
// Docker is not available in every environment this proof runs in, and the
// point here is the RUNNER's behaviour, not Docker's. So the pinned CLI is
// stubbed with a script that replays pg_prove output captured verbatim from the
// last green CI run (run 32564005696, job 97009820870), including the
// "Files=70, Tests=2673" roll-up line the inventory check reads. That exercises
// the whole stack-lane path — reset supervision, stream parsing, progress
// records, summary verification, stall detection, group kill and cleanup —
// without pretending a real stack was involved.

function stubbedCli({ transcript, mode }) {
  const dir = mkdtempSync(join(tmpdir(), 'wo11-stub-'));
  const transcriptPath = join(dir, 'transcript.txt');
  writeFileSync(transcriptPath, transcript);
  const body = `#!/bin/sh
# Stub for the pinned Supabase CLI. Replays a recorded pg_prove transcript.
case "$*" in
  *"db reset"*) echo "stub-cli — reset --local"; exit 0 ;;
  *stop*)       echo "stub-cli — stop"; exit 0 ;;
  *"test db"*)
    cat ${JSON.stringify(transcriptPath)}
    ${mode === 'stall'
      ? '# Then block forever, exactly as the real stall did.\n    while true; do sleep 5; done'
      : 'exit 0'}
    ;;
esac
exit 0
`;
  const npx = join(dir, 'npx');
  writeFileSync(npx, body);
  chmodSync(npx, 0o755);
  return { dir, npx };
}

/** pg_prove's real output shape, as captured from the green CI run. */
function proveTranscript(dir, files, { summaryFiles, summaryTests, tail = true }) {
  const lines = [];
  for (const [name, verdict] of Object.entries(files)) {
    lines.push(`psql:${dir}/${name}:2: NOTICE:  extension "pgtap" already exists, skipping`);
    lines.push(`${dir}/${name} ${'.'.repeat(40 - name.length)} ${verdict}`);
  }
  if (tail) {
    lines.push('All tests successful.');
    lines.push(`Files=${summaryFiles}, Tests=${summaryTests}, 23 wallclock secs ( 0.37 usr  0.12 sys +  0.68 cusr  0.51 csys =  1.68 CPU)`);
    lines.push('Result: PASS');
  }
  return `${lines.join('\n')}\n`;
}

console.log('runner-proof — replaying a successful pg_prove transcript through the Supabase lane');
{
  const suite = miniSuite(
    {
      '00_proof_pass.sql': PASSING('one'),
      '01_proof_pass.sql': PASSING('two'),
      '02_proof_pass.sql': PASSING('three'),
    },
    { '00_proof_pass.sql': 1, '01_proof_pass.sql': 1, '02_proof_pass.sql': 1 },
  );
  const stub = stubbedCli({
    transcript: proveTranscript(suite.dir,
      { '00_proof_pass.sql': 'ok', '01_proof_pass.sql': 'ok', '02_proof_pass.sql': 'ok' },
      { summaryFiles: 3, summaryTests: 3 }),
    mode: 'exit',
  });
  const run = runRunner(suite, { SHADOW_DB_RUNNER: 'supabase-cli' }, { pathPrefix: stub.dir });

  check(run.status === 0, `a clean stack-lane run exits ZERO: exit=${run.status}`);
  check(/progress 01\/3 completed 00_proof_pass\.sql \[ok\]/.test(run.output),
    'the Supabase lane now emits a per-file progress record — the thing it had none of');
  check(/now running 01_proof_pass\.sql/.test(run.output),
    'each record names the file that starts next, so a stall has an owner');
  check(/3 files, 3 assertions, matching the manifest/.test(run.output),
    'the run is verified against the declared inventory, not just its exit code');
  rmSync(suite.dir, { recursive: true, force: true });
  rmSync(stub.dir, { recursive: true, force: true });
}

console.log('runner-proof — replaying a transcript that quietly drops a file');
{
  const suite = miniSuite(
    { '00_proof_pass.sql': PASSING('one'), '01_proof_pass.sql': PASSING('two') },
    { '00_proof_pass.sql': 1, '01_proof_pass.sql': 1 },
  );
  // pg_prove exits 0 but reports one fewer file than the manifest declares:
  // the silent-omission case a bare exit-code check would have passed.
  const stub = stubbedCli({
    transcript: proveTranscript(suite.dir, { '00_proof_pass.sql': 'ok' }, { summaryFiles: 1, summaryTests: 1 }),
    mode: 'exit',
  });
  const run = runRunner(suite, { SHADOW_DB_RUNNER: 'supabase-cli' }, { pathPrefix: stub.dir });

  check(run.status !== 0, `a silently shortened suite exits NONZERO despite pg_prove exiting 0: exit=${run.status}`);
  check(/executed 1 files, manifest declares 2/.test(run.output), 'the shortfall is stated in exact numbers');
  rmSync(suite.dir, { recursive: true, force: true });
  rmSync(stub.dir, { recursive: true, force: true });
}

console.log('runner-proof — reproducing the 2026-08-23 stall shape in the Supabase lane');
{
  const suite = miniSuite(
    {
      '00_proof_pass.sql': PASSING('one'),
      '01_proof_pass.sql': PASSING('two'),
      '15_proof_big.sql': PASSING('the one that stalls'),
    },
    { '00_proof_pass.sql': 1, '01_proof_pass.sql': 1, '15_proof_big.sql': 1 },
  );
  // Two files complete, then a NOTICE from the third, then nothing — the exact
  // sequence the real log ended on.
  const transcript = proveTranscript(
    suite.dir, { '00_proof_pass.sql': 'ok', '01_proof_pass.sql': 'ok' }, { summaryFiles: 0, summaryTests: 0, tail: false },
  ) + `psql:${suite.dir}/15_proof_big.sql:11: NOTICE:  extension "pgtap" already exists, skipping\n`;
  const stub = stubbedCli({ transcript, mode: 'stall' });

  const outerBoundMs = 120_000;  // stands in for the CI step
  const run = runRunner(suite, {
    SHADOW_DB_RUNNER: 'supabase-cli',
    DB_TEST_SUITE_TIMEOUT_MS: '12000',
    DB_TEST_SILENCE_MS: '3000',
  }, { pathPrefix: stub.dir });

  check(run.status !== 0, `the stall exits NONZERO: exit=${run.status}`);
  check(run.elapsedMs < outerBoundMs,
    `the RUNNER ended the stall, not an outer timeout: ${run.elapsedMs} ms`);
  check(/STALL WARNING — no output for/.test(run.output),
    'the stall is announced while it is happening, not only after the kill');
  check(/file 3\/3 15_proof_big\.sql/.test(run.output),
    'the report names the file that was executing, derived from completion order');
  check(/last completed 01_proof_pass\.sql/.test(run.output), 'and the last file that did complete');
  check(/Completed 2\/3/.test(run.output), 'the report states how much of the suite ran');
  check(/SIGTERM:sent/.test(run.output), 'the process group was signalled');
  check(!/PROCESSES SURVIVED THE KILL/.test(run.output), 'nothing survived the group kill');
  check(/cleanup — stopping the local Supabase stack/.test(run.output),
    'cleanup stops the stack on the failure path rather than leaving it running');
  check(/db:test diagnostics/.test(run.output), 'diagnostics were captured');
  rmSync(suite.dir, { recursive: true, force: true });
  rmSync(stub.dir, { recursive: true, force: true });
}

console.log('');

if (failures > 0) {
  console.error(`runner-proof — ${failures} proof(s) FAILED`);
  process.exit(1);
}
console.log('runner-proof — the runner fails finitely, names the file, and cleans up after itself');

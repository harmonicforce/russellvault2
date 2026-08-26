// The suite inventory guard, plus the diagnostics redaction.
//
// The manifest is what makes "2,673 assertions preserved" a checkable claim
// rather than a sentence in a report. These tests prove the guard catches the
// three ways coverage disappears quietly: a file dropped, a file's assertions
// reduced, and assertions moved from one file to another so the total still
// looks right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTestFiles, readManifest, expectedTotal,
  checkInventory, checkExecution, checkSummary, resolveSuitePaths,
  TESTS_DIR, MANIFEST_PATH,
} from './suiteManifest.mjs';
import { redact, clamp, runProbe, collectDiagnostics, renderDiagnostics } from './diagnostics.mjs';

const manifest = readManifest();
const onDisk = listTestFiles();

test('the shipped manifest matches the pgTAP suite on disk', () => {
  const result = checkInventory(manifest, onDisk);
  assert.equal(result.ok, true, result.problems.join('; '));
});

test('the shipped manifest still declares 71 files and 2700 assertions', () => {
  // The figures Work Order 11 must preserve. If this test changes, the diff has
  // to say why.
  //
  // WHY IT CHANGED: 70 files / 2,673 assertions until the ESC-002 repair, which
  // adds 71_receiving_rpc_dispatch.sql and its 27 assertions. That file exists
  // because the previous 2,673 could not see a defect that made three governed
  // receiving RPCs unreachable through PostgREST — they call those functions
  // positionally from SQL, where unnamed parameters are legal.
  assert.equal(onDisk.length, 71);
  assert.equal(Object.keys(manifest.files).length, 71);
  assert.equal(expectedTotal(manifest), 2700);
  assert.equal(manifest.totalAssertions, 2700);
});

test('15_acquisition_digest_parity.sql is still in the suite with its four assertions', () => {
  // Work Order 11 forbids deleting, skipping, quarantining or weakening it.
  assert.ok(onDisk.includes('15_acquisition_digest_parity.sql'));
  assert.equal(manifest.files['15_acquisition_digest_parity.sql'], 4);
});

test('a file dropped from disk is caught', () => {
  const result = checkInventory(manifest, onDisk.filter((n) => n !== '15_acquisition_digest_parity.sql'));
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /15_acquisition_digest_parity\.sql/);
  assert.match(result.problems.join(' '), /--write-manifest/, 'the failure must say how to fix it');
});

test('a file added without a manifest entry is caught', () => {
  const result = checkInventory(manifest, [...onDisk, '71_sneaked_in.sql']);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /71_sneaked_in\.sql/);
});

test('a file that never ran is caught even when everything else passes', () => {
  const observed = { ...manifest.files };
  delete observed['15_acquisition_digest_parity.sql'];
  const result = checkExecution(manifest, observed);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /15_acquisition_digest_parity\.sql was declared .* but never ran/);
});

test('a file that lost assertions is caught', () => {
  const observed = { ...manifest.files, '00_schema_structure.sql': 30 };
  const result = checkExecution(manifest, observed);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /00_schema_structure\.sql produced 30 assertions, manifest declares 37/);
});

test('assertions MOVED between files are caught, which a bare total could not do', () => {
  const observed = { ...manifest.files };
  observed['00_schema_structure.sql'] -= 5;
  observed['01_workspace_rls.sql'] += 5;
  const result = checkExecution(manifest, observed);
  assert.equal(result.observedTotal, expectedTotal(manifest), 'the total is unchanged by construction');
  assert.equal(result.ok, false, 'an exact per-file check is what catches a swap');
  assert.equal(result.problems.length, 2);
});

test('an exactly matching run passes', () => {
  const result = checkExecution(manifest, { ...manifest.files });
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.equal(result.observedTotal, 2700);
  assert.equal(result.declaredTotal, 2700);
});

test('the pg_prove roll-up is checked against the manifest', () => {
  assert.equal(checkSummary(manifest, { files: 71, tests: 2700 }).ok, true);
  assert.match(checkSummary(manifest, { files: 70, tests: 2700 }).problems.join(' '), /executed 70 files/);
  assert.match(checkSummary(manifest, { files: 71, tests: 2696 }).problems.join(' '), /reported 2696 assertions/);
});

test('a runner that reports no roll-up at all fails rather than being assumed complete', () => {
  const result = checkSummary(manifest, null);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /no file\/assertion summary/);
});

test('suite paths default to the canonical suite and report an override', () => {
  const plain = resolveSuitePaths({});
  assert.equal(plain.testsDir, TESTS_DIR);
  assert.equal(plain.manifestPath, MANIFEST_PATH);
  assert.equal(plain.overridden, false);

  const overridden = resolveSuitePaths({ DB_TEST_TESTS_DIR: '/tmp/mini-suite' });
  assert.equal(overridden.testsDir, '/tmp/mini-suite');
  assert.equal(overridden.overridden, true);
});

// --- diagnostics -------------------------------------------------------------

test('credentials are redacted from diagnostics output', () => {
  const text = redact([
    'postgresql://postgres:sup3rs3cret@127.0.0.1:54322/postgres',
    'PGPASSWORD=hunter2 SUPABASE_SERVICE_ROLE_KEY=abc123 SOME_TOKEN=xyz',
    'psql --password s3cr3t -d postgres',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl',
  ].join('\n'));

  for (const secret of ['sup3rs3cret', 'hunter2', 'abc123', 'xyz', 's3cr3t', 'c2lnbmF0dXJl']) {
    assert.doesNotMatch(text, new RegExp(secret), `"${secret}" survived redaction`);
  }
  // The shape must remain readable, or the diagnostics are useless.
  assert.match(text, /postgresql:\/\/postgres:REDACTED@127\.0\.0\.1:54322/);
});

test('a chatty probe is clamped rather than burying the rest of the bundle', () => {
  const clamped = clamp('x'.repeat(5_000), 100);
  assert.ok(clamped.length < 200);
  assert.match(clamped, /truncated, 4900 more characters/);
});

test('a probe for a missing binary reports the absence instead of throwing', () => {
  const probe = runProbe('missing', 'definitely-not-a-real-binary-wo11', []);
  assert.equal(probe.ok, false);
  assert.match(probe.output, /probe could not run/);
});

test('a probe that hangs is killed and its own timeout is reported as evidence', () => {
  const probe = runProbe('hang', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(probe.ok, false);
  assert.match(probe.output, /exceeded 300 ms and was killed/);
});

test('the bundle always leads with where the suite was, and survives missing tools', () => {
  const sections = collectDiagnostics({
    lane: 'supabase-cli',
    phase: 'suite',
    reason: 'no output for 90s',
    position: 'file 16/70 15_acquisition_digest_parity.sql, last completed 14_acquisition_acceptance.sql',
    elapsedMs: 92_500,
    // Force the docker path to be unavailable without needing docker present.
    findDbContainer: () => ({ container: null, listing: { title: 'docker containers', ok: false, output: 'no docker' } }),
  });
  assert.equal(sections[0].title, 'suite position');
  assert.match(sections[0].output, /15_acquisition_digest_parity\.sql/);
  assert.match(sections[0].output, /elapsed: 92\.5s/);
  const rendered = renderDiagnostics(sections);
  assert.match(rendered, /===== db:test diagnostics =====/);
  assert.match(rendered, /PostgreSQL activity \(probe failed\)/);
  assert.match(rendered, /container was not found/);
});

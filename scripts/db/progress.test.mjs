// The progress tracker: can the log say, unambiguously, where the suite was?
//
// On 2026-08-23 the answer was no. The last line before the twelve-minute kill
// was a NOTICE emitted from inside 15_acquisition_digest_parity.sql — strongly
// suggestive, but not proof, because pg_prove announces a file only when it
// finishes and a NOTICE is incidental output. These tests pin down what the
// tracker may and may not claim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgressTracker } from './progress.mjs';

const INVENTORY = ['00_a.sql', '01_b.sql', '15_big.sql', '16_c.sql'];
const prove = (name, verdict = 'ok') =>
  `/home/runner/work/rv/rv/supabase/tests/${name} ................ ${verdict}`;

test('an empty inventory is refused rather than silently tracking nothing', () => {
  assert.throws(() => createProgressTracker([]), /non-empty inventory/);
});

test('before anything runs, the current file is the first one', () => {
  const state = createProgressTracker(INVENTORY).state();
  assert.equal(state.currentFile, '00_a.sql');
  assert.equal(state.lastCompleted, null);
  assert.equal(state.completedCount, 0);
});

test('the executing file is derived from completion COUNT, not from the last name printed', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe(prove('00_a.sql'));
  tracker.observe(prove('01_b.sql'));
  // A file that emits nothing at all leaves 01_b as the last name mentioned…
  assert.equal(tracker.state().lastMentionedFile, '01_b.sql');
  // …but the position is still derived correctly.
  assert.equal(tracker.state().currentFile, '15_big.sql');
  assert.equal(tracker.state().lastCompleted, '01_b.sql');
});

test('the exact 2026-08-23 stall shape is reported with the right file', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe(prove('00_a.sql'));
  tracker.observe(prove('01_b.sql'));
  tracker.observe(
    'psql:/home/runner/work/rv/rv/supabase/tests/15_big.sql:11: '
    + 'NOTICE:  extension "pgtap" already exists, skipping',
  );
  const description = tracker.describePosition();
  assert.match(description, /file 3\/4 15_big\.sql/);
  assert.match(description, /last completed 01_b\.sql/);
  assert.doesNotMatch(description, /WARNING/, 'the two indicators agree here, so no warning is due');
  assert.deepEqual(tracker.state().notStarted, ['16_c.sql']);
});

test('a disagreement between the two indicators is surfaced, never resolved silently', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe(prove('00_a.sql'));
  // Output naming a file that is NOT the one the ordering says should be running.
  tracker.observe('psql:/x/supabase/tests/16_c.sql:4: NOTICE:  something odd');
  const description = tracker.describePosition();
  assert.match(description, /WARNING/);
  assert.match(description, /named 16_c\.sql, not 01_b\.sql/);
  assert.equal(tracker.state().mentionAgrees, false);
});

test('a failing file is recorded with its verdict and named for the report', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe(prove('00_a.sql'));
  tracker.observe(prove('01_b.sql', 'Failed 2/28 subtests'));
  tracker.observe(prove('15_big.sql', 'Dubious, test returned 1 (wstat 256, 0x100)'));
  const failures = tracker.state().failures;
  assert.deepEqual(failures.map((entry) => entry.file), ['01_b.sql', '15_big.sql']);
  assert.match(failures[0].verdict, /^Failed 2\/28/);
  assert.match(failures[1].verdict, /^Dubious/);
});

test('the pg_prove roll-up is captured for the inventory check', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe('Files=70, Tests=2673, 23 wallclock secs ( 0.37 usr  0.12 sys +  0.68 cusr  0.51 csys =  1.68 CPU)');
  tracker.observe('Result: PASS');
  assert.deepEqual(tracker.state().summary, { files: 70, tests: 2673 });
  assert.equal(tracker.state().verdict, 'PASS');
});

test('a FAIL verdict is recorded as such', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe('Result: FAIL');
  assert.equal(tracker.state().verdict, 'FAIL');
});

test('once every file has reported, the position says so rather than naming a phantom file', () => {
  const tracker = createProgressTracker(INVENTORY);
  for (const name of INVENTORY) tracker.observe(prove(name));
  assert.equal(tracker.state().currentFile, null);
  assert.match(tracker.describePosition(), /all 4 files reported/);
});

test('unrelated output does not invent progress', () => {
  const tracker = createProgressTracker(INVENTORY);
  tracker.observe('Downloading public.ecr.aws/supabase/pg_prove:3.36');
  tracker.observe('Status: Downloaded newer image');
  assert.equal(tracker.state().completedCount, 0);
  assert.equal(tracker.state().lastMentionedFile, null);
  assert.equal(tracker.state().currentFile, '00_a.sql');
});

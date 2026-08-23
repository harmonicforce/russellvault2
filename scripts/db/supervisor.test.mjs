// Self-tests for the bounded process supervisor and process-group termination.
//
// These spawn REAL processes. That is the point: the defect being repaired was
// that killing a child left its descendants running, and no amount of mocking
// proves a grandchild actually died. The pure escalation ladder is also tested
// with injected clocks, so both the logic and the behaviour are covered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { superviseProcess, OUTCOME } from './supervisor.mjs';
import { terminateGroup, isGroupAlive, assertSignalableGroup } from './processGroup.mjs';

const silence = { write() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until the pid is gone, or give up. Returns whether it died. */
async function waitForDeath(pid, limitMs = 5_000) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await sleep(25);
  }
  try { process.kill(pid, 0); return false; } catch { return true; }
}

test('a child that exits on its own reports its real status', async () => {
  const result = await superviseProcess({
    command: process.execPath,
    args: ['-e', 'process.exit(7)'],
    deadlineMs: 10_000,
    stdout: silence,
    stderr: silence,
  });
  assert.equal(result.outcome, OUTCOME.exited);
  assert.equal(result.status, 7);
  assert.equal(result.termination, null);
});

test('a command that cannot start is reported, never treated as a pass', async () => {
  const result = await superviseProcess({
    command: 'definitely-not-a-real-binary-wo11',
    args: [],
    deadlineMs: 5_000,
    stdout: silence,
    stderr: silence,
  });
  assert.equal(result.outcome, OUTCOME.spawnFailed);
  assert.notEqual(result.spawnError, null);
});

test('output is observed line by line and still forwarded verbatim', async () => {
  const lines = [];
  const forwarded = [];
  const result = await superviseProcess({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("alpha\\nbeta\\n"); process.stderr.write("gamma\\n")'],
    deadlineMs: 10_000,
    onLine: (line, stream) => lines.push(`${stream}:${line}`),
    stdout: { write: (t) => forwarded.push(t) },
    stderr: { write: (t) => forwarded.push(t) },
  });
  assert.equal(result.outcome, OUTCOME.exited);
  assert.deepEqual(lines.sort(), ['stderr:gamma', 'stdout:alpha', 'stdout:beta']);
  assert.equal(forwarded.join(''), 'alpha\nbeta\ngamma\n');
});

test('a deliberately stalled child is killed well below any outer timeout', async () => {
  // The outer bound this stands in for is the CI step. The whole point of the
  // repair is that the runner acts first, so this must finish in a fraction of
  // the time an outer timeout would have taken.
  const outerBoundMs = 15_000;
  const startedAt = Date.now();
  const result = await superviseProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    deadlineMs: 400,
    graceMs: 500,
    stdout: silence,
    stderr: silence,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.outcome, OUTCOME.deadline);
  assert.ok(elapsed < outerBoundMs, `supervisor took ${elapsed} ms, which is not below the outer bound`);
  assert.equal(result.termination.survived, false, 'the process group outlived the kill');
});

test('the silence detector fires before the deadline and does not stop the run', async () => {
  const observations = [];
  const result = await superviseProcess({
    command: process.execPath,
    // Emits, then goes quiet, then finishes on its own.
    args: ['-e', 'console.log("start"); setTimeout(() => process.exit(0), 900)'],
    deadlineMs: 10_000,
    silenceMs: 200,
    onSilence: ({ silentMs }) => { observations.push(silentMs); },
    stdout: silence,
    stderr: silence,
  });
  assert.equal(result.outcome, OUTCOME.exited, 'a silence warning must not end the run');
  assert.equal(result.status, 0);
  assert.ok(observations.length >= 1, 'the silence detector never fired');
});

test('diagnostics are collected BEFORE the group is signalled', async () => {
  const order = [];
  await superviseProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    deadlineMs: 300,
    graceMs: 400,
    onDeadline: () => { order.push('diagnostics'); },
    terminate: async (pid, options) => {
      order.push('terminate');
      return terminateGroup(pid, options);
    },
    stdout: silence,
    stderr: silence,
  });
  assert.deepEqual(order, ['diagnostics', 'terminate'],
    'a stall must be photographed while the process tree is still alive');
});

test('no grandchild is orphaned, even one that ignores SIGTERM', async () => {
  // This is the exact shape of the CI failure: the step was killed and eight
  // descendants kept running. The grandchild here refuses SIGTERM so the test
  // also proves the SIGKILL escalation actually reaches the whole group.
  const grandchild = String.raw`
    process.on('SIGTERM', () => {});
    console.log('GRANDCHILD ' + process.pid);
    setInterval(() => {}, 1000);
  `;
  const parent = String.raw`
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `;

  let grandchildPid = null;
  const result = await superviseProcess({
    command: process.execPath,
    args: ['-e', parent],
    deadlineMs: 1_500,
    graceMs: 600,
    onLine: (line) => {
      const match = /^GRANDCHILD (\d+)$/.exec(line.trim());
      if (match) grandchildPid = Number(match[1]);
    },
    stdout: silence,
    stderr: silence,
  });

  assert.equal(result.outcome, OUTCOME.deadline);
  assert.notEqual(grandchildPid, null, 'the grandchild never announced itself');
  assert.equal(await waitForDeath(grandchildPid), true,
    `grandchild ${grandchildPid} survived the group kill — this is the orphan defect`);
  assert.equal(result.termination.survived, false);
  assert.ok(
    result.termination.steps.some((step) => step.signal === 'SIGKILL'),
    'a SIGTERM-ignoring group must be escalated to SIGKILL',
  );
});

test('termination escalates TERM then KILL, and reports both', async () => {
  // Injected clocks: no real process, no real waiting.
  const signals = [];
  let alive = true;
  const kill = (pid, signal) => {
    if (signal === 0) { if (!alive) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; } return; }
    signals.push(signal);
    if (signal === 'SIGKILL') alive = false;
  };
  let clock = 0;
  const result = await terminateGroup(4242, {
    graceMs: 100, killWaitMs: 100, pollMs: 10,
    kill,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.escalated, true);
  assert.equal(result.survived, false);
});

test('a group that dies on SIGTERM is never escalated', async () => {
  const signals = [];
  let alive = true;
  const kill = (pid, signal) => {
    if (signal === 0) { if (!alive) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; } return; }
    signals.push(signal);
    if (signal === 'SIGTERM') alive = false;
  };
  let clock = 0;
  const result = await terminateGroup(4242, {
    graceMs: 100, killWaitMs: 100, pollMs: 10, kill, now: () => clock, sleep: async (ms) => { clock += ms; },
  });
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(result.escalated, false);
  assert.equal(result.survived, false);
});

test('a group still alive after SIGKILL is reported as surviving, not as clean', async () => {
  const kill = (pid, signal) => { if (signal === 0) return; };  // nothing ever dies
  let clock = 0;
  const result = await terminateGroup(4242, {
    graceMs: 50, killWaitMs: 50, pollMs: 10, kill, now: () => clock, sleep: async (ms) => { clock += ms; },
  });
  assert.equal(result.survived, true, 'a surviving group must never be reported as cleaned up');
});

test('unsafe process groups are refused rather than signalled', () => {
  assert.throws(() => assertSignalableGroup(0), /not a valid child group id/);
  assert.throws(() => assertSignalableGroup(1), /not a valid child group id/);
  assert.throws(() => assertSignalableGroup(process.pid), /this process/);
  assert.throws(() => assertSignalableGroup(undefined), /not a valid child group id/);
});

test('isGroupAlive reports a vanished group as gone', () => {
  const kill = () => { const error = new Error('ESRCH'); error.code = 'ESRCH'; throw error; };
  assert.equal(isGroupAlive(4242, { kill }), false);
});

test('isGroupAlive treats a group we may not signal as alive, not as gone', () => {
  const kill = () => { const error = new Error('EPERM'); error.code = 'EPERM'; throw error; };
  assert.equal(isGroupAlive(4242, { kill }), true);
});

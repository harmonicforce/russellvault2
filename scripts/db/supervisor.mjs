// A bounded, observable supervisor for a long-running child process.
//
// The defect this exists to remove
// --------------------------------
// The Supabase lane used to be one opaque `spawnSync` with `stdio: 'inherit'`
// and a timeout LONGER than the CI step that invoked it. Three consequences,
// all of which CI hit on 2026-08-23:
//
//   1. The inner timeout could never fire, so GitHub's step timeout always won.
//      GitHub kills the step and prints one line; it does not know what the
//      suite was doing, so the log ended mid-file with no attribution.
//   2. `stdio: 'inherit'` means the parent never sees a byte, so nothing could
//      notice that output had stopped, and nothing could take a snapshot of the
//      database while the stall was still observable.
//   3. Killing the step shell left the whole descendant chain running.
//
// This supervisor inverts all three: it owns the deadline, it watches the
// stream, and it kills the process GROUP. Output is still forwarded verbatim,
// so the CI log keeps reading exactly as it did before.
//
// Every timer dependency is injectable so the escalation ladder and the
// silence detector can be tested deterministically.

import { spawn as nodeSpawn } from 'node:child_process';
import { terminateGroup } from './processGroup.mjs';

/** Why the supervised run ended. Exactly one of these is always reported. */
export const OUTCOME = {
  exited: 'exited',              // the child exited on its own (any status)
  deadline: 'deadline_exceeded', // our deadline fired and we killed the group
  spawnFailed: 'spawn_failed',   // the child never started
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split a byte stream into complete lines, forwarding every chunk verbatim to
 * `sink` first. Forwarding the raw chunk (not the reassembled lines) keeps
 * partial-line progress output and carriage-return redraws intact in the log.
 */
function lineReader(onLine) {
  let buffered = '';
  return {
    push(chunk) {
      buffered += chunk;
      let index = buffered.indexOf('\n');
      while (index !== -1) {
        onLine(buffered.slice(0, index).replace(/\r$/, ''));
        buffered = buffered.slice(index + 1);
        index = buffered.indexOf('\n');
      }
    },
    flush() {
      if (buffered.length > 0) {
        onLine(buffered);
        buffered = '';
      }
    },
  };
}

/**
 * Run `command args` under a hard deadline, in its own process group, with the
 * output observed.
 *
 * Options:
 *   deadlineMs  — hard limit for the whole run. On expiry the group is killed
 *                 and the outcome is `deadline_exceeded`. Required.
 *   silenceMs   — if no output arrives for this long, `onSilence` is called
 *                 with the current elapsed time. This is the hook that lets a
 *                 stall be photographed WHILE it is still happening, instead of
 *                 being autopsied after everything has been killed. Re-armed
 *                 after each firing, with the interval doubling (capped at
 *                 4x) so a genuinely long-running step does not spam the log.
 *   graceMs     — how long SIGTERM gets before SIGKILL.
 *   onLine      — called with each complete stdout/stderr line, plus which
 *                 stream it came from.
 *   onSilence   — async; awaited before the next silence timer is armed.
 *   onDeadline  — async; awaited BEFORE the group is signalled, so diagnostics
 *                 are collected against a live process tree.
 *
 * Returns { outcome, status, signal, elapsedMs, termination, spawnError }.
 */
export async function superviseProcess({
  command,
  args = [],
  cwd,
  env,
  deadlineMs,
  silenceMs = 0,
  graceMs = 10_000,
  onLine = () => {},
  onSilence = null,
  onDeadline = null,
  stdout = process.stdout,
  stderr = process.stderr,
  spawn = nodeSpawn,
  now = () => Date.now(),
  sleep = defaultSleep,
  terminate = terminateGroup,
}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error(`superviseProcess requires a positive deadlineMs, received ${JSON.stringify(deadlineMs)}`);
  }

  const startedAt = now();
  const elapsed = () => now() - startedAt;

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      // detached makes the child a process-group leader (pgid === pid), which
      // is the whole point: it gives us one handle for every descendant.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { outcome: OUTCOME.spawnFailed, status: null, signal: null, elapsedMs: elapsed(), termination: null, spawnError: error };
  }

  const readers = {
    stdout: lineReader((line) => onLine(line, 'stdout')),
    stderr: lineReader((line) => onLine(line, 'stderr')),
  };

  let lastOutputAt = now();
  const observe = (streamName, sink) => (chunk) => {
    const text = chunk.toString();
    lastOutputAt = now();
    sink.write(text);
    readers[streamName].push(text);
  };
  child.stdout?.on('data', observe('stdout', stdout));
  child.stderr?.on('data', observe('stderr', stderr));

  const exitPromise = new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      readers.stdout.flush();
      readers.stderr.flush();
      resolve(value);
    };
    child.on('error', (error) => settle({ kind: 'error', error }));
    child.on('close', (status, signal) => settle({ kind: 'close', status, signal }));
  });

  let finished = null;
  exitPromise.then((value) => { finished = value; });

  // The polling loop is deliberately simple and driven by injectable clocks:
  // it is far easier to prove correct (and to test) than a web of timers, and
  // its resolution is irrelevant at these time scales.
  const pollMs = Math.max(1, Math.min(250, Math.floor(deadlineMs / 20)));
  let silenceBudget = silenceMs;
  let deadlineFired = false;

  while (finished === null) {
    if (elapsed() >= deadlineMs) { deadlineFired = true; break; }
    if (silenceMs > 0 && onSilence && now() - lastOutputAt >= silenceBudget) {
      // Re-arm BEFORE awaiting: collecting diagnostics itself takes time, and
      // that time must not immediately re-trigger the detector.
      await onSilence({ silentMs: now() - lastOutputAt, elapsedMs: elapsed() });
      lastOutputAt = now();
      silenceBudget = Math.min(silenceBudget * 2, silenceMs * 4);
    }
    await sleep(pollMs);
  }

  if (!deadlineFired && finished) {
    if (finished.kind === 'error') {
      return { outcome: OUTCOME.spawnFailed, status: null, signal: null, elapsedMs: elapsed(), termination: null, spawnError: finished.error };
    }
    return { outcome: OUTCOME.exited, status: finished.status, signal: finished.signal, elapsedMs: elapsed(), termination: null, spawnError: null };
  }

  // Deadline path. Photograph first, then kill the whole group.
  if (onDeadline) await onDeadline({ elapsedMs: elapsed(), pid: child.pid });
  const termination = await terminate(child.pid, { graceMs, sleep, now });
  // Give the close event a bounded chance to land so the reported status is
  // real rather than assumed. If it never lands, we still return.
  const settleDeadline = now() + 2_000;
  while (finished === null && now() < settleDeadline) await sleep(pollMs);

  return {
    outcome: OUTCOME.deadline,
    status: finished?.kind === 'close' ? finished.status : null,
    signal: finished?.kind === 'close' ? finished.signal : null,
    elapsedMs: elapsed(),
    termination,
    spawnError: null,
  };
}

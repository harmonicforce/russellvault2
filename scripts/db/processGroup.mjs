// Whole-process-group termination for the shadow-database runners.
//
// Why this module exists
// ----------------------
// `spawnSync(..., { timeout })` kills ONLY the direct child. A GitHub Actions
// step timeout kills only the step's shell. Neither reaches the grandchildren.
// The Supabase lane spawns a chain -- `npm run db:test` -> `sh` -> `node` ->
// `npm exec supabase` -> `sh` -> `node` -> `supabase` -> `docker` -- so killing
// the top of that chain leaves everything below it running. That is exactly
// what CI observed on 2026-08-23: after the step was killed, the runner's own
// post-job cleanup reported eight surviving processes.
//
// The fix is to give the child its own process GROUP (`detached: true` makes
// the child a group leader whose pgid equals its pid) and then signal the whole
// group with a negative pid. Every descendant that has not deliberately left
// the group receives the signal.
//
// Escalation is TERM first, then a BOUNDED wait, then KILL. TERM lets the
// Supabase CLI and docker remove containers on the way out; KILL guarantees the
// wait is finite. Both are bounded so the caller can never block here forever
// -- an unbounded cleanup would simply move the hang from the test to the
// teardown.

/** A group id we will never signal: signalling it would kill this process. */
function ownGroupId() {
  // process.getpgrp is POSIX-only; on platforms without it we can still refuse
  // the obvious self-signal cases below.
  return typeof process.getpgrp === 'function' ? process.getpgrp() : null;
}

/**
 * Refuse group ids that are unsafe to signal. Signalling group 0 means "my own
 * group", group 1 is init, and our own group is suicide. A caller that reaches
 * one of these has a bug; killing the CI job to hide it is not an improvement.
 */
export function assertSignalableGroup(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1) {
    throw new Error(`refusing to signal process group ${JSON.stringify(pgid)}: not a valid child group id`);
  }
  const own = ownGroupId();
  if (own !== null && pgid === own) {
    throw new Error(`refusing to signal process group ${pgid}: it is this process's own group`);
  }
  if (pgid === process.pid) {
    throw new Error(`refusing to signal process group ${pgid}: it is this process`);
  }
  return pgid;
}

/**
 * Is any member of the group still alive?
 *
 * Signal 0 performs the permission and existence check without delivering a
 * signal. EPERM means the group exists but is not ours to signal, which for our
 * purposes still counts as alive -- reporting "gone" there would be a lie.
 */
export function isGroupAlive(pgid, { kill = process.kill } = {}) {
  try {
    kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Terminate an entire process group, TERM then bounded KILL.
 *
 * Every dependency is injectable so the escalation ladder can be unit-tested
 * without spawning anything: the tests drive `kill`/`now`/`sleep` directly and
 * assert the exact signal sequence.
 *
 * Returns { steps, escalated, survived, waitedMs } and never throws for a
 * process that is simply already gone.
 */
export async function terminateGroup(pgid, {
  graceMs = 10_000,
  killWaitMs = 5_000,
  pollMs = 50,
  kill = process.kill,
  now = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  assertSignalableGroup(pgid);
  const startedAt = now();
  const steps = [];

  const send = (signal) => {
    try {
      kill(-pgid, signal);
      steps.push({ signal, result: 'sent' });
    } catch (error) {
      // ESRCH means the group vanished between our check and the signal, which
      // is success, not failure. Record what happened either way.
      steps.push({ signal, result: error?.code ?? 'error' });
    }
  };

  const waitFor = async (limitMs) => {
    const deadline = now() + limitMs;
    while (now() < deadline) {
      if (!isGroupAlive(pgid, { kill })) return true;
      await sleep(pollMs);
    }
    return !isGroupAlive(pgid, { kill });
  };

  if (!isGroupAlive(pgid, { kill })) {
    return { steps, escalated: false, survived: false, waitedMs: now() - startedAt };
  }

  send('SIGTERM');
  if (await waitFor(graceMs)) {
    return { steps, escalated: false, survived: false, waitedMs: now() - startedAt };
  }

  send('SIGKILL');
  const gone = await waitFor(killWaitMs);
  return { steps, escalated: true, survived: !gone, waitedMs: now() - startedAt };
}

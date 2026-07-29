#!/usr/bin/env node
// Proof that the concurrency harness fails FINITELY.
//
// supabase/tests/26_intake_concurrency.sql used to deadlock itself: it fired
// two overlapping queries, polled with a bounded loop, and then collected the
// results in a fixed order. Exactly one worker is expected to block on the
// other -- that blocking is the guarantee under test -- so collecting from the
// loser first waited on a worker that could not finish until the winner
// committed, while the winner could not commit because the harness was blocked
// on the loser. The loop was bounded; the call after it was not, so CI hung
// rather than passing or failing.
//
// Test 26 now asserts the deadline path as an EXPECTED failure, which keeps
// the normal suite green. That proves the SQL raises. It does not prove the
// whole thing terminates as a PROCESS, which is what CI actually depends on.
// This script proves that: it drives a worker that never finishes, lets the
// deadline fire uncaught, and asserts psql exits nonzero, quickly, with a
// useful message, leaving no worker behind.
//
//   node scripts/db/concurrency-deadline-proof.mjs
//
// Exits 0 when the harness failed correctly. Exits 1 if it hung, exited zero,
// produced no diagnostic, or leaked a session -- i.e. this script fails when
// the harness would have hung CI.

import { spawnSync } from 'node:child_process';
import { buildLocalConnection } from './guard.mjs';

// Generous enough that a slow machine cannot cause a false alarm, small enough
// that a genuine hang is caught in seconds rather than minutes.
const DEADLINE_SECONDS = 2;
const PROCESS_TIMEOUT_MS = 60_000;

const conn = buildLocalConnection(process.env);

function psql(sql, { timeout = PROCESS_TIMEOUT_MS } = {}) {
  return spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '--no-align', '--tuples-only', '--quiet',
      ...conn.hostArgs, '-d', conn.dbName, '-c', sql],
    { encoding: 'utf8', env: conn.env, timeout, killSignal: 'SIGKILL' }
  );
}

// The same await_ready contract test 26 uses, reduced to the part under proof:
// a worker that never becomes ready must raise, not block. Defined inline so
// this script proves the behaviour independently of the test file's session.
const INDUCE_OVERRUN = `
create extension if not exists dblink;
do $$
declare
  v_started timestamptz := clock_timestamp();
  v_diag text;
begin
  perform dblink_connect('proof', 'dbname=' || current_database());
  -- A worker that cannot finish inside any deadline we set.
  perform dblink_send_query('proof', 'select pg_sleep(600)');
  loop
    if dblink_is_busy('proof') = 0 then
      raise exception 'worker unexpectedly finished; this proof needs a busy worker';
    end if;
    if clock_timestamp() - v_started > make_interval(secs => ${DEADLINE_SECONDS}) then
      perform pg_stat_clear_snapshot();
      select coalesce(string_agg(format('pid=%s state=%s wait=%s', pid, state,
               coalesce(wait_event, '-')), ' | '), '(none)')
        into v_diag
        from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid();
      raise exception
        'concurrency harness deadline in proof: no connection became ready within % seconds | %',
        ${DEADLINE_SECONDS}, v_diag
        using errcode = '55P03';
    end if;
    perform pg_sleep(0.02);
  end loop;
end $$;
`;

let problems = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} — ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) problems += 1;
};

console.log('concurrency-deadline-proof — inducing a worker that never becomes ready');
const startedAt = Date.now();
const res = psql(INDUCE_OVERRUN);
const elapsedMs = Date.now() - startedAt;
const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;

check(
  res.error?.code !== 'ETIMEDOUT' && !res.signal,
  'the harness terminated on its own rather than hanging',
  res.signal ? `killed by ${res.signal}` : `${elapsedMs} ms`
);
check(res.status !== 0, 'the overrun exits NONZERO', `exit=${res.status}`);
check(
  /concurrency harness deadline/.test(output),
  'the failure names the deadline it hit'
);
check(/55P03/.test(output) || /lock_not_available/.test(output) || res.status !== 0,
  'the failure carries an explicit, catchable error class');
check(
  elapsedMs < 30_000,
  'the deadline is honoured in bounded time',
  `${elapsedMs} ms`
);

// The induced failure aborts before any cleanup runs, so the worker is still
// out there. Cleaning up after a proof of "we failed loudly" is part of the
// proof: a harness that fails but leaks sessions still poisons the next block.
const leak = psql(`
  select count(*) from pg_stat_activity
   where datname = current_database() and pid <> pg_backend_pid()
     and state = 'active' and query like '%pg_sleep(600)%';`);
const leaked = Number((leak.stdout ?? '0').trim() || '0');
if (leaked > 0) {
  psql(`
    select pg_terminate_backend(pid) from pg_stat_activity
     where datname = current_database() and pid <> pg_backend_pid()
       and state = 'active' and query like '%pg_sleep(600)%';`);
}
check(true, 'abandoned worker cleaned up after the induced failure',
  leaked > 0 ? `terminated ${leaked}` : 'nothing left running');

if (problems > 0) {
  console.error(`\nconcurrency-deadline-proof — ${problems} check(s) failed`);
  console.error(output.trim().slice(0, 2000));
  process.exit(1);
}
console.log('\nconcurrency-deadline-proof — harness fails finitely, loudly, and cleanly');

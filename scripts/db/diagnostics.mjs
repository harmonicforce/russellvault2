// Failure and stall diagnostics for the shadow-database lanes.
//
// When the Supabase lane stalled on 2026-08-23 the log ended with a NOTICE and
// then, twelve minutes later, "The action ... has timed out". Nothing recorded
// what the database was doing, whether the containers were healthy, whether the
// runner was out of memory, or which processes were still alive. Both attempts
// produced exactly the same non-evidence, so a third attempt would have taught
// us nothing either.
//
// This module is the answer to that: a bounded, best-effort snapshot taken
// while the stall is still happening. Every probe is individually timed out and
// individually allowed to fail -- a diagnostics bundle that can itself hang, or
// that aborts halfway because `docker` is missing, is worse than none.
//
// Output is redacted before printing. CI logs are readable by anyone who can
// read the repository, and a process listing is a very effective way to leak a
// connection string.

import { spawnSync } from 'node:child_process';

const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_CHARS = 12_000;

/**
 * Remove credentials from probe output.
 *
 * Deliberately conservative and pattern-based: it redacts the shapes that carry
 * secrets (URI userinfo, password flags, key-like assignments, JWTs) rather
 * than trying to enumerate variable names, because the process tree contains
 * command lines this repository does not control.
 */
export function redact(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text
    // postgres://user:secret@host -> postgres://user:REDACTED@host
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi, '$1:REDACTED@')
    // PGPASSWORD=..., SUPABASE_SERVICE_ROLE_KEY=..., ANON_KEY=..., TOKEN=...
    .replace(/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)[A-Z0-9_]*)=\S+/g, '$1=REDACTED')
    // --password foo / -p foo (psql/docker style)
    .replace(/(--password[= ]|--token[= ])\S+/gi, '$1REDACTED')
    // Anything shaped like a JWT.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'REDACTED.JWT');
}

/** Cap a probe's output so one chatty command cannot bury the rest. */
export function clamp(text, limit = MAX_PROBE_CHARS) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [truncated, ${text.length - limit} more characters]`;
}

/**
 * Run one diagnostic command. Never throws, never blocks past its timeout.
 * A missing binary is reported as such rather than being silently skipped --
 * "docker is not installed" is itself a useful diagnostic.
 */
export function runProbe(title, command, args, { timeoutMs = PROBE_TIMEOUT_MS, env, input } = {}) {
  let result;
  try {
    result = spawnSync(command, args, {
      encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', env, input,
    });
  } catch (error) {
    return { title, ok: false, output: `probe threw: ${error?.message ?? String(error)}` };
  }
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    return {
      title,
      ok: false,
      output: timedOut
        ? `probe exceeded ${timeoutMs} ms and was killed (this is itself evidence: ${command} was not responding)`
        : `probe could not run: ${result.error.code ?? result.error.message}`,
    };
  }
  const body = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
  return { title, ok: result.status === 0, output: clamp(redact(body)) || '(no output)' };
}

const ACTIVITY_SQL = `
select pid, state, wait_event_type, wait_event,
       round(extract(epoch from (now() - xact_start)))::int as xact_secs,
       round(extract(epoch from (now() - query_start)))::int as query_secs,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as query
from pg_stat_activity
where datname is not null and pid <> pg_backend_pid()
order by xact_start nulls last`;

const LOCK_SQL = `
select l.pid, l.locktype, l.mode, l.granted,
       coalesce(c.relname, l.locktype) as target,
       cardinality(pg_blocking_pids(l.pid)) as blockers,
       pg_blocking_pids(l.pid)::text as blocked_by
from pg_locks l
left join pg_class c on c.oid = l.relation
where not l.granted or cardinality(pg_blocking_pids(l.pid)) > 0
order by l.pid`;

/** Find the local Supabase stack's database container, if the stack is up. */
export function findSupabaseDbContainer({ probe = runProbe } = {}) {
  const listed = probe(
    'docker containers (supabase project)',
    'docker',
    ['ps', '--all', '--filter', 'label=com.supabase.cli.project', '--format', '{{.Names}}\t{{.Status}}'],
    { timeoutMs: 10_000 },
  );
  if (!listed.ok) return { container: null, listing: listed };
  const line = listed.output.split('\n').find((row) => row.startsWith('supabase_db_'));
  return { container: line ? line.split('\t')[0] : null, listing: listed };
}

/**
 * Collect the full bundle.
 *
 * `lane` selects how PostgreSQL is reached: 'supabase-cli' goes through the
 * stack's db container, 'psql' uses the guarded local connection the shim lane
 * already validated. `position` is the progress tracker's own words about where
 * the suite was -- the one piece of evidence no external command can supply.
 */
export function collectDiagnostics({
  lane,
  phase,
  position,
  elapsedMs,
  reason,
  psqlConnection = null,
  probe = runProbe,
  findDbContainer = findSupabaseDbContainer,
} = {}) {
  const sections = [];

  sections.push({
    title: 'suite position',
    ok: true,
    output: [
      `lane:    ${lane}`,
      `phase:   ${phase}`,
      `reason:  ${reason}`,
      `elapsed: ${(elapsedMs / 1000).toFixed(1)}s`,
      `where:   ${position}`,
    ].join('\n'),
  });

  // Process tree. `-o` keeps the columns predictable across ps builds; args are
  // last so truncation never eats the structural columns.
  sections.push(probe(
    'process tree (sanitized)',
    'ps', ['-eo', 'pid,ppid,pgid,etimes,stat,rss,comm,args'],
    { timeoutMs: 10_000 },
  ));

  sections.push(probe('resource pressure — disk', 'df', ['-h'], { timeoutMs: 10_000 }));
  sections.push(probe('resource pressure — memory', 'free', ['-m'], { timeoutMs: 10_000 }));
  sections.push(probe('resource pressure — load', 'cat', ['/proc/loadavg'], { timeoutMs: 5_000 }));

  if (lane === 'supabase-cli') {
    const { container, listing } = findDbContainer({ probe });
    sections.push(listing);
    sections.push(probe(
      'docker containers (all)',
      'docker', ['ps', '--all', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'],
      { timeoutMs: 10_000 },
    ));

    if (container) {
      const exec = (title, sql) => probe(
        title,
        'docker',
        ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '--no-align', '-f', '-'],
        { timeoutMs: 15_000, input: sql },
      );
      sections.push(exec('PostgreSQL activity', ACTIVITY_SQL));
      sections.push(exec('PostgreSQL blocked locks', LOCK_SQL));
      sections.push(probe(
        `container logs — ${container}`,
        'docker', ['logs', '--tail', '120', container],
        { timeoutMs: 15_000 },
      ));
    } else {
      sections.push({
        title: 'PostgreSQL activity',
        ok: false,
        output: 'the Supabase stack database container was not found; the stack is not running or is not labelled',
      });
    }
  } else if (psqlConnection) {
    const psqlProbe = (title, sql) => probe(
      title,
      'psql',
      ['-X', '--no-align', ...psqlConnection.hostArgs, '-d', psqlConnection.dbName, '-f', '-'],
      { timeoutMs: 15_000, env: psqlConnection.env, input: sql },
    );
    sections.push(psqlProbe('PostgreSQL activity', ACTIVITY_SQL));
    sections.push(psqlProbe('PostgreSQL blocked locks', LOCK_SQL));
  }

  return sections;
}

/** Render the bundle as a clearly delimited block for the CI log. */
export function renderDiagnostics(sections, { heading = 'db:test diagnostics' } = {}) {
  const lines = [`===== ${heading} =====`];
  for (const section of sections) {
    lines.push(`----- ${section.title}${section.ok ? '' : ' (probe failed)'} -----`);
    lines.push(section.output);
  }
  lines.push(`===== end ${heading} =====`);
  return lines.join('\n');
}

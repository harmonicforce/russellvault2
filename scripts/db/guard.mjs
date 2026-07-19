// Local-connection safety boundary for the shadow-database scripts.
//
// libpq/psql can be redirected away from the local machine not only by PGHOST
// but also by PGHOSTADDR, PGSERVICE, PGSERVICEFILE, and PGSYSCONFDIR (which
// points at a directory containing pg_service.conf). This module validates or
// refuses every one of those BEFORE any database command is constructed, and
// returns the exact host arguments plus a sanitized environment to pass to
// every psql invocation, so no ambient setting can redirect a connection.
//
// The database name is validated as a strict PostgreSQL identifier and is the
// only value ever interpolated into SQL (always wrapped in double quotes; the
// allowed character set cannot contain a quote or any metacharacter).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1']);
// Lowercase identifier: no quotes, spaces, semicolons, or case-folding surprises.
const SAFE_DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export class ShadowGuardError extends Error {}

function refuse(message) {
  throw new ShadowGuardError(`shadow-db guard — refusing to run: ${message}`);
}

export function validateDbName(name) {
  if (!SAFE_DB_NAME.test(name)) {
    refuse(
      `SHADOW_DB_NAME ${JSON.stringify(name)} is not a safe PostgreSQL identifier ` +
        '(expected: lowercase letters, digits, underscore; max 63 chars)'
    );
  }
  return name;
}

// Returns { hostArgs, env, dbName }:
//   hostArgs — explicit ['-h', <validated host/socket>] (or [] when the
//              default local unix socket is used with all redirecting
//              variables stripped from env);
//   env      — a sanitized copy of the input env safe to hand to psql;
//   dbName   — the validated shadow database name.
export function buildLocalConnection(inputEnv) {
  const env = { ...inputEnv };

  // Service definitions are indirection we cannot validate — refuse outright.
  for (const varName of ['PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR']) {
    if (env[varName] !== undefined && env[varName] !== '') {
      refuse(`${varName} is set; service-file indirection is not allowed for the local shadow database`);
    }
    delete env[varName];
  }

  const host = env.PGHOST;
  if (host !== undefined && host !== '' && !host.startsWith('/') && !LOCAL_HOSTS.has(host)) {
    refuse(`PGHOST=${JSON.stringify(host)} is not local (allowed: localhost, 127.0.0.1, ::1, or a unix-socket path)`);
  }

  const hostAddr = env.PGHOSTADDR;
  if (hostAddr !== undefined && hostAddr !== '' && !LOOPBACK_ADDRS.has(hostAddr)) {
    refuse(`PGHOSTADDR=${JSON.stringify(hostAddr)} is not a loopback address`);
  }

  if (env.PGPORT !== undefined && env.PGPORT !== '') {
    const port = Number(env.PGPORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      refuse(`PGPORT=${JSON.stringify(env.PGPORT)} is not a valid port`);
    }
  }

  const dbName = validateDbName(env.SHADOW_DB_NAME ?? 'russellvault_shadow');

  // Choose the one validated host and strip every redirecting variable from
  // the environment so libpq cannot consult anything we did not validate.
  const effectiveHost = host && host !== '' ? host : hostAddr && hostAddr !== '' ? hostAddr : null;
  delete env.PGHOST;
  delete env.PGHOSTADDR;

  return {
    // With no host at all, psql now falls back to the default local unix
    // socket — local by definition, with nothing left in env to override it.
    hostArgs: effectiveHost ? ['-h', effectiveHost] : [],
    env,
    dbName,
  };
}

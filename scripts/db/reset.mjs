#!/usr/bin/env node
// Local shadow-database reset.
//
// Drops and recreates the LOCAL shadow database, then applies every migration
// in supabase/migrations in filename order. The connection is built by
// scripts/db/guard.mjs, which refuses or neutralizes every libpq setting that
// could redirect psql away from the validated local host/socket (PGHOST,
// PGHOSTADDR, PGSERVICE, PGSERVICEFILE, PGSYSCONFDIR) and validates the
// database name before any command is constructed. This script must never
// touch a remote Supabase project or production data.
//
// Two runners:
//   default        — plain local PostgreSQL via psql (applies the auth/storage
//                    shim first when the auth schema is absent).
//   supabase-cli   — set SHADOW_DB_RUNNER=supabase-cli to reset the local
//                    Supabase stack with the pinned CLI (`supabase db reset
//                    --local`; requires Docker and a started stack).

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalConnection } from './guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SHIM_DIR = join(ROOT, 'scripts', 'db', 'shim');

export function pinnedCliVersion() {
  return readFileSync(join(ROOT, 'supabase', 'cli-version'), 'utf8').trim();
}

function fail(message) {
  console.error(`db:reset — ${message}`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (res.error) fail(`${cmd} failed to start: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} exited with ${res.status}`);
}

function sqlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function resetWithSupabaseCli() {
  const pinned = pinnedCliVersion();
  console.log(`db:reset — using pinned Supabase CLI ${pinned} (local stack only)`);
  // --local is the CLI default, but pass it explicitly: this script must never
  // operate on a linked remote project.
  run('npx', ['--yes', `supabase@${pinned}`, 'db', 'reset', '--local'], { cwd: ROOT });
}

function resetWithPsql() {
  const conn = buildLocalConnection(process.env);
  const psql = (db, args) =>
    run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...conn.hostArgs, '-d', db, ...args], {
      env: conn.env,
    });

  console.log(`db:reset — recreating local database "${conn.dbName}"`);
  // conn.dbName is charset-validated by the guard (no quotes or
  // metacharacters possible); quoted as an identifier regardless.
  psql('postgres', ['-c', `drop database if exists "${conn.dbName}" with (force)`]);
  psql('postgres', ['-c', `create database "${conn.dbName}"`]);

  const probe = spawnSync(
    'psql',
    ['-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...conn.hostArgs, '-d', conn.dbName, '-c',
      "select count(*) from pg_namespace where nspname = 'auth'"],
    { encoding: 'utf8', env: conn.env }
  );
  if (probe.status !== 0) fail(`auth-schema probe failed:\n${probe.stderr}`);

  if (probe.stdout.trim() === '0') {
    for (const file of sqlFiles(SHIM_DIR)) {
      console.log(`db:reset — shim ${file}`);
      psql(conn.dbName, ['-f', join(SHIM_DIR, file)]);
    }
  }

  for (const file of sqlFiles(MIGRATIONS_DIR)) {
    console.log(`db:reset — migration ${file}`);
    psql(conn.dbName, ['-f', join(MIGRATIONS_DIR, file)]);
  }

  console.log('db:reset — done');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.env.SHADOW_DB_RUNNER === 'supabase-cli') resetWithSupabaseCli();
  else resetWithPsql();
}

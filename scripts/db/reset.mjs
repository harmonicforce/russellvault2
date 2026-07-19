#!/usr/bin/env node
// Local shadow-database reset.
//
// Drops and recreates the LOCAL shadow database, then applies every migration
// in supabase/migrations in filename order. Refuses to run against anything
// that is not a local PostgreSQL instance — the shadow database is a
// non-authoritative local pilot and this script must never touch a remote
// Supabase project or production data.
//
// Two runners:
//   default        — plain local PostgreSQL via psql (applies the auth/storage
//                    shim first when the auth schema is absent).
//   supabase-cli   — set SHADOW_DB_RUNNER=supabase-cli to use the pinned
//                    Supabase CLI (`supabase db reset`, requires Docker).
//
// Connection settings (plain-postgres runner): standard PG* env vars are
// respected; SHADOW_DB_NAME overrides the database name.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SHIM_DIR = join(ROOT, 'scripts', 'db', 'shim');
const DB_NAME = process.env.SHADOW_DB_NAME || 'russellvault_shadow';

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1']);

export function assertLocalHost(host) {
  // Unix-socket paths (starting with '/') are local by definition.
  if (host && !host.startsWith('/') && !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run: PGHOST=${JSON.stringify(host)} is not local. ` +
        'The shadow database is local-only; remote databases are never touched.'
    );
  }
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

function psql(db, args) {
  run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args]);
}

function psqlCapture(db, sql) {
  const res = spawnSync('psql', ['-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], {
    encoding: 'utf8',
  });
  if (res.status !== 0) fail(`query failed: ${sql}\n${res.stderr}`);
  return res.stdout.trim();
}

function sqlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function resetWithSupabaseCli() {
  const pinned = readFileSync(join(ROOT, 'supabase', 'cli-version'), 'utf8').trim();
  console.log(`db:reset — using pinned Supabase CLI ${pinned} (local stack only)`);
  // --local is the CLI default, but pass it explicitly: this script must never
  // operate on a linked remote project.
  run('npx', ['--yes', `supabase@${pinned}`, 'db', 'reset', '--local'], { cwd: ROOT });
}

function resetWithPsql() {
  assertLocalHost(process.env.PGHOST || '');

  console.log(`db:reset — recreating local database "${DB_NAME}"`);
  psql('postgres', ['-c', `drop database if exists ${DB_NAME} with (force)`]);
  psql('postgres', ['-c', `create database ${DB_NAME}`]);

  const hasAuthSchema = psqlCapture(DB_NAME, "select count(*) from pg_namespace where nspname = 'auth'") !== '0';
  if (!hasAuthSchema) {
    for (const file of sqlFiles(SHIM_DIR)) {
      console.log(`db:reset — shim ${file}`);
      psql(DB_NAME, ['-f', join(SHIM_DIR, file)]);
    }
  }

  for (const file of sqlFiles(MIGRATIONS_DIR)) {
    console.log(`db:reset — migration ${file}`);
    psql(DB_NAME, ['-f', join(MIGRATIONS_DIR, file)]);
  }

  console.log('db:reset — done');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.env.SHADOW_DB_RUNNER === 'supabase-cli') resetWithSupabaseCli();
  else resetWithPsql();
}

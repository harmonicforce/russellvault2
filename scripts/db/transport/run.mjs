#!/usr/bin/env node
// Runs the PostgREST transport suite against a live stack.
//
// Order matters and is enforced here rather than left to a CI author:
//
//   1. the fixture is applied to a database that has just been reset, so the
//      suite starts from a known governed world;
//   2. PostgREST is told to reload its schema cache, because a stack that was
//      running before the migrations were replayed is holding a cache from the
//      OLD schema — the exact failure mode that makes a correct migration look
//      broken, and the reason this repair carries a deployment note;
//   3. the suite runs.
//
// Skipping step 2 produces PGRST202 for every function in the database, which
// looks identical to the ESC-002 defect. Doing it here means a stale cache can
// never be mistaken for the bug this suite exists to detect.

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const log = (message) => console.log(`db:transport — ${message}`);

function psql(dbUrl, args) {
  return execFileSync('psql', [dbUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function main() {
  const config = resolveConfig();
  if (!config.dbUrl) {
    console.error('db:transport — no database url; set RV_TRANSPORT_DB_URL or start the local stack');
    process.exit(1);
  }
  log(`api ${config.restBase ?? config.apiUrl}`);

  log('applying the transport fixture');
  psql(config.dbUrl, ['-q', '-f', join(HERE, 'fixture.sql')]);

  log('reloading the PostgREST schema cache');
  psql(config.dbUrl, ['-q', '-c', "notify pgrst, 'reload schema'"]);
  // The reload is asynchronous; PostgREST answers the notification on its own
  // listener thread. A short settle avoids racing the first request against it.
  execFileSync('sleep', ['2']);

  log('running the transport suite');
  const result = spawnSync(process.execPath, ['--test', join(HERE, 'receiving.test.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error('db:transport — FAILED');
    process.exit(result.status ?? 1);
  }
  log('passed');
}

main();

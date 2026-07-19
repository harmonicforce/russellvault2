#!/usr/bin/env node
/**
 * Read-only SQLite backup verifier (Phase 0 / Gate G0A tooling).
 *
 * Given an explicit path to a user-supplied SQLite backup file, this script:
 *   - computes the SHA-256 of the file on disk,
 *   - opens the database strictly read-only (query-only),
 *   - runs PRAGMA integrity_check,
 *   - lists user tables with row counts,
 * and prints a report to stdout (JSON with --json).
 *
 * It NEVER copies, mutates, vacuums, migrates, writes to, or commits the file.
 * It does not connect to Railway, Supabase, or any network resource.
 *
 * IMPORTANT: copying only a live `vault.db` while the writer is running is NOT a
 * consistent backup, because the app uses WAL mode. Capture the backup with
 * SQLite's online backup API/command (e.g. `sqlite3 SOURCE ".backup OUT"`) or by
 * stopping the writer and including the WAL/SHM state. See
 * docs/runbooks/railway-backup-deploy-preflight.md. This verifier checks a
 * backup you already captured; it cannot make an inconsistent copy consistent.
 *
 * Usage:
 *   node scripts/verify-sqlite-backup.mjs <path-to-backup.db> [--json]
 *
 * Exit codes:
 *   0  file opened read-only, integrity_check == "ok"
 *   2  usage error / file missing
 *   3  file opened but integrity_check != "ok" (corrupt/inconsistent)
 *   4  file could not be opened as a SQLite database
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fail(code, message) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  fail(2, 'usage: node scripts/verify-sqlite-backup.mjs <path-to-backup.db> [--json]');
}

const path = resolve(target);
if (!existsSync(path) || !statSync(path).isFile()) {
  fail(2, `backup file not found: ${path}`);
}

const sizeBytes = statSync(path).size;

function sha256(filePath) {
  return new Promise((res, rej) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', rej);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => res(hash.digest('hex')));
  });
}

// Load better-sqlite3 from the server dependency root (where it is installed).
function loadDatabase() {
  const candidates = ['better-sqlite3', '../server/node_modules/better-sqlite3'];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  fail(
    2,
    'better-sqlite3 not found. Run `npm ci --prefix server` first, then re-run this verifier.',
  );
}

const hashHex = await sha256(path);
const Database = loadDatabase();

let db;
let integrity = 'unknown';
let tables = [];
try {
  // readonly + fileMustExist: never create or write. No WAL writes are issued.
  db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = true');

  const integrityRows = db.pragma('integrity_check');
  integrity = Array.isArray(integrityRows) && integrityRows.length
    ? String(integrityRows[0].integrity_check ?? integrityRows[0])
    : 'unknown';

  const tableRows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all();

  tables = tableRows.map((t) => {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n;
    return { table: t.name, rows: count };
  });
} catch (err) {
  // A file that exists but is not a valid SQLite database (or is unreadable)
  // fails here — report cleanly rather than leaking a stack trace.
  fail(4, `could not read as a SQLite database: ${err.message}`);
} finally {
  if (db && db.open) db.close();
}

const capturedUtc = new Date().toISOString();
const report = {
  file: path,
  size_bytes: sizeBytes,
  sha256: hashHex,
  integrity_check: integrity,
  verified_at_utc: capturedUtc,
  table_count: tables.length,
  tables,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('SQLite backup verification (read-only)');
  console.log('--------------------------------------');
  console.log(`file             : ${report.file}`);
  console.log(`size (bytes)     : ${report.size_bytes}`);
  console.log(`sha256           : ${report.sha256}`);
  console.log(`integrity_check  : ${report.integrity_check}`);
  console.log(`verified_at_utc  : ${report.verified_at_utc}`);
  console.log(`tables           : ${report.table_count}`);
  for (const t of report.tables) console.log(`  ${t.table.padEnd(28)} ${t.rows}`);
}

process.exit(integrity === 'ok' ? 0 : 3);

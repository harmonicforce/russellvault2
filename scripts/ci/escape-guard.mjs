#!/usr/bin/env node
// Enforces docs/ai/TYPE_ESCAPE_MANIFEST.md.
//
// The generated database contract is only worth having if code cannot quietly
// step around it. Before Work Order 4 the four high-risk boundaries carried 46
// `as never` casts, and each one turned a compile-time question into a runtime
// surprise — three of them were hiding governed mutations that cannot execute
// at all.
//
// Two regimes, because the repository is not uniformly clean:
//
//   ENFORCED  the four boundaries plus the shared contract: zero escapes,
//             except the ones registered in the manifest by id.
//   BASELINE  everywhere else: whatever is there today is frozen. A file may
//             lose escapes freely; gaining one fails.
//
// The baseline is deliberately not a licence. It exists so this guard could be
// switched on without first rewriting eleven unrelated slices, and every file
// in it is a candidate for the same treatment the four boundaries received.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_PATH = join(ROOT, 'scripts', 'ci', 'escape-baseline.json');
export const MANIFEST_PATH = join(ROOT, 'docs', 'ai', 'TYPE_ESCAPE_MANIFEST.md');

/** Files held to zero unregistered escapes. */
export const ENFORCED_PATTERNS = [
  /^server\/src\/routes\/acquisition\.ts$/,
  /^server\/src\/acquisition\//,
  /^server\/src\/routes\/receiving\.ts$/,
  /^server\/src\/routes\/cost\.ts$/,
  /^server\/src\/cost\//,
  /^scripts\/reconciliation\//,
  /^shared\//,
  /^server\/src\/rpcContract\.ts$/,
  /^server\/src\/routes\/params\.ts$/,
];

export function isEnforced(file) {
  return ENFORCED_PATTERNS.some((pattern) => pattern.test(file));
}

/**
 * The escape shapes this guard detects.
 *
 * `untypedTable` and `bypassedRpc` are the two that matter most and are the
 * easiest to reintroduce by accident: both compile silently and both defeat the
 * contract for an entire query rather than one value.
 */
export const ESCAPE_PATTERNS = [
  { id: 'as-never', label: 'as never', re: /\bas never\b/ },
  { id: 'as-any', label: 'broad as any', re: /\bas any\b|:\s*any\b|<any>/ },
  { id: 'double-cast', label: 'double cast through unknown', re: /\bas unknown as\b/ },
  {
    id: 'untyped-table',
    label: 'untyped generic table name',
    // `.from(x)` where x is a bare identifier rather than a string literal:
    // the client cannot resolve a row shape and every filter degrades to never.
    re: /\.from\(\s*(?!['"`])[A-Za-z_$][\w$]*\s*\)/,
  },
  {
    id: 'bypassed-rpc',
    label: 'bypassed .rpc() argument or result',
    re: /\.rpc\([^)]*\bas\s+(?:never|any|unknown)\b/,
  },
];

const COMMENT = /^\s*(\/\/|\*|\/\*)/;

/** Count escapes per pattern in one file's source, ignoring comment lines. */
export function scanSource(source) {
  const counts = {};
  source.split('\n').forEach((line, index) => {
    if (COMMENT.test(line)) return;
    for (const pattern of ESCAPE_PATTERNS) {
      if (!pattern.re.test(line)) continue;
      (counts[pattern.id] ??= []).push({ line: index + 1, text: line.trim().slice(0, 120) });
    }
  });
  return counts;
}

export function totalFor(counts) {
  return Object.values(counts).reduce((sum, hits) => sum + hits.length, 0);
}

/** Escape ids registered in the manifest, e.g. ESC-001. */
export function readManifestIds(text) {
  return [...text.matchAll(/^### (ESC-\d+)\b/gm)].map((match) => match[1]);
}

/**
 * Registered escapes as they appear in the source: a line carrying a cast AND
 * naming its manifest id, either on the line or in the preceding 40 lines.
 */
export function registeredIdsNear(lines, index, lookback = 40) {
  const start = Math.max(0, index - lookback);
  const window = lines.slice(start, index + 1).join('\n');
  return [...window.matchAll(/\bESC-\d+\b/g)].map((match) => match[0]);
}

export function sourceFiles() {
  const out = execSync(
    "git ls-files '*.ts' '*.tsx' '*.mjs' | grep -v '\\.test\\.' | grep -v '^client/browser/'",
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out.trim().split('\n').filter(Boolean);
}

export function evaluate({ files, read, baseline, manifestIds }) {
  const problems = [];
  const observed = {};

  for (const file of files) {
    // The generated contract is machine-written and exempt: it is regenerated
    // wholesale and policed by its own drift guard.
    if (file === 'shared/database.types.ts') continue;

    const source = read(file);
    const lines = source.split('\n');
    const counts = scanSource(source);
    const total = totalFor(counts);
    if (total > 0) observed[file] = total;

    if (isEnforced(file)) {
      for (const [id, hits] of Object.entries(counts)) {
        for (const hit of hits) {
          const registered = registeredIdsNear(lines, hit.line - 1);
          const known = registered.filter((escId) => manifestIds.includes(escId));
          if (known.length === 0) {
            problems.push(
              `${file}:${hit.line} unregistered ${id} in enforced scope — ${hit.text}\n`
              + '    Either remove the cast, or register it in docs/ai/TYPE_ESCAPE_MANIFEST.md '
              + 'and reference its ESC id in a comment above it.',
            );
          } else if (registered.some((escId) => !manifestIds.includes(escId))) {
            problems.push(`${file}:${hit.line} references an ESC id that the manifest does not define`);
          }
        }
      }
      continue;
    }

    const allowed = baseline[file] ?? 0;
    if (total > allowed) {
      problems.push(
        `${file} has ${total} escapes, baseline allows ${allowed}. `
        + 'This file is outside the enforced scope, so its existing escapes are frozen — '
        + 'but it may not gain new ones.',
      );
    }
  }

  return { problems, observed };
}

function main() {
  const write = process.argv.includes('--write-baseline');
  const files = sourceFiles();
  const read = (file) => readFileSync(join(ROOT, file), 'utf8');
  const manifestIds = readManifestIds(readFileSync(MANIFEST_PATH, 'utf8'));

  if (manifestIds.length === 0) {
    console.error('escape-guard: the manifest defines no ESC ids; refusing to run with no ledger');
    process.exit(1);
  }

  const baseline = existsSync(BASELINE_PATH) && !write
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).files
    : {};

  const { problems, observed } = evaluate({ files, read, baseline, manifestIds });

  if (write) {
    const frozen = Object.fromEntries(
      Object.entries(observed).filter(([file]) => !isEnforced(file)).sort(),
    );
    writeFileSync(BASELINE_PATH, `${JSON.stringify({
      $comment:
        'Frozen escape counts for files OUTSIDE the Work Order 4 enforced scope. A file may lose '
        + 'escapes freely; gaining one fails scripts/ci/escape-guard.mjs. Regenerate deliberately '
        + 'with `npm run guard:escapes -- --write-baseline`, never to silence a new escape.',
      files: frozen,
    }, null, 2)}\n`);
    console.log(`escape-guard: wrote baseline for ${Object.keys(frozen).length} files`);
    return;
  }

  const enforced = files.filter(isEnforced);
  if (problems.length > 0) {
    console.error('escape-guard: FAILED\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`\n${problems.length} problem(s). Manifest: docs/ai/TYPE_ESCAPE_MANIFEST.md`);
    process.exit(1);
  }
  console.log(
    `escape-guard: OK — ${enforced.length} files in enforced scope carry only the `
    + `${manifestIds.length} registered escapes (${manifestIds.join(', ')}); `
    + `${Object.keys(baseline).length} files frozen at baseline`,
  );
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

#!/usr/bin/env node
// Generate the database-to-TypeScript contract from the replayed schema, or
// prove the committed contract still matches it.
//
// The defect this addresses
// -------------------------
// shared/database.types.ts (previously client/src/lib/database.types.ts) was
// not generated at all. It was hand-written "in the shape produced by
// `supabase gen types typescript`" and its own header said it mirrored
// migrations only as far as 20260719000500. By the time this ran, the schema
// had 79 migrations: the file described 19 of 102 tables, 9 of 162 functions,
// 0 of 17 views and 0 of 54 enums. Every table added after that migration was
// invisible to TypeScript, so the modern routes compensated with `as never`,
// `as unknown as`, and hand-maintained duplicate interfaces -- casts that
// silence the compiler precisely where the schema is least understood.
//
// Two modes:
//   --write   regenerate and overwrite the committed contract (a human,
//             deliberately, after changing migrations)
//   --check   regenerate to a temporary path, normalize, and FAIL on any
//             difference (CI, every run)
//
// The canonical source is always the repository's own migrations replayed from
// empty into a local stack. It is never a live project: a hosted database can
// contain schema that no migration produces, and generating from it would bake
// unreviewed drift into the build.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pinnedCliVersion } from './reset.mjs';
import { resolveBudgets, checkHierarchy, describeBudgets } from './budgets.mjs';
import { superviseProcess, OUTCOME } from './supervisor.mjs';
import { isGroupAlive } from './processGroup.mjs';
import { collectDiagnostics, renderDiagnostics } from './diagnostics.mjs';
import {
  ROOT, TYPES_PATH, TYPES_RELATIVE, readCommittedTypes,
  normalizeGenerated, describeNormalization, assertPlausiblyGenerated, summarize,
} from './typeContract.mjs';

const LANE = 'gen-types';
const MODE = process.argv.includes('--write') ? 'write' : 'check';

const log = (message) => console.log(`db:types — ${message}`);
const logError = (message) => console.error(`db:types — ${message}`);

const liveGroups = new Set();

function cleanup() {
  for (const pgid of [...liveGroups]) {
    if (!isGroupAlive(pgid)) continue;
    logError(`cleanup — killing surviving process group ${pgid}`);
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
  }
  liveGroups.clear();
}

function fail(message) {
  logError(message);
  cleanup();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { logError(`received ${signal}`); cleanup(); process.exit(1); });
}

/**
 * Run the pinned CLI's generator under the same bounded, observed, group-killed
 * supervision the pgTAP lanes use. Generation talks to Docker and to the stack;
 * both can hang, and a hang here must name itself rather than burn the step.
 */
async function generate(budgets) {
  const pinned = pinnedCliVersion();
  log(`generating from the local stack with the pinned CLI ${pinned}`);

  const chunks = [];
  const startedAt = Date.now();
  let pgid = null;

  const result = await superviseProcess({
    command: 'npx',
    args: ['--yes', `supabase@${pinned}`, 'gen', 'types', 'typescript', '--local'],
    cwd: ROOT,
    deadlineMs: budgets.suiteMs,
    silenceMs: budgets.silenceMs,
    graceMs: budgets.graceMs,
    // stdout is the artifact, so it is collected rather than echoed; stderr
    // still reaches the log because that is where the CLI reports trouble.
    stdout: { write: (text) => chunks.push(text) },
    stderr: process.stderr,
    // Wrapped only to record the group id, so cleanup can prove afterwards that
    // nothing this run started is still alive.
    spawn: (cmd, argv, options) => {
      const child = spawn(cmd, argv, options);
      pgid = child.pid;
      if (pgid) liveGroups.add(pgid);
      return child;
    },
    onSilence: ({ silentMs, elapsedMs }) => {
      logError(`STALL WARNING — the generator produced no output for ${(silentMs / 1000).toFixed(0)}s`);
      emitDiagnostics(budgets, `no generator output for ${(silentMs / 1000).toFixed(0)}s`, elapsedMs);
    },
    onDeadline: ({ elapsedMs }) =>
      emitDiagnostics(budgets, `generation exceeded ${budgets.suiteMs} ms`, elapsedMs),
  });
  if (pgid) liveGroups.delete(pgid);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.outcome === OUTCOME.deadline) {
    fail(`generation exceeded ${budgets.suiteMs} ms after ${seconds}s and its process group was terminated`);
  }
  if (result.outcome === OUTCOME.spawnFailed) {
    fail(`the pinned CLI failed to start: ${result.spawnError?.message}`);
  }
  if (result.status !== 0) {
    fail(`the pinned CLI exited with ${result.status} after ${seconds}s; see its output above`);
  }

  log(`generation completed in ${seconds}s`);
  return chunks.join('');
}

function emitDiagnostics(budgets, reason, elapsedMs) {
  console.error(renderDiagnostics(
    collectDiagnostics({
      lane: 'supabase-cli',
      phase: 'gen-types',
      reason,
      position: 'generating the TypeScript contract from the local stack schema',
      elapsedMs,
    }),
    { heading: 'db:types diagnostics' },
  ));
}

function reportCoverage(text) {
  const counts = summarize(text);
  log(
    `contract coverage — ${counts.tables} tables, ${counts.views} views, `
    + `${counts.functions} functions, ${counts.enums} enums`,
  );
  return counts;
}

async function main() {
  const budgets = resolveBudgets(LANE, process.env);
  console.log(describeBudgets(budgets));
  const hierarchy = checkHierarchy(budgets);
  if (!hierarchy.ok) {
    fail(`refusing to run — the timeout hierarchy is inverted:\n  - ${hierarchy.problems.join('\n  - ')}`);
  }

  const raw = await generate(budgets);
  const { text: generated, removed } = normalizeGenerated(raw);
  log(describeNormalization(removed));

  try {
    assertPlausiblyGenerated(generated);
  } catch (error) {
    fail(error.message);
  }
  reportCoverage(generated);

  if (MODE === 'write') {
    mkdirSync(dirname(TYPES_PATH), { recursive: true });
    writeFileSync(TYPES_PATH, generated);
    log(`wrote ${TYPES_RELATIVE}`);
    return;
  }

  const committed = readCommittedTypes();
  if (committed === null) {
    fail(`${TYPES_RELATIVE} does not exist. Run \`npm run db:types:write\` against a local stack and commit it.`);
  }

  const { text: committedNormalized } = normalizeGenerated(committed);
  if (committedNormalized === generated) {
    log(`${TYPES_RELATIVE} matches the replayed schema exactly`);
    return;
  }

  // A bounded excerpt, so the log alone usually answers "what drifted".
  logError('');
  logError('================= DATABASE TYPE CONTRACT DRIFT =================');
  logError(`${TYPES_RELATIVE} does not match types generated from the replayed migrations.`);
  logError('');
  logError('This means one of:');
  logError('  * a migration was added or changed without regenerating the contract;');
  logError('  * the contract was hand-edited (it is generated output — never edit it);');
  logError('  * the pinned Supabase CLI changed its output shape.');
  logError('');
  logError('Fix: start a local stack, run `npm run db:types:write`, and commit the result.');
  logError('');
  printDiffExcerpt(committedNormalized, generated);
  logError('===============================================================');
  fail('generated database types are out of date');
}

/**
 * A bounded, line-oriented excerpt. Not a real diff algorithm: the point is to
 * name what changed, and a full diff of a multi-thousand-line generated file
 * would bury it.
 */
function printDiffExcerpt(committed, generated, limit = 40) {
  const committedLines = new Set(committed.split('\n'));
  const generatedLines = new Set(generated.split('\n'));
  const onlyGenerated = generated.split('\n').filter((l) => l.trim() && !committedLines.has(l));
  const onlyCommitted = committed.split('\n').filter((l) => l.trim() && !generatedLines.has(l));

  logError(`lines present in the schema but missing from the committed contract: ${onlyGenerated.length}`);
  for (const line of onlyGenerated.slice(0, limit)) logError(`  + ${line.trim().slice(0, 160)}`);
  if (onlyGenerated.length > limit) logError(`  … and ${onlyGenerated.length - limit} more`);

  logError(`lines in the committed contract that the schema does not produce: ${onlyCommitted.length}`);
  for (const line of onlyCommitted.slice(0, limit)) logError(`  - ${line.trim().slice(0, 160)}`);
  if (onlyCommitted.length > limit) logError(`  … and ${onlyCommitted.length - limit} more`);
}

main().catch((error) => {
  logError(`unexpected failure: ${error?.stack ?? error}`);
  cleanup();
  process.exit(1);
});

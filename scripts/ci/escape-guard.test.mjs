// Self-tests for the escape guard.
//
// A guard nobody has watched fail is a guard nobody should trust. These drive
// the decision function directly, so every rejection path is exercised without
// touching the repository's real files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluate, scanSource, isEnforced, readManifestIds, registeredIdsNear,
  ESCAPE_PATTERNS, MANIFEST_PATH, BASELINE_PATH,
} from './escape-guard.mjs';

const IDS = ['ESC-001', 'ESC-002', 'ESC-003'];
const enforcedFile = 'server/src/routes/acquisition.ts';
const otherFile = 'server/src/routes/media.ts';

const run = (files, sources, baseline = {}) =>
  evaluate({ files, read: (f) => sources[f], baseline, manifestIds: IDS });

test('the enforced scope covers the four boundaries and the shared contract', () => {
  for (const file of [
    'server/src/routes/acquisition.ts', 'server/src/acquisition/commitDriver.ts',
    'server/src/routes/receiving.ts', 'server/src/routes/cost.ts',
    'server/src/cost/contract.ts', 'scripts/reconciliation/runner.mjs',
    'shared/databaseAliases.ts', 'server/src/rpcContract.ts', 'server/src/routes/params.ts',
  ]) assert.equal(isEnforced(file), true, file);

  for (const file of ['server/src/routes/media.ts', 'client/src/pages/Inventory.tsx']) {
    assert.equal(isEnforced(file), false, file);
  }
});

test('every required escape shape is detected', () => {
  const detected = (src) => Object.keys(scanSource(src));
  assert.deepEqual(detected("const x = y as never;"), ['as-never']);
  assert.deepEqual(detected("const x = y as any;"), ['as-any']);
  assert.deepEqual(detected("function f(a: any) {}"), ['as-any']);
  assert.deepEqual(detected("const x = y as unknown as Z;"), ['double-cast']);
  assert.deepEqual(detected("client.from(table).select('*')"), ['untyped-table']);
  assert.deepEqual(
    detected("client.rpc('f' as never, args as never)").sort(),
    ['as-never', 'bypassed-rpc'],
  );
  // The five shapes Work Order 4 requires the guard to catch.
  assert.deepEqual(
    ESCAPE_PATTERNS.map((p) => p.id).sort(),
    ['as-any', 'as-never', 'bypassed-rpc', 'double-cast', 'untyped-table'],
  );
});

test('a string-literal table name is NOT flagged', () => {
  // Work Order 4 is explicit: a literal passed through the typed client is
  // acceptable, because TypeScript rejects unknown names.
  assert.deepEqual(scanSource("client.from('acquisition_orders').select('*')"), {});
  assert.deepEqual(scanSource("client.rpc('record_acquisition_payment', args)"), {});
});

test('comments are not mistaken for code', () => {
  assert.deepEqual(scanSource('// this used to be `as never` before the repair'), {});
  assert.deepEqual(scanSource(' * removed the `as any` here'), {});
});

test('an unregistered escape in the enforced scope fails', () => {
  const { problems } = run([enforcedFile], { [enforcedFile]: 'const x = y as never;\n' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unregistered as-never in enforced scope/);
  assert.match(problems[0], /TYPE_ESCAPE_MANIFEST/);
});

test('an escape referencing a registered id passes', () => {
  const source = '// widened here, see ESC-001\nconst x = args as A;\n';
  const { problems } = run([enforcedFile], { [enforcedFile]: source });
  assert.deepEqual(problems, []);
});

test('an escape citing an id the manifest does not define fails', () => {
  const source = '// see ESC-999\nconst x = y as never;\n';
  const { problems } = run([enforcedFile], { [enforcedFile]: source });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unregistered/);
});

test('a reference too far above the cast does not license it', () => {
  const source = `// ESC-001\n${'const filler = 1;\n'.repeat(60)}const x = y as never;\n`;
  const { problems } = run([enforcedFile], { [enforcedFile]: source });
  assert.equal(problems.length, 1, 'a distant ESC mention must not license an unrelated cast');
});

test('a file outside the enforced scope may keep its baseline escapes', () => {
  const source = 'const a = x as never;\nconst b = y as any;\n';
  const { problems } = run([otherFile], { [otherFile]: source }, { [otherFile]: 2 });
  assert.deepEqual(problems, []);
});

test('a file outside the enforced scope may NOT gain an escape', () => {
  const source = 'const a = x as never;\nconst b = y as any;\nconst c = z as never;\n';
  const { problems } = run([otherFile], { [otherFile]: source }, { [otherFile]: 2 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /has 3 escapes, baseline allows 2/);
});

test('a file outside the enforced scope may lose escapes freely', () => {
  const { problems } = run([otherFile], { [otherFile]: 'const clean = 1;\n' }, { [otherFile]: 5 });
  assert.deepEqual(problems, []);
});

test('a brand-new file outside the scope starts at zero', () => {
  const fresh = 'server/src/routes/brandNew.ts';
  const { problems } = run([fresh], { [fresh]: 'const a = x as never;\n' }, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /baseline allows 0/);
});

test('the generated contract is exempt, because it is machine-written', () => {
  const generated = 'shared/database.types.ts';
  const { problems } = run([generated], { [generated]: 'const x: any = 1;\n' });
  assert.deepEqual(problems, []);
});

test('registeredIdsNear finds an id on the cast line itself', () => {
  const lines = ['const x = y as never; // ESC-002'];
  assert.deepEqual(registeredIdsNear(lines, 0), ['ESC-002']);
});

// --- the real repository ----------------------------------------------------

test('the shipped manifest defines exactly the ids the code references', () => {
  const ids = readManifestIds(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(ids, ['ESC-001', 'ESC-002', 'ESC-003']);
});

test('the shipped baseline holds no file from the enforced scope', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).files;
  const leaked = Object.keys(baseline).filter(isEnforced);
  assert.deepEqual(leaked, [], 'the enforced scope must never be frozen at a baseline');
});

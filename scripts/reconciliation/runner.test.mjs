import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, parseArtifact } from './artifact.mjs';
import { persistResult } from './ledger.mjs';
import { reconcileArtifacts } from './runner.mjs';

const config = {
  domain: 'synthetic_inventory', comparisonKey: 'id',
  comparedFields: [
    { name: 'amount', materiality: 'financial' },
    { name: 'title', materiality: 'cosmetic' },
    { name: 'status', materiality: 'material' },
  ],
  aggregateNumericFields: ['amount'], aggregateGroupFields: ['status'],
};
const bytes = (rows, spacing = 0) => Buffer.from(JSON.stringify({ artifactVersion: 1, rows }, null, spacing));
const artifact = (rows, side = 'fixture', spacing = 0) => parseArtifact(bytes(rows, spacing), side);
const run = (source, target, cfg = config) => reconcileArtifacts(artifact(source, 'source'), artifact(target, 'target'), cfg);

test('identical artifacts classify every key as matched_identical', () => {
  const result = run([{ id: 'b', amount: 0, title: 'B', status: 'held' }, { id: 'a', amount: 2, title: 'A', status: 'held' }], [{ id: 'a', amount: 2, title: 'A', status: 'held' }, { id: 'b', amount: 0, title: 'B', status: 'held' }]);
  assert.equal(result.verdictCounts.matched_identical, 2);
  assert.deepEqual(result.findings.map((finding) => finding.comparisonKeyValue), ['a', 'b']);
});

test('union includes target-only and source-only keys without fabricated differences', () => {
  const result = run([{ id: 'source', amount: 1, title: 'S', status: 'held' }], [{ id: 'target', amount: 1, title: 'T', status: 'held' }]);
  assert.deepEqual(result.findings.map(({ comparisonKeyValue, verdict, fieldDifferences }) => ({ comparisonKeyValue, verdict, fieldDifferences })), [
    { comparisonKeyValue: 'source', verdict: 'source_only', fieldDifferences: [] },
    { comparisonKeyValue: 'target', verdict: 'target_only', fieldDifferences: [] },
  ]);
});

test('financial, cosmetic, and material differences are classified independently', () => {
  const left = [{ id: 'x', amount: 10, title: 'Alpha', status: 'held' }];
  for (const [field, value, materiality] of [['amount', 11, 'financial'], ['title', 'Beta', 'cosmetic'], ['status', 'sold', 'material']]) {
    const result = run(left, [{ ...left[0], [field]: value }]);
    assert.equal(result.findings[0].materiality, materiality);
    assert.deepEqual(result.findings[0].fieldDifferences.map((difference) => difference.field), [field]);
  }
});

test('multiple differences remain ordered and highest materiality is retained', () => {
  const result = run([{ id: 'x', amount: 10, title: 'Alpha', status: 'held' }], [{ id: 'x', amount: 11, title: 'Beta', status: 'sold' }]);
  assert.deepEqual(result.findings[0].fieldDifferences.map((difference) => difference.field), ['amount', 'title', 'status']);
  assert.equal(result.findings[0].materiality, 'financial');
});

test('equal aggregate totals do not hide compensating row errors', () => {
  const result = run([{ id: 'a', amount: 10, title: 'A', status: 'held' }, { id: 'b', amount: 20, title: 'B', status: 'held' }], [{ id: 'a', amount: 15, title: 'A', status: 'held' }, { id: 'b', amount: 15, title: 'B', status: 'held' }]);
  assert.equal(result.l1.source.numericSums.amount, result.l1.target.numericSums.amount);
  assert.equal(result.l1.agreementIsReconciliationPass, false);
  assert.equal(result.verdictCounts.matched_with_differences, 2);
});

test('union coverage is exactly one finding per distinct union key', () => {
  const result = run([{ id: 'a', amount: 1, title: '', status: 'x' }, { id: 'b', amount: 1, title: '', status: 'x' }], [{ id: 'b', amount: 1, title: '', status: 'x' }, { id: 'c', amount: 1, title: '', status: 'x' }]);
  assert.equal(result.findings.length, 3);
  assert.equal(new Set(result.findings.map((finding) => finding.comparisonKeyValue)).size, 3);
});

test('duplicate and missing comparison keys fail closed', () => {
  assert.throws(() => run([{ id: 'a' }, { id: 'a' }], []), /duplicate comparison key/);
  assert.throws(() => run([{}], []), /missing comparison key/);
  assert.throws(() => run([{ id: null }], []), /missing comparison key/);
});

test('malformed artifact input fails closed', () => {
  assert.throws(() => parseArtifact(Buffer.from('{'), 'source'), /not valid JSON/);
  assert.throws(() => parseArtifact(Buffer.from('{"artifactVersion":1,"rows":{}}'), 'source'), /rows array/);
  assert.throws(() => parseArtifact(Buffer.from('{"artifactVersion":1,"rows":[null]}'), 'source'), /rows must be objects/);
});

test('ordering and semantic evidence are deterministic independent of row order', () => {
  const rows = [{ id: 'z', amount: 1, title: 'Z', status: 'x' }, { id: 'a', amount: 2, title: 'A', status: 'y' }];
  const first = run(rows, [...rows].reverse());
  const second = run([...rows].reverse(), rows);
  assert.deepEqual(first.findings, second.findings);
  assert.equal(canonicalJson({ ...first, sourceArtifact: null, targetArtifact: null }), canonicalJson({ ...second, sourceArtifact: null, targetArtifact: null }));
});

test('raw artifact SHA and output bytes are deterministic', () => {
  const raw = bytes([{ id: 'a', amount: 1, title: 'A', status: 'x' }], 2);
  const first = reconcileArtifacts(parseArtifact(raw, 'source'), parseArtifact(raw, 'target'), config);
  const second = reconcileArtifacts(parseArtifact(raw, 'source'), parseArtifact(raw, 'target'), config);
  assert.equal(first.sourceArtifact.sha256, second.sourceArtifact.sha256);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.ok(!canonicalJson(first).includes(process.cwd()));
});

test('numeric zero differs from null and missing', () => {
  for (const target of [{ amount: null }, {}]) {
    const result = run([{ id: 'a', amount: 0, title: '', status: 'x' }], [{ id: 'a', title: '', status: 'x', ...target }]);
    assert.equal(result.findings[0].fieldDifferences[0].source, 0);
    assert.equal(result.findings[0].fieldDifferences[0].target, null);
  }
});

test('strings are exact unless normalization is explicitly configured', () => {
  const left = [{ id: 'a', amount: 1, title: ' Alpha ', status: 'x' }];
  const right = [{ id: 'a', amount: 1, title: 'alpha', status: 'x' }];
  assert.equal(run(left, right).findings[0].verdict, 'matched_with_differences');
  const normalized = { ...config, comparedFields: config.comparedFields.map((field) => field.name === 'title' ? { ...field, normalize: 'trim_lowercase' } : field) };
  assert.equal(run(left, right, normalized).findings[0].verdict, 'matched_identical');
});

test('comparison has no database or network dependency', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network called'); };
  try { assert.equal(run([], []).findings.length, 0); } finally { globalThis.fetch = originalFetch; }
});

test('ledger adapter maps one governed finding call per union key', async () => {
  const result = run([{ id: 'a', amount: 1, title: 'A', status: 'x' }], [{ id: 'b', amount: 1, title: 'B', status: 'x' }]);
  const calls = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return name === 'begin_reconciliation_run' ? { runPublicId: 'RV-RECON-TEST' } : {}; };
  await persistResult(rpc, result, { workspaceId: 'workspace', sourceLabel: 'source fixture', targetScope: 'target fixture', idempotencyKey: 'test-1' });
  assert.deepEqual(calls.map((call) => call.name), ['begin_reconciliation_run', 'record_reconciliation_finding', 'record_reconciliation_finding', 'complete_reconciliation_run']);
  assert.ok(calls.every((call) => !call.name.includes('insert')));
});

test('ledger adapter fails a begun run through the governed failure function', async () => {
  const result = run([{ id: 'a', amount: 1, title: 'A', status: 'x' }], []);
  const calls = [];
  const rpc = async (name) => {
    calls.push(name);
    if (name === 'begin_reconciliation_run') return { runPublicId: 'RV-RECON-TEST' };
    if (name === 'record_reconciliation_finding') throw new Error('synthetic persistence failure');
    return {};
  };
  await assert.rejects(() => persistResult(rpc, result, { workspaceId: 'workspace', sourceLabel: 'source fixture', targetScope: 'target fixture', idempotencyKey: 'test-fail' }), /synthetic persistence failure/);
  assert.deepEqual(calls, ['begin_reconciliation_run', 'record_reconciliation_finding', 'fail_reconciliation_run']);
});

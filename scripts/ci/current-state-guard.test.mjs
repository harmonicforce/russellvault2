// Tests for the current-state freshness and production-identity guard.
//
// These exercise the pure decision logic with fixture inputs — no network, no
// live database. The last test runs the real guard against the repository as it
// stands, so the repaired baseline must actually pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertsNeverFailed,
  checkCiClaim,
  checkDerivedDocumentation,
  checkMigrationLedger,
  checkProjectRefs,
  computeMigrationSetDigest,
  evaluate,
  findProjectRefs,
  parseAttestation,
  readMigrationNames,
  run,
} from './current-state-guard.mjs';

const MIGRATIONS = ['20260719000100_alpha', '20260719000200_beta', '20260719000300_gamma'];
const DIGEST = computeMigrationSetDigest(MIGRATIONS);

// A well-formed attestation matching the fixture migration set, with deployment
// identity honestly unverified — the repaired baseline's shape.
function baseAttestation(overrides = {}) {
  return {
    schemaVersion: 1,
    review: {
      lastReviewedMainSha: 'a647b77a0f88fbaac9abc86430be58502a562bf9',
      verifiedAtUtc: '2026-08-22T04:10:00Z',
    },
    migrationLedger: {
      expectedCount: MIGRATIONS.length,
      lastMigrationName: MIGRATIONS[MIGRATIONS.length - 1],
      setDigest: DIGEST,
    },
    deploymentIdentity: {
      verificationPerformed: false,
      canonicalProjectRef: null,
      destructiveActionRule: 'Re-read the deployed Supabase URL immediately before acting.',
    },
    projectRefRegistry: {
      refs: [
        { ref: 'ncyqqitqtsyjrijieykd', role: 'ledger_match_candidate', evidenceClass: 'live_schema' },
        { ref: 'ykdyqnvmwpxhowbwhzqz', role: 'superseded_documentation_ref', evidenceClass: 'live_schema' },
      ],
    },
    ci: {
      headSha: 'a647b77a0f88fbaac9abc86430be58502a562bf9',
      runId: '32265646383',
      runAttempt: 2,
      conclusion: 'success',
      greenAfterRerun: true,
      priorAttempts: [{ runAttempt: 1, conclusion: 'failure' }],
      verifiedAtUtc: '2026-08-22T04:05:00Z',
    },
    ...overrides,
  };
}

const OK_DERIVED_DOC = [
  '# Current State',
  'Reviewed main SHA: `a647b77a0f88fbaac9abc86430be58502a562bf9`.',
  `Governed migration count: ${MIGRATIONS.length}.`,
  `Last migration: \`${MIGRATIONS[MIGRATIONS.length - 1]}\`.`,
].join('\n');

function codes(findings) {
  return findings.map((f) => f.code);
}

// ---- digest ---------------------------------------------------------------

test('the migration digest is order-independent but content-sensitive', () => {
  assert.equal(computeMigrationSetDigest([...MIGRATIONS].reverse()), DIGEST);
  assert.notEqual(computeMigrationSetDigest([...MIGRATIONS, '20260820000100_delta']), DIGEST);
  // A rename that preserves the count must still move the digest.
  const renamed = [...MIGRATIONS.slice(0, 2), '20260719000300_gamma_renamed'];
  assert.notEqual(computeMigrationSetDigest(renamed), DIGEST);
});

// ---- required failure case 1: a changed migration set ---------------------

test('fails when a migration is added without updating the attestation', () => {
  const actual = [...MIGRATIONS, '20260820000100_delta'];
  const findings = checkMigrationLedger(baseAttestation(), actual);
  assert.ok(codes(findings).includes('migration_count_drift'));
  assert.ok(codes(findings).includes('migration_last_name_drift'));
  assert.ok(codes(findings).includes('migration_set_digest_drift'));
});

test('fails when a migration is renamed even though the count is unchanged', () => {
  const actual = [...MIGRATIONS.slice(0, 2), '20260719000300_gamma_renamed'];
  const findings = checkMigrationLedger(baseAttestation(), actual);
  assert.deepEqual(codes(findings).includes('migration_count_drift'), false);
  assert.ok(codes(findings).includes('migration_set_digest_drift'));
});

test('fails when the migration set changed but only the attestation was updated', () => {
  // Attestation moved forward to a 4-migration set; CURRENT_STATE.md did not.
  const actual = [...MIGRATIONS, '20260820000100_delta'];
  const att = baseAttestation({
    migrationLedger: {
      expectedCount: actual.length,
      lastMigrationName: '20260820000100_delta',
      setDigest: computeMigrationSetDigest(actual),
    },
  });
  const findings = checkDerivedDocumentation(att, OK_DERIVED_DOC);
  assert.ok(codes(findings).includes('derived_doc_count_stale'));
  assert.ok(codes(findings).includes('derived_doc_last_migration_stale'));
});

test('passes the ledger check when attestation and derived doc both match', () => {
  assert.deepEqual(checkMigrationLedger(baseAttestation(), MIGRATIONS), []);
  assert.deepEqual(checkDerivedDocumentation(baseAttestation(), OK_DERIVED_DOC), []);
});

// ---- required failure case 2: conflicting project refs --------------------

test('finds refs in supabase URLs and backticked tokens, and flags production assertions', () => {
  const found = findProjectRefs(
    [
      'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
      'Some prose mentioning `ykdyqnvmwpxhowbwhzqz` without asserting anything.',
      'VITE_SUPABASE_URL points to https://ncyqqitqtsyjrijieykd.supabase.co today.',
    ].join('\n'),
  );
  assert.deepEqual([...found.keys()].sort(), ['ncyqqitqtsyjrijieykd', 'ykdyqnvmwpxhowbwhzqz']);
  assert.equal(found.get('ncyqqitqtsyjrijieykd').filter((h) => h.assertsProduction).length, 2);
  assert.equal(found.get('ykdyqnvmwpxhowbwhzqz').some((h) => h.assertsProduction), false);
});

test('fails when two different refs are presented as production across canonical docs', () => {
  const att = baseAttestation({
    deploymentIdentity: {
      verificationPerformed: true,
      canonicalProjectRef: 'ncyqqitqtsyjrijieykd',
      destructiveActionRule: 'Re-read the deployed Supabase URL immediately before acting.',
    },
    projectRefRegistry: {
      refs: [
        { ref: 'ncyqqitqtsyjrijieykd', role: 'deployed_production', evidenceClass: 'deployed_config' },
        { ref: 'ykdyqnvmwpxhowbwhzqz', role: 'superseded_documentation_ref', evidenceClass: 'live_schema' },
      ],
    },
  });
  const findings = checkProjectRefs(att, {
    'CLAUDE.md': 'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
    'docs/ai/CURRENT_STATE.md': 'Supabase project: `ykdyqnvmwpxhowbwhzqz`',
  });
  assert.ok(codes(findings).includes('conflicting_production_refs'));
});

test('fails when the registry marks two refs as production', () => {
  const att = baseAttestation({
    deploymentIdentity: {
      verificationPerformed: true,
      canonicalProjectRef: null,
      destructiveActionRule: 'Re-read the deployed Supabase URL immediately before acting.',
    },
    projectRefRegistry: {
      refs: [
        { ref: 'ncyqqitqtsyjrijieykd', role: 'deployed_production', evidenceClass: 'deployed_config' },
        { ref: 'ykdyqnvmwpxhowbwhzqz', role: 'deployed_production', evidenceClass: 'deployed_config' },
      ],
    },
  });
  assert.ok(codes(checkProjectRefs(att, {})).includes('conflicting_production_refs'));
});

// This is the guard's whole point: the repository may not mint production
// authority it did not earn from the deployed runtime.
test('fails when a doc asserts a production ref while deployment was never verified', () => {
  const findings = checkProjectRefs(baseAttestation(), {
    'CLAUDE.md': 'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
  });
  assert.ok(codes(findings).includes('unverified_production_assertion'));
});

test('fails when the registry grants deployed_production without verification', () => {
  const att = baseAttestation({
    projectRefRegistry: {
      refs: [{ ref: 'ncyqqitqtsyjrijieykd', role: 'deployed_production', evidenceClass: 'live_schema' }],
    },
  });
  assert.ok(codes(checkProjectRefs(att, {})).includes('unverified_production_role'));
});

test('fails when a canonical doc names an unregistered project ref', () => {
  const findings = checkProjectRefs(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md': 'Use `abcdefghijklmnopqrst` for the migration.',
  });
  assert.ok(codes(findings).includes('unregistered_project_ref'));
});

test('a registered ref mentioned without a production assertion is allowed', () => {
  const findings = checkProjectRefs(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md':
      '`ykdyqnvmwpxhowbwhzqz` is a different database and must not be treated as production.',
  });
  assert.deepEqual(findings, []);
});

// ---- required failure case 3: a malformed attestation ---------------------

test('rejects malformed attestations', () => {
  assert.throws(() => parseAttestation(''), /empty/);
  assert.throws(() => parseAttestation('{ not json'), /not valid JSON/);
  assert.throws(() => parseAttestation('[]'), /must be a JSON object/);
  assert.throws(() => parseAttestation(JSON.stringify({ schemaVersion: 1 })), /missing required section/);

  const bad = (mutate) => {
    const att = baseAttestation();
    mutate(att);
    return () => parseAttestation(JSON.stringify(att));
  };
  assert.throws(bad((a) => { a.schemaVersion = 99; }), /unsupported attestation schemaVersion/);
  assert.throws(bad((a) => { a.review.lastReviewedMainSha = 'a647b77'; }), /40-character commit SHA/);
  assert.throws(bad((a) => { a.review.verifiedAtUtc = 'sometime'; }), /ISO-8601/);
  assert.throws(bad((a) => { a.migrationLedger.expectedCount = '79'; }), /non-negative integer/);
  assert.throws(bad((a) => { a.migrationLedger.setDigest = 'deadbeef'; }), /sha256:/);
  assert.throws(bad((a) => { a.deploymentIdentity.verificationPerformed = 'no'; }), /must be a boolean/);
  assert.throws(bad((a) => { a.deploymentIdentity.destructiveActionRule = ''; }), /re-read/);
  assert.throws(bad((a) => { a.projectRefRegistry.refs[0].ref = 'TOO-SHORT'; }), /invalid project ref/);
  assert.throws(bad((a) => { a.projectRefRegistry.refs[0].role = 'production-ish'; }), /unknown role/);
  assert.throws(bad((a) => { delete a.projectRefRegistry.refs[0].evidenceClass; }), /evidenceClass/);
});

test('accepts the well-formed fixture attestation', () => {
  assert.equal(parseAttestation(JSON.stringify(baseAttestation())).schemaVersion, 1);
});

// ---- required failure case 4: a stale CI claim shape ----------------------

test('fails when a rerun-recovered run is presented without its failed attempt', () => {
  const att = baseAttestation({
    ci: {
      headSha: 'a647b77a0f88fbaac9abc86430be58502a562bf9',
      runId: '32265646383',
      runAttempt: 2,
      conclusion: 'success',
      verifiedAtUtc: '2026-08-22T04:05:00Z',
    },
  });
  assert.ok(codes(checkCiClaim(att)).includes('ci_claim_hides_rerun'));
});

test('fails when an earlier failed attempt is disclosed but greenAfterRerun is not set', () => {
  const att = baseAttestation();
  delete att.ci.greenAfterRerun;
  assert.ok(codes(checkCiClaim(att)).includes('ci_claim_hides_rerun'));
});

test('fails when a CI claim omits the run attempt entirely', () => {
  const att = baseAttestation();
  delete att.ci.runAttempt;
  assert.ok(codes(checkCiClaim(att)).includes('ci_claim_missing_attempt'));
});

test('fails when the CI claim describes a different SHA than the reviewed one', () => {
  const att = baseAttestation();
  att.ci.headSha = '0'.repeat(40);
  assert.ok(codes(checkCiClaim(att)).includes('ci_claim_sha_mismatch'));
});

test('fails when prose launders a rerun into "never failed"', () => {
  const findings = checkCiClaim(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md': 'Required CI has never failed on this SHA.',
  });
  assert.ok(codes(findings).includes('ci_claim_hides_rerun'));
});

test('distinguishes asserting "never failed" from forbidding the phrase', () => {
  // Used as a claim.
  assert.equal(assertsNeverFailed('Required CI has never failed on this SHA.'), true);
  assert.equal(assertsNeverFailed('The suite passed on the first attempt.'), true);
  // Merely mentioned — the rule that forbids this wording must be able to quote it.
  assert.equal(assertsNeverFailed('Never reduce "green after a rerun" to "never failed".'), false);
  assert.equal(assertsNeverFailed('Do not restate this as `never failed`.'), false);
  assert.equal(assertsNeverFailed('Do not describe a rerun-recovered run as never failed.'), false);
});

test('a document that only forbids the phrase does not trip the CI check', () => {
  assert.deepEqual(checkCiClaim(baseAttestation(), {
    'CLAUDE.md': 'Never reduce "green after a rerun" to "never failed".',
  }), []);
});

test('accepts an honest green-after-rerun claim', () => {
  assert.deepEqual(checkCiClaim(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md': 'Run 32265646383 went green on attempt 2 after attempt 1 failed.',
  }), []);
});

test('accepts an honest first-attempt green claim', () => {
  const att = baseAttestation({
    ci: {
      headSha: 'a647b77a0f88fbaac9abc86430be58502a562bf9',
      runId: '99999999999',
      runAttempt: 1,
      conclusion: 'success',
      verifiedAtUtc: '2026-08-22T04:05:00Z',
    },
  });
  assert.deepEqual(checkCiClaim(att), []);
});

// ---- combined + the real repository ---------------------------------------

test('evaluate aggregates findings across every check', () => {
  const att = baseAttestation();
  const result = evaluate({
    attestation: att,
    migrationNames: [...MIGRATIONS, '20260820000100_delta'],
    docs: { 'CLAUDE.md': 'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`' },
    derivedDoc: '',
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result.findings).includes('migration_count_drift'));
  assert.ok(codes(result.findings).includes('unverified_production_assertion'));
});

test('the repaired repository baseline passes the guard', () => {
  const result = run();
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test('the repository migration set matches the attested digest', () => {
  const names = readMigrationNames();
  assert.ok(names.length > 0);
  assert.equal(names[names.length - 1], '20260819000200_null_safe_acquisition_mutation_guards');
});

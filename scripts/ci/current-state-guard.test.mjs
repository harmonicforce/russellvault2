// Tests for the current-state freshness and production-identity guard.
//
// These exercise the pure decision logic with fixture inputs — no network, no
// live database. The last tests run the real guard against the repository as it
// stands, so the repaired baseline must actually pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_BEGIN,
  BASELINE_END,
  assertsNeverFailed,
  checkCiClaim,
  checkDeploymentIdentity,
  checkDerivedDocumentation,
  checkMigrationLedger,
  computeMigrationSetDigest,
  evaluate,
  findProjectRefs,
  parseAttestation,
  parseBaselineBlock,
  readMigrationNames,
  run,
} from './current-state-guard.mjs';

const MIGRATIONS = ['20260719000100_alpha', '20260719000200_beta', '20260719000300_gamma'];
const DIGEST = computeMigrationSetDigest(MIGRATIONS);
const SHA = 'a647b77a0f88fbaac9abc86430be58502a562bf9';
const PROD = 'ncyqqitqtsyjrijieykd';
const OTHER = 'ykdyqnvmwpxhowbwhzqz';

// A well-formed attestation in the UNVERIFIED state — the repaired baseline's shape.
function baseAttestation(overrides = {}) {
  return {
    schemaVersion: 1,
    review: { lastReviewedMainSha: SHA, verifiedAtUtc: '2026-08-22T04:10:00Z' },
    migrationLedger: {
      expectedCount: MIGRATIONS.length,
      lastMigrationName: MIGRATIONS[MIGRATIONS.length - 1],
      setDigest: DIGEST,
    },
    deploymentIdentity: {
      verificationPerformed: false,
      canonicalProjectRef: null,
      blocker: 'Egress policy answered 403 to CONNECT for the Railway host.',
      evidenceClass: 'not_inspectable',
      verifiedAtUtc: null,
      verificationMethod: null,
      authoritativeSource: 'VITE_SUPABASE_URL in the deployed Railway service',
      destructiveActionRule: 'Re-read the deployed Supabase URL immediately before acting.',
    },
    projectRefRegistry: {
      refs: [
        { ref: PROD, role: 'ledger_match_candidate', evidenceClass: 'live_schema' },
        { ref: OTHER, role: 'superseded_documentation_ref', evidenceClass: 'live_schema' },
      ],
    },
    ci: {
      headSha: SHA,
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

// A coherent VERIFIED state, used as the base for seeded invalid combinations.
function verifiedAttestation(mutate = () => {}) {
  const att = baseAttestation();
  att.deploymentIdentity = {
    verificationPerformed: true,
    canonicalProjectRef: PROD,
    verifiedAtUtc: '2026-08-22T05:00:00Z',
    verificationMethod: 'Read VITE_SUPABASE_URL from the deployed Railway service.',
    authoritativeSource: 'VITE_SUPABASE_URL in the deployed Railway service',
    evidenceClass: 'deployed_config',
    blocker: null,
    destructiveActionRule: 'Re-read the deployed Supabase URL immediately before acting.',
  };
  att.projectRefRegistry.refs = [
    { ref: PROD, role: 'deployed_production', evidenceClass: 'deployed_config' },
    { ref: OTHER, role: 'superseded_documentation_ref', evidenceClass: 'live_schema' },
  ];
  mutate(att);
  return att;
}

function baselineDoc({ sha = SHA, count = MIGRATIONS.length, last = MIGRATIONS[MIGRATIONS.length - 1] } = {}) {
  return [
    '# Current State',
    '',
    BASELINE_BEGIN,
    `- reviewed-main-sha: \`${sha}\``,
    `- governed-migration-count: \`${count}\``,
    `- last-migration-name: \`${last}\``,
    BASELINE_END,
    '',
  ].join('\n');
}

const codes = (findings) => findings.map((f) => f.code);

// ---- digest ---------------------------------------------------------------

test('the migration digest is order-independent but content-sensitive', () => {
  assert.equal(computeMigrationSetDigest([...MIGRATIONS].reverse()), DIGEST);
  assert.notEqual(computeMigrationSetDigest([...MIGRATIONS, '20260820000100_delta']), DIGEST);
  const renamed = [...MIGRATIONS.slice(0, 2), '20260719000300_gamma_renamed'];
  assert.notEqual(computeMigrationSetDigest(renamed), DIGEST);
});

// ---- failure case 1: a changed migration set ------------------------------

test('fails when a migration is added without updating the attestation', () => {
  const findings = checkMigrationLedger(baseAttestation(), [...MIGRATIONS, '20260820000100_delta']);
  assert.ok(codes(findings).includes('migration_count_drift'));
  assert.ok(codes(findings).includes('migration_last_name_drift'));
  assert.ok(codes(findings).includes('migration_set_digest_drift'));
});

test('fails when a migration is renamed even though the count is unchanged', () => {
  const actual = [...MIGRATIONS.slice(0, 2), '20260719000300_gamma_renamed'];
  const findings = checkMigrationLedger(baseAttestation(), actual);
  assert.equal(codes(findings).includes('migration_count_drift'), false);
  assert.ok(codes(findings).includes('migration_set_digest_drift'));
});

test('passes the ledger check when attestation and baseline block both match', () => {
  assert.deepEqual(checkMigrationLedger(baseAttestation(), MIGRATIONS), []);
  assert.deepEqual(checkDerivedDocumentation(baseAttestation(), baselineDoc()), []);
});

// ---- requirement 3: structurally exact derived-document markers -----------

test('parses each machine-owned baseline field exactly once', () => {
  const { fields, findings } = parseBaselineBlock(baselineDoc());
  assert.deepEqual(findings, []);
  assert.equal(fields.reviewedMainSha, SHA);
  assert.equal(fields.migrationCount, String(MIGRATIONS.length));
  assert.equal(fields.lastMigrationName, MIGRATIONS[MIGRATIONS.length - 1]);
});

test('fails when the baseline block is missing entirely', () => {
  const findings = checkDerivedDocumentation(baseAttestation(), '# Current State\n79 migrations.\n');
  assert.ok(codes(findings).includes('baseline_block_missing'));
});

test('fails when the baseline block is duplicated', () => {
  const findings = checkDerivedDocumentation(baseAttestation(), baselineDoc() + baselineDoc());
  assert.ok(codes(findings).includes('baseline_block_duplicate'));
});

test('fails when a baseline field is declared twice, even with one correct copy', () => {
  // This is the exact hole the old "does 79 appear anywhere" check allowed:
  // a stale contradictory count coexisting with the right one.
  const doc = baselineDoc() + '\nHistorical note: governed-migration-count: `47`\n';
  const findings = checkDerivedDocumentation(baseAttestation(), doc);
  assert.ok(codes(findings).includes('baseline_field_duplicate'));
});

test('fails when a baseline field is declared outside the block', () => {
  const doc = [
    '# Current State',
    `- governed-migration-count: \`${MIGRATIONS.length}\``,
    BASELINE_BEGIN,
    `- reviewed-main-sha: \`${SHA}\``,
    `- last-migration-name: \`${MIGRATIONS[MIGRATIONS.length - 1]}\``,
    BASELINE_END,
  ].join('\n');
  assert.ok(codes(checkDerivedDocumentation(baseAttestation(), doc)).includes('baseline_field_outside_block'));
});

test('fails when a baseline field is missing from the block', () => {
  const doc = [BASELINE_BEGIN, `- reviewed-main-sha: \`${SHA}\``, BASELINE_END].join('\n');
  const findings = checkDerivedDocumentation(baseAttestation(), doc);
  assert.ok(codes(findings).includes('baseline_field_missing'));
});

test('fails when a baseline field is empty or non-numeric where a number is required', () => {
  const empty = [BASELINE_BEGIN, '- reviewed-main-sha: ``', '- governed-migration-count: `3`',
    `- last-migration-name: \`${MIGRATIONS[2]}\``, BASELINE_END].join('\n');
  assert.ok(codes(checkDerivedDocumentation(baseAttestation(), empty)).includes('baseline_field_malformed'));

  const nan = baselineDoc({ count: 'seventy-nine' });
  assert.ok(codes(checkDerivedDocumentation(baseAttestation(), nan)).includes('baseline_field_malformed'));
});

test('fails when a baseline field contradicts the attestation', () => {
  for (const [doc, label] of [
    [baselineDoc({ count: 47 }), 'count'],
    [baselineDoc({ sha: '0'.repeat(40) }), 'sha'],
    [baselineDoc({ last: '20260101000100_wrong' }), 'last migration'],
  ]) {
    assert.ok(
      codes(checkDerivedDocumentation(baseAttestation(), doc)).includes('baseline_field_mismatch'),
      `expected mismatch for ${label}`,
    );
  }
});

test('unrelated prose changes do not invalidate the baseline block', () => {
  const doc = baselineDoc() + '\n## Notes\nWe shipped 12 things and reviewed 47 documents.\n';
  assert.deepEqual(checkDerivedDocumentation(baseAttestation(), doc), []);
});

// ---- requirement 2: bare-reference detection ------------------------------

test('detects a bare unquoted ref on an identity-assertion line', () => {
  const found = findProjectRefs('Supabase project: ncyqqitqtsyjrijieykd');
  assert.deepEqual([...found.keys()], [PROD]);
  assert.equal(found.get(PROD)[0].assertsProduction, true);
});

test('still detects refs in supabase hosts and backticks globally', () => {
  const found = findProjectRefs([
    'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
    'Plain mention of `ykdyqnvmwpxhowbwhzqz` with no assertion.',
    'See https://ncyqqitqtsyjrijieykd.supabase.co for the dashboard.',
  ].join('\n'));
  assert.deepEqual([...found.keys()].sort(), [PROD, OTHER].sort());
  assert.equal(found.get(OTHER).some((h) => h.assertsProduction), false);
});

test('ignores an unrelated 20-letter English token outside identity context', () => {
  const found = findProjectRefs('The counterrevolutionary faction disagreed at length.');
  assert.deepEqual([...found.keys()], []);
});

test('a bare production assertion fails in the UNVERIFIED state', () => {
  const findings = checkDeploymentIdentity(baseAttestation(), {
    'CLAUDE.md': 'Production Supabase project: ncyqqitqtsyjrijieykd',
  });
  assert.ok(codes(findings).includes('unverified_production_assertion'));
});

test('a bare assertion conflicting with the canonical ref fails in the VERIFIED state', () => {
  const findings = checkDeploymentIdentity(verifiedAttestation(), {
    'docs/ai/CURRENT_STATE.md': 'Supabase project: ykdyqnvmwpxhowbwhzqz',
  });
  assert.ok(codes(findings).includes('conflicting_production_refs'));
  assert.ok(codes(findings).includes('misclassified_production_assertion'));
});

// ---- requirement 1: the deployment-identity state machine -----------------

test('the exact reviewed bypass now fails: verified=true, canonicalRef=null, no production entry', () => {
  const att = baseAttestation();
  att.deploymentIdentity.verificationPerformed = true;
  const findings = checkDeploymentIdentity(att, {
    'CLAUDE.md': 'Production Supabase project: `ncyqqitqtsyjrijieykd`',
  });
  assert.notEqual(findings.length, 0);
  assert.ok(codes(findings).includes('verified_missing_canonical_ref'));
  assert.ok(codes(findings).includes('verified_missing_production_entry'));
  assert.ok(codes(findings).includes('verified_missing_timestamp'));
  assert.ok(codes(findings).includes('verified_missing_method'));
});

test('a coherent UNVERIFIED state passes', () => {
  assert.deepEqual(checkDeploymentIdentity(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md': '`ykdyqnvmwpxhowbwhzqz` is a different database, not production.',
  }), []);
});

test('a coherent VERIFIED state passes', () => {
  assert.deepEqual(checkDeploymentIdentity(verifiedAttestation(), {
    'CLAUDE.md': 'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
  }), []);
});

test('UNVERIFIED rejects a canonical ref, a production role, and a missing blocker', () => {
  const withRef = baseAttestation();
  withRef.deploymentIdentity.canonicalProjectRef = PROD;
  assert.ok(codes(checkDeploymentIdentity(withRef, {})).includes('unverified_canonical_ref'));

  const withRole = baseAttestation();
  withRole.projectRefRegistry.refs[0].role = 'deployed_production';
  assert.ok(codes(checkDeploymentIdentity(withRole, {})).includes('unverified_production_role'));

  for (const blocker of ['', '   ', undefined]) {
    const noBlocker = baseAttestation();
    noBlocker.deploymentIdentity.blocker = blocker;
    assert.ok(
      codes(checkDeploymentIdentity(noBlocker, {})).includes('unverified_missing_blocker'),
      `expected missing-blocker finding for ${JSON.stringify(blocker)}`,
    );
  }
});

test('VERIFIED rejects every incoherent combination', () => {
  const cases = [
    ['verified_missing_canonical_ref', (a) => { a.deploymentIdentity.canonicalProjectRef = null; }],
    ['verified_missing_canonical_ref', (a) => { a.deploymentIdentity.canonicalProjectRef = 'NOT-A-REF'; }],
    ['verified_missing_production_entry', (a) => { a.projectRefRegistry.refs[0].role = 'ledger_match_candidate'; }],
    ['conflicting_production_refs', (a) => { a.projectRefRegistry.refs[1].role = 'deployed_production'; }],
    ['verified_production_entry_mismatch', (a) => { a.deploymentIdentity.canonicalProjectRef = OTHER; }],
    ['verified_production_evidence_class', (a) => { a.projectRefRegistry.refs[0].evidenceClass = 'live_schema'; }],
    ['verified_missing_timestamp', (a) => { delete a.deploymentIdentity.verifiedAtUtc; }],
    ['verified_missing_timestamp', (a) => { a.deploymentIdentity.verifiedAtUtc = 'whenever'; }],
    ['verified_missing_method', (a) => { delete a.deploymentIdentity.verificationMethod; }],
    ['verified_missing_method', (a) => { a.deploymentIdentity.verificationMethod = '  '; }],
    ['verified_missing_source', (a) => { delete a.deploymentIdentity.authoritativeSource; }],
  ];
  for (const [expected, mutate] of cases) {
    const findings = checkDeploymentIdentity(verifiedAttestation(mutate), {});
    assert.ok(codes(findings).includes(expected), `expected ${expected}; got ${codes(findings).join(', ')}`);
  }
});

test('rejects a duplicate state label outright', () => {
  const att = baseAttestation();
  att.deploymentIdentity.currentState = 'UNVERIFIED';
  assert.throws(() => parseAttestation(JSON.stringify(att)), /currentState is not allowed/);
  // Even when it agrees, it is still a second editable source of truth.
  const agreeing = verifiedAttestation((a) => { a.deploymentIdentity.currentState = 'VERIFIED'; });
  assert.throws(() => parseAttestation(JSON.stringify(agreeing)), /currentState is not allowed/);
});

test('rejects an unknown deployment evidence class', () => {
  for (const bad of ['vibes', '', null, undefined, 'deployed-config']) {
    const att = baseAttestation();
    att.deploymentIdentity.evidenceClass = bad;
    assert.throws(
      () => parseAttestation(JSON.stringify(att)),
      /deploymentIdentity.evidenceClass is unknown/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test('UNVERIFIED rejects every VERIFIED-only field', () => {
  const cases = [
    ['unverified_canonical_ref', (a) => { a.deploymentIdentity.canonicalProjectRef = PROD; }],
    ['unverified_production_role', (a) => { a.projectRefRegistry.refs[0].role = 'deployed_production'; }],
    ['unverified_missing_blocker', (a) => { a.deploymentIdentity.blocker = ''; }],
    ['unverified_evidence_class', (a) => { a.deploymentIdentity.evidenceClass = 'deployed_config'; }],
    ['unverified_evidence_class', (a) => { a.deploymentIdentity.evidenceClass = 'live_schema'; }],
    ['unverified_stale_verification_field', (a) => { a.deploymentIdentity.verifiedAtUtc = '2026-08-22T05:00:00Z'; }],
    ['unverified_stale_verification_field', (a) => { a.deploymentIdentity.verificationMethod = 'read the env'; }],
  ];
  for (const [expected, mutate] of cases) {
    const att = baseAttestation();
    mutate(att);
    const findings = checkDeploymentIdentity(att, {});
    assert.ok(codes(findings).includes(expected), `expected ${expected}; got ${codes(findings).join(', ')}`);
  }
});

test('VERIFIED rejects a leftover blocker and a non-deployed evidence class', () => {
  const withBlocker = verifiedAttestation((a) => {
    a.deploymentIdentity.blocker = 'Railway was unreachable from the verifying environment.';
  });
  assert.ok(codes(checkDeploymentIdentity(withBlocker, {})).includes('verified_stale_blocker'));

  for (const cls of ['not_inspectable', 'live_schema', 'repository']) {
    const att = verifiedAttestation((a) => { a.deploymentIdentity.evidenceClass = cls; });
    assert.ok(
      codes(checkDeploymentIdentity(att, {})).includes('verified_evidence_class'),
      `expected verified_evidence_class for ${cls}`,
    );
  }
});

test('VERIFIED requires a strict ISO-8601 UTC verification timestamp', () => {
  for (const bad of ['2026-08-22', '2026-08-22 05:00:00', 'August 22 2026', '2026-08-22T05:00:00']) {
    const att = verifiedAttestation((a) => { a.deploymentIdentity.verifiedAtUtc = bad; });
    assert.ok(
      codes(checkDeploymentIdentity(att, {})).includes('verified_missing_timestamp'),
      `expected rejection of ${JSON.stringify(bad)}`,
    );
  }
  for (const good of ['2026-08-22T05:00:00Z', '2026-08-22T05:00:00.123Z', '2026-08-22T05:00:00+00:00']) {
    const att = verifiedAttestation((a) => { a.deploymentIdentity.verifiedAtUtc = good; });
    assert.equal(
      codes(checkDeploymentIdentity(att, {})).includes('verified_missing_timestamp'), false,
      `expected acceptance of ${good}`,
    );
  }
});

// The exact contradictory state from the third review: every VERIFIED field set,
// every UNVERIFIED-owned field left behind. It must not pass.
test('the incomplete owner transition fails: VERIFIED fields set, UNVERIFIED evidence left behind', () => {
  const att = baseAttestation();
  const d = att.deploymentIdentity;
  d.verificationPerformed = true;
  d.canonicalProjectRef = PROD;
  d.verifiedAtUtc = '2026-08-22T06:00:00Z';
  d.verificationMethod = 'Read VITE_SUPABASE_URL from the deployed Railway service.';
  const entry = att.projectRefRegistry.refs.find((r) => r.ref === PROD);
  entry.role = 'deployed_production';
  entry.evidenceClass = 'deployed_config';
  // Deliberately NOT moved: evidenceClass and blocker.
  const findings = checkDeploymentIdentity(att, {});
  assert.notEqual(findings.length, 0, 'the contradictory state must not pass');
  assert.ok(codes(findings).includes('verified_evidence_class'));
  assert.ok(codes(findings).includes('verified_stale_blocker'));
});

// ...and the same transition, done completely, is the only way through.
test('the complete UNVERIFIED to VERIFIED transition succeeds only when every field moves', () => {
  const steps = [
    (d, a) => { d.verificationPerformed = true; },
    (d, a) => { d.canonicalProjectRef = PROD; },
    (d, a) => {
      const e = a.projectRefRegistry.refs.find((r) => r.ref === PROD);
      e.role = 'deployed_production';
      e.evidenceClass = 'deployed_config';
    },
    (d, a) => { d.verifiedAtUtc = '2026-08-22T06:00:00Z'; },
    (d, a) => { d.verificationMethod = 'Read VITE_SUPABASE_URL from the deployed Railway service.'; },
    (d, a) => { d.evidenceClass = 'deployed_config'; },
    (d, a) => { d.blocker = null; },
  ];
  // Every strict prefix of the transition is incomplete and must fail.
  for (let n = 1; n < steps.length; n += 1) {
    const att = baseAttestation();
    for (let i = 0; i < n; i += 1) steps[i](att.deploymentIdentity, att);
    assert.notEqual(
      checkDeploymentIdentity(att, {}).length, 0,
      `transition stopped after step ${n} must fail`,
    );
  }
  // The whole tuple, moved together, passes — and only then.
  const complete = baseAttestation();
  for (const step of steps) step(complete.deploymentIdentity, complete);
  assert.deepEqual(checkDeploymentIdentity(complete, {}), []);
  // And the attestation still parses, proving no forbidden field was needed.
  assert.equal(parseAttestation(JSON.stringify(complete)).schemaVersion, 1);
  // Once verified, a document may name that exact ref.
  assert.deepEqual(checkDeploymentIdentity(complete, {
    'CLAUDE.md': 'Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`',
  }), []);
});

test('a live_schema ledger match can never stand in for deployment verification', () => {
  const att = verifiedAttestation((a) => {
    a.projectRefRegistry.refs[0].evidenceClass = 'live_schema';
  });
  assert.ok(codes(checkDeploymentIdentity(att, {})).includes('verified_production_evidence_class'));
});

test('fails when a canonical doc names an unregistered project ref', () => {
  const findings = checkDeploymentIdentity(baseAttestation(), {
    'docs/ai/CURRENT_STATE.md': 'Use `abcdefghijklmnopqrst` for the migration.',
  });
  assert.ok(codes(findings).includes('unregistered_project_ref'));
});

// ---- malformed attestation ------------------------------------------------

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
  assert.throws(bad((a) => { delete a.projectRefRegistry.refs[0].evidenceClass; }), /unknown evidenceClass/);
  assert.throws(bad((a) => { a.projectRefRegistry.refs[0].evidenceClass = 'vibes'; }), /unknown evidenceClass/);
  assert.throws(bad((a) => { a.projectRefRegistry.refs[1].ref = PROD; }), /duplicate entry/);
});

test('accepts the well-formed fixture attestations', () => {
  assert.equal(parseAttestation(JSON.stringify(baseAttestation())).schemaVersion, 1);
  assert.equal(parseAttestation(JSON.stringify(verifiedAttestation())).schemaVersion, 1);
});

// ---- stale CI claim shape -------------------------------------------------

test('fails when a rerun-recovered run is presented without its failed attempt', () => {
  const att = baseAttestation({
    ci: { headSha: SHA, runId: '32265646383', runAttempt: 2, conclusion: 'success',
      verifiedAtUtc: '2026-08-22T04:05:00Z' },
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
  assert.equal(assertsNeverFailed('Required CI has never failed on this SHA.'), true);
  assert.equal(assertsNeverFailed('The suite passed on the first attempt.'), true);
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
    ci: { headSha: SHA, runId: '99999999999', runAttempt: 1, conclusion: 'success',
      verifiedAtUtc: '2026-08-22T04:05:00Z' },
  });
  assert.deepEqual(checkCiClaim(att), []);
});

// ---- combined + the real repository ---------------------------------------

test('evaluate aggregates findings across every check', () => {
  const result = evaluate({
    attestation: baseAttestation(),
    migrationNames: [...MIGRATIONS, '20260820000100_delta'],
    docs: { 'CLAUDE.md': 'Production Supabase project: ncyqqitqtsyjrijieykd' },
    derivedDoc: '',
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result.findings).includes('migration_count_drift'));
  assert.ok(codes(result.findings).includes('baseline_block_missing'));
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

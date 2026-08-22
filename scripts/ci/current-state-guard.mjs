#!/usr/bin/env node
// Current-state freshness and production-identity guard.
//
// The failure this exists to prevent: a human or an agent reads a canonical
// repository document, believes it names the production Supabase project or the
// present program phase, and acts on a remembered or stale identity. Two real
// Russell Vault databases exist and both look plausible, so "the document said
// so" is not a safe basis for a destructive live action.
//
// The guard enforces four things against docs/ai/CURRENT_STATE.attestation.json:
//
//   1. FRESHNESS. If the governed migration set changes, the attestation AND its
//      derived documentation must be updated in the same change. Count, last
//      migration name, and a digest over the whole sorted set are all checked,
//      so a renamed or swapped migration that leaves the count intact is caught.
//
//   2. IDENTITY CONFLICT. Every Supabase project ref appearing in a canonical
//      document must be registered in the attestation, and two different refs
//      may never both be presented as production.
//
//   3. UNEARNED AUTHORITY. A ref may be called production ONLY when deployment
//      verification was actually performed. This is the point of the guard that
//      must not be misunderstood: it does NOT make a hard-coded ref safer by
//      repeating it. The deployed runtime remains the sole authority for
//      production identity; the guard's job is to stop the repository from
//      asserting an identity it has not verified.
//
//   4. CI CLAIM SHAPE. A CI claim must name the exact SHA, run id, and run
//      ATTEMPT, and must list earlier attempts when it is not the first. "Green
//      after a rerun" may never be reduced to "never failed".
//
// Deliberately NOT checked: that the attestation matches git HEAD. Pinning to
// HEAD would force an edit on every documentation-only commit. The attestation
// is a bounded projection: only a governed migration-set change invalidates it.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ATTESTATION_PATH = 'docs/ai/CURRENT_STATE.attestation.json';
export const MIGRATIONS_DIR = 'supabase/migrations';
export const DERIVED_DOC_PATH = 'docs/ai/CURRENT_STATE.md';

// Canonical documents that may name production identity or present state.
export const CANONICAL_DOCS = [
  'CLAUDE.md',
  'AGENTS.md',
  'docs/ai/CURRENT_STATE.md',
  'docs/ai/PROJECT_CONTEXT.md',
  'docs/ai/ENGINEERING_RULES.md',
  'docs/ai/PROJECT_ROADMAP.md',
  'docs/ai/HANDOFF_PROTOCOL.md',
  'docs/ai/WORK_ORDER_PROTOCOL.md',
  'docs/ai/SESSION_CHECKLIST.md',
  'docs/runbooks/hosted-migration-parity.md',
  'docs/runbooks/railway-backup-deploy-preflight.md',
  'supabase/config.toml',
  'railway.json',
  '.env.example',
];

// A Supabase project ref is exactly 20 lowercase letters.
const REF_BODY = '[a-z]{20}';
// Only recognise a ref in an unambiguous context: a supabase.co host, or a
// backtick-quoted bare token. A bare 20-letter word in prose is not treated as
// a ref, which keeps ordinary English out of the registry requirement.
const REF_PATTERNS = [
  new RegExp(`\\b(${REF_BODY})\\.supabase\\.co\\b`, 'g'),
  new RegExp('`(' + REF_BODY + ')`', 'g'),
];

// Phrases that present a ref as THE production/deployed database. A line
// carrying one of these plus a ref is an identity assertion.
// No trailing \b: some alternatives end in a colon, and a colon followed by a
// space is not a word boundary, so a trailing \b would silently never match them.
const PRODUCTION_ASSERTION_RE =
  /\b(canonical deployed|deployed supabase project|production supabase project|production project ref|supabase project:|vite_supabase_url|is the production|current production)/i;

// Phrasings that collapse "green after a rerun" into "never failed".
const NEVER_FAILED_RE =
  /\b(never failed|passed on the first attempt|green on the first attempt|first-attempt green|has always been green|no failed attempts)\b/i;

// Quoted spans are the phrase being MENTIONED, not claimed — the rule that
// forbids this wording has to be allowed to state the wording it forbids.
const QUOTED_SPAN_RE = /"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g;

// An unquoted mention inside a prohibition is also not a claim.
const PROHIBITION_RE =
  /\b(never|not|don'?t|avoid|rather than|instead of)\b[^.]*\b(reduce|restate|describe|call|claim|say|state|present|collapse|launder|report|write)\b/i;

// True when the line actually ASSERTS that CI never failed.
export function assertsNeverFailed(line) {
  const text = String(line ?? '');
  if (PROHIBITION_RE.test(text)) return false;
  return NEVER_FAILED_RE.test(text.replace(QUOTED_SPAN_RE, ' '));
}

export const VALID_REF_ROLES = new Set([
  'deployed_production',
  'ledger_match_candidate',
  'superseded_documentation_ref',
  'historical_reference',
  'local_shadow',
]);

// ---- pure helpers (unit-tested in current-state-guard.test.mjs) ------------

// sha256 over the sorted migration basenames (no .sql), one per line, each
// newline-terminated. Reproduces:
//   ls supabase/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' \
//     | sort | sha256sum
export function computeMigrationSetDigest(names) {
  if (!Array.isArray(names)) throw new TypeError('migration names must be an array');
  const body = [...names].sort().map((n) => `${n}\n`).join('');
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

export function parseAttestation(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('attestation is empty');
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`attestation is not valid JSON: ${err.message}`);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('attestation must be a JSON object');
  }
  const required = [
    'schemaVersion',
    'review',
    'migrationLedger',
    'deploymentIdentity',
    'projectRefRegistry',
    'ci',
  ];
  for (const key of required) {
    if (!(key in obj)) throw new Error(`attestation is missing required section: ${key}`);
  }
  if (obj.schemaVersion !== 1) {
    throw new Error(`unsupported attestation schemaVersion: ${JSON.stringify(obj.schemaVersion)}`);
  }
  if (typeof obj.review?.lastReviewedMainSha !== 'string' ||
      !/^[0-9a-f]{40}$/.test(obj.review.lastReviewedMainSha)) {
    throw new Error('review.lastReviewedMainSha must be a full 40-character commit SHA');
  }
  if (typeof obj.review?.verifiedAtUtc !== 'string' ||
      Number.isNaN(Date.parse(obj.review.verifiedAtUtc))) {
    throw new Error('review.verifiedAtUtc must be an ISO-8601 UTC timestamp');
  }
  const ledger = obj.migrationLedger;
  if (!Number.isInteger(ledger?.expectedCount) || ledger.expectedCount < 0) {
    throw new Error('migrationLedger.expectedCount must be a non-negative integer');
  }
  if (typeof ledger?.lastMigrationName !== 'string' || ledger.lastMigrationName === '') {
    throw new Error('migrationLedger.lastMigrationName must be a non-empty string');
  }
  if (typeof ledger?.setDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(ledger.setDigest)) {
    throw new Error('migrationLedger.setDigest must be "sha256:" followed by 64 hex characters');
  }
  const deployment = obj.deploymentIdentity;
  if (typeof deployment?.verificationPerformed !== 'boolean') {
    throw new Error('deploymentIdentity.verificationPerformed must be a boolean');
  }
  if (deployment.canonicalProjectRef !== null &&
      typeof deployment.canonicalProjectRef !== 'string') {
    throw new Error('deploymentIdentity.canonicalProjectRef must be a string or null');
  }
  if (typeof deployment?.destructiveActionRule !== 'string' ||
      deployment.destructiveActionRule.trim() === '') {
    throw new Error(
      'deploymentIdentity.destructiveActionRule must state that live work re-reads deployment identity immediately before acting',
    );
  }
  if (!Array.isArray(obj.projectRefRegistry?.refs)) {
    throw new Error('projectRefRegistry.refs must be an array');
  }
  for (const entry of obj.projectRefRegistry.refs) {
    if (typeof entry?.ref !== 'string' || !new RegExp(`^${REF_BODY}$`).test(entry.ref)) {
      throw new Error(`registry entry has an invalid project ref: ${JSON.stringify(entry?.ref)}`);
    }
    if (!VALID_REF_ROLES.has(entry?.role)) {
      throw new Error(`registry entry ${entry.ref} has an unknown role: ${JSON.stringify(entry?.role)}`);
    }
    if (typeof entry?.evidenceClass !== 'string' || entry.evidenceClass === '') {
      throw new Error(`registry entry ${entry.ref} is missing an evidenceClass`);
    }
  }
  return obj;
}

// Find every Supabase project ref in a document, with the lines carrying it.
export function findProjectRefs(text) {
  const found = new Map();
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, i) => {
    for (const pattern of REF_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        const ref = m[1];
        if (!found.has(ref)) found.set(ref, []);
        const hits = found.get(ref);
        // One entry per ref per line, even if the line mentions it twice.
        if (!hits.some((h) => h.line === i + 1)) {
          hits.push({ line: i + 1, text: line.trim(), assertsProduction: PRODUCTION_ASSERTION_RE.test(line) });
        }
      }
    }
  });
  return found;
}

export function checkMigrationLedger(attestation, migrationNames) {
  const findings = [];
  const ledger = attestation.migrationLedger;
  const sorted = [...migrationNames].sort();
  const actualCount = sorted.length;
  const actualLast = sorted[sorted.length - 1] ?? null;
  const actualDigest = computeMigrationSetDigest(sorted);

  if (actualCount !== ledger.expectedCount) {
    findings.push({
      code: 'migration_count_drift',
      message:
        `The repository has ${actualCount} governed migrations but ` +
        `${ATTESTATION_PATH} expects ${ledger.expectedCount}. A migration-bearing change must ` +
        `update migrationLedger (count, lastMigrationName, setDigest) and ${DERIVED_DOC_PATH}.`,
    });
  }
  if (actualLast !== ledger.lastMigrationName) {
    findings.push({
      code: 'migration_last_name_drift',
      message:
        `The last governed migration is ${JSON.stringify(actualLast)} but ` +
        `${ATTESTATION_PATH} names ${JSON.stringify(ledger.lastMigrationName)}.`,
    });
  }
  if (actualDigest !== ledger.setDigest) {
    findings.push({
      code: 'migration_set_digest_drift',
      message:
        `The governed migration set digest is ${actualDigest} but ${ATTESTATION_PATH} ` +
        `records ${ledger.setDigest}. The migration set changed (a file was added, removed, ` +
        `or renamed) without updating the attestation.`,
    });
  }
  return findings;
}

// The derived prose must agree with the machine-readable projection, so a
// migration-bearing change cannot update one and leave the other stale.
export function checkDerivedDocumentation(attestation, derivedText) {
  const findings = [];
  const text = String(derivedText ?? '');
  const { expectedCount, lastMigrationName } = attestation.migrationLedger;
  const sha = attestation.review.lastReviewedMainSha;

  if (!new RegExp(`\\b${expectedCount}\\b`).test(text)) {
    findings.push({
      code: 'derived_doc_count_stale',
      message:
        `${DERIVED_DOC_PATH} does not state the attested migration count ${expectedCount}. ` +
        `Update the derived documentation alongside the attestation.`,
    });
  }
  if (!text.includes(lastMigrationName)) {
    findings.push({
      code: 'derived_doc_last_migration_stale',
      message:
        `${DERIVED_DOC_PATH} does not name the attested last migration ${lastMigrationName}.`,
    });
  }
  if (!text.includes(sha) && !text.includes(sha.slice(0, 7))) {
    findings.push({
      code: 'derived_doc_sha_stale',
      message:
        `${DERIVED_DOC_PATH} does not state the attested reviewed SHA ${sha.slice(0, 7)}.`,
    });
  }
  return findings;
}

export function checkProjectRefs(attestation, docs) {
  const findings = [];
  const registry = new Map(attestation.projectRefRegistry.refs.map((e) => [e.ref, e]));
  const deployment = attestation.deploymentIdentity;

  const productionRoles = attestation.projectRefRegistry.refs.filter(
    (e) => e.role === 'deployed_production',
  );
  if (productionRoles.length > 1) {
    findings.push({
      code: 'conflicting_production_refs',
      message:
        `The registry assigns role deployed_production to more than one project ref: ` +
        `${productionRoles.map((e) => e.ref).join(', ')}. Exactly one project can be production.`,
    });
  }
  if (productionRoles.length > 0 && deployment.verificationPerformed !== true) {
    findings.push({
      code: 'unverified_production_role',
      message:
        `${productionRoles.map((e) => e.ref).join(', ')} carries role deployed_production, but ` +
        `deploymentIdentity.verificationPerformed is false. A project ref may only be called ` +
        `production when deployment verification was actually performed against the deployed runtime.`,
    });
  }
  if (deployment.canonicalProjectRef !== null) {
    if (deployment.verificationPerformed !== true) {
      findings.push({
        code: 'unverified_canonical_ref',
        message:
          `deploymentIdentity.canonicalProjectRef is set to ${deployment.canonicalProjectRef} while ` +
          `verificationPerformed is false. Leave it null until the deployed runtime is actually read.`,
      });
    }
    const entry = registry.get(deployment.canonicalProjectRef);
    if (!entry || entry.role !== 'deployed_production') {
      findings.push({
        code: 'canonical_ref_not_registered',
        message:
          `deploymentIdentity.canonicalProjectRef ${deployment.canonicalProjectRef} is not registered ` +
          `with role deployed_production in projectRefRegistry.`,
      });
    }
  }

  // Refs asserted as production inside the canonical documents themselves.
  const assertedInDocs = new Map();
  for (const [path, text] of Object.entries(docs)) {
    for (const [ref, hits] of findProjectRefs(text)) {
      if (!registry.has(ref)) {
        findings.push({
          code: 'unregistered_project_ref',
          message:
            `${path}:${hits[0].line} names Supabase project ref ${ref}, which is not registered in ` +
            `${ATTESTATION_PATH}. Register it with a role and evidence class, or remove it.`,
        });
      }
      for (const hit of hits.filter((h) => h.assertsProduction)) {
        if (!assertedInDocs.has(ref)) assertedInDocs.set(ref, []);
        assertedInDocs.get(ref).push(`${path}:${hit.line}`);
      }
    }
  }

  if (assertedInDocs.size > 1) {
    findings.push({
      code: 'conflicting_production_refs',
      message:
        `Canonical documents present more than one project ref as production: ` +
        [...assertedInDocs.entries()].map(([ref, at]) => `${ref} (${at.join(', ')})`).join('; ') +
        `. Production identity must be single-valued.`,
    });
  }
  for (const [ref, at] of assertedInDocs) {
    if (deployment.verificationPerformed !== true) {
      findings.push({
        code: 'unverified_production_assertion',
        message:
          `${at.join(', ')} presents ${ref} as the production/deployed Supabase project, but ` +
          `deployment verification was not performed. Documents must defer to the deployed runtime ` +
          `instead of asserting an unverified identity.`,
      });
    } else if (deployment.canonicalProjectRef !== null && ref !== deployment.canonicalProjectRef) {
      findings.push({
        code: 'conflicting_production_refs',
        message:
          `${at.join(', ')} presents ${ref} as production, but the attested canonical production ref ` +
          `is ${deployment.canonicalProjectRef}.`,
      });
    }
  }
  return findings;
}

export function checkCiClaim(attestation, docs = {}) {
  const findings = [];
  const ci = attestation.ci;

  if (typeof ci !== 'object' || ci === null) {
    return [{ code: 'ci_claim_malformed', message: 'attestation.ci must be an object' }];
  }
  for (const key of ['headSha', 'runId', 'conclusion', 'verifiedAtUtc']) {
    if (typeof ci[key] !== 'string' || ci[key] === '') {
      findings.push({
        code: 'ci_claim_malformed',
        message: `attestation.ci.${key} must be a non-empty string. A CI claim must name the exact SHA, run id, and run attempt.`,
      });
    }
  }
  if (!Number.isInteger(ci.runAttempt) || ci.runAttempt < 1) {
    findings.push({
      code: 'ci_claim_missing_attempt',
      message:
        'attestation.ci.runAttempt must be an integer >= 1. A run id alone is not a CI claim: the ' +
        'same run id can hold a failed attempt and a later successful one.',
    });
  }
  if (typeof ci.headSha === 'string' && ci.headSha !== attestation.review?.lastReviewedMainSha) {
    findings.push({
      code: 'ci_claim_sha_mismatch',
      message:
        `attestation.ci.headSha ${ci.headSha} does not match review.lastReviewedMainSha ` +
        `${attestation.review?.lastReviewedMainSha}. A CI claim about another commit is stale here.`,
    });
  }

  // The core anti-laundering rule: a later attempt must disclose the earlier ones.
  if (Number.isInteger(ci.runAttempt) && ci.runAttempt > 1) {
    const prior = ci.priorAttempts;
    if (!Array.isArray(prior) || prior.length === 0) {
      findings.push({
        code: 'ci_claim_hides_rerun',
        message:
          `attestation.ci reports run ${ci.runId} attempt ${ci.runAttempt} as "${ci.conclusion}" but ` +
          `lists no priorAttempts. Green after a rerun must never be reduced to "never failed": ` +
          `disclose each earlier attempt and its conclusion.`,
      });
    } else {
      for (let n = 1; n < ci.runAttempt; n += 1) {
        const entry = prior.find((p) => p?.runAttempt === n);
        if (!entry) {
          findings.push({
            code: 'ci_claim_hides_rerun',
            message: `attestation.ci.priorAttempts does not describe attempt ${n} of run ${ci.runId}.`,
          });
        } else if (typeof entry.conclusion !== 'string' || entry.conclusion === '') {
          findings.push({
            code: 'ci_claim_hides_rerun',
            message: `attestation.ci.priorAttempts entry for attempt ${n} has no conclusion.`,
          });
        }
      }
      const anyFailed = prior.some((p) => p?.conclusion && p.conclusion !== 'success');
      if (anyFailed && ci.conclusion === 'success' && ci.greenAfterRerun !== true) {
        findings.push({
          code: 'ci_claim_hides_rerun',
          message:
            `attestation.ci records an earlier failed attempt and a successful current attempt, so ` +
            `greenAfterRerun must be true. Do not present a rerun-recovered run as a clean pass.`,
        });
      }
    }
  }

  // The same laundering, in prose.
  if (ci.greenAfterRerun === true) {
    for (const [path, text] of Object.entries(docs)) {
      String(text ?? '').split('\n').forEach((line, i) => {
        if (assertsNeverFailed(line)) {
          findings.push({
            code: 'ci_claim_hides_rerun',
            message:
              `${path}:${i + 1} claims CI never failed while the attestation records ` +
              `greenAfterRerun for run ${ci.runId}. State that it went green on attempt ${ci.runAttempt}.`,
          });
        }
      });
    }
  }
  return findings;
}

export function evaluate({ attestation, migrationNames, docs = {}, derivedDoc = '' }) {
  const findings = [
    ...checkMigrationLedger(attestation, migrationNames),
    ...checkDerivedDocumentation(attestation, derivedDoc),
    ...checkProjectRefs(attestation, docs),
    ...checkCiClaim(attestation, docs),
  ];
  return { ok: findings.length === 0, findings };
}

// ---- I/O shell ------------------------------------------------------------

export function readMigrationNames(root = ROOT) {
  return readdirSync(join(root, MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .sort();
}

function readDocs(root, paths) {
  const docs = {};
  for (const rel of paths) {
    try {
      docs[rel] = readFileSync(join(root, rel), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // A canonical document that does not exist simply contributes nothing.
    }
  }
  return docs;
}

export function run(root = ROOT) {
  const attestation = parseAttestation(readFileSync(join(root, ATTESTATION_PATH), 'utf8'));
  const docs = readDocs(root, CANONICAL_DOCS);
  return evaluate({
    attestation,
    migrationNames: readMigrationNames(root),
    docs,
    derivedDoc: docs[DERIVED_DOC_PATH] ?? '',
  });
}

function main() {
  let result;
  try {
    result = run();
  } catch (err) {
    console.error(`current-state guard: FAIL\n  attestation could not be read: ${err.message}`);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(`current-state guard: FAIL (${result.findings.length})`);
    for (const f of result.findings) console.error(`  [${f.code}] ${f.message}`);
    process.exit(1);
  }
  console.log('current-state guard: OK');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

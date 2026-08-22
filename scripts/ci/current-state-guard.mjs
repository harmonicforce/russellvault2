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
//      The derived values are read from an explicit machine-owned marker block,
//      not by hunting for a number somewhere in the prose.
//
//   2. DEPLOYMENT-IDENTITY STATE MACHINE. Deployment identity is exactly one of
//      two coherent states, UNVERIFIED or VERIFIED, and every field, registry
//      role, and document assertion must agree with the declared state. A
//      half-populated state (claiming verification while naming nothing, or
//      naming a ref no registry entry backs) is itself a failure.
//
//   3. UNEARNED AUTHORITY. A ref may be called production ONLY in the VERIFIED
//      state, backed by a registry entry whose evidence class is deployed_config.
//      This is the point of the guard that must not be misunderstood: it does
//      NOT make a hard-coded ref safer by repeating it. The deployed runtime
//      remains the sole authority for production identity; the guard's job is to
//      stop the repository from asserting an identity it has not verified.
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
  'docs/ai/GENOME_PROGRAM_REGISTRY.md',
  'docs/runbooks/hosted-migration-parity.md',
  'docs/runbooks/railway-backup-deploy-preflight.md',
  'supabase/config.toml',
  'railway.json',
  '.env.example',
];

// A Supabase project ref is exactly 20 lowercase letters.
const REF_BODY = '[a-z]{20}';
const REF_EXACT_RE = new RegExp(`^${REF_BODY}$`);

// Contexts in which a token is unambiguously a project ref, recognised on every
// line of a document.
const REF_PATTERNS = [
  new RegExp(`\\b(${REF_BODY})\\.supabase\\.co\\b`, 'g'),
  new RegExp('`(' + REF_BODY + ')`', 'g'),
];
// A BARE, unquoted ref is only recognised on a line that also carries an
// identity assertion. That keeps an ordinary 20-letter English word in prose out
// of the registry requirement while closing the "Supabase project: <ref>" hole.
const BARE_REF_RE = new RegExp(`(?<![a-z\`./])(${REF_BODY})(?![a-z\`.])`, 'g');

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

export const VALID_REF_ROLES = new Set([
  'deployed_production',
  'ledger_match_candidate',
  'superseded_documentation_ref',
  'historical_reference',
  'local_shadow',
]);

export const VALID_EVIDENCE_CLASSES = new Set([
  'deployed_config',
  'live_schema',
  'repository',
  'github_api',
  'unmerged',
  'not_inspectable',
]);

// The machine-owned block inside the derived document. Only this block and the
// attestation are auto-authorized for migration-bearing work; everything else in
// CURRENT_STATE.md stays steward-controlled.
export const BASELINE_BEGIN = '<!-- machine-derived-baseline:begin -->';
export const BASELINE_END = '<!-- machine-derived-baseline:end -->';

// Exactly-labeled fields inside that block.
export const BASELINE_FIELDS = {
  reviewedMainSha: 'reviewed-main-sha',
  migrationCount: 'governed-migration-count',
  lastMigrationName: 'last-migration-name',
};

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
  const seen = new Set();
  for (const entry of obj.projectRefRegistry.refs) {
    if (typeof entry?.ref !== 'string' || !REF_EXACT_RE.test(entry.ref)) {
      throw new Error(`registry entry has an invalid project ref: ${JSON.stringify(entry?.ref)}`);
    }
    if (seen.has(entry.ref)) {
      throw new Error(`projectRefRegistry contains a duplicate entry for ${entry.ref}`);
    }
    seen.add(entry.ref);
    if (!VALID_REF_ROLES.has(entry?.role)) {
      throw new Error(`registry entry ${entry.ref} has an unknown role: ${JSON.stringify(entry?.role)}`);
    }
    if (!VALID_EVIDENCE_CLASSES.has(entry?.evidenceClass)) {
      throw new Error(
        `registry entry ${entry.ref} has an unknown evidenceClass: ${JSON.stringify(entry?.evidenceClass)}`,
      );
    }
  }
  return obj;
}

// Find every Supabase project ref in a document, with the lines carrying it.
export function findProjectRefs(text) {
  const found = new Map();
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, i) => {
    const assertsProduction = PRODUCTION_ASSERTION_RE.test(line);
    // Bare refs only count on an identity-assertion line.
    const patterns = assertsProduction ? [...REF_PATTERNS, BARE_REF_RE] : REF_PATTERNS;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        const ref = m[1];
        if (!found.has(ref)) found.set(ref, []);
        const hits = found.get(ref);
        // One entry per ref per line, even if the line mentions it twice.
        if (!hits.some((h) => h.line === i + 1)) {
          hits.push({ line: i + 1, text: line.trim(), assertsProduction });
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
        `update migrationLedger (count, lastMigrationName, setDigest) and the machine-derived ` +
        `baseline block in ${DERIVED_DOC_PATH}.`,
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

// Read the machine-owned baseline block out of the derived document.
// Returns { block, fields, findings }. Structural problems are findings, not
// throws, so one malformed block reports alongside everything else.
export function parseBaselineBlock(derivedText) {
  const findings = [];
  const text = String(derivedText ?? '');
  const begins = text.split(BASELINE_BEGIN).length - 1;
  const ends = text.split(BASELINE_END).length - 1;

  if (begins === 0 || ends === 0) {
    findings.push({
      code: 'baseline_block_missing',
      message:
        `${DERIVED_DOC_PATH} has no machine-derived baseline block. It must contain exactly one ` +
        `${BASELINE_BEGIN} … ${BASELINE_END} block declaring ` +
        `${Object.values(BASELINE_FIELDS).join(', ')}.`,
    });
    return { block: null, fields: {}, findings };
  }
  if (begins > 1 || ends > 1) {
    findings.push({
      code: 'baseline_block_duplicate',
      message:
        `${DERIVED_DOC_PATH} contains ${begins} baseline begin markers and ${ends} end markers. ` +
        `Exactly one block is allowed.`,
    });
    return { block: null, fields: {}, findings };
  }
  const start = text.indexOf(BASELINE_BEGIN);
  const stop = text.indexOf(BASELINE_END);
  if (stop < start) {
    findings.push({
      code: 'baseline_block_malformed',
      message: `${DERIVED_DOC_PATH} closes the baseline block before it opens it.`,
    });
    return { block: null, fields: {}, findings };
  }
  const block = text.slice(start + BASELINE_BEGIN.length, stop);

  const fields = {};
  for (const [key, label] of Object.entries(BASELINE_FIELDS)) {
    // Labelled occurrences anywhere in the document, so a stale duplicate copy
    // outside the block is caught rather than silently ignored.
    const anywhere = [...text.matchAll(new RegExp(`${label}\\s*:\\s*\`?([^\`\\s]*)\`?`, 'gi'))];
    const inBlock = [...block.matchAll(new RegExp(`${label}\\s*:\\s*\`?([^\`\\s]*)\`?`, 'gi'))];
    if (anywhere.length === 0) {
      findings.push({
        code: 'baseline_field_missing',
        message: `${DERIVED_DOC_PATH} does not declare \`${label}\` in its machine-derived baseline block.`,
      });
      continue;
    }
    if (anywhere.length > 1) {
      findings.push({
        code: 'baseline_field_duplicate',
        message:
          `${DERIVED_DOC_PATH} declares \`${label}\` ${anywhere.length} times ` +
          `(values: ${anywhere.map((m) => JSON.stringify(m[1])).join(', ')}). ` +
          `Exactly one declaration is allowed, so a stale copy cannot coexist with the correct one.`,
      });
      continue;
    }
    if (inBlock.length !== 1) {
      findings.push({
        code: 'baseline_field_outside_block',
        message:
          `${DERIVED_DOC_PATH} declares \`${label}\` outside the machine-derived baseline block. ` +
          `Machine-owned fields must live inside the marked block.`,
      });
      continue;
    }
    const value = inBlock[0][1];
    if (value === '') {
      findings.push({
        code: 'baseline_field_malformed',
        message: `${DERIVED_DOC_PATH} declares \`${label}\` with an empty value.`,
      });
      continue;
    }
    fields[key] = value;
  }
  return { block, fields, findings };
}

// The derived prose must agree with the machine-readable projection, so a
// migration-bearing change cannot update one and leave the other stale.
export function checkDerivedDocumentation(attestation, derivedText) {
  const { fields, findings } = parseBaselineBlock(derivedText);
  const expected = {
    reviewedMainSha: attestation.review.lastReviewedMainSha,
    migrationCount: String(attestation.migrationLedger.expectedCount),
    lastMigrationName: attestation.migrationLedger.lastMigrationName,
  };
  for (const [key, label] of Object.entries(BASELINE_FIELDS)) {
    if (!(key in fields)) continue; // already reported by parseBaselineBlock
    if (fields[key] !== expected[key]) {
      findings.push({
        code: 'baseline_field_mismatch',
        message:
          `${DERIVED_DOC_PATH} declares \`${label}: ${fields[key]}\` but ${ATTESTATION_PATH} ` +
          `says ${JSON.stringify(expected[key])}. Update the attestation and the baseline block together.`,
      });
    }
  }
  if (Number.isInteger(attestation.migrationLedger.expectedCount) &&
      'migrationCount' in fields && !/^\d+$/.test(fields.migrationCount)) {
    findings.push({
      code: 'baseline_field_malformed',
      message: `${DERIVED_DOC_PATH} declares a non-numeric governed-migration-count: ${JSON.stringify(fields.migrationCount)}.`,
    });
  }
  return findings;
}

// The deployment-identity state machine. Exactly two coherent states exist, and
// every field, registry role, and document assertion must agree with the one
// declared. A half-populated state is itself a failure.
export function checkDeploymentIdentity(attestation, docs = {}) {
  const findings = [];
  const deployment = attestation.deploymentIdentity;
  const refs = attestation.projectRefRegistry.refs;
  const registry = new Map(refs.map((e) => [e.ref, e]));
  const verified = deployment.verificationPerformed === true;
  const productionEntries = refs.filter((e) => e.role === 'deployed_production');

  // --- refs asserted as production inside canonical documents ---
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

  if (!verified) {
    // ---------------- UNVERIFIED state ----------------
    if (deployment.canonicalProjectRef !== null) {
      findings.push({
        code: 'unverified_canonical_ref',
        message:
          `deploymentIdentity.canonicalProjectRef is ${JSON.stringify(deployment.canonicalProjectRef)} ` +
          `while verificationPerformed is false. In the UNVERIFIED state it must be null.`,
      });
    }
    if (productionEntries.length > 0) {
      findings.push({
        code: 'unverified_production_role',
        message:
          `${productionEntries.map((e) => e.ref).join(', ')} carries role deployed_production while ` +
          `verificationPerformed is false. In the UNVERIFIED state no registry entry may hold that role.`,
      });
    }
    if (typeof deployment.blocker !== 'string' || deployment.blocker.trim() === '') {
      findings.push({
        code: 'unverified_missing_blocker',
        message:
          `deploymentIdentity.blocker must be a nonempty explanation of why deployment verification ` +
          `is unavailable whenever verificationPerformed is false.`,
      });
    }
    for (const [ref, at] of assertedInDocs) {
      findings.push({
        code: 'unverified_production_assertion',
        message:
          `${at.join(', ')} presents ${ref} as the production/deployed Supabase project, but ` +
          `deployment verification was not performed. Documents must defer to the deployed runtime ` +
          `instead of asserting an unverified identity.`,
      });
    }
    return findings;
  }

  // ---------------- VERIFIED state ----------------
  const canonical = deployment.canonicalProjectRef;
  if (typeof canonical !== 'string' || !REF_EXACT_RE.test(canonical)) {
    findings.push({
      code: 'verified_missing_canonical_ref',
      message:
        `verificationPerformed is true, so deploymentIdentity.canonicalProjectRef must be one valid ` +
        `20-character project ref. Found ${JSON.stringify(canonical)}.`,
    });
  }
  if (productionEntries.length === 0) {
    findings.push({
      code: 'verified_missing_production_entry',
      message:
        `verificationPerformed is true, so exactly one projectRefRegistry entry must carry role ` +
        `deployed_production. None does.`,
    });
  } else if (productionEntries.length > 1) {
    findings.push({
      code: 'conflicting_production_refs',
      message:
        `The registry assigns role deployed_production to more than one project ref: ` +
        `${productionEntries.map((e) => e.ref).join(', ')}. Exactly one project can be production.`,
    });
  } else {
    const entry = productionEntries[0];
    if (typeof canonical === 'string' && entry.ref !== canonical) {
      findings.push({
        code: 'verified_production_entry_mismatch',
        message:
          `The deployed_production registry entry is ${entry.ref} but ` +
          `deploymentIdentity.canonicalProjectRef is ${canonical}. They must be the same ref.`,
      });
    }
    if (entry.evidenceClass !== 'deployed_config') {
      findings.push({
        code: 'verified_production_evidence_class',
        message:
          `The deployed_production registry entry ${entry.ref} has evidenceClass ` +
          `${JSON.stringify(entry.evidenceClass)}. Production identity may only rest on ` +
          `deployed_config evidence — a live_schema ledger match is not deployment verification.`,
      });
    }
  }
  if (typeof deployment.verifiedAtUtc !== 'string' ||
      Number.isNaN(Date.parse(deployment.verifiedAtUtc))) {
    findings.push({
      code: 'verified_missing_timestamp',
      message:
        `verificationPerformed is true, so deploymentIdentity.verifiedAtUtc must be its own ` +
        `ISO-8601 UTC timestamp for when the deployed runtime was actually read.`,
    });
  }
  if (typeof deployment.verificationMethod !== 'string' ||
      deployment.verificationMethod.trim() === '') {
    findings.push({
      code: 'verified_missing_method',
      message:
        `verificationPerformed is true, so deploymentIdentity.verificationMethod must record how the ` +
        `deployed runtime was read (for example: read VITE_SUPABASE_URL from the Railway service).`,
    });
  }
  if (typeof deployment.authoritativeSource !== 'string' ||
      deployment.authoritativeSource.trim() === '') {
    findings.push({
      code: 'verified_missing_source',
      message:
        `verificationPerformed is true, so deploymentIdentity.authoritativeSource must name the ` +
        `deployed source the identity was read from.`,
    });
  }
  // A document may only assert the one canonical ref.
  for (const [ref, at] of assertedInDocs) {
    if (typeof canonical === 'string' && ref !== canonical) {
      findings.push({
        code: 'conflicting_production_refs',
        message:
          `${at.join(', ')} presents ${ref} as production, but the attested canonical production ref ` +
          `is ${canonical}.`,
      });
      const entry = registry.get(ref);
      if (entry && entry.role !== 'deployed_production') {
        findings.push({
          code: 'misclassified_production_assertion',
          message:
            `${at.join(', ')} presents ${ref} as production while its registry role is ` +
            `${JSON.stringify(entry.role)}. A differently classified ref must not be presented as production.`,
        });
      }
    }
  }
  return findings;
}

// Retained as the documented entry point for ref/identity checking.
export const checkProjectRefs = checkDeploymentIdentity;

// True when the line actually ASSERTS that CI never failed.
export function assertsNeverFailed(line) {
  const text = String(line ?? '');
  if (PROHIBITION_RE.test(text)) return false;
  return NEVER_FAILED_RE.test(text.replace(QUOTED_SPAN_RE, ' '));
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
    ...checkDeploymentIdentity(attestation, docs),
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

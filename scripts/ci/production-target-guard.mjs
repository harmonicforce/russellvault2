#!/usr/bin/env node
// Fail-closed production-target guard.
//
// THE INVARIANT
//
//   No deployment or hosted migration may proceed unless the Supabase project
//   resolved AT EXECUTION TIME, from the environment that will actually be
//   acted upon, matches the canonical production identity.
//
// WHY IT EXISTS
//
// This repository has already had a near-miss of exactly the kind this guard
// prevents. Canonical documents named a project as "the Supabase project" that
// was in fact a different, far-behind database — one that is ACTIVE_HEALTHY and
// displayed under a name that reads like the product. A destructive action
// aimed there on the strength of that line would have found a real, plausible
// Russell Vault database and damaged the wrong one.
//
// A second trap sits next to it: the project that DOES match this repository's
// schema is literally named "russellvault2-production". Selecting it because of
// that name would be the same mistake with a luckier outcome. A name is a label
// a human typed once. It is not authority, and this guard never reads one.
//
// WHAT THE GUARD WILL AND WILL NOT ACCEPT
//
// It compares only NON-SECRET routing identity: the project ref embedded in the
// Supabase URL the deployment is actually configured with. It never reads,
// requires, logs, or compares a key, token, password or connection string, and
// it redacts anything that looks like one before printing.
//
// It fails closed. Missing, malformed, ambiguous, conflicting, preview, legacy,
// known-decoy, unknown, and not-yet-verified canonical identity all REJECT. The
// only ACCEPT is an exact match against a canonical ref that an owner has
// verified from the deployed environment and recorded in the registry.
//
// While canonicalProductionRef is null — its state today — every production
// check rejects with canonical_identity_unverified. That is not a bug to route
// around; it is the guard doing its job until identity is proven.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_PATH = join(HERE, 'deployment-targets.json');

/** Bounded outcome codes. Every rejection is one of these, and nothing else. */
export const CODES = {
  ok: 'target_matches_canonical_production',
  okNonProduction: 'non_production_target_accepted',
  unverified: 'canonical_identity_unverified',
  missing: 'target_absent',
  malformed: 'target_malformed',
  ambiguous: 'target_ambiguous',
  decoy: 'target_is_known_decoy',
  preview: 'target_is_preview',
  legacy: 'target_is_legacy',
  unknown: 'target_unknown_to_registry',
  mismatch: 'target_is_not_canonical_production',
  registryInvalid: 'registry_invalid',
};

/**
 * Environment variables that can name the Supabase target, in the order the
 * runtime itself resolves them.
 *
 * All of them are read, not just the first: two variables that disagree is the
 * ambiguity this guard exists to catch, and a guard that stopped at the first
 * hit would silently pick a side.
 */
export const TARGET_VARS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_URL',
];

const REF_RE = /^[a-z]{20}$/;

/** Redact anything that could carry credential material before it is printed. */
export function redact(value) {
  if (typeof value !== 'string' || value === '') return '<empty>';
  const withoutUserinfo = value.replace(/\/\/[^/@\s]*@/, '//<redacted>@');
  const withoutQuery = withoutUserinfo.replace(/\?.*$/, '?<redacted>');
  // A bare long token (key, JWT, password) never belongs in output at all.
  if (!/^[a-z]+:\/\//i.test(withoutQuery) && withoutQuery.length > 24) return '<redacted>';
  return withoutQuery;
}

/**
 * Extract a project ref from whatever form the environment supplies.
 *
 * Accepts a bare ref, a Supabase API URL, or a Postgres connection URL, because
 * those are the three shapes a real deployment actually uses. Anything else is
 * malformed rather than guessed at — guessing is how the wrong database gets
 * picked.
 */
export function extractRef(raw) {
  if (typeof raw !== 'string') return { ok: false, code: CODES.malformed };
  const value = raw.trim();
  if (value === '') return { ok: false, code: CODES.missing };

  const bare = value.toLowerCase();
  if (REF_RE.test(bare)) return { ok: true, ref: bare };

  let host;
  try {
    const url = new URL(value);
    if (!/^(https?|postgres(ql)?):$/.test(url.protocol)) return { ok: false, code: CODES.malformed };
    host = url.hostname.toLowerCase();
  } catch {
    return { ok: false, code: CODES.malformed };
  }
  if (!host) return { ok: false, code: CODES.malformed };

  // <ref>.supabase.co, db.<ref>.supabase.co, <ref>.supabase.in, ...
  const parts = host.split('.');
  const candidate = parts.find((part) => REF_RE.test(part));
  if (!candidate) return { ok: false, code: CODES.malformed };
  return { ok: true, ref: candidate };
}

export function loadRegistry(path = REGISTRY_PATH, read = readFileSync) {
  let parsed;
  try {
    parsed = JSON.parse(read(path, 'utf8'));
  } catch {
    throw new Error(CODES.registryInvalid);
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(CODES.registryInvalid);
  const { canonicalProductionRef, knownRefs } = parsed;
  if (canonicalProductionRef !== null && !REF_RE.test(String(canonicalProductionRef ?? ''))) {
    throw new Error(CODES.registryInvalid);
  }
  if (!Array.isArray(knownRefs)) throw new Error(CODES.registryInvalid);
  for (const entry of knownRefs) {
    if (!REF_RE.test(String(entry?.ref ?? ''))) throw new Error(CODES.registryInvalid);
  }
  // A canonical ref that is not itself registered is a stale registry: the two
  // halves disagree, so neither can be trusted.
  if (canonicalProductionRef && !knownRefs.some((e) => e.ref === canonicalProductionRef)) {
    throw new Error(CODES.registryInvalid);
  }
  return parsed;
}

const CLASSIFICATION_CODE = {
  STALE_PREVIEW: CODES.preview,
  LEGACY_OR_DECOY: CODES.legacy,
  KNOWN_DECOY: CODES.decoy,
};

/**
 * Decide whether a resolved environment may be acted upon.
 *
 * `mode` is 'production' for anything that deploys or migrates hosted state,
 * and 'non-production' for a preview or shadow action. The two are separate
 * verbs on purpose: "verified" for a preview target must never read as
 * "verified" for production.
 */
export function decide({ env = {}, mode = 'production', registry }) {
  const reg = registry ?? loadRegistry();

  const present = TARGET_VARS
    .map((name) => ({ name, raw: env[name] }))
    .filter((v) => typeof v.raw === 'string' && v.raw.trim() !== '');

  if (present.length === 0) {
    return { ok: false, code: CODES.missing, detail: `none of ${TARGET_VARS.join(', ')} is set` };
  }

  const resolved = [];
  for (const { name, raw } of present) {
    const parsed = extractRef(raw);
    if (!parsed.ok) {
      return { ok: false, code: parsed.code, detail: `${name}=${redact(raw)}` };
    }
    resolved.push({ name, ref: parsed.ref });
  }

  const distinct = [...new Set(resolved.map((r) => r.ref))];
  if (distinct.length > 1) {
    // Two variables naming two projects. Which one "wins" depends on which code
    // path reads which variable, so there is no safe answer — only a stop.
    return {
      ok: false,
      code: CODES.ambiguous,
      detail: resolved.map((r) => `${r.name}->${r.ref}`).join(', '),
    };
  }

  const ref = distinct[0];
  const entry = reg.knownRefs.find((e) => e.ref === ref);

  if (mode !== 'production') {
    if (!entry) return { ok: false, code: CODES.unknown, ref, detail: 'not registered' };
    if (entry.ref === reg.canonicalProductionRef) {
      // A preview action pointed at production is the accident this guard is
      // most worth having.
      return { ok: false, code: CODES.mismatch, ref, detail: 'non-production mode may not target production' };
    }
    return { ok: true, code: CODES.okNonProduction, ref };
  }

  if (reg.canonicalProductionRef === null) {
    return {
      ok: false,
      code: CODES.unverified,
      ref,
      detail: reg.canonicalProductionUnverifiedReason ?? 'canonical production identity is not verified',
    };
  }
  if (!entry) return { ok: false, code: CODES.unknown, ref, detail: 'not registered' };
  if (entry.ref !== reg.canonicalProductionRef) {
    const code = CLASSIFICATION_CODE[entry.classification] ?? CODES.mismatch;
    return { ok: false, code, ref, detail: `classified ${entry.classification}` };
  }
  if (entry.deployable !== true) {
    return { ok: false, code: CODES.mismatch, ref, detail: 'canonical entry is not marked deployable' };
  }
  return { ok: true, code: CODES.ok, ref };
}

function main() {
  const mode = process.argv.includes('--non-production') ? 'non-production' : 'production';
  let decision;
  try {
    decision = decide({ env: process.env, mode });
  } catch (error) {
    console.error(`production-target-guard: REJECT (${error.message})`);
    process.exit(1);
  }
  if (decision.ok) {
    console.log(`production-target-guard: OK (${decision.code})${decision.ref ? ` target=${decision.ref}` : ''}`);
    return;
  }
  console.error(`production-target-guard: REJECT (${decision.code})`);
  if (decision.ref) console.error(`  resolved target: ${decision.ref}`);
  if (decision.detail) console.error(`  ${decision.detail}`);
  console.error('  See docs/runbooks/deployment-target-guard.md');
  process.exit(1);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

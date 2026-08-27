// Tests for the fail-closed production-target guard.
//
// The guard's whole value is what it REFUSES, so most of these are rejections.
// A guard that only proves it accepts the right answer has not been tested at
// all: the failure it exists to prevent is accepting a wrong one.
//
// Most cases build their own registry rather than reading the shipped one, so
// the rejection proofs keep working whatever the shipped registry says. The
// shipped registry is then pinned separately, at the bottom, against the state
// it is actually in — including that identity rests on an owner declaration and
// not on a reading of the deployed runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decide, extractRef, redact, loadRegistry, CODES, REGISTRY_PATH, TARGET_VARS,
} from './production-target-guard.mjs';

const CANON = 'aaaaaaaaaaaaaaaaaaaa';
const DECOY = 'bbbbbbbbbbbbbbbbbbbb';
const PREVIEW = 'cccccccccccccccccccc';
const LEGACY = 'dddddddddddddddddddd';
const STRANGER = 'eeeeeeeeeeeeeeeeeeee';

const verifiedRegistry = {
  canonicalProductionRef: CANON,
  knownRefs: [
    { ref: CANON, classification: 'CANONICAL_PRODUCTION', deployable: true },
    { ref: DECOY, classification: 'KNOWN_DECOY', deployable: false },
    { ref: PREVIEW, classification: 'STALE_PREVIEW', deployable: false },
    { ref: LEGACY, classification: 'LEGACY_OR_DECOY', deployable: false },
  ],
};

const url = (ref) => `https://${ref}.supabase.co`;

// --- the accept path -------------------------------------------------------

test('the canonical production target is accepted', () => {
  const d = decide({ env: { SUPABASE_URL: url(CANON) }, registry: verifiedRegistry });
  assert.equal(d.ok, true, d.code);
  assert.equal(d.code, CODES.ok);
  assert.equal(d.ref, CANON);
});

test('a canonical entry not marked deployable is still refused', () => {
  // Belt and braces: an owner can park the canonical ref without deleting it.
  const registry = {
    ...verifiedRegistry,
    knownRefs: verifiedRegistry.knownRefs.map((e) => (e.ref === CANON ? { ...e, deployable: false } : e)),
  };
  assert.equal(decide({ env: { SUPABASE_URL: url(CANON) }, registry }).code, CODES.mismatch);
});

// --- the rejections that matter --------------------------------------------

test('a known decoy is refused by classification, not by luck', () => {
  const d = decide({ env: { SUPABASE_URL: url(DECOY) }, registry: verifiedRegistry });
  assert.equal(d.ok, false);
  assert.equal(d.code, CODES.decoy);
});

test('a preview target is refused for production', () => {
  assert.equal(decide({ env: { SUPABASE_URL: url(PREVIEW) }, registry: verifiedRegistry }).code, CODES.preview);
});

test('a legacy target is refused for production', () => {
  assert.equal(decide({ env: { SUPABASE_URL: url(LEGACY) }, registry: verifiedRegistry }).code, CODES.legacy);
});

test('a project the registry has never heard of is refused', () => {
  const d = decide({ env: { SUPABASE_URL: url(STRANGER) }, registry: verifiedRegistry });
  assert.equal(d.ok, false);
  assert.equal(d.code, CODES.unknown);
});

test('a missing target is refused rather than defaulted', () => {
  assert.equal(decide({ env: {}, registry: verifiedRegistry }).code, CODES.missing);
  assert.equal(decide({ env: { SUPABASE_URL: '   ' }, registry: verifiedRegistry }).code, CODES.missing);
});

test('a malformed target is refused rather than guessed at', () => {
  for (const bad of ['not-a-url', 'https://', 'https://example.com', 'ftp://x.supabase.co', 'https://tooshort.supabase.co']) {
    const d = decide({ env: { SUPABASE_URL: bad }, registry: verifiedRegistry });
    assert.equal(d.ok, false, `accepted ${bad}`);
    assert.ok([CODES.malformed, CODES.missing].includes(d.code), `${bad} -> ${d.code}`);
  }
});

test('two variables naming two different projects are ambiguous, and neither wins', () => {
  const d = decide({
    env: { SUPABASE_URL: url(CANON), VITE_SUPABASE_URL: url(DECOY) },
    registry: verifiedRegistry,
  });
  assert.equal(d.ok, false);
  assert.equal(d.code, CODES.ambiguous);
  // The detail must name both, so an operator can see the conflict.
  assert.match(d.detail, new RegExp(CANON));
  assert.match(d.detail, new RegExp(DECOY));
});

test('aliases that agree are not ambiguous', () => {
  const d = decide({
    env: { SUPABASE_URL: url(CANON), VITE_SUPABASE_URL: `https://${CANON.toUpperCase()}.supabase.co` },
    registry: verifiedRegistry,
  });
  assert.equal(d.ok, true, d.code);
});

// --- normalization ---------------------------------------------------------

test('whitespace and case are normalized before comparison', () => {
  for (const raw of [`  ${url(CANON)}  `, CANON.toUpperCase(), `  ${CANON}  `, `HTTPS://${CANON}.SUPABASE.CO`]) {
    assert.equal(decide({ env: { SUPABASE_URL: raw }, registry: verifiedRegistry }).ok, true, `rejected ${raw}`);
  }
});

test('a ref is extracted from every shape a real deployment uses', () => {
  assert.equal(extractRef(CANON).ref, CANON);
  assert.equal(extractRef(`https://${CANON}.supabase.co`).ref, CANON);
  assert.equal(extractRef(`postgresql://postgres:pw@db.${CANON}.supabase.co:5432/postgres`).ref, CANON);
});

// --- secrets ---------------------------------------------------------------

test('redaction removes credential material from anything printed', () => {
  const withPassword = `postgresql://postgres:sup3rs3cret@db.${CANON}.supabase.co:5432/postgres`;
  assert.ok(!redact(withPassword).includes('sup3rs3cret'), redact(withPassword));
  assert.ok(!redact('https://x.supabase.co/?apikey=eyJhbGciOiJIUzI1NiJ9').includes('eyJhbGciOiJIUzI1NiJ9'));
  // A bare long token is never echoed at all.
  assert.equal(redact('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaa'), '<redacted>');
});

test('a rejection never echoes a password from the environment', () => {
  const d = decide({
    env: { SUPABASE_DB_URL: 'postgresql://postgres:sup3rs3cret@not-a-supabase-host/postgres' },
    registry: verifiedRegistry,
  });
  assert.equal(d.ok, false);
  assert.ok(!JSON.stringify(d).includes('sup3rs3cret'), JSON.stringify(d));
});

// --- registry integrity ----------------------------------------------------

test('a stale registry — canonical ref absent from knownRefs — is invalid, not trusted', () => {
  assert.throws(
    () => loadRegistry('x', () => JSON.stringify({ canonicalProductionRef: CANON, knownRefs: [] })),
    /registry_invalid/,
  );
});

test('a malformed or unparseable registry is invalid rather than empty', () => {
  assert.throws(() => loadRegistry('x', () => 'not json'), /registry_invalid/);
  assert.throws(() => loadRegistry('x', () => JSON.stringify({ knownRefs: [] })), /registry_invalid/);
  assert.throws(
    () => loadRegistry('x', () => JSON.stringify({ canonicalProductionRef: 'short', knownRefs: [] })),
    /registry_invalid/,
  );
});

// --- non-production mode ---------------------------------------------------

test('non-production mode accepts a preview target but never production', () => {
  const preview = decide({ env: { SUPABASE_URL: url(PREVIEW) }, mode: 'non-production', registry: verifiedRegistry });
  assert.equal(preview.ok, true, preview.code);
  assert.equal(preview.code, CODES.okNonProduction);
  // The important half: a preview action must not be able to hit production.
  const wrong = decide({ env: { SUPABASE_URL: url(CANON) }, mode: 'non-production', registry: verifiedRegistry });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, CODES.mismatch);
});

test('non-production acceptance uses a DIFFERENT code from production acceptance', () => {
  // So no log line, and no reader, can mistake one verdict for the other.
  assert.notEqual(CODES.okNonProduction, CODES.ok);
});

// --- the shipped registry, as it actually stands ----------------------------

const OWNER_DECLARED_CANON = 'ncyqqitqtsyjrijieykd';
const SHIPPED_PREVIEW = 'ykdyqnvmwpxhowbwhzqz';
const SHIPPED_LEGACY = 'ssqrgfbhqfufnjrsjpgj';

test('the shipped registry accepts the owner-declared canonical production project', () => {
  const shipped = loadRegistry();
  assert.equal(shipped.canonicalProductionRef, OWNER_DECLARED_CANON);
  const d = decide({ env: { SUPABASE_URL: url(OWNER_DECLARED_CANON) }, registry: shipped });
  assert.equal(d.ok, true);
  assert.equal(d.code, CODES.ok);
  assert.equal(d.ref, OWNER_DECLARED_CANON);
});

test('the shipped registry marks exactly one project deployable', () => {
  const shipped = loadRegistry();
  const deployable = shipped.knownRefs.filter((e) => e.deployable === true);
  assert.deepEqual(deployable.map((e) => e.ref), [OWNER_DECLARED_CANON],
    'exactly one project may be deployable, and it must be the canonical one');
});

test('the shipped registry still refuses the stale preview and the legacy project', () => {
  const shipped = loadRegistry();
  // These are the two real projects a name or a dashboard listing could talk
  // someone into. Neither may pass, canonical ref set or not.
  assert.equal(decide({ env: { SUPABASE_URL: url(SHIPPED_PREVIEW) }, registry: shipped }).code, CODES.preview);
  assert.equal(decide({ env: { SUPABASE_URL: url(SHIPPED_LEGACY) }, registry: shipped }).code, CODES.legacy);
});

test('the shipped registry records that identity rests on an owner declaration', () => {
  // The registry must not present the declaration as a runtime reading. If this
  // ever flips to deployed_config, an owner actually read Railway — and the
  // attestation has to say the same thing, which the current-state guard pins.
  const shipped = loadRegistry();
  assert.equal(shipped.identityBasis, 'owner_declaration');
  const entry = shipped.knownRefs.find((e) => e.ref === shipped.canonicalProductionRef);
  assert.equal(entry.classification, 'CANONICAL_PRODUCTION');
});

test('the shipped registry and the attestation name the same production project', () => {
  // A half-applied identity update — one file moved, the other not — is the
  // failure this pair of assertions exists to catch.
  const shipped = loadRegistry();
  const attestation = JSON.parse(readFileSync('docs/ai/CURRENT_STATE.attestation.json', 'utf8'));
  assert.equal(attestation.deploymentIdentity.canonicalProjectRef, shipped.canonicalProductionRef);
  assert.equal(attestation.deploymentIdentity.evidenceClass, shipped.identityBasis);
  const production = attestation.projectRefRegistry.refs.filter(
    (e) => e.role === 'deployed_production' || e.role === 'owner_declared_production',
  );
  assert.deepEqual(production.map((e) => e.ref), [shipped.canonicalProductionRef]);
});

test('the attestation keeps saying the deployed runtime was never read', () => {
  // The single most losable fact in this whole change. An owner declaration is
  // authority about which project is production; it is not an inspection of the
  // deployed service, and the moment the file stops saying so, a later reader
  // will assume it was one.
  const attestation = JSON.parse(readFileSync('docs/ai/CURRENT_STATE.attestation.json', 'utf8'));
  const note = attestation.deploymentIdentity.independentRuntimeInspection;
  assert.ok(typeof note === 'string' && note.trim() !== '',
    'independentRuntimeInspection must record whether the deployed runtime was inspected');
  assert.match(note, /NOT PERFORMED/);
  assert.ok(attestation.deploymentIdentity.preDeploymentRequirement.trim() !== '',
    'the pre-deployment re-resolution requirement must survive the identity being established');
});

test('the shipped registry classifies every ref this repository mentions', () => {
  const shipped = loadRegistry();
  const registered = new Set(shipped.knownRefs.map((e) => e.ref));
  // Refs asserted anywhere in the canonical attestation must be classified here
  // too, so a project cannot be discussed in one file and unknown to the guard.
  const attestation = JSON.parse(readFileSync('docs/ai/CURRENT_STATE.attestation.json', 'utf8'));
  for (const entry of attestation.projectRefRegistry.refs) {
    assert.ok(registered.has(entry.ref), `${entry.ref} is in the attestation but unknown to the target guard`);
  }
});

test('every target variable the runtime can read is checked', () => {
  // A variable the runtime honours but the guard ignores is a bypass.
  for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    assert.ok(TARGET_VARS.includes(name), `${name} is not checked by the guard`);
  }
});

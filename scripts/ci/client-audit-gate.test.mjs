// Tests for the conditional client production-audit gate policy.
//
// These exercise the pure decision logic with fixture inputs — no network, no
// real npm audit. They prove the gate allows EXACTLY GHSA-qwww-vcr4-c8h2 under
// the BrowserRouter/no-RSC guards and fails on everything else the policy names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ADVISORY,
  decide,
  evaluateGuards,
  extractGhsa,
  highAdvisories,
  parseAuditOutput,
} from './client-audit-gate.mjs';

// Guards that reflect this repository's real, RSC-free BrowserRouter client.
const OK_GUARDS = {
  browserRouterOk: true,
  noRsc: true,
  noRscPackages: true,
  rscHit: null,
  rscPackage: null,
};

// A minimal npm v2 audit JSON with one high advisory on react-router*.
function auditWith(id, { severity = 'high', pkg = 'react-router' } = {}) {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      [pkg]: {
        name: pkg,
        severity,
        via: [
          { source: 1, name: pkg, dependency: pkg, title: 't',
            url: `https://github.com/advisories/${id}`, severity, range: '>=7.12.0 <=8.2.0' },
        ],
      },
      'react-router-dom': { name: 'react-router-dom', severity, via: [pkg] },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  });
}

const NO_VULNS = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

test('extractGhsa pulls the canonical (lowercase-body) id from an advisory url', () => {
  assert.equal(extractGhsa('https://github.com/advisories/GHSA-qwww-vcr4-c8h2'), 'GHSA-qwww-vcr4-c8h2');
  assert.equal(extractGhsa('https://github.com/advisories/GHSA-QWWW-VCR4-C8H2'), 'GHSA-qwww-vcr4-c8h2');
  assert.equal(extractGhsa('no id here'), null);
});

test('1. the exact advisory is conditionally allowed (waived) under the guards', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith(ALLOWED_ADVISORY)));
  const d = decide(advisories, OK_GUARDS);
  assert.equal(d.pass, true);
  assert.equal(d.code, 'waived');
});

test('2. another high advisory fails the gate', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith('GHSA-aaaa-bbbb-cccc', { pkg: 'lodash' })));
  const d = decide(advisories, OK_GUARDS);
  assert.equal(d.pass, false);
  assert.equal(d.code, 'other_high_advisory');
});

test('2b. a CHANGED advisory identity on react-router fails (waiver does not cover it)', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith('GHSA-zzzz-yyyy-xxxx', { pkg: 'react-router' })));
  const d = decide(advisories, OK_GUARDS);
  assert.equal(d.pass, false);
  assert.equal(d.code, 'changed_advisory_identity');
});

test('2c. a critical advisory fails even if it is the allowed id at wrong severity handling', () => {
  // Two advisories: the allowed high one plus an unrelated critical one.
  const audit = JSON.parse(auditWith(ALLOWED_ADVISORY));
  audit.vulnerabilities['minimatch'] = {
    name: 'minimatch', severity: 'critical',
    via: [{ source: 9, name: 'minimatch', url: 'https://github.com/advisories/GHSA-1111-2222-3333', severity: 'critical' }],
  };
  const advisories = highAdvisories(parseAuditOutput(JSON.stringify(audit)));
  const d = decide(advisories, OK_GUARDS);
  assert.equal(d.pass, false);
  assert.equal(d.code, 'other_high_advisory');
});

test('3. malformed audit JSON fails (never treated as clean)', () => {
  assert.throws(() => parseAuditOutput('this is not json'), /not valid JSON/);
  assert.throws(() => parseAuditOutput(''), /empty audit output/);
  assert.throws(
    () => parseAuditOutput(JSON.stringify({ error: { code: 'EAUDITNOPJSON', summary: 'boom' } })),
    /npm audit reported an error/,
  );
});

test('3b. a high advisory without an identifiable GHSA fails (unidentified)', () => {
  const audit = { auditReportVersion: 2, vulnerabilities: {
    weird: { name: 'weird', severity: 'high', via: [{ source: 5, name: 'weird', url: 'not-a-ghsa', severity: 'high' }] },
  } };
  const d = decide(highAdvisories(parseAuditOutput(JSON.stringify(audit))), OK_GUARDS);
  assert.equal(d.pass, false);
  assert.equal(d.code, 'unidentified_advisory');
});

test('4. RSC usage fails the applicability guard even for the allowed advisory', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith(ALLOWED_ADVISORY)));
  const d = decide(advisories, { ...OK_GUARDS, noRsc: false, rscHit: 'client/src/rsc-entry.tsx' });
  assert.equal(d.pass, false);
  assert.equal(d.code, 'rsc_usage');
});

test('4b. an installed @react-router framework package fails the guard', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith(ALLOWED_ADVISORY)));
  const d = decide(advisories, { ...OK_GUARDS, noRscPackages: false, rscPackage: '@react-router/dev' });
  assert.equal(d.pass, false);
  assert.equal(d.code, 'rsc_package_installed');
});

test('4c. removing the BrowserRouter guard fails while the advisory is present', () => {
  const advisories = highAdvisories(parseAuditOutput(auditWith(ALLOWED_ADVISORY)));
  const d = decide(advisories, { ...OK_GUARDS, browserRouterOk: false });
  assert.equal(d.pass, false);
  assert.equal(d.code, 'no_browserrouter_guard');
});

test('5. a zero-advisory audit succeeds', () => {
  const d = decide(highAdvisories(parseAuditOutput(NO_VULNS)), OK_GUARDS);
  assert.equal(d.pass, true);
  assert.equal(d.code, 'no_advisories');
});

test('evaluateGuards recognizes a declarative BrowserRouter client with no RSC', () => {
  const g = evaluateGuards({
    mainSrc: "import { BrowserRouter } from 'react-router-dom';\nrender(<BrowserRouter><App/></BrowserRouter>)",
    srcFiles: [{ path: 'App.tsx', content: "import { Routes, Route } from 'react-router-dom'" }],
    pkgJson: { dependencies: { 'react-router-dom': '^7.18.1' } },
    lockContent: '',
  });
  assert.deepEqual(
    { br: g.browserRouterOk, rsc: g.noRsc, pkgs: g.noRscPackages },
    { br: true, rsc: true, pkgs: true },
  );
});

test('evaluateGuards flags an installed @react-router package and RSC usage', () => {
  const g = evaluateGuards({
    mainSrc: "import { BrowserRouter } from 'react-router-dom';\n<BrowserRouter/>",
    srcFiles: [{ path: 'x.tsx', content: 'import { matchRSCServerRequest } from "react-router/rsc"' }],
    pkgJson: { dependencies: { '@react-router/dev': '^7.0.0' } },
    lockContent: '',
  });
  assert.equal(g.noRsc, false);
  assert.equal(g.noRscPackages, false);
});

test('the allowed advisory id is exactly the react-router RSC CSRF advisory', () => {
  assert.equal(ALLOWED_ADVISORY, 'GHSA-qwww-vcr4-c8h2');
});

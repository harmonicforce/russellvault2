#!/usr/bin/env node
// Conditional client production-audit gate.
//
// Replaces a blanket `npm audit --prefix client --omit=dev --audit-level=high`
// with a policy that parses the audit JSON and allows EXACTLY ONE high advisory,
// GHSA-qwww-vcr4-c8h2 (React Router "RSC mode CSRF bypass"), and ONLY while the
// client is demonstrably a declarative BrowserRouter SPA with no React Router
// RSC surface. Everything else fails CI:
//   * any other high/critical advisory;
//   * a changed advisory identity (the react-router advisory reissued under a
//     different id, or an unidentifiable high advisory);
//   * unstable React Router RSC usage in client/src;
//   * removal of the BrowserRouter mount guard while the advisory is present;
//   * an installed @react-router/* framework/server/RSC package;
//   * failure to obtain or parse the audit result.
//
// The advisory is RSC-only (React Server Components). This repository uses React
// Router in declarative BrowserRouter mode and never touches RSC, so the
// advisory is not reachable here — but the waiver stays narrow and self-removing:
// it evaporates the moment the code grows an RSC surface or the advisory changes.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_ADVISORY = 'GHSA-qwww-vcr4-c8h2';
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
// RSC / framework surfaces that would make the advisory actually reachable.
const RSC_RE =
  /@react-router\/(dev|rsc|server|node|express|architect|cloudflare|serve|fs-routes)\b|react-router\/rsc|unstable_RSC|matchRSCServerRequest|RSCStaticRouter|createCallServer|routeRSCServerRequest|unstable_createServerRouter|unstable_getRSCStream/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT = join(ROOT, 'client');

// ---- pure helpers (unit-tested in client-audit-gate.test.mjs) --------------

export function extractGhsa(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(GHSA_RE);
  // Canonical GHSA form: "GHSA-" prefix + lowercase body (case-insensitive ids).
  return m ? `GHSA-${m[0].slice(5).toLowerCase()}` : null;
}

// Parse `npm audit --json` stdout. Throws on unparseable output or an audit
// error object (we must never treat an unreadable audit as "clean").
export function parseAuditOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new Error('empty audit output');
  }
  let obj;
  try {
    obj = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`audit output is not valid JSON: ${err.message}`);
  }
  if (obj && obj.error) {
    const e = obj.error;
    throw new Error(`npm audit reported an error: ${e.summary || e.code || 'unknown'}`);
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('audit JSON is not an object');
  }
  return obj;
}

// Distinct high/critical advisories from a parsed audit object. Supports npm v2
// (`vulnerabilities`) and the older v1 (`advisories`) shapes. Each entry is
// { id, severity, packages:Set, identified:boolean }.
export function highAdvisories(audit) {
  const byKey = new Map();
  const add = (id, severity, pkg) => {
    const key = id || `__unidentified__:${pkg}`;
    if (!byKey.has(key)) {
      byKey.set(key, { id, severity, packages: new Set(), identified: Boolean(id) });
    }
    byKey.get(key).packages.add(pkg);
  };

  // npm v2 shape: vulnerabilities is a map of package -> { via: [...] }
  if (audit.vulnerabilities && typeof audit.vulnerabilities === 'object') {
    for (const [pkg, entry] of Object.entries(audit.vulnerabilities)) {
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.via)) continue;
      for (const via of entry.via) {
        if (via && typeof via === 'object' && (via.severity === 'high' || via.severity === 'critical')) {
          add(extractGhsa(via.url || via.source || ''), via.severity, via.name || pkg);
        }
      }
    }
  }
  // npm v1 shape: advisories is a map of id -> advisory
  if (audit.advisories && typeof audit.advisories === 'object') {
    for (const a of Object.values(audit.advisories)) {
      if (a && (a.severity === 'high' || a.severity === 'critical')) {
        add(extractGhsa(a.url || a.github_advisory_id || '') || (a.github_advisory_id || null),
          a.severity, a.module_name || 'unknown');
      }
    }
  }
  return [...byKey.values()];
}

// The core policy decision. `guards` is the BrowserRouter/RSC evidence.
export function decide(advisories, guards) {
  if (!Array.isArray(advisories)) {
    return { pass: false, code: 'parse_failure', message: 'advisory list unavailable' };
  }
  if (advisories.length === 0) {
    return { pass: true, code: 'no_advisories', message: 'no high or critical production advisories' };
  }
  const unidentified = advisories.filter((a) => !a.identified);
  if (unidentified.length > 0) {
    return {
      pass: false,
      code: 'unidentified_advisory',
      message: `unidentifiable high advisory on ${[...unidentified[0].packages].join(', ')}`,
    };
  }
  const others = advisories.filter((a) => a.id !== ALLOWED_ADVISORY);
  if (others.length > 0) {
    const touchesReactRouter = others.some((a) =>
      [...a.packages].some((p) => p === 'react-router' || p === 'react-router-dom'));
    return {
      pass: false,
      code: touchesReactRouter ? 'changed_advisory_identity' : 'other_high_advisory',
      message: touchesReactRouter
        ? `a different high advisory now affects react-router (${others.map((a) => a.id).join(', ')}); the ${ALLOWED_ADVISORY} waiver does not cover it`
        : `disallowed high/critical advisory: ${others.map((a) => `${a.id} (${[...a.packages].join(', ')})`).join('; ')}`,
    };
  }
  // Only the allowed advisory remains. It is valid ONLY under the guards.
  if (!guards.noRscPackages) {
    return { pass: false, code: 'rsc_package_installed',
      message: `an @react-router RSC/framework/server package is installed (${guards.rscPackage}); the RSC advisory is now applicable` };
  }
  if (!guards.noRsc) {
    return { pass: false, code: 'rsc_usage',
      message: `unstable React Router RSC usage detected (${guards.rscHit}); the RSC advisory is now applicable` };
  }
  if (!guards.browserRouterOk) {
    return { pass: false, code: 'no_browserrouter_guard',
      message: 'the BrowserRouter mount guard (client/src/main.tsx) is missing; cannot prove RSC is unused' };
  }
  return { pass: true, code: 'waived',
    message: `${ALLOWED_ADVISORY} is waived: RSC-only advisory, client is declarative BrowserRouter with no RSC surface` };
}

// Pure guard evaluation over already-read file contents (unit-tested).
export function evaluateGuards({ mainSrc, srcFiles, pkgJson, lockContent }) {
  const importsBR =
    typeof mainSrc === 'string' &&
    /import\s*\{[^}]*\bBrowserRouter\b[^}]*\}\s*from\s*['"]react-router-dom['"]/.test(mainSrc);
  const mountsBR = typeof mainSrc === 'string' && /<BrowserRouter[\s/>]/.test(mainSrc);
  const browserRouterOk = Boolean(importsBR && mountsBR);

  let rscHit = null;
  for (const f of srcFiles || []) {
    if (RSC_RE.test(f.content)) { rscHit = f.path; break; }
  }
  const noRsc = rscHit === null;

  const deps = {
    ...(pkgJson?.dependencies || {}),
    ...(pkgJson?.devDependencies || {}),
    ...(pkgJson?.optionalDependencies || {}),
    ...(pkgJson?.peerDependencies || {}),
  };
  let rscPackage = Object.keys(deps).find((n) => n.startsWith('@react-router/')) || null;
  if (!rscPackage && typeof lockContent === 'string' && /"node_modules\/@react-router\//.test(lockContent)) {
    rscPackage = '(present in package-lock.json)';
  }
  const noRscPackages = !rscPackage;

  return { browserRouterOk, noRsc, noRscPackages, rscHit, rscPackage };
}

// ---- impure I/O (only exercised end-to-end in CI) --------------------------

function walkSource(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSource(p));
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(name)) out.push({ path: p, content: readFileSync(p, 'utf8') });
  }
  return out;
}

function readGuards(clientDir) {
  const mainPath = join(clientDir, 'src', 'main.tsx');
  const mainSrc = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : null;
  const srcFiles = walkSource(join(clientDir, 'src'));
  const pkgJson = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'));
  const lockPath = join(clientDir, 'package-lock.json');
  const lockContent = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
  return evaluateGuards({ mainSrc, srcFiles, pkgJson, lockContent });
}

function resolvedReactRouter(clientDir) {
  try {
    const lock = JSON.parse(readFileSync(join(clientDir, 'package-lock.json'), 'utf8'));
    return lock.packages?.['node_modules/react-router']?.version
      || lock.packages?.['node_modules/react-router-dom']?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function warn(clientDir) {
  const v = resolvedReactRouter(clientDir);
  const lines = [
    `Conditionally waiving ${ALLOWED_ADVISORY} (high) for the client production audit.`,
    `Affected package: react-router / react-router-dom, vulnerable range 7.12.0 - 8.2.0 (client resolves ${v}).`,
    'Applicability: this advisory is a React Router RSC (React Server Components) mode CSRF bypass — it applies ONLY in RSC mode.',
    'Evidence: client/src/main.tsx mounts the app through declarative BrowserRouter; no @react-router/* framework/server package is installed; no RSC API is imported or used in client/src.',
    'Removal condition: delete this waiver once React Router is upgraded to a patched version (> 8.2.0), which also removes the advisory from the audit.',
  ];
  // GitHub Actions annotation + plain log for local runs.
  process.stdout.write(`::warning title=Client audit waiver::${lines.join(' ')}\n`);
  for (const l of lines) process.stdout.write(`  ${l}\n`);
}

function fail(decision) {
  process.stdout.write(`::error title=Client audit gate failed::[${decision.code}] ${decision.message}\n`);
  process.stderr.write(`client-audit-gate — FAIL (${decision.code}): ${decision.message}\n`);
  process.exit(1);
}

function main() {
  const res = spawnSync('npm', ['audit', '--prefix', 'client', '--omit=dev', '--json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) fail({ code: 'parse_failure', message: `npm audit failed to run: ${res.error.message}` });

  let advisories;
  try {
    advisories = highAdvisories(parseAuditOutput(res.stdout));
  } catch (err) {
    fail({ code: 'parse_failure', message: err.message });
    return;
  }

  const guards = readGuards(CLIENT);
  const decision = decide(advisories, guards);

  if (!decision.pass) fail(decision);

  if (decision.code === 'waived') warn(CLIENT);
  process.stdout.write(`client-audit-gate — PASS (${decision.code}): ${decision.message}\n`);
  process.exit(0);
}

// Run only when invoked directly (not when imported by the test file).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

// Structural proof that every legacy router is behind the quarantine guard.
//
// This test reads server/src/index.ts as text on purpose. The property being
// asserted is about how the application is WIRED, and the only way to check
// wiring without starting a listening server is to inspect the wiring itself.
// index.ts calls app.listen() at import time, so importing it here would bind a
// port during the test run.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOVERNED_ROUTE_PREFIXES,
  LEGACY_ROUTER_MODULES,
  LEGACY_ROUTE_PREFIXES,
  PUBLIC_API_PATHS,
} from './routeInventory.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = readFileSync(join(SRC, 'index.ts'), 'utf8');

describe('legacy route inventory', () => {
  it('names one router module per legacy prefix', () => {
    expect(LEGACY_ROUTER_MODULES.length).toBe(LEGACY_ROUTE_PREFIXES.length);
  });

  it('points at router files that actually exist', () => {
    for (const moduleName of LEGACY_ROUTER_MODULES) {
      expect(existsSync(join(SRC, 'routes', `${moduleName}.ts`)), `${moduleName}.ts`).toBe(true);
    }
  });

  it('does not overlap the governed prefixes', () => {
    for (const prefix of LEGACY_ROUTE_PREFIXES) {
      expect(GOVERNED_ROUTE_PREFIXES as readonly string[]).not.toContain(prefix);
    }
    // '/api/cost' (governed) and '/api/cost-links' (legacy) are deliberately
    // distinct surfaces; assert the inventory keeps them apart.
    expect(LEGACY_ROUTE_PREFIXES as readonly string[]).toContain('/api/cost-links');
    expect(LEGACY_ROUTE_PREFIXES as readonly string[]).not.toContain('/api/cost');
    expect(GOVERNED_ROUTE_PREFIXES as readonly string[]).toContain('/api/cost');
  });
});

describe('index.ts wiring', () => {
  it('mounts every legacy prefix through the guarded loop, never directly', () => {
    for (const prefix of LEGACY_ROUTE_PREFIXES) {
      // A direct mount is the regression this guards against: it would put the
      // router in the app without the access guard in front of it.
      const directMount = new RegExp(`app\\.use\\(\\s*'${prefix.replace(/[/-]/g, '\\$&')}'`);
      expect(directMount.test(indexSource), `${prefix} is mounted directly in index.ts`).toBe(false);
      // It must instead appear as a key of the guarded router map.
      expect(indexSource).toContain(`'${prefix}': `);
    }
  });

  it('drives the mount loop from the inventory and applies the access guard', () => {
    expect(indexSource).toContain('for (const prefix of LEGACY_ROUTE_PREFIXES)');
    expect(indexSource).toMatch(
      /app\.use\(prefix,\s*legacyAccessGuard,\s*legacyWriteGuard,\s*legacyRouters\[prefix\]\)/,
    );
  });

  it('no longer mounts the write guard at the bare /api prefix', () => {
    // The old wiring was `app.use('/api', legacyWriteGuard)`, which also swept
    // in /api/health and /api/version.
    expect(indexSource).not.toMatch(/app\.use\(\s*'\/api'\s*,\s*legacyWriteGuard\s*\)/);
  });

  it('keeps the public paths public', () => {
    for (const path of PUBLIC_API_PATHS) {
      expect(indexSource).toContain(`app.get('${path}'`);
      // They must not be swept into the legacy set.
      expect(LEGACY_ROUTE_PREFIXES as readonly string[]).not.toContain(path);
    }
  });

  it('never applies the legacy access guard to a governed prefix', () => {
    for (const prefix of GOVERNED_ROUTE_PREFIXES) {
      const governedMount = new RegExp(
        `app\\.use\\('${prefix.replace(/[/-]/g, '\\$&')}',\\s*([A-Za-z]+)Router\\)`,
      );
      const match = governedMount.exec(indexSource);
      expect(match, `${prefix} should be mounted plainly`).not.toBeNull();
    }
    expect(indexSource).not.toMatch(/app\.use\('\/api\/(provenance|acquisition|intake|receiving|cost)',\s*legacyAccessGuard/);
  });

  it('does not gate governed routes on ALLOW_LEGACY_WRITES', () => {
    // Governed permissions must stay independent of the legacy flag: the flag
    // appears only in the legacy modules, never in the governed mount section.
    // Comments legitimately discuss the flag; what must not exist is executable
    // governed wiring that reads it.
    // Scoped to the governed MOUNT region: imports at the top of the file
    // legitimately name both symbols, and the health handler below the legacy
    // section legitimately reads legacyWritesEnabled.
    const governedCode = indexSource
      .slice(
        indexSource.indexOf('const app = express();'),
        indexSource.indexOf('LEGACY SQLite SURFACE'),
      )
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(governedCode).not.toContain('ALLOW_LEGACY_WRITES');
    expect(governedCode).not.toContain('legacyWriteGuard');
  });
});

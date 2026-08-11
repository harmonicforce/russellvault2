// @vitest-environment jsdom
//
// Route preservation.
//
// This slice moved every route declaration out of App.tsx. Moving a route is
// allowed; changing what a route MEANS is not. This suite pins the exact set of
// mounted paths so a refactor cannot quietly drop a deep link, rename a
// segment, or change which component answers a URL.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/app/routing/AppRoutes.tsx'), 'utf8');
const declared = [...source.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

/**
 * Mounted regardless of configuration. These are the legacy application and
 * the health surface, and they must stay reachable in a legacy-only
 * deployment where nothing governed is mounted at all.
 */
const ALWAYS_MOUNTED = [
  '/',
  '/inventory',
  '/purchases',
  '/cost-links',
  '/listings',
  '/sales',
  '/checks',
];

/**
 * Mounted only in a governed deployment. Not an authorization rule — these
 * pages have no backend to talk to when the governed surfaces are switched
 * off, which is why the navigation model does not advertise them either.
 */
const GOVERNED_ONLY = [
  '/quick-add',
  '/batch-intake',
  '/workbench',
  '/scan',
  '/inventory/lots/:lotId',
  '/inventory/current',
  '/inventory/move',
  '/corrections',
  '/inventory/current/:itemId',
  '/intake-sessions',
  '/locations',
  '/cycle-counts',
  '/photo-issues',
  '/listing-prep',
  '/listing-prep/:prepId',
  '/acquisitions',
  '/acquisitions/:sourceSystemPublicId/:linePublicId',
  '/acquisitions/:publicId',
  // S2.3 Batch 1. The receipt workspace is addressed by governed receipt public
  // id — never an internal uuid — and is reached from a queue row, exactly as
  // acquisition detail is reached from an acquisition line.
  '/receiving',
  '/receiving/:receiptPublicId',
  '/import-review',
  '/acquisition-review',
  '/inventory-identity',
];

describe('mounted routes', () => {
  it('mounts exactly the paths this application had before the shell was extracted', () => {
    expect([...declared].sort()).toEqual([...ALWAYS_MOUNTED, ...GOVERNED_ONLY].sort());
  });

  it('declares each path exactly once', () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('keeps the legacy application reachable without governed configuration', () => {
    for (const path of ALWAYS_MOUNTED) {
      const line = source.split('\n').find((l) => l.includes(`path="${path}"`))!;
      expect(line, `${path} should not be governed-gated`).not.toContain('provenanceEnabled &&');
    }
  });

  it('gates every governed route behind governed configuration', () => {
    for (const path of GOVERNED_ONLY) {
      const line = source.split('\n').find((l) => l.includes(`path="${path}"`))!;
      expect(line, `${path} should be governed-gated`).toContain('provenanceEnabled &&');
    }
  });
});

describe('acquisition addressing is unchanged', () => {
  // The source-qualified detail route and the bare-id guard are the S1.4
  // addressing contract. A shell refactor must not touch either.
  it('keeps the source-qualified detail route', () => {
    expect(declared).toContain('/acquisitions/:sourceSystemPublicId/:linePublicId');
  });

  it('keeps the unqualified-link guard rather than resolving a bare id', () => {
    expect(declared).toContain('/acquisitions/:publicId');
    expect(source).toContain('This link is not source-qualified.');
  });

  // Order matters: the two-segment route must be declared before the
  // one-segment route, or a source-qualified link would match the guard.
  it('declares the qualified route before the guard', () => {
    expect(declared.indexOf('/acquisitions/:sourceSystemPublicId/:linePublicId'))
      .toBeLessThan(declared.indexOf('/acquisitions/:publicId'));
  });
});

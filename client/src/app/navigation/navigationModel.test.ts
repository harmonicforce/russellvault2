// The navigation model's truth obligations.
//
// The central property: NAVIGATION MAY NOT ADVERTISE WHAT ROUTING DOES NOT
// MOUNT. A menu entry is a promise that a destination exists, and this suite
// checks the promise against the router itself rather than against a list
// written by hand alongside it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { domainsFor, isAuthoritative } from '../../lib/dataTopology';
import { allDestinations, buildNavigation, compositionOf } from './navigationModel';

/**
 * Every path AppRoutes mounts, read from the router source.
 *
 * This is source inspection used as a CROSS-CHECK between two artefacts, not
 * as behavioural acceptance — the behaviour of each destination is proven by
 * rendering in the shell suite. What it catches is the one failure a rendered
 * test cannot see: a menu entry whose route was never mounted, which in a real
 * browser is a silent blank page rather than an error.
 */
const routerSource = readFileSync(resolve(process.cwd(), 'src/app/routing/AppRoutes.tsx'), 'utf8');
const mountedPaths = [...routerSource.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

describe('navigation model — governed deployment', () => {
  const model = buildNavigation('governed');
  const destinations = allDestinations(model);

  it('advertises only destinations the router actually mounts', () => {
    for (const destination of destinations) {
      expect(mountedPaths, `${destination.label} points at an unmounted route`).toContain(destination.to);
    }
  });

  it('advertises no parameterised route, which is reached from a record', () => {
    for (const destination of destinations) {
      expect(destination.to).not.toContain(':');
    }
  });

  it('lists every destination exactly once, so no domain claims another domain’s work', () => {
    const paths = destinations.map((d) => d.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  // Intake touches acquisition and inventory both. Listing it under two
  // domains would teach the operator that the grouping carries no meaning.
  it('places Intake Sessions in exactly one primary domain', () => {
    const groups = model.primary.filter((g) => g.destinations.some((d) => d.to === '/intake-sessions'));
    expect(groups.map((g) => g.id)).toEqual(['inventory']);
  });

  it('exposes the approved governed domains and no manufactured ones', () => {
    expect(model.primary.map((g) => g.id)).toEqual(['home', 'inventory', 'acquire', 'sell']);
  });

  // No valuation, pricing, analytics, AI, or settings route exists today. A
  // group rendered for them would advertise capability the app does not have.
  it('creates no Intelligence or Settings group without a real destination', () => {
    const ids = model.primary.map((g) => g.id);
    expect(ids).not.toContain('intelligence');
    expect(ids).not.toContain('settings');
    expect(allDestinations(model).map((d) => d.to)).not.toContain('/settings');
  });

  it('renders no empty group', () => {
    for (const group of [...model.primary, ...model.secondary]) {
      expect(group.destinations.length, `${group.id} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('navigation model — source composition is verified, not assumed', () => {
  const model = buildNavigation('governed');
  const byPath = new Map(allDestinations(model).map((d) => [d.to, d]));
  const compositionFor = (path: string) => compositionOf(byPath.get(path)!);

  // THE DEFECT THIS SUITE REPLACED.
  //
  // The previous version required every primary destination to be
  // `authority === 'governed'`. It was green, and it was proving something
  // false: it forced Dashboard — which renders the legacy `/dashboard` panel
  // alongside the governed sections — to be labelled uniformly governed.
  //
  // Primary membership is an OPERATIONAL grouping. It is not a proof of data
  // authority, and no assertion here treats it as one.

  it('records Dashboard as mixed, because it renders governed and legacy sections', () => {
    expect(compositionFor('/')).toBe('mixed');
  });

  it('records Health Checks as legacy-only, because /api/checks is SQLite-backed', () => {
    expect(compositionFor('/checks')).toBe('legacy-only');
  });

  it.each(['/inventory', '/purchases', '/cost-links', '/listings', '/sales'])(
    'records %s as legacy-only',
    (path) => {
      expect(compositionFor(path)).toBe('legacy-only');
    },
  );

  it.each([
    '/workbench', '/inventory/current', '/scan', '/intake-sessions', '/locations',
    '/cycle-counts', '/corrections', '/photo-issues', '/acquisitions', '/quick-add',
    '/listing-prep', '/import-review', '/acquisition-review', '/inventory-identity',
  ])('records %s as governed-only', (path) => {
    expect(compositionFor(path)).toBe('governed-only');
  });

  // Grouping is a navigational role, never a source claim. The Tools group is
  // the proof: it legitimately holds three governed diagnostics and one
  // legacy-backed one, and encoding "tool" as an authority is precisely what
  // let /checks go unmarked.
  it('lets one group hold both governed and legacy-backed diagnostics', () => {
    const tools = model.secondary.find((g) => g.id === 'tools')!;
    const compositions = tools.destinations.map(compositionOf);
    expect(compositions).toContain('governed-only');
    expect(compositions).toContain('legacy-only');
  });

  it('exposes no authority field, so a menu role can never be read as a truth claim', () => {
    for (const destination of allDestinations(model)) {
      expect(destination).not.toHaveProperty('authority');
      expect(destination.reads.length).toBeGreaterThan(0);
    }
  });

  // Navigation keeps no authority table of its own; it asks dataTopology.
  // These two models answer different questions and neither proves the other.
  it('derives authority from dataTopology rather than restating it', () => {
    expect(domainsFor('legacy-sqlite-rest').every((d) => !isAuthoritative(d))).toBe(true);
    expect(domainsFor('governed-supabase').every((d) => isAuthoritative(d))).toBe(true);
  });

  it('names exactly two backends, so "mixed" is a composition and not a third system', () => {
    const backends = new Set(allDestinations(model).flatMap((d) => d.reads));
    expect([...backends].sort()).toEqual(['governed-supabase', 'legacy-sqlite-rest']);
  });
});

describe('navigation model — governed and legacy stay separated', () => {
  const model = buildNavigation('governed');

  // Legacy-only surfaces are what must stay out of the governed domains.
  // Dashboard is mixed and legitimately belongs in Home: it is the operator's
  // daily starting point and its legacy region is labelled in the page.
  it('keeps every legacy-only destination out of the governed domains', () => {
    for (const group of model.primary) {
      for (const destination of group.destinations) {
        expect(
          compositionOf(destination),
          `${destination.label} is legacy-only but sits inside ${group.id}`,
        ).not.toBe('legacy-only');
      }
    }
  });

  // The specific defect corrected in S1.6.2: legacy /inventory sat in the
  // primary governed list, directly above the governed inventory destinations.
  it('files legacy /inventory under the legacy group, not under Inventory', () => {
    const inventoryDomain = model.primary.find((g) => g.id === 'inventory')!;
    expect(inventoryDomain.destinations.map((d) => d.to)).not.toContain('/inventory');

    const legacy = model.secondary.find((g) => g.id === 'legacy')!;
    const entry = legacy.destinations.find((d) => d.to === '/inventory')!;
    expect(compositionOf(entry)).toBe('legacy-only');
    // Exact match, or every governed /inventory/* route lights it up.
    expect(entry.end).toBe(true);
  });

  it('carries the legacy application and the tools group in the secondary area only', () => {
    expect(model.secondary.map((g) => g.id)).toEqual(['legacy', 'tools']);
    const legacy = model.secondary.find((g) => g.id === 'legacy')!;
    expect(legacy.destinations.every((d) => compositionOf(d) === 'legacy-only')).toBe(true);
  });
});

describe('navigation model — legacy-only deployment', () => {
  const model = buildNavigation('legacy-only');

  // The governed routes are not mounted in this mode, so advertising any of
  // them would point the operator at a page that cannot exist.
  it('advertises no governed destination', () => {
    const paths = allDestinations(model).map((d) => d.to);
    for (const governedOnly of [
      '/acquisitions', '/workbench', '/scan', '/inventory/current',
      '/intake-sessions', '/locations', '/cycle-counts', '/listing-prep',
      '/photo-issues', '/corrections', '/quick-add',
    ]) {
      expect(paths).not.toContain(governedOnly);
    }
  });

  it('preserves the original legacy destinations, in order', () => {
    expect(allDestinations(model).map((d) => d.to)).toEqual([
      '/', '/inventory', '/purchases', '/cost-links', '/listings', '/sales', '/checks',
    ]);
  });

  it('offers no Tools & legacy area, because the whole deployment is legacy', () => {
    expect(model.secondary).toEqual([]);
  });

  // Dashboard is mixed in governed mode but legacy-only here: without governed
  // configuration `WorkspaceSummarySection` never mounts, so the legacy
  // aggregate is the entire page. Calling it mixed would claim a governed
  // section this deployment cannot render.
  it('records Dashboard as legacy-only, because the governed sections cannot mount', () => {
    const dashboard = allDestinations(model).find((d) => d.to === '/')!;
    expect(compositionOf(dashboard)).toBe('legacy-only');
    expect(compositionOf(allDestinations(buildNavigation('governed')).find((d) => d.to === '/')!)).toBe('mixed');
  });

  it('reads nothing from the governed backend at all', () => {
    const backends = new Set(allDestinations(model).flatMap((d) => d.reads));
    expect([...backends]).toEqual(['legacy-sqlite-rest']);
  });
});

describe('navigation model — misconfigured deployment', () => {
  // AuthShell fails closed before the shell mounts, so this is belt-and-braces
  // rather than a screen anyone sees. A deployment whose configuration is not
  // trustworthy has no destination it can honestly offer.
  it('advertises nothing at all', () => {
    const model = buildNavigation('misconfigured');
    expect(allDestinations(model)).toEqual([]);
  });
});

// The navigation model's truth obligations.
//
// The central property: NAVIGATION MAY NOT ADVERTISE WHAT ROUTING DOES NOT
// MOUNT. A menu entry is a promise that a destination exists, and this suite
// checks the promise against the router itself rather than against a list
// written by hand alongside it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDestinations, buildNavigation } from './navigationModel';

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

describe('navigation model — governed and legacy stay separated', () => {
  const model = buildNavigation('governed');

  it('keeps every legacy destination out of the governed domains', () => {
    for (const group of model.primary) {
      for (const destination of group.destinations) {
        expect(destination.authority, `${destination.label} sits inside ${group.id}`).toBe('governed');
      }
    }
  });

  // The specific defect being corrected: legacy /inventory sat in the primary
  // governed list, directly above the governed inventory destinations.
  it('files legacy /inventory under the legacy group, not under Inventory', () => {
    const inventoryDomain = model.primary.find((g) => g.id === 'inventory')!;
    expect(inventoryDomain.destinations.map((d) => d.to)).not.toContain('/inventory');

    const legacy = model.secondary.find((g) => g.id === 'legacy')!;
    const entry = legacy.destinations.find((d) => d.to === '/inventory')!;
    expect(entry.authority).toBe('legacy');
    // Exact match, or every governed /inventory/* route lights it up.
    expect(entry.end).toBe(true);
  });

  it('carries tools and legacy in the secondary area only', () => {
    expect(model.secondary.map((g) => g.id)).toEqual(['legacy', 'tools']);
    const authorities = model.secondary.flatMap((g) => g.destinations.map((d) => d.authority));
    expect(authorities).not.toContain('governed');
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

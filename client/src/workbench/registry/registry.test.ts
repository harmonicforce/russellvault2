// Behavioral acceptance for the widget registry.
//
// The registry is the gate that keeps roadmap entries out of the operator's
// interface. These tests exist mostly to prove things are ABSENT.
import { describe, expect, it } from 'vitest';
import {
  WIDGET_SIZES,
  allowsMultiple,
  isAvailableIn,
  isOfferable,
  supportsSize,
  type WidgetAvailabilityContext,
  type WidgetDefinition,
} from './widgetDefinition';
import { allDefinitions, availableDefinitions, findDefinition } from './widgetRegistry';

const FULLY_SATISFIED: WidgetAvailabilityContext = {
  surface: 'daily-workbench',
  satisfiedRequirements: ['governed-backend', 'active-workspace', 'intake-transport'],
  role: 'owner',
};

describe('identity', () => {
  it('gives every definition a unique stable id', () => {
    const ids = allDefinitions().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds a definition by id and reports an unknown one as absent', () => {
    expect(findDefinition('inventory.needs-location')?.title).toBe('Needs location');
    expect(findDefinition('nope.not-a-widget')).toBeNull();
  });

  it('carries the full metadata contract on every definition', () => {
    for (const definition of allDefinitions()) {
      expect(definition.definitionVersion).toBeGreaterThan(0);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.lifecycle).toBeTruthy();
      expect(definition.surfaces.length).toBeGreaterThan(0);
      // Every widget must say what a genuine zero means, so `empty` can never
      // be confused with a failed read.
      expect(definition.data.genuineEmpty.length).toBeGreaterThan(0);
      expect(definition.data.coverage.length).toBeGreaterThan(0);
      expect(definition.data.source.length).toBeGreaterThan(0);
    }
  });
});

describe('the active catalogue never advertises what does not exist', () => {
  it('offers only available or experimental lifecycles', () => {
    for (const definition of availableDefinitions(FULLY_SATISFIED)) {
      expect(['available', 'experimental']).toContain(definition.lifecycle);
    }
  });

  it('excludes planned and retired definitions even when everything is satisfied', () => {
    const planned: WidgetDefinition = {
      ...allDefinitions()[0],
      id: 'test.planned',
      lifecycle: 'planned',
    };
    const retired: WidgetDefinition = { ...allDefinitions()[0], id: 'test.retired', lifecycle: 'retired' };
    expect(isOfferable(planned)).toBe(false);
    expect(isOfferable(retired)).toBe(false);
    expect(isAvailableIn(planned, FULLY_SATISFIED)).toBe(false);
    expect(isAvailableIn(retired, FULLY_SATISFIED)).toBe(false);
  });

  // The registry is the only list the catalogue renders, so a widget for a
  // feature that does not exist cannot reach an operator by any path.
  it('ships no widget for a capability the application does not have', () => {
    // Tokenised, not substring-matched: "details" contains "ai" and would
    // otherwise fail a test about artificial intelligence.
    const tokens = new Set(allDefinitions().flatMap((d) => d.id.split(/[.-]/)));
    for (const forbidden of ['valuation', 'pricing', 'market', 'ai', 'receiving', 'cost', 'orders', 'returns']) {
      expect(tokens.has(forbidden)).toBe(false);
    }
  });

  it('ships no widget over the non-authoritative legacy store', () => {
    for (const definition of allDefinitions()) {
      expect(definition.data.provenance).not.toBe('legacy');
      expect(definition.data.source.toLowerCase()).not.toContain('sqlite');
      expect(definition.data.source).not.toContain('/dashboard');
    }
  });
});

describe('requirements filter what this deployment can actually offer', () => {
  it('drops a widget whose requirement is unmet rather than showing it broken', () => {
    const withoutIntake: WidgetAvailabilityContext = {
      ...FULLY_SATISFIED,
      satisfiedRequirements: ['governed-backend', 'active-workspace'],
    };
    const offered = availableDefinitions(withoutIntake).map((d) => d.id);
    expect(offered).not.toContain('intake.open-sessions');
    // Its neighbours are unaffected.
    expect(offered).toContain('inventory.needs-location');
  });

  it('offers nothing governed when no workspace is selected', () => {
    const offered = availableDefinitions({ surface: 'home', satisfiedRequirements: [], role: null }).map((d) => d.id);
    expect(offered).toEqual([]);
  });

  it('respects the surface a widget declares', () => {
    const surfaceOnly: WidgetDefinition = {
      ...allDefinitions()[0],
      id: 'test.home-only',
      surfaces: ['home'],
    };
    expect(isAvailableIn(surfaceOnly, FULLY_SATISFIED)).toBe(false);
    expect(isAvailableIn(surfaceOnly, { ...FULLY_SATISFIED, surface: 'home' })).toBe(true);
  });

  it('enforces a required role without inventing one the server does not apply', () => {
    const ownerOnly: WidgetDefinition = { ...allDefinitions()[0], id: 'test.owner', requiredRole: 'owner' };
    expect(isAvailableIn(ownerOnly, { ...FULLY_SATISFIED, role: 'viewer' })).toBe(false);
    expect(isAvailableIn(ownerOnly, { ...FULLY_SATISFIED, role: 'operator' })).toBe(false);
    expect(isAvailableIn(ownerOnly, { ...FULLY_SATISFIED, role: 'owner' })).toBe(true);
    // Every shipped definition is role-open, because the server applies no
    // per-widget authorization and a lock on the menu is not a lock on the door.
    for (const definition of allDefinitions()) expect(definition.requiredRole).toBeNull();
  });
});

describe('single instance is the default', () => {
  it('treats an unstated allowMultiple as false', () => {
    const definition: WidgetDefinition = { ...allDefinitions()[0], id: 'test.unstated' };
    delete (definition as { allowMultiple?: boolean }).allowMultiple;
    expect(allowsMultiple(definition)).toBe(false);
  });

  it('allows multiple only when a definition says so explicitly', () => {
    const permissive: WidgetDefinition = {
      ...allDefinitions()[0],
      id: 'test.multi',
      allowMultiple: true,
      allowMultipleReason: 'Two of them would show different filters.',
    };
    expect(allowsMultiple(permissive)).toBe(true);
  });

  it('ships every widget as single-instance, each without a justification to the contrary', () => {
    for (const definition of allDefinitions()) {
      expect(allowsMultiple(definition)).toBe(false);
      expect(definition.allowMultipleReason).toBeUndefined();
    }
  });
});

describe('size declarations are coherent', () => {
  it('declares a default that is itself supported', () => {
    for (const definition of allDefinitions()) {
      expect(definition.presentation.supportedSizes).toContain(definition.presentation.defaultSize);
      expect(supportsSize(definition, definition.presentation.defaultSize)).toBe(true);
    }
  });

  it('describes what every supported size shows, so a bigger size is never just bigger', () => {
    for (const definition of allDefinitions()) {
      const described = definition.presentation.sizeBehaviour.map((entry) => entry.size);
      expect([...described].sort()).toEqual([...definition.presentation.supportedSizes].sort());
      // Each size's description must be distinct: two sizes claiming the same
      // content is the definition admitting one of them is padding.
      const texts = definition.presentation.sizeBehaviour.map((entry) => entry.shows);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it('never declares a size outside the semantic vocabulary', () => {
    for (const definition of allDefinitions()) {
      for (const size of definition.presentation.supportedSizes) {
        expect(WIDGET_SIZES).toContain(size);
      }
    }
  });

  it('rejects a size the definition does not support', () => {
    const metric = findDefinition('governance.open-corrections')!;
    expect(supportsSize(metric, 'compact')).toBe(true);
    expect(supportsSize(metric, 'full')).toBe(false);
  });
});

describe('the registry describes; it does not fetch', () => {
  it('exposes no callable data surface on any definition', () => {
    for (const definition of allDefinitions()) {
      const values = Object.values(definition as unknown as Record<string, unknown>);
      // A function on a definition would be a place business data could be
      // loaded from inside presentation metadata.
      expect(values.some((value) => typeof value === 'function')).toBe(false);
      expect(Object.values(definition.data).some((value) => typeof value === 'function')).toBe(false);
    }
  });
});

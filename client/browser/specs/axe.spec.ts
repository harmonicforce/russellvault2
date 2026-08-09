// GATE 16 — the accessibility gate.
//
// ZERO serious and ZERO critical violations on every canonical surface, in both
// explicit themes, at a representative phone and desktop width.
//
// There is deliberately no `disableRules` list here. A blanket exclusion turns
// this file into a graveyard where a real defect can be parked indefinitely; if
// a rule ever has to be narrowed it belongs on a single element, with the
// reason written down and a direct behavioural assertion proving the equivalent
// property somewhere in this suite.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../fixtures/app';
import { ACQUISITIONS, ACQUISITION_DETAIL, HOME, WORKBENCH, openSurface } from '../fixtures/surfaces';
import type { ThemeChoice } from '../fixtures/app';

const THEMES: readonly ThemeChoice[] = ['light', 'dark'];

// axe is expensive and its answer does not vary with a 300px width change, so
// it runs at one narrow and one wide reference viewport rather than all five.
const AXE_VIEWPORTS = new Set(['chromium-phone-390x844', 'chromium-desktop-1440x900']);

interface Violation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: unknown }>;
}

function blocking(violations: Violation[]): Violation[] {
  return violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
}

function describe(violations: Violation[]): string {
  return violations
    .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
    .join('\n');
}

async function analyse(app: import('@playwright/test').Page) {
  // Scanned as the operator meets it: the whole document, with no include or
  // exclude narrowing that could quietly skip a region.
  return new AxeBuilder({ page: app }).analyze();
}

for (const theme of THEMES) {
  for (const surface of [HOME, WORKBENCH, ACQUISITIONS, ACQUISITION_DETAIL]) {
    test(`${surface.name} has no serious or critical violations in ${theme}`, async ({ app, scenario }, testInfo) => {
      test.skip(!AXE_VIEWPORTS.has(testInfo.project.name), 'axe runs at one narrow and one wide reference viewport');

      await scenario.set({ theme });
      await openSurface(app, surface);

      const results = await analyse(app);
      const serious = blocking(results.violations as unknown as Violation[]);
      expect(serious, `${surface.name} (${theme}):\n${describe(serious)}`).toEqual([]);
    });
  }

  test(`the Workbench edit and catalog state has no serious or critical violations in ${theme}`, async ({ app, scenario }, testInfo) => {
    test.skip(!AXE_VIEWPORTS.has(testInfo.project.name), 'axe runs at one narrow and one wide reference viewport');

    await scenario.set({ theme });
    await openSurface(app, WORKBENCH);
    await app.getByRole('button', { name: 'Customize' }).click();
    await expect(app.getByRole('button', { name: 'Done' })).toBeVisible();

    const edit = blocking((await analyse(app)).violations as unknown as Violation[]);
    expect(edit, `Workbench edit mode (${theme}):\n${describe(edit)}`).toEqual([]);

    await app.getByRole('button', { name: 'Widget catalog' }).click();
    await expect(app.getByRole('dialog')).toBeVisible();

    const catalog = blocking((await analyse(app)).violations as unknown as Violation[]);
    expect(catalog, `Widget catalog (${theme}):\n${describe(catalog)}`).toEqual([]);
  });

  test(`an open governed confirmation has no serious or critical violations in ${theme}`, async ({ app, scenario }, testInfo) => {
    test.skip(!AXE_VIEWPORTS.has(testInfo.project.name), 'axe runs at one narrow and one wide reference viewport');

    await scenario.set({ theme });
    await openSurface(app, ACQUISITION_DETAIL);
    await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();
    await expect(app.getByRole('dialog')).toBeVisible();

    const results = blocking((await analyse(app)).violations as unknown as Violation[]);
    expect(results, `Acquisition Detail confirmation (${theme}):\n${describe(results)}`).toEqual([]);
  });
}

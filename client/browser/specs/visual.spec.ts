// GATE 8 — the canonical visual matrix.
//
// Four surfaces x two explicit themes x five reference viewports. Explicit
// themes only: a System baseline would depend on the runner's OS preference,
// which is not a product fact.
//
// The baselines under `browser/baselines/` are COMMITTED and are the gate. CI
// compares against them and never rewrites them, so a baseline change has to
// arrive as a reviewable diff in a pull request — which is the point. The
// tolerance is deliberately small: antialiasing differs between machines, a
// layout regression does not.

import { expect, test } from '../fixtures/app';
import { CANONICAL_SURFACES, freezeForScreenshot, openSurface } from '../fixtures/surfaces';
import type { ThemeChoice } from '../fixtures/app';

const THEMES: readonly ThemeChoice[] = ['light', 'dark'];

for (const theme of THEMES) {
  for (const surface of CANONICAL_SURFACES) {
    test(`${surface.name} in ${theme}`, async ({ app, scenario }) => {
      await scenario.set({ theme });
      await openSurface(app, surface);
      await freezeForScreenshot(app);

      // VIEWPORT, not `fullPage`. The governed shell is a fixed-height frame
      // (`h-screen`, `overflow-hidden`) whose content scrolls INSIDE it, so the
      // document never grows — and asking Playwright to stitch a full-page
      // capture of a non-scrolling document produces duplicated bands and dead
      // space that would be baked into the baseline as if they were the design.
      //
      // The viewport is also the honest subject: this matrix exists to assert
      // what an operator sees at each reference size. Nothing is masked, so a
      // layout regression inside the frame still fails the gate.
      await expect(app).toHaveScreenshot(`${surface.name}-${theme}.png`);
    });
  }
}

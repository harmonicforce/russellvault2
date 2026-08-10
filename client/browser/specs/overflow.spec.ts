// GATE 9 — the global horizontal overflow invariant.
//
// This is the single measurement jsdom could never make. Every S1.6 slice
// asserted responsive behaviour from class names, which proves that a class was
// written, not that the page fits. A page whose content is two pixels wider
// than the viewport looks fine in a screenshot and is miserable to operate: the
// whole document slides sideways under a thumb, and a fixed header drifts off
// the edge.
//
// So the browser is asked directly, at every reference viewport, on every
// canonical surface.

import { expect, test } from '../fixtures/app';
import {
  CANONICAL_SURFACES,
  documentOverflow,
  internalHorizontalScrollers,
  openSurface,
} from '../fixtures/surfaces';

// Sub-pixel layout rounding is real and is not a defect. One CSS pixel of
// slack absorbs it; anything wider is content that does not fit.
const ROUNDING_TOLERANCE = 1;

for (const surface of CANONICAL_SURFACES) {
  test(`${surface.name} does not overflow the viewport horizontally`, async ({ app }) => {
    await openSurface(app, surface);

    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(
      scrollWidth - clientWidth,
      `${surface.name} overflows: document scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`,
    ).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
  });
}

test('the acquisitions table scrolls inside its own container, never the page', async ({ app }) => {
  await openSurface(app, CANONICAL_SURFACES[2]);

  // A data table is allowed to scroll horizontally INSIDE itself — that is the
  // DataTable contract. What it may not do is push the document sideways.
  const scrollers = await internalHorizontalScrollers(app);
  const { scrollWidth, clientWidth } = await documentOverflow(app);

  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
  for (const scroller of scrollers) {
    // Every intentional internal scroller must be a genuinely scrollable
    // container, not the body or the shell.
    expect(scroller.selector).not.toContain('body');
    expect(scroller.selector).not.toContain('html');
  }
});

test('an open governed confirmation does not make the page scroll sideways', async ({ app }) => {
  await openSurface(app, CANONICAL_SURFACES[3]);

  await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();
  await expect(app.getByRole('dialog')).toBeVisible();

  const { scrollWidth, clientWidth } = await documentOverflow(app);
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
});

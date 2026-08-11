// GATE 6 — WebKit iPad smoke.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// WebKit is the engine Safari is built on, so running the governed shell in it
// catches the class of defect that only Safari's layout, focus and `<dialog>`
// implementation produce — the defects Chromium is happy to hide.
//
// It is NOT an iPad. There is no physical touch hardware, no Safari UI, no
// on-screen keyboard, no momentum scrolling, no hover-on-tap emulation and no
// iPadOS. Passing here is evidence that the surface is sound in a Safari-family
// engine at iPad geometry. It is not a claim that the product has been tested
// on real iPad hardware, and that gap is recorded in the documentation rather
// than papered over.

import { expect, test } from '../fixtures/app';
import {
  ACQUISITIONS,
  ACQUISITION_DETAIL,
  HOME,
  RECEIPT_WORKSPACE,
  RECEIVING,
  WORKBENCH,
  documentOverflow,
  openSurface,
  overflowingElements,
} from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

test('the governed shell boots and navigates', async ({ app }) => {
  await openSurface(app, HOME);

  const width = app.viewportSize()?.width ?? 0;
  if (width < SIDEBAR_BREAKPOINT) {
    const trigger = app.getByRole('button', { name: 'Open navigation' });
    await trigger.click();
    const drawer = app.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Acquisitions' }).click();
    await expect(drawer).toBeHidden();
  } else {
    await app.locator('aside').getByRole('link', { name: 'Acquisitions' }).click();
  }
  await expect(app).toHaveURL(/\/acquisitions$/);
  await expect(app.getByText('137 filtered lines')).toBeVisible();
});

test('no canonical surface overflows horizontally', async ({ app }) => {
  // Receiving is included because the overflow invariant is exactly what
  // caught the S1.6.7 shell defect that Chromium never exhibited, and the
  // receipt workspace is now the tallest governed surface in the product.
  for (const surface of [HOME, WORKBENCH, ACQUISITIONS, ACQUISITION_DETAIL, RECEIVING, RECEIPT_WORKSPACE]) {
    await openSurface(app, surface);
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    const overflow = scrollWidth - clientWidth;
    const offenders = overflow > 1 ? await overflowingElements(app) : [];
    expect(
      overflow,
      `${surface.name} overflows by ${overflow}px in WebKit. Widest elements:\n  ${offenders.join('\n  ')}`,
    ).toBeLessThanOrEqual(1);
  }
});

test('the Workbench opens, edits and reorders', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();

  const order = () => app.locator('[data-widget-id]').evaluateAll((n) => n.map((x) => x.getAttribute('data-widget-id')));
  const before = await order();
  await app.getByRole('button', { name: /Move .* earlier/ }).nth(1).click();
  expect(await order()).not.toEqual(before);

  await app.getByRole('button', { name: 'Done' }).click();
  await expect(app.getByRole('button', { name: 'Customize' })).toBeVisible();
});

test('Acquisitions renders the representation this width is designed for', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);
  const width = app.viewportSize()?.width ?? 0;

  if (width < SIDEBAR_BREAKPOINT) {
    await expect(app.getByRole('table')).toBeHidden();
  } else {
    await expect(app.getByRole('table')).toBeVisible();
  }
});

test('Acquisition Detail dialogs open, contain focus and close', async ({ app }) => {
  await openSurface(app, ACQUISITION_DETAIL);

  const trigger = app.getByRole('button', { name: 'Exclude from downstream workflows' });
  await trigger.click();
  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Safari's `<dialog>` implementation is the point of running this at all.
  const native = await dialog.evaluate((node) => node.tagName === 'DIALOG' && (node as HTMLDialogElement).open);
  expect(native, 'WebKit must open a real top-layer <dialog>').toBe(true);

  for (let i = 0; i < 8; i += 1) {
    await app.keyboard.press('Tab');
    expect(
      await app.evaluate(() => {
        const panel = document.querySelector('dialog[open]');
        return !!panel && !!document.activeElement && panel.contains(document.activeElement);
      }),
      'focus escaped the confirmation in WebKit',
    ).toBe(true);
  }

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

/**
 * The SUBMITTED receipt in WebKit.
 *
 * One extra case, not a second matrix. The submitted state adds the inventory
 * provenance panel and the discrepancy region, making it the tallest governed
 * surface in the product — and height is what produced the S1.6.7 `w-screen`
 * defect, which appeared only once a vertical scrollbar existed and only in
 * WebKit. The linking dialog is checked in the same test because Safari's
 * dialog implementation is the other place this engine has diverged.
 */
test('a submitted receipt and its linking dialog stay inside the viewport', async ({ app, scenario }) => {
  const world = scenario.state.receiving;
  world.transition('submitted');
  await openSurface(app, RECEIPT_WORKSPACE);

  const settled = await documentOverflow(app);
  const overflow = settled.scrollWidth - settled.clientWidth;
  const offenders = overflow > 1 ? await overflowingElements(app) : [];
  expect(
    overflow,
    `the submitted receipt overflows by ${overflow}px in WebKit. Widest elements:\n  ${offenders.join('\n  ')}`,
  ).toBeLessThanOrEqual(1);

  await app.getByRole('region', { name: 'Inventory provenance' })
    .getByRole('button', { name: /link inventory/i }).first().click();
  await expect(app.getByRole('dialog')).toBeVisible();

  const open = await documentOverflow(app);
  expect(
    open.scrollWidth - open.clientWidth,
    'an open linking dialog must not widen the page in WebKit',
  ).toBeLessThanOrEqual(1);
});

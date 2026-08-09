// GATE 11 — touch targets, measured rather than asserted from class names.
//
// Every S1.6 slice claimed "touch-friendly" by pointing at `min-h-11`. That
// proves a class was written. It does not prove the rendered box is 44 CSS
// pixels tall, because padding, line-height, a flex parent, a `truncate`, or a
// sibling can all shrink it. `getBoundingClientRect()` is the only evidence.
//
// The 44px expectation is scoped to controls an operator actually drives with a
// thumb, at the widths where they do. A compact desktop-only affordance is not
// forced to 44px, and this file does not pretend otherwise — falsifying the
// scope to make a number go green would be worse than not measuring.

import { expect, test } from '../fixtures/app';
import type { Locator, Page } from '@playwright/test';
import { ACQUISITIONS, ACQUISITION_DETAIL, HOME, WORKBENCH, openSurface } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

const MINIMUM_TOUCH_PX = 44;
// Sub-pixel layout rounding: 43.99 is a 44px control.
const TOLERANCE = 0.5;

async function measure(_page: Page, locator: Locator, label: string) {
  await expect(locator, `${label} must exist to be measured`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has no layout box`).not.toBeNull();
  return { label, width: box!.width, height: box!.height };
}

function assertTouchSized(measured: { label: string; width: number; height: number }) {
  expect(
    measured.height,
    `${measured.label} is ${measured.height.toFixed(1)}px tall; touch controls need ~${MINIMUM_TOUCH_PX}px`,
  ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_PX - TOLERANCE);
  expect(
    measured.width,
    `${measured.label} is ${measured.width.toFixed(1)}px wide; touch controls need ~${MINIMUM_TOUCH_PX}px`,
  ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_PX - TOLERANCE);
}

// Touch geometry is a claim about the widths an operator uses by hand. Running
// it at 1728px would measure a mouse-driven surface and prove nothing.
test.describe('touch geometry', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= SIDEBAR_BREAKPOINT, 'touch sizing applies to phone and tablet portrait');

  test('the shell navigation trigger and drawer close are touch-sized', async ({ app }) => {
    await openSurface(app, HOME);

    const trigger = app.getByRole('button', { name: 'Open navigation' });
    assertTouchSized(await measure(app, trigger, 'shell navigation trigger'));

    await trigger.click();
    const close = app.getByRole('button', { name: 'Close navigation' });
    assertTouchSized(await measure(app, close, 'shell drawer close'));
  });

  test('theme options and the workspace affordance are touch-sized', async ({ app }) => {
    await openSurface(app, HOME);
    await app.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = app.getByRole('dialog', { name: 'Navigation' });

    for (const name of ['System', 'Light Vault Ledger', 'Dark Vault']) {
      const option = drawer.getByRole('radio', { name: new RegExp(name) });
      const box = await option.boundingBox();
      expect(box, `theme option ${name} has no layout box`).not.toBeNull();
      // The radio input itself may be visually small; what an operator taps is
      // its label row, so the LABEL is what must clear 44px.
      const row = drawer.locator('label', { hasText: name }).first();
      const rowBox = await row.boundingBox();
      expect(rowBox, `theme option ${name} row has no layout box`).not.toBeNull();
      expect(
        rowBox!.height,
        `theme option ${name} row is ${rowBox!.height.toFixed(1)}px tall`,
      ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_PX - TOLERANCE);
    }

    const signOut = drawer.getByRole('button', { name: /sign out/i });
    if (await signOut.count()) {
      assertTouchSized(await measure(app, signOut.first(), 'workspace sign-out affordance'));
    }
  });

  test('Workbench customize, done, reorder and catalog controls are touch-sized', async ({ app }) => {
    await openSurface(app, WORKBENCH);

    const customize = app.getByRole('button', { name: 'Customize' });
    assertTouchSized(await measure(app, customize, 'Workbench Customize'));

    await customize.click();
    assertTouchSized(await measure(app, app.getByRole('button', { name: 'Done' }), 'Workbench Done'));

    const earlier = app.getByRole('button', { name: /Move .* earlier/ }).first();
    assertTouchSized(await measure(app, earlier, 'Workbench Move earlier'));
    const later = app.getByRole('button', { name: /Move .* later/ }).first();
    assertTouchSized(await measure(app, later, 'Workbench Move later'));

    const catalogOpen = app.getByRole('button', { name: 'Widget catalog' });
    assertTouchSized(await measure(app, catalogOpen, 'Widget catalog open'));

    await catalogOpen.click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();
    assertTouchSized(await measure(app, dialog.getByRole('button', { name: 'Close catalog' }), 'Widget catalog close'));

    const add = dialog.getByRole('button', { name: /^Add / }).first();
    if (await add.count()) {
      assertTouchSized(await measure(app, add, 'Widget catalog add'));
    }
  });

  test('the drag handle presents a usable target in edit mode', async ({ app }) => {
    await openSurface(app, WORKBENCH);
    await app.getByRole('button', { name: 'Customize' }).click();

    const handle = app.locator('[data-drag-handle]').first();
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    // The handle is a compact glyph beside a title rather than a primary touch
    // control — it has keyboard-equivalent Move earlier/later buttons that ARE
    // touch-sized and are measured above. What it must not be is invisible or
    // sub-tappable, so it is held to a real floor rather than to 44px.
    expect(box!.height, `drag handle is ${box!.height.toFixed(1)}px tall`).toBeGreaterThanOrEqual(24);
    expect(box!.width, `drag handle is ${box!.width.toFixed(1)}px wide`).toBeGreaterThanOrEqual(24);
  });

  test('Acquisitions pagination controls are touch-sized', async ({ app }) => {
    await openSurface(app, ACQUISITIONS);

    for (const name of [/next/i, /previous/i]) {
      const control = app.getByRole('button', { name }).first();
      if (await control.count()) {
        assertTouchSized(await measure(app, control, `Acquisitions pagination ${String(name)}`));
      }
    }
  });

  test('Acquisition Detail mutation and dialog controls are touch-sized', async ({ app }) => {
    await openSurface(app, ACQUISITION_DETAIL);

    assertTouchSized(
      await measure(app, app.getByRole('button', { name: 'Exclude from downstream workflows' }), 'Exclude control'),
    );
    assertTouchSized(await measure(app, app.getByRole('button', { name: 'Add payment' }), 'Add payment'));

    await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();
    assertTouchSized(await measure(app, dialog.getByRole('button', { name: 'Confirm' }), 'confirmation Confirm'));
    assertTouchSized(await measure(app, dialog.getByRole('button', { name: 'Cancel' }), 'confirmation Cancel'));
    assertTouchSized(await measure(app, dialog.getByRole('button', { name: 'Close' }), 'confirmation Close'));
  });
});

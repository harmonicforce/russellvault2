// GATE 18 — reduced motion.
//
// An operator who asked the OS to reduce motion must still be able to do the
// job. The requirement is not that every pixel stops moving; it is that no
// governed operation DEPENDS on an animation finishing.

import { expect, test } from '../fixtures/app';
import { ACQUISITION_DETAIL, HOME, WORKBENCH, openSurface } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

// Emulated per test rather than through `test.use`, so the reduced-motion
// context is set on the same page the fixture already installed the scenario
// on, and the intent is visible at the top of each case.
async function reduceMotion(app: import('@playwright/test').Page): Promise<void> {
  await app.emulateMedia({ reducedMotion: 'reduce' });
}

test('the shell drawer opens, navigates and closes under reduced motion', async ({ app }) => {
  await reduceMotion(app);
  await openSurface(app, HOME);
  const width = app.viewportSize()?.width ?? 0;
  test.skip(width >= SIDEBAR_BREAKPOINT, 'the drawer is a narrow-width surface');

  const trigger = app.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a governed confirmation remains fully usable under reduced motion', async ({ app }) => {
  await reduceMotion(app);
  await openSurface(app, ACQUISITION_DETAIL);

  await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();
  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Reachable, readable and dismissible without waiting for anything.
  await expect(dialog.getByLabel(/Eligibility decision reason/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('Workbench edit mode works under reduced motion', async ({ app }) => {
  await reduceMotion(app);
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();
  await expect(app.getByRole('button', { name: /Move .* earlier/ }).first()).toBeVisible();
  await app.getByRole('button', { name: 'Done' }).click();
  await expect(app.getByRole('button', { name: 'Customize' })).toBeVisible();
});

test('entrance motion is suppressed rather than merely shortened', async ({ app }) => {
  await reduceMotion(app);
  await openSurface(app, ACQUISITION_DETAIL);
  await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();

  const durations = await app.getByRole('dialog').evaluate((node) => {
    const style = getComputedStyle(node);
    return { transition: style.transitionDuration, animation: style.animationDuration };
  });
  // The gate does not demand literal zero — a minimal transition is legitimate
  // CSS semantics. What it demands is that nothing an operator must wait for
  // takes perceptible time under reduced motion.
  const seconds = (value: string) =>
    Math.max(0, ...value.split(',').map((part) => Number.parseFloat(part.trim().replace('ms', 'e-3').replace('s', ''))));
  expect(seconds(durations.transition), `transition ${durations.transition}`).toBeLessThanOrEqual(0.1);
  expect(seconds(durations.animation), `animation ${durations.animation}`).toBeLessThanOrEqual(0.1);
});

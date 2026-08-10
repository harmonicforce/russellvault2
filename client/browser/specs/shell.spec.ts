// GATE 10 — the governed shell, in a real browser.
//
// The navigation drawer is a `<dialog>` driven by `showModal()`. jsdom has no
// `showModal()` at all, so every S1.6.2 and S1.6.3 test ran the FALLBACK path
// and the primitive's own comments said so. Top-layer behaviour, inertness of
// the background, and focus restoration are proved here for the first time.

import { expect, test } from '../fixtures/app';
import { HOME, openSurface } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

async function viewportWidth(page: import('@playwright/test').Page): Promise<number> {
  return page.viewportSize()?.width ?? 0;
}

test('presents the right primary navigation mechanism for its width', async ({ app }) => {
  await openSurface(app, HOME);
  const width = await viewportWidth(app);
  const sidebar = app.locator('aside');
  const trigger = app.getByRole('button', { name: 'Open navigation' });

  if (width >= SIDEBAR_BREAKPOINT) {
    // Persistent sidebar is the primary mechanism; the drawer trigger is not.
    await expect(sidebar).toBeVisible();
    await expect(trigger).toBeHidden();
  } else {
    // No permanent sidebar; navigation lives behind an explicit trigger.
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeVisible();
  }
});

test.describe('navigation drawer', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= SIDEBAR_BREAKPOINT, 'drawer is a narrow-width surface');

  test('opens, takes focus, and blocks the background', async ({ app }) => {
    await openSurface(app, HOME);
    await app.getByRole('button', { name: 'Open navigation' }).click();

    const drawer = app.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();

    // Focus actually entered the drawer, rather than staying on the trigger.
    const focusInsideDrawer = await app.evaluate(() => {
      const dialog = document.querySelector('dialog[open], [role="dialog"]');
      return !!dialog && !!document.activeElement && dialog.contains(document.activeElement);
    });
    expect(focusInsideDrawer).toBe(true);

    // The real proof of top-layer modality: the background is inert, so a
    // programmatic click on content behind the overlay does not reach it.
    // `inert`/top-layer is a browser behaviour jsdom has no equivalent for.
    const heading = app.getByRole('heading', { level: 1, name: 'Today at a glance' });
    const backgroundReachable = await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const atPoint = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!atPoint && (element === atPoint || element.contains(atPoint));
    });
    expect(backgroundReachable, 'content behind the modal drawer must not be hit-testable').toBe(false);
  });

  test('closes on Escape and restores focus to the trigger', async ({ app }) => {
    await openSurface(app, HOME);
    const trigger = app.getByRole('button', { name: 'Open navigation' });
    await trigger.click();
    await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeVisible();

    await app.keyboard.press('Escape');
    await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('closes on the explicit close control and restores focus', async ({ app }) => {
    await openSurface(app, HOME);
    const trigger = app.getByRole('button', { name: 'Open navigation' });
    await trigger.click();
    await app.getByRole('button', { name: 'Close navigation' }).click();

    await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('closes when a destination is chosen and actually navigates', async ({ app }) => {
    await openSurface(app, HOME);
    await app.getByRole('button', { name: 'Open navigation' }).click();

    const drawer = app.getByRole('dialog', { name: 'Navigation' });
    await drawer.getByRole('link', { name: 'Acquisitions' }).click();

    await expect(drawer).toBeHidden();
    await expect(app).toHaveURL(/\/acquisitions$/);
  });

  test('is not closed by choosing a theme inside it', async ({ app }) => {
    await openSurface(app, HOME);
    await app.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = app.getByRole('dialog', { name: 'Navigation' });

    await drawer.getByRole('radio', { name: /Dark Vault/ }).click();

    // A theme change is a preference, not a destination. Closing the drawer on
    // it would throw the operator back to the page mid-decision.
    await expect(drawer).toBeVisible();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('contains Tab focus while it is open', async ({ app }) => {
    await openSurface(app, HOME);
    await app.getByRole('button', { name: 'Open navigation' }).click();
    await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeVisible();

    // Walk further than the drawer has focusables and confirm focus never
    // escapes into the page behind it.
    for (let i = 0; i < 30; i += 1) {
      await app.keyboard.press('Tab');
      const inside = await app.evaluate(() => {
        const dialog = document.querySelector('dialog[open], [role="dialog"]');
        return !!dialog && !!document.activeElement && dialog.contains(document.activeElement);
      });
      expect(inside, `focus escaped the drawer after ${i + 1} Tab presses`).toBe(true);
    }
  });
});

test.describe('system truth region', () => {
  test('is visible when the fixture reports a degraded dependency', async ({ app, scenario }) => {
    await scenario.set({ degradedHealth: true });
    await openSurface(app, HOME);

    await expect(app.getByText(/legacy/i).first()).toBeVisible();
  });

  test('survives route navigation because it lives outside the routed subtree', async ({ app, scenario }) => {
    await scenario.set({ degradedHealth: true });
    await openSurface(app, HOME);
    const banner = app.locator('[data-system-truth-region]');
    await expect(banner).toBeVisible();

    await app.goto('/acquisitions');
    await expect(app.getByText('137 filtered lines')).toBeVisible();
    await expect(banner, 'the system truth region must not be unmounted by routing').toBeVisible();
  });

  test('is never rendered as a customizable Workbench widget', async ({ app, scenario }) => {
    await scenario.set({ degradedHealth: true });
    await app.goto('/workbench');
    await expect(app.getByRole('button', { name: 'Customize' })).toBeVisible();

    // The region exists on the page, and it is NOT inside the arrangeable
    // surface — an operator must not be able to remove the thing that tells
    // them the system is degraded.
    const insideWorkbench = await app.evaluate(() => {
      const region = document.querySelector('[data-system-truth-region]');
      const surface = document.querySelector('[data-workbench-surface]');
      return !!region && !!surface && surface.contains(region);
    });
    expect(insideWorkbench).toBe(false);

    await app.getByRole('button', { name: 'Customize' }).click();
    await expect(app.locator('[data-system-truth-region]')).toBeVisible();
  });
});

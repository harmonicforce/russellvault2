// GATE 7 — the theme matrix, resolved by a real browser.
//
// `prefers-color-scheme` is a media query. jsdom does not evaluate media
// queries, so no previous slice could prove that choosing System actually
// follows the operating system, or that an explicit choice actually ignores it.
// Playwright can change the emulated colour scheme, so it can.

import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/app';
import { HOME, openSurface } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

/**
 * Reach the theme chooser wherever this width actually puts it.
 *
 * Below `lg` it lives inside the navigation drawer; at and above `lg` it is in
 * the persistent sidebar. Clicking "the first radio named Dark Vault" finds the
 * hidden copy at whichever width it is hidden.
 */
async function chooseTheme(page: Page, name: RegExp): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  if (width < SIDEBAR_BREAKPOINT) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('radio', { name }).click();
    return;
  }
  await page.locator('aside').getByRole('radio', { name }).click();
}

test('explicit Light Vault Ledger renders light and ignores a dark OS preference', async ({ app, scenario }) => {
  await scenario.set({ theme: 'light' });
  await app.emulateMedia({ colorScheme: 'dark' });
  await openSurface(app, HOME);

  await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
  // An explicit choice is a decision, not a hint. The OS must not overrule it.
  const background = await app.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  const luminance = await app.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  expect(luminance, 'Light Vault Ledger must render a light surface').toBeGreaterThan(128);
});

test('explicit Dark Vault renders dark and ignores a light OS preference', async ({ app, scenario }) => {
  await scenario.set({ theme: 'dark' });
  await app.emulateMedia({ colorScheme: 'light' });
  await openSurface(app, HOME);

  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  const luminance = await app.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  expect(luminance, 'Dark Vault must render a dark surface').toBeLessThan(128);
});

test('System removes the explicit attribute and follows the OS', async ({ app, scenario }) => {
  await scenario.set({ theme: 'system' });
  await app.emulateMedia({ colorScheme: 'dark' });
  await openSurface(app, HOME);

  // System is the ABSENCE of an explicit stamp. Writing `data-theme="dark"`
  // for System would make the choice indistinguishable from explicit Dark on
  // the next load.
  await expect(app.locator('html')).not.toHaveAttribute('data-theme', /light|dark/);

  const darkLuminance = await app.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  expect(darkLuminance, 'System under a dark OS preference must render dark').toBeLessThan(128);
});

test('a live OS colour-scheme change is reflected while System is active', async ({ app, scenario }) => {
  await scenario.set({ theme: 'system' });
  await app.emulateMedia({ colorScheme: 'dark' });
  await openSurface(app, HOME);

  const read = () =>
    app.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    });

  expect(await read()).toBeLessThan(128);

  // The OS preference changes underneath a running application. Nothing is
  // reloaded; the media query listener has to do the work.
  await app.emulateMedia({ colorScheme: 'light' });
  await expect.poll(read, { message: 'System must follow a live OS change' }).toBeGreaterThan(128);
});

test('choosing a theme persists it for the next visit on this device', async ({ app, scenario }) => {
  await scenario.set({ theme: 'light' });
  await openSurface(app, HOME);

  await chooseTheme(app, /Dark Vault/);
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');

  await app.reload();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
});

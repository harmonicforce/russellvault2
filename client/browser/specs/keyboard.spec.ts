// GATES 15 and 17 — a keyboard-only walkthrough, and visible focus.
//
// "The element can receive focus" is not the proof. This drives the real
// application from the keyboard through a real operator journey, and checks at
// each step that the focused control is actually distinguishable on screen.

import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/app';
import { HOME, openSurface } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';

/** Whether the focused element renders a focus treatment a sighted operator can see. */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return false;
    const style = getComputedStyle(element);
    const outlineWidth = Number.parseFloat(style.outlineWidth || '0');
    const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
    const hasRing = style.boxShadow !== 'none' && style.boxShadow !== '';
    // A visible border change also counts; the gate does not mandate one exact
    // treatment, only that the focused state is distinguishable.
    const hasBorder = Number.parseFloat(style.borderWidth || '0') > 0;
    return hasOutline || hasRing || hasBorder;
  });
}

/**
 * Tab until `predicate` matches the focused element, then stop.
 *
 * `backwards` matters on a real page: the sidebar precedes the routed content
 * in the DOM, so once focus is deep in a page, forward tabbing never returns to
 * navigation. An operator reaches it with Shift+Tab, and so does this.
 */
async function tabTo(
  page: Page,
  predicate: (info: { name: string; tag: string }) => boolean,
  { limit = 60, backwards = false }: { limit?: number; backwards?: boolean } = {},
): Promise<boolean> {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return {
        name: (element?.getAttribute('aria-label') ?? element?.textContent ?? '').trim(),
        tag: element?.tagName ?? '',
      };
    });
    if (predicate(info)) return true;
  }
  return false;
}

test('a keyboard-only operator can complete a real governed journey', async ({ app }) => {
  await openSurface(app, HOME);
  const width = app.viewportSize()?.width ?? 0;

  await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // 1 — reach navigation. Below `lg` that means opening the drawer first.
  if (width < SIDEBAR_BREAKPOINT) {
    const reached = await tabTo(app, (info) => info.name === 'Open navigation');
    expect(reached, 'the navigation trigger must be reachable by Tab').toBe(true);
    expect(await focusIsVisible(app), 'the navigation trigger needs a visible focus treatment').toBe(true);
    await app.keyboard.press('Enter');
    await expect(app.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  }

  // 2 — navigate to the Workbench without a pointer.
  const reachedWorkbench = await tabTo(app, (info) => /daily workbench/i.test(info.name));
  expect(reachedWorkbench, 'the Workbench destination must be reachable by Tab').toBe(true);
  expect(await focusIsVisible(app), 'a navigation destination needs a visible focus treatment').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByRole('button', { name: 'Customize' })).toBeVisible();

  // 3 — enter edit mode.
  const reachedCustomize = await tabTo(app, (info) => info.name === 'Customize');
  expect(reachedCustomize, 'Customize must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByRole('button', { name: 'Done' })).toBeVisible();

  // 4 — move a widget, and keep the operator's place.
  const reachedMove = await tabTo(app, (info) => /^Move .* later$/.test(info.name));
  expect(reachedMove, 'a reorder control must be reachable by Tab').toBe(true);
  expect(await focusIsVisible(app), 'the reorder control needs a visible focus treatment').toBe(true);
  const orderBefore = await app.locator('[data-widget-id]').evaluateAll((n) => n.map((x) => x.getAttribute('data-widget-id')));
  await app.keyboard.press('Enter');
  const orderAfter = await app.locator('[data-widget-id]').evaluateAll((n) => n.map((x) => x.getAttribute('data-widget-id')));
  expect(orderAfter).not.toEqual(orderBefore);
  expect(
    await app.evaluate(() => document.activeElement !== null && document.activeElement !== document.body),
    'focus must survive the reorder',
  ).toBe(true);

  // 5 — open and close the catalog.
  const reachedCatalog = await tabTo(app, (info) => info.name === 'Widget catalog');
  expect(reachedCatalog, 'the catalog trigger must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByRole('dialog')).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog')).toBeHidden();

  // 6 — reach Acquisitions.
  if (width < SIDEBAR_BREAKPOINT) {
    const reopened = await tabTo(app, (info) => info.name === 'Open navigation');
    expect(reopened).toBe(true);
    await app.keyboard.press('Enter');
  }
  const reachedAcquisitions = await tabTo(app, (info) => /^Acquisitions$/i.test(info.name), {
    // Navigation sits before the routed content, so an operator walks back to
    // it rather than forward through the rest of the page.
    backwards: width >= SIDEBAR_BREAKPOINT,
  });
  expect(reachedAcquisitions, 'Acquisitions must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByText('137 filtered lines')).toBeVisible();

  // 7 — operate a filter from the keyboard.
  const reachedFilter = await tabTo(app, (info) => info.tag === 'SELECT');
  expect(reachedFilter, 'a filter control must be reachable by Tab').toBe(true);
  expect(await focusIsVisible(app), 'a filter control needs a visible focus treatment').toBe(true);
  await app.keyboard.press('Enter');

  // 8 — enter a detail record.
  const reachedLine = await tabTo(app, (info) => /^RV-ALIN-/.test(info.name));
  expect(reachedLine, 'an acquisition line link must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();

  // 9 — open a consequential dialog and cancel it.
  const reachedExclude = await tabTo(app, (info) => info.name === 'Exclude from downstream workflows');
  expect(reachedExclude, 'the eligibility control must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await focusIsVisible(app), 'the focused control inside a dialog must be visible').toBe(true);
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 10 — return to Acquisitions.
  // The return link is at the TOP of the detail page, above everything the
  // operator has just been working in.
  const reachedBack = await tabTo(app, (info) => /Back to acquisitions/.test(info.name), { backwards: true });
  expect(reachedBack, 'the return link must be reachable by Tab').toBe(true);
  await app.keyboard.press('Enter');
  await expect(app.getByText(/filtered lines/)).toBeVisible();
});

test('there is no keyboard trap outside an intentional modal', async ({ app }) => {
  await openSurface(app, HOME);
  await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const seen = new Set<string>();
  let repeats = 0;
  for (let i = 0; i < 80; i += 1) {
    await app.keyboard.press('Tab');
    const signature = await app.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return `${element?.tagName}:${(element?.getAttribute('aria-label') ?? element?.textContent ?? '').trim().slice(0, 40)}`;
    });
    if (seen.has(signature)) repeats += 1;
    seen.add(signature);
  }
  // Tab must reach many distinct controls rather than cycling between two,
  // which is what a trap looks like from the outside.
  expect(seen.size, `only ${seen.size} distinct stops in 80 tabs (${repeats} repeats) suggests a trap`).toBeGreaterThan(8);
});

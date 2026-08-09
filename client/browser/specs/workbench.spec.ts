// GATE 12 — the Workbench, driven by a real pointer and a real keyboard.
//
// S1.6.4 built drag-and-drop behind an adapter and said plainly that jsdom
// proves no gesture: it has no layout, so a drag has no coordinates and an
// activation threshold has nothing to measure. Everything below is the part
// that could not be written until now.

import { expect, test } from '../fixtures/app';
import { WORKBENCH, openSurface } from '../fixtures/surfaces';

async function widgetOrder(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('[data-widget-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-widget-id') ?? ''),
  );
}

test('normal mode carries no drag furniture and scrolling does not reorder', async ({ app }) => {
  await openSurface(app, WORKBENCH);

  await expect(app.locator('[data-drag-handle]')).toHaveCount(0);
  await expect(app.getByRole('button', { name: /Move .* earlier/ })).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Done' })).toHaveCount(0);

  const before = await widgetOrder(app);
  expect(before.length).toBeGreaterThan(1);

  // A scroll gesture over widget content is the single most common thing an
  // operator does on a tablet. It must never be interpreted as a drag.
  const first = app.locator('[data-widget-id]').first();
  const box = await first.boundingBox();
  await app.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await app.mouse.wheel(0, 400);
  await app.mouse.wheel(0, -400);

  expect(await widgetOrder(app)).toEqual(before);
});

test('edit mode reveals reorder and size controls and Done exits', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();

  await expect(app.locator('[data-drag-handle]').first()).toBeVisible();
  await expect(app.getByRole('button', { name: /Move .* earlier/ }).first()).toBeVisible();
  await expect(app.getByRole('combobox', { name: /Size for / }).first()).toBeVisible();

  await app.getByRole('button', { name: 'Done' }).click();
  await expect(app.getByRole('button', { name: 'Customize' })).toBeVisible();
  await expect(app.locator('[data-drag-handle]')).toHaveCount(0);
});

test('the widget catalog opens in the browser top layer and returns focus', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  const trigger = app.getByRole('button', { name: 'Customize' });
  await trigger.click();

  const open = app.getByRole('button', { name: 'Widget catalog' });
  await open.click();

  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // A REAL top-layer dialog: `<dialog>` opened with showModal(). This is the
  // assertion jsdom could never make, because jsdom has no showModal at all
  // and the primitive's fallback path was the only one ever exercised.
  const native = await dialog.evaluate((node) => node.tagName === 'DIALOG' && (node as HTMLDialogElement).open);
  expect(native, 'the catalog must be a real open <dialog>').toBe(true);

  const focusInside = await app.evaluate(() => {
    const panel = document.querySelector('dialog[open]');
    return !!panel && !!document.activeElement && panel.contains(document.activeElement);
  });
  expect(focusInside).toBe(true);

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test('the catalog searches, adds and removes without closing between operations', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();
  await app.getByRole('button', { name: 'Widget catalog' }).click();

  const dialog = app.getByRole('dialog');
  const available = dialog.getByRole('list', { name: 'Available widgets' });
  const beforeCount = await available.getByRole('listitem').count();
  expect(beforeCount).toBeGreaterThan(0);

  await dialog.getByLabel('Search widgets').fill('zzzz-no-such-widget');
  await expect(available.getByRole('listitem')).toHaveCount(0);

  await dialog.getByLabel('Search widgets').fill('');
  await expect(available.getByRole('listitem')).toHaveCount(beforeCount);

  const addable = dialog.getByRole('button', { name: /^Add .* to this surface$/ }).and(dialog.locator('button:not([disabled])')).first();
  if (await addable.count()) {
    const before = (await widgetOrder(app)).length;
    await addable.click();
    // Several operations in a row, without the overlay closing between them.
    await expect(dialog).toBeVisible();
    expect((await widgetOrder(app)).length).toBeGreaterThan(before);

    const removable = dialog.getByRole('button', { name: /^Remove .* from this surface$/ }).first();
    if (await removable.count()) {
      await removable.click();
      await expect(dialog).toBeVisible();
      expect((await widgetOrder(app)).length).toBe(before);
    }
  }
});

test('keyboard reorder changes the order and announces it without losing focus', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();

  const before = await widgetOrder(app);
  expect(before.length).toBeGreaterThan(1);

  // The SECOND widget moves earlier, so the assertion is about a real swap
  // rather than about a disabled control at the top of the list.
  const mover = app.getByRole('button', { name: /Move .* earlier/ }).nth(1);
  await mover.click();

  const after = await widgetOrder(app);
  expect(after, 'the persisted order must actually change').not.toEqual(before);
  // The widget that moved is now earlier than it was. Asserting an exact index
  // would encode how many surfaces the page happens to render.
  const moved = before[1];
  expect(after.indexOf(moved)).toBeLessThan(before.indexOf(moved));

  // The live region says what happened, for an operator who cannot see it.
  await expect(app.locator('[role="status"]').filter({ hasText: /mov|order|earlier|later/i }).first()).not.toHaveText('');

  // Focus must not evaporate into the document when the DOM reorders.
  const focusIsSomewhereUseful = await app.evaluate(
    () => document.activeElement !== null && document.activeElement !== document.body,
  );
  expect(focusIsSomewhereUseful).toBe(true);
});

test('a drag starts only from the handle and reorders the persisted order', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();

  const before = await widgetOrder(app);
  expect(before.length).toBeGreaterThan(1);

  const firstHandle = app.locator('[data-drag-handle]').nth(0);
  const secondWidget = app.locator('[data-widget-id]').nth(1);
  const handleBox = await firstHandle.boundingBox();
  const targetBox = await secondWidget.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await app.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await app.mouse.down();
  // Several intermediate moves: a single jump can fall below the activation
  // threshold and prove nothing about dragging.
  for (let step = 1; step <= 6; step += 1) {
    await app.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + ((targetBox!.y + targetBox!.height / 2 - handleBox!.y) * step) / 6,
      { steps: 4 },
    );
  }
  await app.mouse.up();

  await expect
    .poll(async () => (await widgetOrder(app)).join(','), {
      message: 'a drag from the handle must change the persisted order',
      timeout: 5_000,
    })
    .not.toBe(before.join(','));
});

test('a drag gesture on widget CONTENT does not reorder anything', async ({ app }) => {
  await openSurface(app, WORKBENCH);
  await app.getByRole('button', { name: 'Customize' }).click();

  const before = await widgetOrder(app);
  const body = app.locator('[data-widget-id]').first();
  const box = await body.boundingBox();

  // Press well inside the content area, below the header where the handle is.
  const startY = box!.y + box!.height - 12;
  await app.mouse.move(box!.x + box!.width / 2, startY);
  await app.mouse.down();
  await app.mouse.move(box!.x + box!.width / 2, startY + 260, { steps: 12 });
  await app.mouse.up();

  expect(
    await widgetOrder(app),
    'the widget body must not be a drag activator, or every scroll becomes a reorder',
  ).toEqual(before);
});

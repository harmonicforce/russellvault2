// GATE 14 — the governed transactional detail, in a real browser.
//
// S1.6.6 built this page on `<dialog>` and said the limit out loud: jsdom has
// no `showModal()`, so every overlay test ran the fallback path and top-layer
// behaviour was unproven. It is proved here, along with the money rules, the
// delivered-versus-receiving distinction, and the unresolved-operation recovery
// that is the reason S1.6.6 existed.

import { expect, test } from '../fixtures/app';
import { ACQUISITION_DETAIL, openSurface } from '../fixtures/surfaces';
import { mixedCurrencyDetail, missingPlacementDetail, noPaymentDetail } from '../fixtures/data';

test('renders every governed panel', async ({ app }) => {
  await openSurface(app, ACQUISITION_DETAIL);

  for (const panel of ['Overview', 'Classification', 'Downstream eligibility', 'Financial', 'Inbound shipments', 'Source evidence']) {
    await expect(app.getByLabel(panel, { exact: true }), `${panel} panel`).toBeVisible();
  }
  await expect(app.getByText('owner confirmed factory seal on the stream replay')).toBeVisible();
  await expect(app.getByText('whatnot:order:4412:line:1')).toBeVisible();
});

test('a missing active placement is raised as an integrity problem', async ({ app, scenario }) => {
  await scenario.set({ detail: missingPlacementDetail() });
  await openSurface(app, ACQUISITION_DETAIL);

  await expect(app.getByText('No active lot placement')).toBeVisible();
  await expect(app.getByText(/Downstream readiness must not be assumed/)).toBeVisible();
  await expect(app.getByText(/RV-ALOT/)).toHaveCount(0);
});

test.describe('governed confirmations', () => {
  const cases = [
    { name: 'eligibility', open: 'Exclude from downstream workflows', title: 'Exclude from downstream workflows' },
    { name: 'payment reversal', open: 'Reverse (preserve history)', title: 'Reverse payment' },
  ] as const;

  for (const scenarioCase of cases) {
    test(`${scenarioCase.name} opens a real modal, contains focus, and restores it`, async ({ app }) => {
      await openSurface(app, ACQUISITION_DETAIL);
      const trigger = app.getByRole('button', { name: scenarioCase.open });
      await trigger.click();

      const dialog = app.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // A real `<dialog>` in the top layer — not a div wearing the role.
      const native = await dialog.evaluate((node) => node.tagName === 'DIALOG' && (node as HTMLDialogElement).open);
      expect(native, 'the confirmation must be a real open <dialog>').toBe(true);

      // Accessible name.
      await expect(dialog.getByRole('heading', { level: 2, name: scenarioCase.title })).toBeVisible();

      // Focus entered.
      expect(
        await app.evaluate(() => {
          const panel = document.querySelector('dialog[open]');
          return !!panel && !!document.activeElement && panel.contains(document.activeElement);
        }),
      ).toBe(true);

      // The background cannot be operated: the top layer makes it inert, so a
      // control behind the overlay is not even hit-testable.
      const behind = app.getByRole('button', { name: 'Add payment' });
      const reachable = await behind.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const atPoint = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !!atPoint && (element === atPoint || element.contains(atPoint));
      });
      expect(reachable, 'background controls must be inert under a modal').toBe(false);

      // Tab and Shift+Tab stay inside.
      for (let i = 0; i < 12; i += 1) {
        await app.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
        expect(
          await app.evaluate(() => {
            const panel = document.querySelector('dialog[open]');
            return !!panel && !!document.activeElement && panel.contains(document.activeElement);
          }),
          `focus escaped the ${scenarioCase.name} confirmation`,
        ).toBe(true);
      }

      // Escape dismisses, and focus returns where the operator left it.
      await app.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }

  test('Cancel dismisses without sending a governed mutation', async ({ app }) => {
    const posted: string[] = [];
    app.on('request', (request) => {
      if (request.method() === 'POST') posted.push(request.url());
    });

    await openSurface(app, ACQUISITION_DETAIL);
    await app.getByRole('button', { name: 'Exclude from downstream workflows' }).click();
    await app.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(app.getByRole('dialog')).toBeHidden();
    expect(posted).toEqual([]);
  });

  test('a shipment transition confirmation opens and closes', async ({ app }) => {
    await openSurface(app, ACQUISITION_DETAIL);
    await app.getByRole('button', { name: 'delivered' }).click();

    const dialog = app.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Confirm shipment transition' })).toBeVisible();
    await expect(dialog.getByLabel('Actual received time')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the owner classification override is a real field, never a browser prompt', async ({ app }) => {
    let prompted = false;
    app.on('dialog', async (nativeDialog) => {
      prompted = true;
      await nativeDialog.dismiss();
    });

    await openSurface(app, ACQUISITION_DETAIL);
    await app.getByLabel('Required reason').fill('owner verified the seal');
    await app.getByRole('button', { name: 'Save owner override' }).click();

    await expect(app.getByText('Owner override saved with history preserved.')).toBeVisible();
    expect(prompted, 'no window.prompt may appear anywhere on this page').toBe(false);
  });
});

test.describe('money truth', () => {
  test('a single currency shows a currency-qualified total', async ({ app }) => {
    await openSurface(app, ACQUISITION_DETAIL);
    await expect(app.getByLabel('Financial').getByText('USD 129.99').first()).toBeVisible();
  });

  test('mixed currencies produce NO combined total', async ({ app, scenario }) => {
    await scenario.set({ detail: mixedCurrencyDetail() });
    await openSurface(app, ACQUISITION_DETAIL);

    const financial = app.getByLabel('Financial');
    await expect(financial.getByText('Mixed currencies — no combined total')).toBeVisible();
    // There is no exchange rate here; a combined figure would be invented.
    await expect(financial.getByText('USD 174.99')).toHaveCount(0);
    await expect(financial.getByText('Payment difference')).toHaveCount(0);
  });

  test('no active total is never rendered as a fabricated zero', async ({ app, scenario }) => {
    await scenario.set({ detail: noPaymentDetail() });
    await openSurface(app, ACQUISITION_DETAIL);

    const financial = app.getByLabel('Financial');
    await expect(financial.getByText('No active recorded total')).toBeVisible();
    await expect(financial.getByText('USD 0.00')).toHaveCount(0);
  });
});

test('delivered never claims the shipment was inventoried or received', async ({ app }) => {
  await openSurface(app, ACQUISITION_DETAIL);

  const shipments = (await app.getByLabel('Inbound shipments').textContent()) ?? '';
  expect(shipments).toContain('carrier-reported arrival');
  expect(shipments).toContain('not mean the shipment has been physically reconciled');
  expect(shipments).toContain('governed receiving is complete');
  expect(shipments).not.toMatch(/receiv(ed|ing) into inventory/i);
});

test.describe('unresolved governed operation', () => {
  async function submitFailingPayment(app: import('@playwright/test').Page) {
    await app.getByLabel(/Payment amount/).fill('12.34');
    await app.getByLabel(/Payment date and time/).fill('2026-08-06T12:00');
    await app.getByRole('button', { name: 'Add payment' }).click();
  }

  test('an unconfirmed outcome offers exact retry and never says nothing was sent', async ({ app, scenario }) => {
    await scenario.set({ mutationFailure: 'dependency_failed' });
    await openSurface(app, ACQUISITION_DETAIL);
    await submitFailingPayment(app);

    await expect(app.getByText('Payment was not confirmed.')).toBeVisible();
    await expect(app.getByRole('button', { name: 'Retry exact request' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Stop retrying and verify' })).toBeVisible();

    const body = (await app.locator('body').textContent()) ?? '';
    expect(body, 'the page must never claim the request never reached the server').not.toContain('Nothing was sent');
  });

  test('a failed verification keeps the lock and a successful one releases it', async ({ app, scenario }) => {
    await scenario.set({ mutationFailure: 'dependency_failed' });
    await openSurface(app, ACQUISITION_DETAIL);
    await submitFailingPayment(app);
    await expect(app.getByRole('button', { name: 'Stop retrying and verify' })).toBeVisible();

    // The authoritative re-read fails: the outcome AND the current state are
    // both unknown, which is the worst moment to unlock a replacement.
    await scenario.set({ detailReadFails: true });
    await app.getByRole('button', { name: 'Stop retrying and verify' }).click();

    await expect(app.getByText(/Verification failed/)).toBeVisible();
    await expect(app.getByRole('button', { name: 'Retry exact request' })).toBeVisible();

    // Now the record can be read again; stopping resolves, with copy that still
    // refuses to claim what happened to the earlier request.
    await scenario.set({ detailReadFails: false });
    await app.getByRole('button', { name: 'Stop retrying and verify' }).click();
    await expect(app.getByRole('button', { name: 'Stop retrying and verify' })).toBeHidden();
    await expect(app.getByText(/still unknown/)).toBeVisible();
  });
});

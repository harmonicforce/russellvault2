// S2.3 Batch 1 — the governed receiving workflow, proved in a real browser.
//
// jsdom already proves the logic. What it cannot prove is that the workflow is
// OPERABLE: that the queue renders as a table on a desktop and as records on a
// phone, that a dialog opens in the top layer and can be driven, that pressing
// a governed control actually changes the page after the authoritative refresh,
// and that none of it pushes the shell sideways.
//
// Everything here drives the REAL production bundle. The network is answered at
// the browser boundary by a stateful recorded fixture, so recording a quantity
// really does change what the next read returns — the assertions are about the
// workflow, not about a static payload rendering.

import { expect } from '@playwright/test';
import { test } from '../fixtures/app';
import { RECEIVING, RECEIPT_WORKSPACE, documentOverflow, openSurface, overflowingElements } from '../fixtures/surfaces';
import { SIDEBAR_BREAKPOINT } from '../fixtures/viewports';


/**
 * The row an operator can actually see, whichever rendering is on screen.
 *
 * The queue and the expected-versus-observed table are each rendered TWICE —
 * a `<table>` above `lg` and a record list below it — and only one is visible
 * at a given width. Selecting `tr` alone works on a desktop and silently
 * targets a `display: none` element on a phone, so a test written that way
 * passes at one viewport and hangs at another. `:visible` picks whichever
 * rendering this viewport is actually showing.
 */
function visibleRow(app: import('@playwright/test').Page, text: string) {
  return app.locator('tr:visible, li:visible').filter({ hasText: text }).first();
}

test.describe('the receiving queue', () => {
  test('loads through the real application bundle and states governed truth', async ({ app }) => {
    await openSurface(app, RECEIVING);

    // EXPECTED and OBSERVED are separate, labelled facts — never one number.
    await expect(app.getByText(/receivable acquisition orders/)).toBeVisible();
    await expect(app.getByText('WN-2026-000123').locator('visible=true').first()).toBeVisible();
    await expect(app.getByText('Receiving in progress').locator('visible=true').first()).toBeVisible();
  });

  test('renders a table on a desktop and records on a phone', async ({ app }) => {
    await openSurface(app, RECEIVING);
    const width = app.viewportSize()?.width ?? 0;

    // The hand-over is a CSS breakpoint, so only a real browser can prove which
    // rendering an operator actually sees.
    const table = app.locator('table');
    const records = app.getByRole('list', { name: /acquisition orders/i });
    if (width >= SIDEBAR_BREAKPOINT) {
      await expect(table).toBeVisible();
      await expect(records).toBeHidden();
    } else {
      await expect(table).toBeHidden();
      await expect(records).toBeVisible();
    }
  });

  // THE CENTRAL RULE, in a real browser.
  test('never renders a failed queue read as an empty queue', async ({ app, scenario }) => {
    await scenario.set({ receivingQueueFails: true });
    await app.goto('/receiving');
    await expect(app.getByRole('heading', { level: 1, name: 'Receiving' })).toBeVisible();

    await expect(app.getByText(/did not answer/i).locator('visible=true').first()).toBeVisible();
    await expect(app.getByText(/There is no receiving work/i)).toHaveCount(0);
    await expect(app.getByText(/counts are unavailable/i)).toBeVisible();
  });

  test('distinguishes a proven-empty queue from a failed one', async ({ app, scenario }) => {
    await scenario.set({ receivingQueueEmpty: true });
    await app.goto('/receiving');
    await expect(app.getByText(/There is no receiving work/i).locator('visible=true').first()).toBeVisible();
    await expect(app.getByText(/did not answer/i)).toHaveCount(0);
  });

  test('says a partial answer is partial', async ({ app, scenario }) => {
    await scenario.set({ receivingQueuePartial: true });
    await app.goto('/receiving');
    await expect(app.getByText(/reached its size limit/i).locator('visible=true').first()).toBeVisible();
  });

  test('offers a viewer no receiving control', async ({ app, scenario }) => {
    await scenario.set({ receivingRole: 'viewer' });
    await openSurface(app, RECEIVING);
    await expect(app.getByRole('button', { name: /open receipt/i })).toHaveCount(0);
  });

  test('opens a receiving session through a real dialog', async ({ app, scenario }) => {
    await scenario.set({ receivingRole: 'operator' });
    await openSurface(app, RECEIVING);

    await app.getByRole('button', { name: /open receipt/i }).first().click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The confirm control is genuinely inert until an arrival time exists —
    // proved by the browser's own disabled semantics, not by a class name.
    const confirm = dialog.getByRole('button', { name: /open receiving session/i });
    await expect(confirm).toBeDisabled();

    // This order has NO shipment record, and that is a supported case rather
    // than a gap: the only option offered is the contract's shipment-null path.
    const shipment = dialog.getByLabel(/associated shipment/i);
    await expect(shipment).toBeVisible();
    await expect(shipment.locator('option')).toHaveCount(1);
    await expect(shipment.locator('option')).toHaveText(/No shipment record/i);

    await dialog.getByLabel(/when did the goods arrive/i).fill('2026-07-31T09:00');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(app.getByText(/Opened receiving session|already open for this order/i)).toBeVisible();
  });

  test("offers only the order's own shipments, never a free-text identity", async ({ app, scenario }) => {
    // Cancel the in-progress session so the order that HAS a shipment offers
    // "Open receipt" rather than "Continue receiving".
    scenario.state.receiving.transition('cancelled');
    await openSurface(app, RECEIVING);

    const row = visibleRow(app, 'WN-2026-000123');
    await row.getByRole('button', { name: /open receipt/i }).click();
    const shipment = app.getByRole('dialog').getByLabel(/associated shipment/i);

    // A real select, not a text input: an operator cannot type a governed
    // identity belonging to a different order.
    await expect(shipment).toHaveJSProperty('tagName', 'SELECT');
    await expect(shipment.locator('option')).toHaveCount(2);
    await expect(shipment.locator('option').nth(1)).toHaveText(/RV-ASHP-000001/);
    // The carrier's status is labelled as the CARRIER's, never as receipt truth.
    await expect(shipment.locator('option').nth(1)).toHaveText(/carrier status: delivered/i);
  });
});

test.describe('the receipt workspace', () => {
  test('shows expected and observed as separate facts, and never clamps an overage', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);

    // The fixture records 5 observed against an expected 2. Both numbers are on
    // screen, and the overage is named rather than reduced.
    await expect(app.getByText('Graded slab lot').locator('visible=true').first()).toBeVisible();
    await expect(app.getByText(/More than expected by 3/i).locator('visible=true').first()).toBeVisible();
  });

  test('states that a carrier delivery is not receiving truth', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);
    await expect(
      app.getByText(/carrier reporting delivered does not establish that quantities were verified/i),
    ).toBeVisible();
  });

  test('records an observed quantity and the page changes after the governed refresh', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);

    const row = visibleRow(app, 'Sealed booster box');
    await row.getByRole('button', { name: /^record$/i }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // No `max` attribute: the browser itself must not refuse physical truth.
    const quantity = dialog.getByLabel(/observed quantity/i);
    await expect(quantity).not.toHaveAttribute('max', /.*/);

    await quantity.fill('9');
    // An overage is announced, and remains confirmable.
    await expect(dialog.getByText(/More than the acquisition expected/i)).toBeVisible();
    await dialog.getByRole('button', { name: /record observed quantity/i }).click();

    await expect(app.getByText(/Recorded 9 against/i)).toBeVisible();
    // The authoritative re-read now reports it, so the table does too.
    await expect(row.getByText('9').first()).toBeVisible();
  });

  test('requires a reason before a correction can be confirmed', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);

    const row = visibleRow(app, 'Graded slab lot');
    await row.getByRole('button', { name: /^correct$/i }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const confirm = dialog.getByRole('button', { name: /correct observed quantity/i });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel(/why is this being corrected/i).fill('Recount after unpacking');
    await dialog.getByLabel(/corrected observed quantity/i).fill('4');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(app.getByText(/Corrected the observed quantity to 4/i)).toBeVisible();
  });

  test('surfaces a stale correction as a refusal rather than overwriting', async ({ app, scenario }) => {
    await openSurface(app, RECEIPT_WORKSPACE);
    await scenario.set({ receivingMutationFailure: 'receipt_line_conflict' });

    const row = visibleRow(app, 'Graded slab lot');
    await row.getByRole('button', { name: /^correct$/i }).click();
    const dialog = app.getByRole('dialog');
    await dialog.getByLabel(/why is this being corrected/i).fill('Recount');
    await dialog.getByRole('button', { name: /correct observed quantity/i }).click();

    await expect(dialog.getByText(/not the one this screen was showing/i)).toBeVisible();
    // The confirmation stays open so the operator decides again.
    await expect(dialog).toBeVisible();
  });

  test('cancels with a reason, and presents cancellation as preserved evidence', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);

    await app.getByRole('button', { name: /cancel receiving session/i }).first().click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/PRESERVED as history and is not deleted/i)).toBeVisible();

    const confirm = dialog.getByRole('button', { name: /^cancel receiving session$/i });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/why is this session being cancelled/i).fill('Wrong pallet opened');
    await confirm.click();

    await expect(app.getByText(/preserved as history/i).first()).toBeVisible();
    // Terminal: the receipt can no longer be operated.
    await expect(app.getByRole('button', { name: /submit receipt/i })).toHaveCount(0);
  });

  test('submission explains the freeze AND denies reconciliation', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);

    await app.getByRole('button', { name: /submit receipt/i }).first().click();
    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText(/freezes the observed quantities/i).first()).toBeVisible();
    await expect(dialog.getByText(/create any inventory/i)).toBeVisible();
    await expect(dialog.getByText(/owner reconciliation is complete/i)).toBeVisible();
    await expect(dialog.getByText(/establish a cost basis/i)).toBeVisible();

    await dialog.getByRole('button', { name: /^submit receipt$/i }).click();
    await expect(app.getByText(/No inventory was created/i)).toBeVisible();
    await expect(app.getByText(/awaiting review/i).first()).toBeVisible();
  });

  test('exposes none of the Batch 2 surface', async ({ app }) => {
    await openSurface(app, RECEIPT_WORKSPACE);
    for (const forbidden of [/link inventory/i, /unlink/i, /raise discrepancy/i, /reconcile/i]) {
      await expect(app.getByText(forbidden)).toHaveCount(0);
    }
  });
});

test.describe('receiving geometry', () => {
  for (const surface of [RECEIVING, RECEIPT_WORKSPACE]) {
    test(`${surface.name} does not overflow horizontally`, async ({ app }) => {
      await openSurface(app, surface);
      const { scrollWidth, clientWidth } = await documentOverflow(app);
      const offenders = scrollWidth - clientWidth > 1 ? await overflowingElements(app) : [];
      expect(
        scrollWidth - clientWidth,
        `${surface.name} overflows by ${scrollWidth - clientWidth}px: ${offenders.join(' | ')}`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test('a governed dialog stays inside the viewport on a phone', async ({ app }) => {
    test.skip((app.viewportSize()?.width ?? 0) >= SIDEBAR_BREAKPOINT, 'phone and tablet-portrait only');
    await openSurface(app, RECEIPT_WORKSPACE);
    await app.getByRole('button', { name: /submit receipt/i }).first().click();
    await expect(app.getByRole('dialog')).toBeVisible();

    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(scrollWidth - clientWidth, 'an open receiving dialog must not widen the page').toBeLessThanOrEqual(1);
  });
});

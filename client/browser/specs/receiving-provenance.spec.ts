// S2.3 Batch 2 — inventory provenance, discrepancies and owner reconciliation,
// proved in a real browser.
//
// The world these tests drive is STATEFUL: linking really adds a link, unlinking
// really removes one, raising a discrepancy really creates a record, and
// reconciliation really enforces the governed preconditions. So an assertion
// that the page changed after a press is an assertion about the workflow, not
// about a static payload rendering.
//
// The dangerous case has its own scenario: a discrepancy request that COMMITS
// and then loses its response. That is the only way to prove the verify-first
// recovery protects against a duplicate, rather than merely describing it.

import { expect } from '@playwright/test';
import { test } from '../fixtures/app';
import { RECEIPT_WORKSPACE, RECEIVING, documentOverflow, openSurface, overflowingElements } from '../fixtures/surfaces';

/** Whichever rendering this viewport is actually showing. */
function visibleRow(app: import('@playwright/test').Page, text: string) {
  return app.locator('tr:visible, li:visible').filter({ hasText: text }).first();
}

const provenance = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Inventory provenance' });
const discrepancies = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Receiving discrepancies' });

/** Submit the receipt so linking becomes possible, as the contract requires. */
async function submitted(app: import('@playwright/test').Page, scenario: { state: { receiving: { transition: (s: 'submitted') => unknown } } }) {
  scenario.state.receiving.transition('submitted');
  await openSurface(app, RECEIPT_WORKSPACE);
}

test.describe('inventory provenance on a submitted receipt', () => {
  test('linking is offered only after submission', async ({ app, scenario }) => {
    await openSurface(app, RECEIPT_WORKSPACE);
    await expect(provenance(app).getByRole('button', { name: /link inventory/i })).toHaveCount(0);
    await expect(provenance(app).getByText(/linking begins after submission/i)).toBeVisible();

    await submitted(app, scenario);
    await expect(provenance(app).getByRole('button', { name: /link inventory/i }).first()).toBeVisible();
  });

  test('states observed, linked and remaining as separate facts', async ({ app, scenario }) => {
    await submitted(app, scenario);
    const panel = provenance(app);
    await expect(panel.getByText('Observed').first()).toBeVisible();
    await expect(panel.getByText('Linked').first()).toBeVisible();
    await expect(panel.getByText('Still needs a subject').first()).toBeVisible();
    await expect(panel.getByText('5 received, 0 linked, 5 still needs an inventory subject.')).toBeVisible();
    // Never the wrong sentence.
    await expect(app.getByText(/missing inventory/i)).toHaveCount(0);
  });

  test('links a lot-managed subject with an editable quantity', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();

    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('option', { name: /RV-ILOT-000001/ }).waitFor({ state: 'attached' });
    await dialog.getByLabel(/^Inventory subject/).selectOption('RV-ILOT-000001');

    // The remainder is a DEFAULT, and it is genuinely editable.
    const quantity = dialog.getByLabel(/quantity to attribute/i);
    await expect(quantity).toHaveValue('5');
    await expect(dialog.getByText(/recorded by inventory, not chosen here/i)).toBeVisible();
    await quantity.fill('3');
    await dialog.getByRole('button', { name: /^link to inventory$/i }).click();

    await expect(app.getByText(/Linked RV-ALIN-0002/)).toBeVisible();
    // The authoritative re-read now reports it.
    await expect(provenance(app).getByText('5 received, 3 linked, 2 still needs an inventory subject.'))
      .toBeVisible();
    await expect(provenance(app).getByText('Lot-managed lot')).toBeVisible();
  });

  test('links a serialized item as exactly one unit, with no quantity field', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();

    const dialog = app.getByRole('dialog');
    await dialog.getByRole('option', { name: /RV-IITM-000001/ }).waitFor({ state: 'attached' });
    await dialog.getByLabel(/^Inventory subject/).selectOption('RV-IITM-000001');

    await expect(dialog.getByLabel(/quantity to attribute/i)).toHaveCount(0);
    await expect(dialog.getByText(/exactly one unit/i)).toBeVisible();
    await expect(dialog.getByText(/5 separate items/i)).toBeVisible();
    await dialog.getByRole('button', { name: /^link to inventory$/i }).click();

    await expect(provenance(app).getByText('Serialized item')).toBeVisible();
    await expect(provenance(app).getByText('5 received, 1 linked, 4 still needs an inventory subject.'))
      .toBeVisible();
  });

  test('a bounded over-capacity refusal stays bounded', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();

    const dialog = app.getByRole('dialog');
    await dialog.getByRole('option', { name: /RV-ILOT-000001/ }).waitFor({ state: 'attached' });
    await dialog.getByLabel(/^Inventory subject/).selectOption('RV-ILOT-000001');
    await dialog.getByLabel(/quantity to attribute/i).fill('99');
    await dialog.getByRole('button', { name: /^link to inventory$/i }).click();

    await expect(dialog.getByText(/more units than this receipt line observed/i)).toBeVisible();
    // No schema detail reaches the operator.
    await expect(app.getByText(/constraint|relation|pg_|null value/i)).toHaveCount(0);
  });

  test('sends the operator to governed creation when nothing matches', async ({ app, scenario }) => {
    await scenario.set({ receivingSubjectsEmpty: true });
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();

    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/does not create Products/i)).toBeVisible();
    await expect(dialog.getByRole('link', { name: /add inventory/i })).toBeVisible();
  });
});

test.describe('wrong-link recovery', () => {
  test('requires a reason and never presents itself as deleting inventory', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();
    let dialog = app.getByRole('dialog');
    await dialog.getByRole('option', { name: /RV-ILOT-000001/ }).waitFor({ state: 'attached' });
    await dialog.getByLabel(/^Inventory subject/).selectOption('RV-ILOT-000001');
    await dialog.getByRole('button', { name: /^link to inventory$/i }).click();
    await expect(provenance(app).getByRole('button', { name: /remove link/i })).toBeVisible();

    await provenance(app).getByRole('button', { name: /remove link/i }).click();
    dialog = app.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: /^remove inventory link$/i });
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByText(/does NOT delete the inventory lot or item/i)).toBeVisible();
    await expect(dialog.getByText(/does NOT rewrite acquisition evidence/i)).toBeVisible();

    await dialog.getByLabel(/why is this link being removed/i).fill('Attributed to the wrong lot');
    await confirm.click();
    await expect(app.getByText(/inventory subject itself was not deleted/i)).toBeVisible();
    // The link is genuinely gone from the authoritative read.
    await expect(provenance(app).getByText('5 received, 0 linked, 5 still needs an inventory subject.'))
      .toBeVisible();
  });
});

test.describe('discrepancies', () => {
  test('records one, and shows kind and status as words', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await discrepancies(app).getByRole('button', { name: /record a discrepancy/i }).click();

    const dialog = app.getByRole('dialog');
    await expect(dialog.getByLabel(/what kind of discrepancy/i).locator('option')).toHaveCount(7);
    await dialog.getByLabel(/what kind of discrepancy/i).selectOption('over_shipped');
    await dialog.getByLabel(/what did you observe/i).fill('Two extra units in the box');
    await dialog.getByRole('button', { name: /^record discrepancy$/i }).click();

    await expect(discrepancies(app).getByText('Over shipped')).toBeVisible();
    await expect(discrepancies(app).getByText('Open')).toBeVisible();
    await expect(discrepancies(app).getByText('Two extra units in the box')).toBeVisible();
  });

  // THE DANGEROUS CASE: the request committed, then the response was lost.
  test('does not blindly retry after an unknown outcome, and finds the record', async ({ app, scenario }) => {
    await scenario.set({ receivingDiscrepancyCommitsSilently: true });
    await submitted(app, scenario);
    await discrepancies(app).getByRole('button', { name: /record a discrepancy/i }).click();

    const dialog = app.getByRole('dialog');
    await dialog.getByLabel(/what kind of discrepancy/i).selectOption('over_shipped');
    await dialog.getByLabel(/what did you observe/i).fill('Two extra units in the box');
    await dialog.getByRole('button', { name: /^record discrepancy$/i }).click();

    await expect(app.getByText(/may or may not have been created/i)).toBeVisible();
    // No retry control exists, and the false guarantee is never printed.
    await expect(app.getByRole('button', { name: /^retry$|try again/i })).toHaveCount(0);
    await expect(app.getByText(/nothing was sent/i)).toHaveCount(0);
    await expect(discrepancies(app).getByRole('button', { name: /record a discrepancy/i })).toHaveCount(0);

    // Verification finds the record the lost response concealed.
    await app.getByRole('button', { name: /check what is on record/i }).click();
    await expect(app.getByText(/It was not recorded twice/i)).toBeVisible();
    // Exactly ONE discrepancy exists — the duplicate never happened.
    await expect(discrepancies(app).locator('[data-discrepancy]')).toHaveCount(1);
  });

  test('an operator may claim but not resolve or write off', async ({ app, scenario }) => {
    await submitted(app, scenario);
    scenario.state.receiving.raise({ kind: 'damaged', detail: 'Crushed corner', receiptPublicId: null });
    await app.reload();
    await RECEIPT_WORKSPACE.settled(app);

    await expect(discrepancies(app).getByRole('button', { name: /claim for review/i })).toBeVisible();
    await expect(discrepancies(app).getByRole('button', { name: /^resolve$/i })).toHaveCount(0);
    await expect(discrepancies(app).getByRole('button', { name: /^write off$/i })).toHaveCount(0);

    await discrepancies(app).getByRole('button', { name: /claim for review/i }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/does NOT/)).toBeVisible();
    await dialog.getByRole('button', { name: /^claim for review$/i }).click();
    await expect(discrepancies(app).getByText('Claimed for review')).toBeVisible();
  });

  test('an owner resolves and writes off, each with a required note', async ({ app, scenario }) => {
    await scenario.set({ receivingRole: 'owner' });
    await submitted(app, scenario);
    scenario.state.receiving.raise({ kind: 'damaged', detail: 'Crushed corner', receiptPublicId: null });
    await app.reload();
    await RECEIPT_WORKSPACE.settled(app);

    await discrepancies(app).getByRole('button', { name: /^resolve$/i }).click();
    let dialog = app.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: /^resolve discrepancy$/i })).toBeDisabled();
    await expect(dialog.getByText(/is PRESERVED/i)).toBeVisible();
    await dialog.getByLabel(/resolution note/i).fill('Supplier credited the difference');
    await dialog.getByRole('button', { name: /^resolve discrepancy$/i }).click();
    await expect(discrepancies(app).getByText('Resolved')).toBeVisible();
    await expect(discrepancies(app).getByText('Supplier credited the difference')).toBeVisible();
    await expect(discrepancies(app).getByText(/original evidence above is preserved/i)).toBeVisible();

    // A second discrepancy, written off.
    scenario.state.receiving.raise({ kind: 'wrong_item', detail: 'Wrong set entirely', receiptPublicId: null });
    await app.reload();
    await RECEIPT_WORKSPACE.settled(app);
    await discrepancies(app).getByRole('button', { name: /^write off$/i }).click();
    dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/without claiming the expected and observed evidence became equal/i))
      .toBeVisible();
    await dialog.getByLabel(/write-off note/i).fill('Not worth pursuing');
    await dialog.getByRole('button', { name: /^write off discrepancy$/i }).click();
    await expect(discrepancies(app).getByText('Written off')).toBeVisible();
  });
});

test.describe('owner reconciliation', () => {
  test('is offered to an owner only', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await expect(app.getByRole('button', { name: /reconcile receipt/i })).toHaveCount(0);

    await scenario.set({ receivingRole: 'owner' });
    await app.reload();
    await RECEIPT_WORKSPACE.settled(app);
    await expect(app.getByRole('button', { name: /reconcile receipt/i })).toBeVisible();
  });

  test('shows the blockers before the press, and the governed refusal stands', async ({ app, scenario }) => {
    await scenario.set({ receivingRole: 'owner' });
    await submitted(app, scenario);

    // The overage has no Over shipped evidence yet, and nothing is linked.
    await expect(app.getByText(/Observed receiving exceeds the acquisition quantity/i)).toBeVisible();
    await expect(app.getByText(/Record an Over shipped discrepancy before owner reconciliation/i))
      .toBeVisible();

    await app.getByRole('button', { name: /reconcile receipt/i }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/only 0 linked/i)).toBeVisible();
    await expect(dialog.getByText(/An overage has no Over shipped discrepancy/i)).toBeVisible();

    // The server refuses anyway, and the refusal is bounded.
    await dialog.getByRole('button', { name: /^reconcile receipt$/i }).click();
    await expect(dialog.getByText(/every receipt line must be linked/i)).toBeVisible();
  });

  test('succeeds once links and overage evidence are complete, and becomes terminal', async ({ app, scenario }) => {
    await scenario.set({ receivingRole: 'owner' });
    const world = scenario.state.receiving;
    world.transition('submitted');
    // Fully linked, and the overage carries its required evidence.
    world.link('RV-ARL-000002', { inventoryLotPublicId: 'RV-ILOT-000001', quantity: 5 });
    world.raise({
      kind: 'over_shipped', detail: 'Three extra units', receiptPublicId: 'RV-ARCPT-000001',
      receiptLinePublicId: 'RV-ARL-000002',
    });
    await openSurface(app, RECEIPT_WORKSPACE);

    await app.getByRole('button', { name: /reconcile receipt/i }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/provenance links become immutable/i)).toBeVisible();
    await expect(dialog.getByText(/a cost basis has been calculated/i)).toBeVisible();
    await dialog.getByRole('button', { name: /^reconcile receipt$/i }).click();

    await expect(app.getByText(/No cost basis was calculated/i)).toBeVisible();
    // Terminal: every mutation control is gone, provenance remains visible.
    for (const name of [
      /reconcile receipt/i, /link inventory/i, /remove link/i,
      /submit receipt/i, /cancel receiving session/i,
    ]) {
      await expect(app.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(provenance(app).getByText(/provenance is now immutable/i)).toBeVisible();
  });
});

test.describe('Batch 2 geometry and reporting', () => {
  test('never arrived is reported from the queue with no receipt', async ({ app }) => {
    await openSurface(app, RECEIVING);
    await visibleRow(app, 'WN-2026-000124').getByRole('button', { name: /nothing arrived/i }).click();

    const dialog = app.getByRole('dialog');
    await expect(dialog.getByText(/No receipt — this concerns the order itself/i)).toBeVisible();
    await expect(dialog.getByLabel(/what kind of discrepancy/i).locator('option')).toHaveCount(2);
    await dialog.getByLabel(/what did you observe/i).fill('Tracking says delivered, nothing at the door');
    await dialog.getByRole('button', { name: /^record discrepancy$/i }).click();
    await expect(app.getByText(/No receipt was created, because nothing arrived/i)).toBeVisible();
  });

  test('a submitted receipt does not overflow horizontally', async ({ app, scenario }) => {
    await submitted(app, scenario);
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    const offenders = scrollWidth - clientWidth > 1 ? await overflowingElements(app) : [];
    expect(
      scrollWidth - clientWidth,
      `submitted receipt overflows by ${scrollWidth - clientWidth}px: ${offenders.join(' | ')}`,
    ).toBeLessThanOrEqual(1);
  });

  test('an open linking dialog does not widen the page', async ({ app, scenario }) => {
    await submitted(app, scenario);
    await provenance(app).getByRole('button', { name: /link inventory/i }).first().click();
    await expect(app.getByRole('dialog')).toBeVisible();
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1);
  });
});

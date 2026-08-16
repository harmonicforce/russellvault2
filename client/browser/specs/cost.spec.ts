// S2.5 Batch 1 — governed cost allocation, proved in a real browser.
//
// The world these tests drive is STATEFUL: proposing really writes candidate
// rows, confirming really turns them into a basis, reversing really retains
// them as history, and every governed refusal is really raised. So an assertion
// that the page changed after a press is an assertion about the workflow, not
// about a static payload rendering.
//
// TWO CASES HAVE THEIR OWN SCENARIOS, because they are the ones that matter:
//
//   * a proposal that COMMITS and then loses its response — the only way to
//     prove the verify-first recovery protects against acting on a proposal
//     that cannot be withdrawn;
//   * a failed queue read — the only way to prove a workspace whose costs are
//     unreadable never renders as a workspace whose costs are attributed.

import { expect } from '@playwright/test';
import { test } from '../fixtures/app';
import { COST, COST_COMPONENT, documentOverflow, openSurface, overflowingElements } from '../fixtures/surfaces';
import { SHIPPING_COMPONENT } from '../fixtures/costData';

/**
 * A row of the COMPONENT list, in whichever rendering this viewport shows.
 *
 * Scoped to that list on purpose. S2.6 added the unresolved-cost queue to the
 * same page, and its entries are `li`s that legitimately name the same
 * component public ids — an unscoped `li:visible` would resolve to a triage
 * entry and quietly assert against the wrong surface.
 */
function visibleRow(app: import('@playwright/test').Page, text: string) {
  return app
    .locator('tr:visible, ul[aria-label="Governed cost components"] > li:visible')
    .filter({ hasText: text })
    .first();
}

const proposedPanel = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Proposed split' });
const basisPanel = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Confirmed cost basis' });

test.describe('the cost queue', () => {
  test('states every component and where it stands', async ({ app }) => {
    await openSurface(app, COST);
    await expect(visibleRow(app, 'RV-ACOST-SHIP01')).toContainText('Shared, not yet split');
    await expect(visibleRow(app, 'RV-ACOST-PRC001')).toContainText('Directly attributed');
    await expect(visibleRow(app, 'RV-ACOST-TAX001')).toContainText('Amount not known');
  });

  // THE LOAD-BEARING TRUTH RULE, IN A REAL BROWSER.
  test('shows a cost the source never priced as words, never as a currency zero', async ({ app }) => {
    await openSurface(app, COST);
    const row = visibleRow(app, 'RV-ACOST-TAX001');
    await expect(row).toContainText('Not reported');
    await expect(row).not.toContainText('0.00');
  });

  // A documented zero is a DIFFERENT fact and must not look the same. The
  // shipping component has a real amount, so a real figure is expected there.
  test('shows a known amount as an exact figure with its currency', async ({ app }) => {
    await openSurface(app, COST);
    await expect(visibleRow(app, 'RV-ACOST-SHIP01')).toContainText('10.00 USD');
  });

  test('explains why there is no headline total anywhere on the page', async ({ app }) => {
    await openSurface(app, COST);
    await expect(app.getByText('There is no total on this page, on purpose')).toBeVisible();
    await expect(app.getByText(/different currencies/i)).toBeVisible();
  });

  // A FAILED RETRIEVAL IS NEVER A ZERO, and never an empty list.
  test('never renders a failed read as a workspace with no costs', async ({ app, scenario }) => {
    await scenario.set({ costQueueFails: true });
    await app.goto('/cost');
    await expect(app.getByRole('heading', { level: 1, name: 'Cost allocation' })).toBeVisible();
    await expect(app.getByText(/No governed cost components/i)).toHaveCount(0);
    // `:visible` deliberately. Both renderings are mounted at every width and
    // one of them is `display: none`, so an unqualified `.first()` resolves to
    // whichever copy this viewport happens to be hiding.
    await expect(app.locator('[role="alert"]:visible').first()).toBeVisible();
  });

  test('says the counts are of a subset when the answer was cut short', async ({ app, scenario }) => {
    await scenario.set({ costQueuePartial: true });
    await openSurface(app, COST);
    await expect(app.getByText(/not the whole picture/i)).toBeVisible();
  });

  test('does not overflow horizontally', async ({ app }, testInfo) => {
    await openSurface(app, COST);
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(
      scrollWidth,
      `${testInfo.project.name}: widest offenders ${(await overflowingElements(app)).join(' | ')}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe('one cost component', () => {
  test('says plainly that no cost basis exists yet', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await expect(app.getByText(/is NOT a cost basis for any line/i)).toBeVisible();
    await expect(basisPanel(app).getByText(/not a cost basis for any/i)).toBeVisible();
  });

  test('shows a line with no known direct cost as having none, not as zero', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    const line = app.locator('[data-scope-line="RV-AL-000002"]');
    await expect(line).toContainText('None recorded');
    await expect(line).not.toContainText('Known direct cost 0.00');
  });

  test('does not overflow horizontally', async ({ app }, testInfo) => {
    await openSurface(app, COST_COMPONENT);
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(
      scrollWidth,
      `${testInfo.project.name}: widest offenders ${(await overflowingElements(app)).join(' | ')}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe('proposing a split', () => {
  // Copy corrected in Batch 2: withdrawal now EXISTS, so claiming it does not
  // would be false. It is still a governed act with a permanent record rather
  // than an undo, and the warning says which.
  test('warns that a proposal is durable and that withdrawal is not an undo', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await expect(app.getByText('A proposal is durable and cannot be edited')).toBeVisible();
    await expect(app.getByRole('dialog').getByText(/not an undo/i)).toBeVisible();
    await expect(app.getByText(/no way to delete a proposed split/i)).toHaveCount(0);
  });

  test('computes an exact split on the server and sends what was displayed', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/By quantity/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();

    // 3 : 1 of 10.00 → 7.50 : 2.50, exactly.
    await expect(app.locator('[data-share-for="RV-AL-000001"]')).toContainText('7.50 USD');
    await expect(app.locator('[data-share-for="RV-AL-000002"]')).toContainText('2.50 USD');
    await expect(app.locator('[data-conservation]')).toHaveAttribute('data-conservation', 'balanced');

    await app.getByRole('button', { name: /Propose this split/i }).click();
    await expect(app.getByText(/A split of 2 lines was proposed/i)).toBeVisible();
    // And the page now shows a real, durable proposal.
    await expect(proposedPanel(app).getByText('RV-ACALLOC-000001')).toBeVisible();
  });

  // A PROPOSAL IS NOT A BASIS. The distinction is carried in words, every time.
  test('never describes a pending proposal as a cost basis', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/By quantity/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();
    await app.getByRole('button', { name: /Propose this split/i }).click();

    await expect(proposedPanel(app).getByText('RV-ACALLOC-000001')).toBeVisible();
    await expect(proposedPanel(app).getByText(/NOT a cost basis/i).first()).toBeVisible();
    await expect(proposedPanel(app).getByText(/Not reviewed — a proposal is not a cost basis/i).first())
      .toBeVisible();
    await expect(basisPanel(app).getByText(/No confirmed allocation exists/i)).toBeVisible();
  });

  // THE DEAD-END GUARD, IN A REAL BROWSER. A split that does not add up is
  // refused before it is sent, with the exact difference stated.
  test('refuses a hand-entered split that does not add up, and says by how much', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/Entered by hand/i).check();
    await app.getByLabel(/Amount for RV-AL-000001/i).fill('7.50');
    await app.getByLabel(/Amount for RV-AL-000002/i).fill('2.10');

    await expect(app.locator('[data-conservation]')).toHaveAttribute('data-conservation', 'out_of_balance');
    await expect(app.locator('[data-conservation]')).toContainText('0.40 USD less');
    await expect(app.getByRole('button', { name: /Propose this split/i })).toBeDisabled();

    // Correcting it unlocks the control.
    await app.getByLabel(/Amount for RV-AL-000002/i).fill('2.50');
    await expect(app.getByRole('button', { name: /Propose this split/i })).toBeEnabled();
  });

  // Half a cent is not something the ledger holds. Refused, not rounded.
  test('refuses more precision than the currency has rather than rounding it', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/Entered by hand/i).check();
    await app.getByLabel(/Amount for RV-AL-000001/i).fill('7.505');
    await expect(app.getByText(/not an amount USD can hold exactly/i)).toBeVisible();
    await expect(app.getByText(/It was not rounded to fit/i)).toBeVisible();
  });

  // THE ANTI-FABRICATION CASE. No line in the chosen set has a known direct
  // cost, so a value-weighted split has no basis and the server refuses. The
  // page must show the refusal and invent nothing.
  test('refuses a value split with no value basis instead of splitting evenly', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    // Narrow to the line that has no known direct cost.
    await app.getByLabel(/Include RV-AL-000001 in the split/i).uncheck();
    await app.getByLabel(/By known value/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();

    await expect(app.getByText(/None of the lines in scope has a known direct cost/i)).toBeVisible();
    await expect(app.getByText(/was NOT invented from an even share/i)).toBeVisible();
    await expect(app.locator('[data-share-for="RV-AL-000002"]')).toHaveCount(0);
  });

  test('refuses a second proposal while one is pending, and says why', async ({ app, scenario }) => {
    scenario.state.cost.propose('manual_equal', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '500' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '500' },
    ]);
    await openSurface(app, COST_COMPONENT);
    // The control is not offered at all, because the component is no longer
    // awaiting a proposal. The refusal is the governed state, not a surprise.
    await expect(app.getByRole('button', { name: /^Propose a split$/i })).toHaveCount(0);
    await expect(proposedPanel(app).getByText('RV-ACALLOC-000001')).toBeVisible();
  });
});

// --- the verify-first recovery ----------------------------------------------

test.describe('a proposal that commits and then loses its response', () => {
  test('locks proposing, never claims nothing was sent, and proves what happened', async ({ app, scenario }) => {
    await scenario.set({ costProposalCommitsSilently: true });
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/By quantity/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();
    await app.getByRole('button', { name: /Propose this split/i }).click();

    // The outcome is unknown, and the page says exactly that.
    await expect(app.getByText('It is unknown whether the split was recorded')).toBeVisible();
    await expect(app.getByText(/nothing was sent/i)).toHaveCount(0);
    // Proposing is LOCKED. There is no second attempt to make.
    await expect(app.getByRole('button', { name: /^Propose a split$/i })).toHaveCount(0);

    // The verification reads the governed record, which DID receive the write.
    await scenario.set({ costProposalCommitsSilently: false });
    await app.getByRole('button', { name: /Check what is on record/i }).click();
    await expect(app.getByText('The split did reach the database')).toBeVisible();
    await expect(app.getByText(/It was not recorded twice/i)).toBeVisible();
    // Exactly ONE proposal exists — a blind retry would have made a second.
    await expect(proposedPanel(app).locator('[data-allocation]')).toHaveCount(2);
  });

  // A FAILED VERIFICATION IS NOT AN ABSENCE.
  test('stays locked when verification itself fails', async ({ app, scenario }) => {
    await scenario.set({ costProposalCommitsSilently: true });
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await app.getByLabel(/By quantity/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();
    await app.getByRole('button', { name: /Propose this split/i }).click();
    await expect(app.getByText('It is unknown whether the split was recorded')).toBeVisible();

    await scenario.set({ costComponentReadFails: true });
    await app.getByRole('button', { name: /Check what is on record/i }).click();
    await expect(app.getByText('It is still unknown whether the split was recorded')).toBeVisible();
    await expect(app.getByText(/Proposing is still locked/i)).toBeVisible();
    await expect(app.getByRole('button', { name: /^Propose a split$/i })).toHaveCount(0);
  });
});

// --- confirming and reversing ------------------------------------------------

test.describe('confirming and reversing', () => {
  async function withPendingProposal(
    app: import('@playwright/test').Page,
    scenario: { state: { cost: { propose: (m: string, a: readonly { sourceSystemPublicId: string; acquisitionLinePublicId: string; amountMinor: string }[]) => unknown } } },
  ) {
    scenario.state.cost.propose('manual_quantity', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
    ]);
    await openSurface(app, COST_COMPONENT);
  }

  test('confirming turns a proposal into a cost basis and says so', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Confirm this split as the cost basis/i }).click();
    await expect(app.getByText(/independently verifies/i)).toBeVisible();
    await app.getByRole('button', { name: /Confirm the cost basis/i }).click();

    await expect(app.getByText(/are now the governed cost basis/i)).toBeVisible();
    await expect(basisPanel(app).locator('[data-allocation]')).toHaveCount(2);
    await expect(proposedPanel(app).getByText(/no proposed split/i)).toBeVisible();
  });

  test('reversing retracts the basis and keeps the rows as history', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Confirm this split as the cost basis/i }).click();
    await app.getByRole('button', { name: /Confirm the cost basis/i }).click();
    await expect(basisPanel(app).locator('[data-allocation]')).toHaveCount(2);

    await app.getByRole('button', { name: /Reverse this allocation/i }).click();
    await expect(app.getByText(/Nothing is deleted/i)).toBeVisible();
    // A reason is REQUIRED. Until one is given the control stays disabled.
    await expect(app.getByRole('button', { name: /Reverse the allocation/i })).toBeDisabled();
    await app.getByLabel(/Why is this allocation being reversed/i)
      .fill('Shipping was billed to the wrong order');
    await app.getByRole('button', { name: /Reverse the allocation/i }).click();

    await expect(app.getByText(/kept as history/i)).toBeVisible();
    await expect(app.getByText(/nothing was deleted/i)).toBeVisible();
    // The rows SURVIVE, in their own section.
    await expect(app.getByRole('region', { name: 'Reversed allocations' })
      .locator('[data-allocation]')).toHaveCount(2);
  });
});

// --- capability --------------------------------------------------------------

test.describe('capability comes from the server', () => {
  test('offers a viewer no mutation control at all', async ({ app, scenario }) => {
    scenario.state.cost.propose('manual_quantity', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
    ]);
    await scenario.set({ costRole: 'viewer' });
    await openSurface(app, COST_COMPONENT);

    await expect(app.getByRole('button', { name: /^Propose a split$/i })).toHaveCount(0);
    await expect(app.getByRole('button', { name: /Confirm this split/i })).toHaveCount(0);
    await expect(app.getByRole('button', { name: /Reverse this allocation/i })).toHaveCount(0);
    // And a viewer still SEES the governed record. Read access is not the
    // thing being withheld.
    await expect(proposedPanel(app).getByText('RV-ACALLOC-000001')).toBeVisible();
  });
});

// === S2.5 Batch 2 ============================================================

/**
 * The DERIVED basis region.
 *
 * Named apart from `basisPanel` above, which is the CONFIRMED COST BASIS
 * evidence region. Two different things, two different names — collapsing them
 * in the harness would be the same mistake the UI is designed to avoid.
 */
const derivedBasis = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Derived inventory cost basis' });

/** Put a real pending proposal on the component. */
async function withPendingProposal(
  app: import('@playwright/test').Page,
  scenario: { state: { cost: { propose: (m: string, a: readonly { sourceSystemPublicId: string; acquisitionLinePublicId: string; amountMinor: string }[]) => unknown } } },
) {
  scenario.state.cost.propose('manual_quantity', [
    { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
    { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
  ]);
  await openSurface(app, COST_COMPONENT);
}

test.describe('withdrawing a pending proposal', () => {
  test('requires a reason and never calls itself a deletion', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();

    await expect(app.getByText(/It is NOT a deletion/i)).toBeVisible();
    await expect(app.getByRole('button', { name: /Withdraw the proposal/i })).toBeDisabled();

    await app.getByLabel(/Why is this proposal being withdrawn/i)
      .fill('The weighting used quantity instead of value');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();

    await expect(app.getByText(/were NOT deleted/i).first()).toBeVisible();
    await expect(app.getByText(/remain on record as history/i).first()).toBeVisible();
  });

  test('keeps the withdrawn rows visible as history', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();

    const history = app.getByRole('region', { name: 'Withdrawn proposals' });
    await expect(history.locator('[data-allocation]')).toHaveCount(2);
    await expect(history.getByText('RV-ACALLOC-000001')).toBeVisible();
    await expect(history.getByText(/never became a cost basis/i).first()).toBeVisible();
  });

  // The recovery Batch 1 could not offer: a corrected split after withdrawal.
  test('permits a corrected proposal once the old one is withdrawn', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();
    await expect(app.getByText(/were NOT deleted/i).first()).toBeVisible();

    // A NEW proposal, not an edit of the old one.
    await app.getByRole('button', { name: /^Propose a split$/i }).click();
    await app.getByLabel(/By known value/i).check();
    await app.getByRole('button', { name: /Compute the split/i }).click();
    await app.getByRole('button', { name: /Propose this split/i }).click();
    await expect(app.getByText(/A split of 2 lines was proposed/i)).toBeVisible();
    // And the withdrawn history survives the new proposal.
    await expect(app.getByRole('region', { name: 'Withdrawn proposals' })
      .locator('[data-allocation]')).toHaveCount(2);
  });

  test('offers a viewer no withdrawal control at all', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costRole: 'viewer' });
    await openSurface(app, COST_COMPONENT);
    await expect(app.getByRole('button', { name: /Withdraw this proposal/i })).toHaveCount(0);
    // And still SEES the proposal. Read access is not what is withheld.
    await expect(proposedPanel(app).getByText('RV-ACALLOC-000001')).toBeVisible();
  });

  test('offers an operator the withdrawal control', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costRole: 'operator' });
    await openSurface(app, COST_COMPONENT);
    await expect(app.getByRole('button', { name: /Withdraw this proposal/i })).toBeVisible();
  });
});

test.describe('a withdrawal that commits and then loses its response', () => {
  test('locks withdrawal, never claims nothing was sent, and proves what happened', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costWithdrawalCommitsSilently: true });

    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();

    await expect(app.getByText('It is unknown whether the proposal was withdrawn')).toBeVisible();
    await expect(app.getByText(/nothing was sent/i)).toHaveCount(0);
    await expect(app.getByRole('button', { name: /^Withdraw this proposal$/i })).toHaveCount(0);

    await scenario.set({ costWithdrawalCommitsSilently: false });
    await app.getByRole('button', { name: /Check what is on record/i }).click();
    await expect(app.getByText('The proposal was withdrawn')).toBeVisible();
    // Exactly two rows, withdrawn once — a blind retry would have been refused.
    await expect(app.getByRole('region', { name: 'Withdrawn proposals' })
      .locator('[data-allocation]')).toHaveCount(2);
  });

  // THE CONCURRENT-CONFIRM CASE.
  test('reports a confirmation winning the race, never as a withdrawal', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costConfirmWinsTheRace: true });

    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();
    await expect(app.getByText('It is unknown whether the proposal was withdrawn')).toBeVisible();

    await scenario.set({ costConfirmWinsTheRace: false });
    await app.getByRole('button', { name: /Check what is on record/i }).click();

    await expect(app.getByText('The proposal was CONFIRMED, not withdrawn')).toBeVisible();
    await expect(app.getByText(/now the governed cost basis/i)).toBeVisible();
    await expect(app.getByText(/reverse it rather than withdrawing it/i)).toBeVisible();
    // And it must never claim the withdrawal landed.
    await expect(app.getByText('The proposal was withdrawn')).toHaveCount(0);
  });

  test('stays locked when verification itself fails', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costWithdrawalCommitsSilently: true });
    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();
    await expect(app.getByText('It is unknown whether the proposal was withdrawn')).toBeVisible();

    await scenario.set({ costComponentReadFails: true });
    await app.getByRole('button', { name: /Check what is on record/i }).click();
    await expect(app.getByText('It is still unknown whether the proposal was withdrawn')).toBeVisible();
    await expect(app.getByRole('button', { name: /^Withdraw this proposal$/i })).toHaveCount(0);
  });
});

test.describe('the derived basis refresh', () => {
  test('reports a successful recompute beside the allocation result', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await app.getByRole('button', { name: /Confirm this split as the cost basis/i }).click();
    await app.getByRole('button', { name: /Confirm the cost basis/i }).click();

    await expect(app.getByText(/are now the governed cost basis/i)).toBeVisible();
    await expect(app.getByText(/recomputed by algorithm 1\.1\.0/i)).toBeVisible();
  });

  // THE LOAD-BEARING TRUTH RULE, IN A REAL BROWSER.
  test('never relabels a committed allocation as failed when the recompute fails', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costRecomputeFails: true });
    await app.getByRole('button', { name: /Confirm this split as the cost basis/i }).click();
    await app.getByRole('button', { name: /Confirm the cost basis/i }).click();

    // The allocation is reported as the success it was …
    await expect(app.getByText(/are now the governed cost basis/i)).toBeVisible();
    // … and the basis refresh as the separate failure it was.
    await expect(app.getByText(/The allocation change is recorded; the derived basis was not refreshed/i))
      .toBeVisible();
    await expect(app.getByText(/Retrying is safe/i)).toBeVisible();
    await expect(app.getByText(/allocation failed/i)).toHaveCount(0);
  });

  test('reports the basis refresh after a withdrawal too', async ({ app, scenario }) => {
    await withPendingProposal(app, scenario);
    await scenario.set({ costRecomputeFails: true });
    await app.getByRole('button', { name: /Withdraw this proposal/i }).click();
    await app.getByLabel(/Why is this proposal being withdrawn/i).fill('Wrong weighting');
    await app.getByRole('button', { name: /Withdraw the proposal/i }).click();

    await expect(app.getByText(/were NOT deleted/i).first()).toBeVisible();
    await expect(app.getByText(/the derived basis was not refreshed/i)).toBeVisible();
  });
});

test.describe('the derived cost basis, shown beside the evidence', () => {
  test('is its own region, separate from the allocation evidence', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app).getByText(/DERIVED, not decided/i)).toBeVisible();
    await expect(proposedPanel(app)).toBeVisible();
  });

  test('shows an established basis as an exact figure', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app).getByText('66.00 USD')).toBeVisible();
  });

  // AN UNRESOLVED BASIS IS NOT A ZERO.
  test('shows an unresolved currency as words, never as 0.00', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    const usd = app.locator('[data-basis-line="RV-AL-000002"] [data-basis-currency="USD"]');
    await expect(usd).toContainText('No established basis');
    await expect(usd).not.toContainText('0.00');
    await expect(usd.locator('[data-basis-total="none"]')).toBeVisible();
  });

  test('shows each currency separately and offers no combined total', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    const line = app.locator('[data-basis-line="RV-AL-000002"]');
    await expect(line.locator('[data-basis-currency="EUR"]')).toContainText('5.00 EUR');
    await expect(line.locator('[data-basis-currency="USD"]')).toBeVisible();
    await expect(derivedBasis(app).getByText(/combined|grand total/i)).toHaveCount(0);
  });

  // FIFO MUST NEVER READ AS PROOF OF PHYSICAL MOVEMENT.
  test('states the FIFO caveat prominently', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app).getByText(/FIFO here is an accounting convention/i)).toBeVisible();
    await expect(derivedBasis(app).getByText(/does not assert which physical unit arrived first/i).first())
      .toBeVisible();
  });

  test('says why a line is not fully resolved', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app).getByText(/units arrived beyond/i)).toBeVisible();
    await expect(derivedBasis(app).getByText(/Cost evidence on this line is still unresolved/i))
      .toBeVisible();
  });

  // NOT DERIVED is a third state and must not render as zeroes.
  test('says the basis has never been derived rather than showing zeroes', async ({ app, scenario }) => {
    await scenario.set({ costBasisNotDerived: true });
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app).getByText(/No cost basis has been derived for these lines yet/i))
      .toBeVisible();
    await expect(derivedBasis(app).getByText(/not a cost basis of zero/i)).toBeVisible();
    await expect(derivedBasis(app).getByText('0.00')).toHaveCount(0);
  });

  test('does not overflow horizontally with the basis panel rendered', async ({ app }, testInfo) => {
    await openSurface(app, COST_COMPONENT);
    await expect(derivedBasis(app)).toBeVisible();
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(
      scrollWidth,
      `${testInfo.project.name}: widest offenders ${(await overflowingElements(app)).join(' | ')}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
});

// === S2.6: the governed unresolved-cost queue ================================

const unresolvedPanel = (app: import('@playwright/test').Page) =>
  app.getByRole('region', { name: 'Unresolved cost' });

const entry = (app: import('@playwright/test').Page, reason: string) =>
  app.locator(`[data-unresolved-reason="${reason}"]`);

test.describe('the unresolved-cost queue', () => {
  test('is part of /cost rather than a separate destination', async ({ app }) => {
    await openSurface(app, COST);
    await expect(unresolvedPanel(app)).toBeVisible();
    // The component record is on the same page.
    await expect(app.locator('[data-cost-count="awaiting_proposal"]')).toBeVisible();
    // And the navigation does not grow a second cost entry.
    await expect(app.getByRole('link', { name: /unresolved cost/i })).toHaveCount(0);
  });

  // THE TRUTH RULE, IN A REAL BROWSER.
  test('shows an unknown amount as words, never as zero', async ({ app }) => {
    await openSurface(app, COST);
    const row = entry(app, 'amount_not_known');
    await expect(row).toContainText('Amount never reported');
    await expect(row).toContainText('Not reported');
    await expect(row).not.toContainText('0.00');
  });

  test('names each distinct reason rather than a catch-all', async ({ app }) => {
    await openSurface(app, COST);
    await expect(entry(app, 'shared_cost_unallocated')).toContainText('Shared cost not yet split');
    await expect(entry(app, 'basis_unresolved'))
      .toContainText('Inventory cost basis not established');
    await expect(entry(app, 'overage_without_cost'))
      .toContainText('More units received than the source priced');
    // Every entry names a specific problem.
    await expect(entry(app, 'amount_not_known')).not.toContainText(/needs attention/i);
  });

  test('states the governed overage quantities', async ({ app }) => {
    await openSurface(app, COST);
    await expect(entry(app, 'overage_without_cost')).toContainText('over by');
  });

  // TRIAGE AND NAVIGATION: the link reaches the real S2.5 workflow.
  test('links into the existing component workspace', async ({ app }) => {
    await openSurface(app, COST);
    await app.locator(`[data-unresolved-link="${SHIPPING_COMPONENT}"]`).click();
    await expect(app.getByRole('region', { name: 'Proposed split' })).toBeVisible();
    await expect(app.getByText(SHIPPING_COMPONENT).first()).toBeVisible();
  });

  test('duplicates no allocation editing of its own', async ({ app }) => {
    await openSurface(app, COST);
    await expect(unresolvedPanel(app)
      .getByRole('button', { name: /Propose a split|Confirm|Withdraw|Reverse/i })).toHaveCount(0);
  });

  // --- the live workflow is reflected --------------------------------------

  test('moves a component from "not yet split" to "awaiting review" when proposed', async ({ app, scenario }) => {
    await openSurface(app, COST);
    await expect(entry(app, 'shared_cost_unallocated')).toBeVisible();

    scenario.state.cost.propose('manual_quantity', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
    ]);
    await openSurface(app, COST);
    await expect(entry(app, 'proposal_awaiting_review')).toBeVisible();
    await expect(entry(app, 'shared_cost_unallocated')).toHaveCount(0);
  });

  // WITHDRAWAL IS HISTORY, NOT A RESOLUTION.
  test('shows the component still needs splitting after its proposal is withdrawn', async ({ app, scenario }) => {
    scenario.state.cost.propose('manual_quantity', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
    ]);
    await openSurface(app, COST);
    await expect(entry(app, 'proposal_awaiting_review')).toBeVisible();

    scenario.state.cost.withdraw('Wrong weighting');
    await openSurface(app, COST);
    // The problem did NOT disappear with the withdrawal — the CURRENT truth is
    // that the cost still needs splitting.
    await expect(entry(app, 'shared_cost_unallocated')).toBeVisible();
    await expect(entry(app, 'proposal_awaiting_review')).toHaveCount(0);
  });

  test('drops the component from the queue once its split is confirmed', async ({ app, scenario }) => {
    scenario.state.cost.propose('manual_quantity', [
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000001', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SRC-WHATNOT', acquisitionLinePublicId: 'RV-AL-000002', amountMinor: '250' },
    ]);
    scenario.state.cost.confirm('1000');
    await openSurface(app, COST);
    await expect(entry(app, 'proposal_awaiting_review')).toHaveCount(0);
    await expect(entry(app, 'shared_cost_unallocated')).toHaveCount(0);
    // The unrelated problems remain.
    await expect(entry(app, 'amount_not_known')).toBeVisible();
  });

  // --- empty / partial / failure -------------------------------------------

  // "Nothing needs attention" only after a COMPLETE authoritative read.
  test('renders a truthful empty state for a complete, empty answer', async ({ app, scenario }) => {
    await scenario.set({ costUnresolvedEmpty: true });
    await openSurface(app, COST);
    await expect(unresolvedPanel(app).getByText('No unresolved cost')).toBeVisible();
    await expect(unresolvedPanel(app).getByText(/an answer, not a failure to look/i)).toBeVisible();
  });

  test('is visibly partial, never empty, when the answer was cut short', async ({ app, scenario }) => {
    await scenario.set({ costUnresolvedPartial: true });
    await openSurface(app, COST);
    await expect(unresolvedPanel(app).getByText(/Coverage is partial/i)).toBeVisible();
    await expect(unresolvedPanel(app).getByText('No unresolved cost')).toHaveCount(0);
  });

  // A FAILED READ IS NEVER AN EMPTY QUEUE.
  test('renders a failed read as unavailable, never as an empty queue', async ({ app, scenario }) => {
    await scenario.set({ costUnresolvedFails: true });
    await openSurface(app, COST);
    await expect(app.locator('[data-unresolved-cost="unavailable"]')).toBeVisible();
    await expect(unresolvedPanel(app).getByText('No unresolved cost')).toHaveCount(0);
  });

  // The two governed reads are independent.
  test('keeps the component record readable when the triage read fails', async ({ app, scenario }) => {
    await scenario.set({ costUnresolvedFails: true });
    await openSurface(app, COST);
    await expect(visibleRow(app, 'RV-ACOST-SHIP01')).toBeVisible();
  });

  // --- filtering ------------------------------------------------------------

  test('filters by reason without concealing that other entries exist', async ({ app }) => {
    await openSurface(app, COST);
    const before = await app.locator('[data-unresolved-reason]').count();
    expect(before).toBeGreaterThan(1);

    await unresolvedPanel(app).getByLabel('Reason').selectOption('amount_not_known');
    await expect(app.locator('[data-unresolved-reason]')).toHaveCount(1);
    // The unfiltered total is still on screen.
    await expect(app.locator('[data-unresolved-total]')).toContainText(String(before));
  });

  // CURRENCIES STAY SEPARATE.
  test('lists currencies separately and never combines them', async ({ app }) => {
    await openSurface(app, COST);
    await expect(unresolvedPanel(app).getByText(/never added together/i)).toBeVisible();
    await unresolvedPanel(app).getByLabel('Currency').selectOption('EUR');
    await expect(entry(app, 'basis_unresolved')).toBeVisible();
    await expect(entry(app, 'amount_not_known')).toHaveCount(0);
  });

  // --- derivation, roles, layout -------------------------------------------

  test('says what the last derivation was and refuses to claim it is current', async ({ app }) => {
    await openSurface(app, COST);
    await expect(app.locator('[data-derivation-note]'))
      .toContainText('last derived by algorithm 1.1.0');
    await expect(app.locator('[data-derivation-note]'))
      .toContainText('not something the governed record exposes');
  });

  test('says plainly when no derivation has ever run', async ({ app, scenario }) => {
    await scenario.set({ costBasisNotDerived: true });
    await openSurface(app, COST);
    await expect(entry(app, 'basis_never_derived')).toBeVisible();
    await expect(app.locator('[data-derivation-note]')).toContainText('has ever run');
  });

  test('lets a viewer read the queue and offers them no mutation', async ({ app, scenario }) => {
    await scenario.set({ costRole: 'viewer' });
    await openSurface(app, COST);
    await expect(entry(app, 'amount_not_known')).toBeVisible();
    await expect(unresolvedPanel(app).getByRole('button')).toHaveCount(0);
    // Reading is not what is withheld: the navigation link is still there.
    await expect(app.locator(`[data-unresolved-link="${SHIPPING_COMPONENT}"]`)).toBeVisible();
  });

  test('does not overflow horizontally with the queue rendered', async ({ app }, testInfo) => {
    await openSurface(app, COST);
    await expect(unresolvedPanel(app)).toBeVisible();
    const { scrollWidth, clientWidth } = await documentOverflow(app);
    expect(
      scrollWidth,
      `${testInfo.project.name}: widest offenders ${(await overflowingElements(app)).join(' | ')}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
});

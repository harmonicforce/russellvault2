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

/** Whichever rendering this viewport is actually showing. */
function visibleRow(app: import('@playwright/test').Page, text: string) {
  return app.locator('tr:visible, li:visible').filter({ hasText: text }).first();
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
  test('warns that a proposal cannot be withdrawn before anything is chosen', async ({ app }) => {
    await openSurface(app, COST_COMPONENT);
    await app.getByRole('button', { name: /Propose a split/i }).click();
    await expect(app.getByText('A proposal cannot be withdrawn')).toBeVisible();
    await expect(app.getByText(/no way to delete a proposed split/i)).toBeVisible();
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

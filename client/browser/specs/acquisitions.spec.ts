// GATE 13 — the governed Acquisitions list, at real widths.
//
// S1.6.5's own test file says the limit out loud: jsdom applies no CSS, so the
// table and the record list are BOTH in the document at once and no test could
// say which one an operator actually sees. That is decided here.

import { expect, test } from '../fixtures/app';
import { ACQUISITIONS, openSurface } from '../fixtures/surfaces';

const TABLE_BREAKPOINT = 1024; // DataTable hands over to records below `lg`.

test('shows the representation this width is designed for', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);
  const width = app.viewportSize()?.width ?? 0;

  const table = app.getByRole('table');
  const records = app.getByRole('list', { name: /acquisition/i }).first();

  if (width < TABLE_BREAKPOINT) {
    // A nine-column table on a phone or a tablet in portrait is the sideways
    // strip the responsive handover exists to prevent.
    await expect(table).toBeHidden();
    const recordsVisible = await records.count();
    expect(recordsVisible, 'a record list must be presented below lg').toBeGreaterThan(0);
    await expect(records).toBeVisible();
  } else {
    await expect(table).toBeVisible();
  }
});

test('the table occupies no layout below its breakpoint', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);
  const width = app.viewportSize()?.width ?? 0;
  test.skip(width >= TABLE_BREAKPOINT, 'this is a narrow-width assertion');

  // Hidden is not enough: a `visibility: hidden` table still takes space and
  // still pushes the page sideways. Measured directly, and tolerant of the
  // table not being in the document at all — which is also a correct answer.
  const occupies = await app.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return false;
    const rect = table.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  });
  expect(occupies, 'the desktop table must not occupy layout at narrow widths').toBe(false);
});

test('search updates the URL and the rendered data', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  await app.getByLabel('Search acquisitions').fill('Northgate');
  await app.getByRole('button', { name: 'Search' }).click();

  await expect(app).toHaveURL(/query=Northgate/);
  await expect(app.getByText(/filtered lines/)).toBeVisible();
  const total = await app.getByText(/filtered lines/).textContent();
  expect(total).not.toContain('137');
});

test('each governed filter narrows the list and is carried by the URL', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  await app.getByLabel('Classification', { exact: true }).selectOption('slab');
  await expect(app).toHaveURL(/classification=slab/);

  await app.getByLabel('Seller').selectOption('CardHaven');
  await expect(app).toHaveURL(/seller=CardHaven/);

  await app.getByLabel('Classification method').selectOption('owner_override');
  await expect(app).toHaveURL(/method=owner_override/);

  await app.getByLabel('Eligibility').selectOption('excluded');
  await expect(app).toHaveURL(/exclusionState=excluded/);

  // Clearing returns the operator to the full governed set.
  await app.getByRole('button', { name: /clear filters/i }).click();
  await expect(app).not.toHaveURL(/classification=slab/);
  await expect(app.getByText('137 filtered lines')).toBeVisible();
});

test('a visible sort control changes order and toggles direction', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);
  const width = app.viewportSize()?.width ?? 0;
  test.skip(width < TABLE_BREAKPOINT, 'column sort controls belong to the table representation');

  const seller = app.getByRole('button', { name: /Seller/ }).first();
  await seller.click();
  await expect(app).toHaveURL(/sort=seller/);
  const firstDirection = new URL(app.url()).searchParams.get('order');

  await seller.click();
  await expect
    .poll(() => new URL(app.url()).searchParams.get('order'))
    .not.toBe(firstDirection);
});

test('pagination moves to page 2 and back through browser history', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  const next = app.getByRole('button', { name: /next/i }).first();
  await next.click();
  await expect(app).toHaveURL(/page=2/);

  await app.goBack();
  await expect(app).not.toHaveURL(/page=2/);
  await expect(app.getByText('137 filtered lines')).toBeVisible();

  await app.goForward();
  await expect(app).toHaveURL(/page=2/);
});

test('the exact total is the server total, not the row count on screen', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);
  // 137 governed lines over a 50-row page: a client counting what it rendered
  // would say 50 and be confidently wrong.
  await expect(app.getByText('137 filtered lines')).toBeVisible();
});

test('a facet failure costs suggestions and nothing else', async ({ app, scenario }) => {
  await scenario.set({ facetsFail: true });
  await openSurface(app, ACQUISITIONS);

  // The rows and the exact total survive.
  await expect(app.getByText('137 filtered lines')).toBeVisible();

  // No fabricated zero anywhere in the summary region.
  const body = (await app.locator('body').textContent()) ?? '';
  expect(body).not.toMatch(/Sealed product: 0|Unclassified: 0/);
});

test('states coverage and never invites adding governed to legacy', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  const coverage = app.getByText('Coverage is partial');
  await expect(coverage).toBeVisible();
  const region = (await app.locator('body').textContent()) ?? '';
  expect(region).toContain('Do not total these figures');
});

test('an excluded line stays visible and says so in words', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  await app.getByLabel('Eligibility').selectOption('excluded');
  await expect(app).toHaveURL(/exclusionState=excluded/);
  await expect(app.getByText('Excluded').locator('visible=true').first()).toBeVisible();
});

test('an unclassified line says Unclassified rather than showing a blank', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  await app.getByLabel('Review state').selectOption('unclassified');
  await expect(app).toHaveURL(/classificationState=unclassified/);
  await expect(app.getByText(/Unclassified/i).locator('visible=true').first()).toBeVisible();
});

test('a row navigates to a source-qualified detail URL and returns to the exact list', async ({ app }) => {
  await openSurface(app, ACQUISITIONS);

  // Put the list into a state worth returning to.
  await app.getByLabel('Seller').selectOption('CardHaven');
  await expect(app).toHaveURL(/seller=CardHaven/);
  const listUrl = app.url();

  await app.getByRole('link', { name: /^RV-ALIN-/ }).first().click();

  // BOTH identifiers in the path. A single-segment link addresses the wrong
  // record the moment a second source system exists.
  await expect(app).toHaveURL(/\/acquisitions\/RV-SRC-WHATNOT\/RV-ALIN-\d+/);
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();

  await app.getByRole('link', { name: /Back to acquisitions/ }).click();
  await expect(app).toHaveURL(listUrl);
});

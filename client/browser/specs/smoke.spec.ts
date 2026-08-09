// The first thing the gate has to prove: the REAL application boots.
//
// If this file fails, nothing else in the suite means anything — every other
// spec would be asserting against a sign-in form or a configuration error
// screen rather than the governed application.

import { expect, gotoGoverned, test } from '../fixtures/app';

test('boots the real governed application past auth, workspace and first run', async ({ app }) => {
  const failures: string[] = [];
  app.on('requestfailed', (request) => failures.push(request.url()));

  await gotoGoverned(app, '/');

  // The governed shell, not the sign-in form and not the configuration screen.
  await expect(app.locator('[data-shell-root]')).toBeVisible();
  await expect(app.getByText('Configuration incomplete')).toHaveCount(0);
  await expect(app.getByRole('button', { name: /sign in/i })).toHaveCount(0);

  // Nothing left the browser for a real host.
  expect(failures.filter((url) => !url.startsWith('http://127.0.0.1'))).toEqual([]);
});

test('reaches the governed Acquisitions list with real rows', async ({ app }) => {
  await gotoGoverned(app, '/acquisitions');
  await expect(app.getByText('137 filtered lines')).toBeVisible();
  await expect(app.getByRole('link', { name: /^RV-ALIN-/ }).first()).toBeVisible();
});

test('reaches the governed Acquisition Detail through a source-qualified URL', async ({ app }) => {
  await gotoGoverned(app, '/acquisitions/RV-SRC-WHATNOT/RV-ALIN-0001');
  await expect(app.getByRole('heading', { level: 1, name: 'Scarlet & Violet 151 Booster Bundle' })).toBeVisible();
});

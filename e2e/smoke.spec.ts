// The harness gate.
//
// This spec proves the infrastructure works, and nothing about cycle counting.
// If it fails, no workflow spec's result means anything: either the stack is
// not up, the client is not configured, the seed cannot reach the governed
// functions, or sign-in is broken.

import { test, expect, openCycleCounts } from './support/fixtures';

test('the seed builds an isolated workspace through governed functions', async ({ workspace }) => {
  expect(workspace.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(workspace.email).toContain('@russellvault.test');
  // Two serialized units and two quantity lots, all created by the same
  // functions the application calls.
  expect(workspace.certificates).toHaveLength(2);
  expect(workspace.lots).toHaveLength(2);
  expect(workspace.lots[0].quantity).toBe(12);
});

test('an operator can sign in and reach an authenticated route', async ({ signedIn, workspace }) => {
  // First-run setup is complete, so the shell renders rather than the setup gate.
  await expect(signedIn.getByRole('link', { name: 'Cycle Counts' })).toBeVisible();
  await openCycleCounts(signedIn);

  // A brand-new workspace has run no counts, and the empty state says so
  // rather than rendering a blank page.
  await expect(signedIn.getByText('No count is running.')).toBeVisible();
  expect(workspace.locations.shelfA).toBe('E2E-SHELF-A');
});

test('@mobile the counting entry point is usable at phone width', async ({ signedIn }) => {
  await openCycleCounts(signedIn);
  await expect(signedIn.getByRole('link', { name: /Start a new count/ }).first()).toBeVisible();

  // The page must not scroll sideways to reach its primary action.
  const overflow = await signedIn.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

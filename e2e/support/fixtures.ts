// Playwright fixtures for the Russell Vault browser suite.
//
// Each test gets its own freshly seeded workspace and a page already signed in
// as that workspace's owner. Signing in is done through the application's own
// form rather than by injecting a token, because the sign-in path is part of
// what these tests are supposed to prove works.

import { test as base, expect, type Page } from '@playwright/test';
import { seedWorkspace, type SeededWorkspace, type SeedOptions } from './seed';

export interface RussellFixtures {
  /** A workspace created for this test alone. */
  workspace: SeededWorkspace;
  /** A page signed in as that workspace's owner, on the app's home route. */
  signedIn: Page;
}

export interface RussellOptions {
  /** Per-test override of what inventory the seed creates. */
  seedOptions: SeedOptions;
}

export const test = base.extend<RussellFixtures & RussellOptions>({
  seedOptions: [{}, { option: true }],

  workspace: async ({ seedOptions }, use) => {
    const seeded = await seedWorkspace(seedOptions);
    await use(seeded);
    // Nothing is torn down. The workspace is unique to this test and append-only
    // evidence is the point of the schema — deleting it would be both refused by
    // the database and dishonest about what the run did.
  },

  signedIn: async ({ page, workspace }, use) => {
    await signIn(page, workspace);
    await use(page);
  },
});

export { expect };

/**
 * Drives the real sign-in form. Deliberately not a token injection: if sign-in
 * breaks, every workflow spec should fail, not silently keep working.
 */
export async function signIn(page: Page, workspace: SeededWorkspace): Promise<void> {
  await page.goto('/');

  const email = page.getByLabel(/email/i).first();
  await email.waitFor({ state: 'visible' });
  await email.fill(workspace.email);
  await page.getByLabel(/password/i).first().fill(workspace.password);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();

  // Signed in means the workspace shell is rendered, not merely that the form
  // went away.
  await expect(page.getByText(`E2E ${workspace.workspaceId.slice(0, 0)}`, { exact: false })
    .or(page.getByRole('link', { name: 'Cycle Counts' })))
    .toBeVisible({ timeout: 20_000 });
}

/** Opens Cycle Counts through the navigation, the way an operator would. */
export async function openCycleCounts(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cycle Counts' }).click();
  await expect(page.getByRole('heading', { name: 'Cycle Counts' })).toBeVisible();
}

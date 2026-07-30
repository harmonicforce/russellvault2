// Browser-test configuration.
//
// The suite runs against a locally served client and a local Supabase stack,
// both of which must already be running — the config starts the client but not
// the stack, because starting a database is not something a test runner should
// do implicitly.
//
// Chromium only, deliberately. These tests exist to prove the counting workflow
// behaves, not to survey browser engines; adding engines would multiply the run
// time without testing anything about Russell Vault.

import { defineConfig, devices } from '@playwright/test';

const APP_URL = process.env.E2E_APP_URL?.trim() || 'http://127.0.0.1:5173';

// The runner image ships Chromium at PLAYWRIGHT_BROWSERS_PATH; CI installs its
// own. Neither needs a per-run download.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // A counting workflow is a sequence of governed writes. Retrying one would
  // re-run half-applied state against a database that correctly refuses it, so
  // a flake must be read as a failure and investigated.
  retries: 0,
  // Each test seeds its own workspace, so they are genuinely independent.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      // @mobile specs belong to the phone project. Without this they run in
      // both, which doubles the cost and reports a phone-width assertion under
      // a desktop viewport.
      grepInvert: /@mobile/,
    },
    {
      // The counting screens are used on a phone at a shelf. Specs tagged
      // @mobile run here as well.
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],

  webServer: {
    // Vite dev rather than a preview build: it starts in about a second and
    // serves the same routes. The build is already proven by CI's build job.
    command: 'npm run dev --prefix client -- --host 127.0.0.1 --port 5173 --strictPort',
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SHADOW_AUTH: 'supabase',
      VITE_SHADOW_IMPORT: 'repository-fixtures',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
    },
  },
});

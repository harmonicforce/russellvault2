import { defineConfig, devices } from '@playwright/test';
import { IPAD_VIEWPORTS, REFERENCE_VIEWPORTS } from './browser/fixtures/viewports';

/**
 * The S1.6.7 browser quality gate.
 *
 * S1.6.1 through S1.6.6 each deferred real-browser proof, and each said so in
 * writing: jsdom applies no CSS, has no layout, has no top layer, and has no
 * `showModal()`. Everything those slices could not prove — responsive geometry,
 * focus containment, touch-target size, horizontal overflow, theme rendering,
 * drag activation, and accessibility — is proved here or is not proved at all.
 *
 * The server under test is the REAL production bundle served by `vite preview`,
 * bound to loopback. It is never exposed beyond 127.0.0.1.
 */

const PORT = 4317;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Deterministic rendering. Locale and timezone are pinned because the pages
// format money and instants with `toLocaleString`, and an unpinned runner would
// produce a different screenshot in a different region.
const DETERMINISTIC = {
  locale: 'en-US',
  timezoneId: 'UTC',
  baseURL: BASE_URL,
} as const;

const chromiumProjects = REFERENCE_VIEWPORTS.map((viewport) => ({
  name: `chromium-${viewport.name}`,
  use: {
    ...devices['Desktop Chrome'],
    ...DETERMINISTIC,
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
    isMobile: false,
  },
  testIgnore: /webkit-ipad\.spec\.ts/,
}));

// WebKit is a Safari-ENGINE approximation. It is not an iPad, it has no real
// touch hardware, and passing here is not a claim that a physical iPad behaves
// identically. It is the closest engine CI can run, and it catches the class of
// defect that only Safari's layout and dialog implementation produce.
const webkitProjects = IPAD_VIEWPORTS.map((viewport) => ({
  name: `webkit-${viewport.name}`,
  use: {
    ...devices['Desktop Safari'],
    ...DETERMINISTIC,
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true,
    isMobile: false,
  },
  testMatch: /webkit-ipad\.spec\.ts/,
}));

export default defineConfig({
  testDir: './browser/specs',
  snapshotDir: './browser/baselines',
  outputDir: './browser/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: './browser/.report' }]] : [['list']],

  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Per-pixel colour tolerance absorbs antialiasing, which differs between
      // machines for reasons that are not product changes.
      threshold: 0.2,
      // The share of pixels allowed to differ. Deliberately small: a real
      // layout regression moves far more than 1% of the page, so this catches
      // one without turning the gate into a ceremonial green light.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    ...DETERMINISTIC,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Nothing in this suite may reach a real host; the fixture aborts anything
    // that is not loopback. This makes an accidental external call obvious.
    serviceWorkers: 'block',
  },

  projects: [...chromiumProjects, ...webkitProjects],

  webServer: {
    command: 'npm run browser:serve',
    url: BASE_URL,
    // Loopback only. The gate never binds a test server to a routable address.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

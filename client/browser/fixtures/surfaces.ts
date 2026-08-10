import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { DETAIL_LINE, SOURCE_SYSTEM } from './data';

/** The four canonical S1.6 surfaces the whole gate is measured against. */
export interface CanonicalSurface {
  readonly name: string;
  readonly path: string;
  /** Something only this surface renders, used to wait for it truthfully. */
  readonly settled: (page: Page) => Promise<void>;
}

export const HOME: CanonicalSurface = {
  name: 'home',
  path: '/',
  settled: async (page) => {
    // Deliberately NOT "a navigation landmark is visible": below `lg` the
    // persistent sidebar is absent by design and navigation lives behind the
    // drawer trigger. Waiting on the sidebar would make the harness assert a
    // desktop-only shape at every width.
    await expect(page.locator('[data-shell-root]')).toBeVisible();
    // The routed content itself, not the chrome. The brand appears twice — once
    // in the `lg:hidden` header and once in the `lg:flex` sidebar — so matching
    // it by text and taking the first hit finds whichever copy is hidden at
    // this width.
    await expect(page.getByRole('heading', { level: 1, name: 'Today at a glance' })).toBeVisible();
  },
};

export const WORKBENCH: CanonicalSurface = {
  name: 'workbench',
  path: '/workbench',
  settled: async (page) => {
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  },
};

export const ACQUISITIONS: CanonicalSurface = {
  name: 'acquisitions',
  path: '/acquisitions',
  settled: async (page) => {
    await expect(page.getByText('137 filtered lines')).toBeVisible();
  },
};

export const ACQUISITION_DETAIL: CanonicalSurface = {
  name: 'acquisition-detail',
  path: `/acquisitions/${SOURCE_SYSTEM}/${DETAIL_LINE}`,
  settled: async (page) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Financial')).toBeVisible();
  },
};

export const CANONICAL_SURFACES: readonly CanonicalSurface[] = [
  HOME,
  WORKBENCH,
  ACQUISITIONS,
  ACQUISITION_DETAIL,
];

/** Navigate to a surface and wait until it has actually settled. */
export async function openSurface(page: Page, surface: CanonicalSurface): Promise<void> {
  await page.goto(surface.path);
  await surface.settled(page);
}

/**
 * The page's real horizontal geometry, measured in the browser.
 *
 * Deliberately `scrollWidth` versus `clientWidth` on the document element
 * rather than a search for `overflow-x-hidden`: a class that hides overflow
 * hides the SYMPTOM, and a page can overflow with the class present. Only the
 * measurement is evidence.
 */
export async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/** Elements that scroll horizontally inside the page, with what they are. */
export async function internalHorizontalScrollers(page: Page): Promise<Array<{ selector: string; overflow: number }>> {
  return page.evaluate(() => {
    const found: Array<{ selector: string; overflow: number }> = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const overflow = element.scrollWidth - element.clientWidth;
      if (overflow <= 1) continue;
      const style = getComputedStyle(element);
      if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
      const id = element.getAttribute('data-testid') ?? element.getAttribute('aria-label') ?? element.tagName;
      found.push({ selector: `${element.tagName.toLowerCase()}[${id}]`, overflow });
    }
    return found;
  });
}

/**
 * Which elements are actually wider than the viewport.
 *
 * The overflow invariant can only say THAT a page overflows; a failure that
 * does not say WHICH element sends the next person hunting. This reports the
 * widest offenders so the message carries the diagnosis with it.
 */
export async function overflowingElements(page: Page, limit = 5): Promise<string[]> {
  return page.evaluate((max) => {
    const viewport = document.documentElement.clientWidth;
    const offenders: Array<{ description: string; right: number }> = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= viewport + 1) continue;
      const name =
        element.getAttribute('data-shell-root') !== null
          ? '[data-shell-root]'
          : (element.getAttribute('aria-label') ?? element.className?.toString().slice(0, 60) ?? '');
      offenders.push({
        description: `${element.tagName.toLowerCase()}(${name}) right=${Math.round(rect.right)} vs viewport ${viewport}`,
        right: rect.right,
      });
    }
    return offenders
      .sort((a, b) => b.right - a.right)
      .slice(0, max)
      .map((o) => o.description);
  }, limit);
}

/**
 * Freeze everything that would otherwise make a screenshot depend on when it
 * was taken. Applied as a page stylesheet — this is the harness's stylesheet,
 * not the application's, and the application ships none of it.
 */
export async function freezeForScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* Scrollbars are drawn by the platform and differ between machines for
         reasons that are not product changes. */
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
    `,
  });
  // Fonts must be resolved before the pixels are compared, or the first
  // screenshot of a run captures a fallback face and the rest do not.
  await page.evaluate(() => document.fonts.ready);
}

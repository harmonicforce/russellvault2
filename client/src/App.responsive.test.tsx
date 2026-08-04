// @vitest-environment jsdom
//
// The app is used mostly on an iPad. A permanently docked 240px sidebar plus a
// desktop table that switched on at `md` (768px — exactly iPad portrait width)
// left roughly 528px for Current Inventory, which is what clipped it.
//
// jsdom has no layout engine and no viewport, so these tests assert the
// mechanism — which nodes exist, which classes gate them, and that the drawer
// opens, closes and closes again on navigate. What they CANNOT prove is
// recorded at the bottom of this file.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Shadow surfaces off, which is the deployed default: the navigation under test
// is the chrome, and it must work in the configuration that actually ships.
vi.mock('./lib/provenanceConfig', () => ({
  isProvenanceUiEnabled: () => false,
  getProvenanceUiConfig: () => null,
  SHADOW_IMPORT_FLAG: 'VITE_SHADOW_IMPORT',
  STAGING_NOTICE: '',
}));
// Legacy-only: no governed configuration at all. This is the shape the shell
// must stay navigable in, and it is now an explicit mode rather than the
// fall-through that any partial configuration used to produce.
vi.mock('./lib/appConfig', () => ({ resolveAppConfig: () => ({ mode: 'legacy-only' }) }));
vi.mock('./lib/api', () => ({ get: () => new Promise(() => undefined) }));
// Health never settles, which is the state these tests want: the chrome must
// be navigable before any backend answers.
vi.mock('./lib/healthApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/healthApi')>()),
  fetchSystemHealth: () => new Promise(() => undefined),
}));

const { default: App } = await import('./App');

afterEach(() => cleanup());

// `SystemStatusBanner` reads deployment health through react-query, so the
// shell needs a client even though nothing here asserts on the banner.
const renderApp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><App /></MemoryRouter>
    </QueryClientProvider>
  );
};

describe('tablet navigation', () => {
  it('keeps the desktop sidebar for large screens only', () => {
    const { container } = renderApp();
    const aside = container.querySelector('aside');
    expect(aside).toBeTruthy();
    // Hidden by default, shown from lg up — so iPad portrait gets the full
    // width instead of losing 240px to a permanently docked rail.
    expect(aside!.className).toContain('hidden');
    expect(aside!.className).toContain('lg:flex');
  });

  it('offers a navigation control below that breakpoint', () => {
    renderApp();
    const opener = screen.getByLabelText('Open navigation');
    expect(opener).toBeTruthy();
    expect(opener.closest('div')!.className).toContain('lg:hidden');
    expect(opener.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the drawer as a labelled dialog', () => {
    renderApp();
    fireEvent.click(screen.getByLabelText('Open navigation'));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByLabelText('Open navigation').getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on the backdrop and on Escape', () => {
    renderApp();
    fireEvent.click(screen.getByLabelText('Open navigation'));
    fireEvent.click(screen.getByLabelText('Close navigation'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Open navigation'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Navigation' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // One tap to reach a destination, not one to navigate and another to close.
  it('closes when a destination is chosen', () => {
    renderApp();
    fireEvent.click(screen.getByLabelText('Open navigation'));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(dialog).getByText('Inventory'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the same destinations in the drawer as in the sidebar', () => {
    const { container } = renderApp();
    const sidebarLinks = [...container.querySelectorAll('aside a')].map((a) => a.textContent);
    fireEvent.click(screen.getByLabelText('Open navigation'));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    const drawerLinks = [...drawer.querySelectorAll('a')].map((a) => a.textContent);
    // One definition renders both, so they cannot drift apart.
    expect(drawerLinks).toEqual(sidebarLinks);
    expect(drawerLinks.length).toBeGreaterThan(0);
  });

  it('never lets the page itself scroll sideways', () => {
    const { container } = renderApp();
    expect(container.firstElementChild!.className).toContain('overflow-hidden');
  });
});

// What jsdom cannot prove, and is therefore NOT claimed:
//
//   * that 768px actually renders the card list rather than the table — jsdom
//     evaluates no media queries, so the `lg:` gating is asserted as class
//     names, not as layout;
//   * that no element overflows its container at a real viewport width;
//   * touch targets, momentum scrolling, or the software keyboard.
//
// Those need a real browser. This repository has no Playwright harness and none
// was added here.

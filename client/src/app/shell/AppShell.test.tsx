// @vitest-environment jsdom
//
// Governed application shell acceptance.
//
// Everything here renders the real AppShell and interacts with it. Nothing
// reads component source. What jsdom cannot prove — that a breakpoint actually
// changes layout, that focus is visible, that a touch target measures 44
// physical pixels — is recorded at the bottom of this file rather than claimed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppConfigState } from '../../lib/appConfig';
import { createMemoryThemeStore, type ThemeStore } from '../../lib/theme';
import { AppShell } from './AppShell';

// Health never settles: the chrome must be navigable before any backend
// answers, and the shell must not depend on a health verdict to render.
vi.mock('../../lib/healthApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/healthApi')>()),
  fetchSystemHealth: () => new Promise(() => undefined),
}));

const workspaceState = {
  workspace: { id: 'ws-1', name: 'Russell Vault', role: 'owner', skuPrefix: 'RV', setupCompletedAt: '2026-01-01' },
  workspaces: [
    { id: 'ws-1', name: 'Russell Vault', role: 'owner', skuPrefix: 'RV', setupCompletedAt: '2026-01-01' },
    { id: 'ws-2', name: 'Second Vault', role: 'operator', skuPrefix: 'SV', setupCompletedAt: '2026-01-01' },
  ],
  loading: false,
  email: 'owner@russellvault.test',
  selectWorkspace: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('../../lib/workspaceContext', () => ({
  useWorkspace: () => workspaceState,
}));

const GOVERNED: AppConfigState = { mode: 'governed', url: 'http://supabase.test', anonKey: 'anon' };
const LEGACY_ONLY: AppConfigState = { mode: 'legacy-only' };

function renderShell(
  config: AppConfigState = GOVERNED,
  store: ThemeStore = createMemoryThemeStore(),
  initialPath = '/',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  return {
    root,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppShell config={config} themeStore={store}>
            <Routes>
              <Route path="*" element={<CurrentPath />} />
            </Routes>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** Stands in for routed content and reports where the router actually is. */
function CurrentPath() {
  const { pathname } = useLocation();
  return <div data-testid="routed">{pathname}</div>;
}

const openDrawer = () => {
  fireEvent.click(screen.getByLabelText('Open navigation'));
  return screen.getByRole('dialog', { name: 'Navigation' });
};

const sidebar = (container: HTMLElement) => container.querySelector('aside')!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

// ---------------------------------------------------------------------------

describe('one navigation model, two surfaces', () => {
  it('renders the same destinations in the sidebar and the drawer', () => {
    const { container } = renderShell();
    const sidebarLinks = [...sidebar(container).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const drawerLinks = [...openDrawer().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(drawerLinks).toEqual(sidebarLinks);
    expect(drawerLinks.length).toBeGreaterThan(0);
  });

  it('reaches every advertised governed destination from the sidebar', () => {
    const { container } = renderShell();
    const hrefs = [...sidebar(container).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const path of [
      '/', '/workbench', '/inventory/current', '/scan', '/intake-sessions',
      '/locations', '/cycle-counts', '/corrections', '/photo-issues',
      '/acquisitions', '/quick-add', '/listing-prep',
    ]) {
      expect(hrefs, `${path} is not reachable from navigation`).toContain(path);
    }
  });

  it('groups the governed domains under their approved headings', () => {
    const { container } = renderShell();
    const nav = within(sidebar(container));
    for (const domain of ['Home', 'Inventory', 'Acquire', 'Sell']) {
      expect(nav.getByText(domain)).toBeTruthy();
    }
  });
});

describe('governed, tools, and legacy stay separated', () => {
  it('hides tools and legacy behind their own disclosure, not in the governed flow', () => {
    const { container } = renderShell();
    const nav = within(sidebar(container));
    // Collapsed by default: not daily governed workflow.
    expect(nav.queryByText('Whatnot Purchases')).toBeNull();
    const toggle = nav.getByText(/Tools & legacy/).closest('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(nav.getByText('Whatnot Purchases')).toBeTruthy();
    expect(nav.getByText('Health Checks')).toBeTruthy();
  });

  it('marks legacy destinations non-authoritative in words, not by colour alone', () => {
    const { container } = renderShell();
    const nav = within(sidebar(container));
    fireEvent.click(nav.getByText(/Tools & legacy/).closest('button')!);
    const legacyLink = nav.getByText('Whatnot Purchases').closest('a')!;
    expect(legacyLink.textContent).toContain('Non-authoritative');
  });

  it('advertises no legacy destination inside a governed domain', () => {
    const { container } = renderShell();
    const nav = sidebar(container);
    // With the disclosure closed, only governed destinations are on screen.
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const legacy of ['/purchases', '/cost-links', '/listings', '/sales', '/inventory']) {
      expect(hrefs).not.toContain(legacy);
    }
  });

  it('keeps legacy inventory reachable, just not inside the governed domain', () => {
    const { container } = renderShell();
    const nav = within(sidebar(container));
    fireEvent.click(nav.getByText(/Tools & legacy/).closest('button')!);
    expect(nav.getByText('Legacy Inventory').closest('a')!.getAttribute('href')).toBe('/inventory');
  });
});

describe('legacy-only deployment', () => {
  it('advertises no governed destination', () => {
    const { container } = renderShell(LEGACY_ONLY);
    const hrefs = [...sidebar(container).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const governed of ['/acquisitions', '/workbench', '/inventory/current', '/cycle-counts']) {
      expect(hrefs).not.toContain(governed);
    }
  });

  it('still offers the legacy destinations', () => {
    const { container } = renderShell(LEGACY_ONLY);
    const hrefs = [...sidebar(container).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/inventory', '/purchases', '/cost-links', '/listings', '/sales', '/checks']);
  });

  it('shows no workspace area, because there is no governed workspace', () => {
    renderShell(LEGACY_ONLY);
    expect(screen.queryByLabelText(/Switch workspace/)).toBeNull();
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('workspace area', () => {
  it('shows the active workspace, the caller role, and the identity', () => {
    const { container } = renderShell();
    const nav = within(sidebar(container));
    expect(nav.getByText('Russell Vault')).toBeTruthy();
    expect(nav.getByText(/owner/)).toBeTruthy();
    expect(nav.getByText(/owner@russellvault\.test/)).toBeTruthy();
  });

  it('never infers the active workspace from the route', () => {
    const { container } = renderShell(GOVERNED, createMemoryThemeStore(), '/acquisitions');
    // The route moved; the workspace name is still the context's answer.
    expect(screen.getByTestId('routed').textContent).toBe('/acquisitions');
    expect(within(sidebar(container)).getByText('Russell Vault')).toBeTruthy();
  });

  it('switches workspace through the established context action', () => {
    const { container } = renderShell();
    fireEvent.click(within(sidebar(container)).getByLabelText(/Switch workspace/));
    fireEvent.change(screen.getByLabelText('Active workspace'), { target: { value: 'ws-2' } });
    expect(workspaceState.selectWorkspace).toHaveBeenCalledWith('ws-2');
  });

  it('signs out through the established context action', () => {
    const { container } = renderShell();
    fireEvent.click(within(sidebar(container)).getByLabelText('Sign out'));
    expect(workspaceState.signOut).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe('theme control', () => {
  it('defaults to System and writes no attribute, so CSS keeps following the OS', () => {
    const { root } = renderShell();
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(screen.getByRole('radio', { name: 'System', checked: true })).toBeTruthy();
  });

  it('loads a stored Light Vault Ledger preference', () => {
    const { root } = renderShell(GOVERNED, createMemoryThemeStore('light'));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light Vault Ledger', checked: true })).toBeTruthy();
  });

  it('loads a stored Dark Vault preference', () => {
    const { root } = renderShell(GOVERNED, createMemoryThemeStore('dark'));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark Vault', checked: true })).toBeTruthy();
  });

  it('falls back to System when the stored value is corrupt', () => {
    const corrupt: ThemeStore = { read: () => 'banana', write: () => undefined };
    const { root } = renderShell(GOVERNED, corrupt);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(screen.getByRole('radio', { name: 'System', checked: true })).toBeTruthy();
  });

  it('applies an explicit choice immediately and persists it through the store', () => {
    const store = createMemoryThemeStore();
    const { root, container } = renderShell(GOVERNED, store);
    const nav = within(sidebar(container));
    fireEvent.click(nav.getByRole('radio', { name: 'Dark Vault' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(store.read()).toBe('dark');

    fireEvent.click(nav.getByRole('radio', { name: 'Light Vault Ledger' }));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(store.read()).toBe('light');
  });

  // Removing the attribute is what keeps prefers-color-scheme live. Writing a
  // resolved snapshot would freeze the theme at whatever the OS was.
  it('removes the attribute when returning to System', () => {
    const store = createMemoryThemeStore('dark');
    const { root, container } = renderShell(GOVERNED, store);
    expect(root.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(within(sidebar(container)).getByRole('radio', { name: 'System' }));
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(store.read()).toBe('system');
  });

  it('leaves a usable shell when the store throws on write', () => {
    const hostile: ThemeStore = {
      read: () => 'system',
      write: () => { throw new Error('quota'); },
    };
    const { root, container } = renderShell(GOVERNED, hostile);
    // The theme still applies for this session; only durability is lost.
    expect(() =>
      fireEvent.click(within(sidebar(container)).getByRole('radio', { name: 'Dark Vault' })),
    ).not.toThrow();
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByLabelText('Open navigation')).toBeTruthy();
  });

  it('discloses that the preference is device-local rather than implying it syncs', () => {
    const { container } = renderShell();
    expect(within(sidebar(container)).getByText(/Saved on this device only/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('navigation drawer', () => {
  it('starts closed and reports its state on the trigger', () => {
    renderShell();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
    expect(screen.getByLabelText('Open navigation').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens as a labelled modal dialog', () => {
    renderShell();
    const drawer = openDrawer();
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByLabelText('Open navigation').getAttribute('aria-expanded')).toBe('true');
  });

  it('moves focus into the drawer on open', () => {
    renderShell();
    const drawer = openDrawer();
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the trigger on close', () => {
    renderShell();
    const trigger = screen.getByLabelText('Open navigation');
    openDrawer();
    fireEvent.click(screen.getByLabelText('Close navigation'));
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    renderShell();
    fireEvent.keyDown(openDrawer(), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('closes on the backdrop', () => {
    const { container } = renderShell();
    openDrawer();
    fireEvent.click(container.querySelector('[data-drawer-backdrop]')!);
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('closes when a destination is chosen, so one tap reaches the page', () => {
    renderShell();
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText('Cycle Counts'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
    expect(screen.getByTestId('routed').textContent).toBe('/cycle-counts');
  });

  // The regression this behaviour exists for: a close handler on the <nav>
  // shut the drawer the instant the operator touched anything inside it.
  it('stays open when the Tools & legacy disclosure is expanded', () => {
    renderShell();
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByText(/Tools & legacy/).closest('button')!);
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();
    expect(within(screen.getByRole('dialog', { name: 'Navigation' })).getByText('eBay Listings')).toBeTruthy();
  });

  it('stays open while the operator switches workspace inside it', () => {
    renderShell();
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByLabelText(/Switch workspace/));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Navigation' })).getByLabelText('Active workspace'), {
      target: { value: 'ws-2' },
    });
    expect(workspaceState.selectWorkspace).toHaveBeenCalledWith('ws-2');
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();
  });

  it('stays open while the operator changes theme inside it', () => {
    renderShell();
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Dark Vault' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('offers a backdrop that is not a second control with the same name', () => {
    const { container } = renderShell();
    openDrawer();
    // Exactly one "Close navigation" in the accessibility tree.
    expect(screen.getAllByLabelText('Close navigation')).toHaveLength(1);
    expect(container.querySelector('[data-drawer-backdrop]')!.getAttribute('aria-hidden')).toBe('true');
  });
});

// ---------------------------------------------------------------------------

describe('system truth region', () => {
  it('is present in the shell, outside the routed content', () => {
    const { container } = renderShell();
    const region = container.querySelector('[data-system-truth-region]')!;
    expect(region).toBeTruthy();
    expect(region.contains(screen.getByTestId('routed'))).toBe(false);
  });

  it('survives navigation, so a warning cannot be escaped by changing page', () => {
    const { container } = renderShell();
    const before = container.querySelector('[data-system-truth-region]');
    fireEvent.click(within(sidebar(container)).getByText('Cycle Counts'));
    expect(screen.getByTestId('routed').textContent).toBe('/cycle-counts');
    // Same node: outside <main>, so routing never unmounts it.
    expect(container.querySelector('[data-system-truth-region]')).toBe(before);
  });

  it('renders no banner while health is unresolved rather than asserting all-clear', () => {
    renderShell();
    const region = document.querySelector('[data-system-truth-region]')!;
    expect(region.textContent).toBe('');
    // "Nothing to report" and "verified healthy" are different claims, and
    // only the first is true here.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('states legacy-only mode rather than leaving it implied', async () => {
    renderShell(LEGACY_ONLY);
    const region = document.querySelector('[data-system-truth-region]')!;
    expect(await screen.findByText(/Legacy-only mode/)).toBeTruthy();
    expect(region.textContent).toContain('non-authoritative');
  });
});

// ---------------------------------------------------------------------------

describe('shell geometry', () => {
  it('keeps the sidebar off small viewports and docks it from lg', () => {
    const { container } = renderShell();
    const aside = sidebar(container);
    expect(aside.className).toContain('hidden');
    expect(aside.className).toContain('lg:flex');
  });

  // Tablet landscape gets a narrower rail than desktop: the old fixed 240px
  // took width from the record for no navigational benefit.
  it('narrows the rail on tablet landscape and widens it on desktop', () => {
    const { container } = renderShell();
    const aside = sidebar(container);
    expect(aside.className).toContain('w-52');
    expect(aside.className).toContain('xl:w-60');
  });

  it('offers the drawer trigger only below the docked breakpoint', () => {
    renderShell();
    const trigger = screen.getByLabelText('Open navigation');
    expect(trigger.closest('div')!.className).toContain('lg:hidden');
  });

  it('never lets the page itself scroll sideways', () => {
    const { container } = renderShell();
    expect(container.firstElementChild!.className).toContain('overflow-hidden');
  });

  it('imposes no maximum width on route content, which the page owns', () => {
    const { container } = renderShell();
    const main = container.querySelector('main')!;
    expect(main.className).not.toMatch(/max-w-/);
  });
});

// What jsdom cannot prove, and is therefore NOT claimed here:
//
//   * that any breakpoint actually changes the layout — jsdom evaluates no
//     media queries, so `lg:` and `xl:` are asserted as class names;
//   * that a touch target measures 44 physical pixels;
//   * that focus is visibly indicated;
//   * that focus cannot escape the open drawer by tabbing — this shell drawer
//     moves focus in and restores it out, but a continuous focus trap is the
//     reusable Dialog/Drawer primitive's job in S1.6.3, and no such trap is
//     claimed to exist yet.
//
// Those need a real browser. S1.6.7 adds Playwright and axe; neither is added
// here.

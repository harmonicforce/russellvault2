// @vitest-environment jsdom
//
// The banner this replaces rendered `null` whenever the health request failed
// — including the 503 that S0.1 introduced precisely to announce a missing,
// unreadable or emptied legacy database. These are rendered tests, not helper
// assertions, because "the operator sees nothing" was the actual defect.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SystemStatusBanner, { appliesToPath } from './SystemStatusBanner';
import {
  HealthTransportError,
  type SystemHealth,
  type SystemHealthResult,
} from '../lib/healthApi';

const fetchSystemHealth = vi.hoisted(() => vi.fn());
vi.mock('../lib/healthApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/healthApi')>()),
  fetchSystemHealth,
}));

afterEach(() => {
  cleanup();
  fetchSystemHealth.mockReset();
});

const HEALTHY: SystemHealth = {
  ok: true,
  readOnly: true,
  legacyDatabaseAvailable: true,
  legacySchemaPresent: true,
  legacySeeded: true,
  legacyBootWritesEnabled: false,
};

function healthy(overrides: Partial<SystemHealth> = {}): SystemHealthResult {
  return { status: 'healthy', health: { ...HEALTHY, ...overrides } };
}

function unhealthy(overrides: Partial<SystemHealth> = {}): SystemHealthResult {
  return {
    status: 'unhealthy',
    health: {
      ...HEALTHY,
      ok: false,
      legacyDatabaseAvailable: false,
      legacySchemaPresent: false,
      legacySeeded: false,
      reason: 'legacy_database_missing',
      ...overrides,
    },
  };
}

function renderBanner(
  props: { provenanceEnabled?: boolean; appMode?: 'governed' | 'legacy-only' } = {},
  route = '/',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SystemStatusBanner provenanceEnabled appMode="governed" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('governed mode, healthy legacy database', () => {
  it('warns on a legacy write route that changes will not be saved', async () => {
    fetchSystemHealth.mockResolvedValue(healthy({ readOnly: true }));
    renderBanner({}, '/purchases');
    expect(await screen.findByText(/changes here will not be saved/i)).toBeTruthy();
  });

  it('stays silent on a governed route, whose writes are unaffected', async () => {
    fetchSystemHealth.mockResolvedValue(healthy({ readOnly: true }));
    const { container } = renderBanner({}, '/inventory/current');
    await waitFor(() => expect(fetchSystemHealth).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('stays silent on a legacy route when legacy writes are enabled', async () => {
    fetchSystemHealth.mockResolvedValue(healthy({ readOnly: false }));
    const { container } = renderBanner({}, '/sales');
    await waitFor(() => expect(fetchSystemHealth).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('legacy-only mode is visible, never implied', () => {
  it('states that the data is non-authoritative and governed workflows are unavailable', async () => {
    fetchSystemHealth.mockResolvedValue(healthy({ readOnly: false }));
    const { container } = renderBanner({ provenanceEnabled: false, appMode: 'legacy-only' }, '/inventory');
    await screen.findByText(/legacy-only mode/i);
    expect(container.textContent).toMatch(/non-authoritative/i);
    expect(container.textContent).toMatch(/governed inventory workflows are unavailable/i);
    expect(container.textContent).toMatch(/never be combined/i);
  });

  it('folds the read-only fact into one notice rather than stacking two', async () => {
    fetchSystemHealth.mockResolvedValue(healthy({ readOnly: true }));
    const { container } = renderBanner({ provenanceEnabled: false, appMode: 'legacy-only' }, '/inventory');
    // The read-only sentence appears once health resolves, in the SAME banner.
    await waitFor(() => expect(container.textContent).toMatch(/will not be saved/i));
    expect(container.querySelectorAll('div.border-b')).toHaveLength(1);
    expect(container.textContent).toMatch(/non-authoritative/i);
  });
});

describe('a structured legacy database failure is loud on every route', () => {
  it('raises a critical alert on a legacy route and says the page is unreliable', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    renderBanner({}, '/purchases');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/legacy data unavailable/i);
    expect(alert.textContent).toMatch(/could not be found/i);
    expect(alert.textContent).toMatch(/cannot show reliable legacy data/i);
    // Never let an empty list read as a real zero.
    expect(alert.textContent).toMatch(/zero total/i);
  });

  it('stays visible on a governed route without claiming governed writes are down', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    renderBanner({}, '/inventory/current');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/legacy data unavailable/i);
    expect(alert.textContent).toMatch(/governed inventory workflows are unaffected/i);
    expect(alert.textContent).not.toMatch(/governed .*(disabled|unavailable)/i);
  });

  it.each([
    ['legacy_database_unreadable', /could not be read/i],
    ['legacy_schema_missing', /missing tables or columns/i],
    ['legacy_baseline_empty', /imported records are missing/i],
    ['legacy_health_check_failed', /health check did not complete/i],
  ] as const)('maps %s to safe fixed copy', async (reason, expected) => {
    fetchSystemHealth.mockResolvedValue(unhealthy({ reason }));
    renderBanner({}, '/sales');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(expected);
  });

  it('falls back to generic copy when no reason survived validation', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy({ reason: undefined }));
    renderBanner({}, '/sales');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not usable/i);
  });

  it('renders no server text, path, SQL or stack trace', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    const { container } = renderBanner({}, '/purchases');
    await screen.findByRole('alert');
    expect(container.textContent).not.toMatch(/\/data|vault\.db|SQLITE_|SELECT |\bat \w+\.\w+/);
  });

  it('is critical even in legacy-only mode, outranking the legacy-only notice', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    const { container } = renderBanner({ provenanceEnabled: false, appMode: 'legacy-only' }, '/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/legacy data unavailable/i);
    expect(container.querySelectorAll('div.border-b')).toHaveLength(1);
  });
});

describe('an unverifiable health response never disappears silently', () => {
  it('warns when the request fails on the network', async () => {
    fetchSystemHealth.mockRejectedValue(new HealthTransportError('network'));
    renderBanner({}, '/inventory/current');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be verified/i);
  });

  it('warns when the response was not the documented shape', async () => {
    fetchSystemHealth.mockRejectedValue(new HealthTransportError('protocol'));
    renderBanner({}, '/inventory/current');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be verified/i);
    // Must not be silently reinterpreted as "writes are fine".
    expect(alert.textContent).not.toMatch(/read-only mode/i);
  });

  it('offers a retry that refetches health', async () => {
    fetchSystemHealth.mockRejectedValue(new HealthTransportError('network'));
    renderBanner({}, '/purchases');
    await screen.findByRole('alert');
    const callsBefore = fetchSystemHealth.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(fetchSystemHealth.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('renders something rather than nothing — the exact old defect', async () => {
    fetchSystemHealth.mockRejectedValue(new HealthTransportError('network'));
    const { container } = renderBanner({}, '/purchases');
    await screen.findByRole('alert');
    expect(container.textContent).not.toBe('');
  });
});

describe('accessibility', () => {
  it('marks failures with role=alert and offers no dismiss control', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    renderBanner({}, '/purchases');
    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.queryByRole('button', { name: /dismiss|close/i })).toBeNull();
  });

  it('carries its meaning in text, not only in colour', async () => {
    fetchSystemHealth.mockResolvedValue(unhealthy());
    renderBanner({}, '/purchases');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent && alert.textContent.trim().length).toBeGreaterThan(40);
  });
});

// Scope rules carried over from the banner this replaces: an incorrect warning
// tells the owner their working app is broken.
describe('legacy write-path scope', () => {
  it('covers every page when the governed surfaces are switched off', () => {
    for (const path of ['/', '/inventory', '/sales', '/checks', '/anything']) {
      expect(appliesToPath(path, false)).toBe(true);
    }
  });

  it('still warns on the legacy write surfaces', () => {
    for (const path of ['/inventory', '/purchases', '/cost-links', '/listings', '/sales']) {
      expect(appliesToPath(path, true)).toBe(true);
    }
  });

  it('stays off the governed pages, whose writes are unaffected', () => {
    for (const path of [
      '/', '/workbench', '/quick-add', '/batch-intake', '/scan',
      '/inventory/current', '/inventory/current/abc-123', '/inventory/lots/def-456',
      '/intake-sessions', '/locations', '/checks',
    ]) {
      expect(appliesToPath(path, true)).toBe(false);
    }
  });

  it('distinguishes legacy /inventory from the governed inventory beneath it', () => {
    expect(appliesToPath('/inventory', true)).toBe(true);
    expect(appliesToPath('/inventory/current', true)).toBe(false);
    expect(appliesToPath('/inventory/lots/x', true)).toBe(false);
  });
});

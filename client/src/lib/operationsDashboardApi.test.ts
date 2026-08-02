import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelError, createOperationsDashboardTransport } from './operationsDashboardApi';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const transport = () => createOperationsDashboardTransport(async () => 'token');

describe('operations dashboard transport', () => {
  it('scopes every panel request to the workspace and caller token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ asOf: '2026-08-01T00:00:00Z', serializedUnits: 2, lotManagedRecords: 1, lotManagedUnits: 4, withoutLocation: 0 }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await createOperationsDashboardTransport(async () => 'caller-token').health('workspace A');
    const [url, init] = fetchMock.mock.calls[0];
    // Asserted through the parser rather than as a literal: URLSearchParams
    // encodes a space as '+', which decodes identically server-side, and the
    // guarantee that matters is the workspace and token that were sent.
    const parsed = new URL(url as string, 'http://test.local');
    expect(parsed.pathname).toBe('/api/operations-dashboard/health');
    expect(parsed.searchParams.get('workspaceId')).toBe('workspace A');
    expect(init).toEqual({ headers: { authorization: 'Bearer caller-token' } });
  });

  // The whole point of the panel contract: a dependency that failed is never
  // allowed to resolve as data the dashboard could render as a zero.
  it('rejects a failed panel rather than substituting zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(
      { error: 'panel_unavailable', code: 'dependency_failed', message: 'A dependency failed.' }, 503)));
    await expect(transport().health('workspace')).rejects.toThrow(PanelError);
  });

  it('carries the stable code so the panel can act on the reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(
      { error: 'panel_unavailable', code: 'dashboard_contract_missing', message: 'The required database update has not been applied.' }, 503)));
    await expect(transport().health('ws')).rejects.toMatchObject({
      code: 'dashboard_contract_missing', status: 503,
      message: 'The required database update has not been applied.',
    });
  });

  // Regression: middleware sends `{ error }` with no `detail`, and reading
  // `detail` alone reduced every auth failure to "Panel failed (403)".
  it('keeps an authentication or membership failure understandable', async () => {
    for (const [status, message] of [
      [401, 'invalid or expired authentication'],
      [403, 'not a member of this workspace'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: message }, status)));
      await expect(transport().work('ws')).rejects.toMatchObject({ status, message });
    }
  });

  it('keeps a disabled deployment distinguishable from a broken one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(
      { error: 'panel_unavailable', code: 'feature_unavailable', message: 'This dashboard is not enabled on this deployment.' }, 404)));
    await expect(transport().workflows('ws')).rejects.toMatchObject({ status: 404, code: 'feature_unavailable' });
  });

  it('still reports a failure when the body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 502 })));
    await expect(transport().activity('ws')).rejects.toThrow(/502/);
  });

  it('refuses to send an unauthenticated request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createOperationsDashboardTransport(async () => null).health('ws'))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still accepts the older detail-only failure shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'database unavailable' }, 400)));
    await expect(transport().health('workspace')).rejects.toThrow('database unavailable');
  });
});

describe('media readiness drill-down', () => {
  it('sends the requested status so the page matches the tile that linked to it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ asOf: 'now', total: 0, limit: 50, offset: 0, rows: [] }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await transport().mediaReadiness('ws-1', ['missing_required_angle']);
    const parsed = new URL(fetchMock.mock.calls[0][0] as string, 'http://test.local');
    expect(parsed.pathname).toBe('/api/operations-dashboard/media-readiness');
    expect(parsed.searchParams.get('workspaceId')).toBe('ws-1');
    expect(parsed.searchParams.get('status')).toBe('missing_required_angle');
  });

  it('omits the status filter entirely when none is requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ asOf: 'now', total: 0, limit: 50, offset: 0, rows: [] }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await transport().mediaReadiness('ws-1');
    const parsed = new URL(fetchMock.mock.calls[0][0] as string, 'http://test.local');
    expect(parsed.searchParams.has('status')).toBe(false);
  });
});

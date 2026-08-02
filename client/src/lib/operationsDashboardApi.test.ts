import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationsDashboardTransport } from './operationsDashboardApi';

afterEach(() => vi.unstubAllGlobals());

describe('operations dashboard transport', () => {
  it('scopes every panel request to the workspace and caller token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ asOf: '2026-08-01T00:00:00Z', serializedUnits: 2, lotManagedRecords: 1, lotManagedUnits: 4, withoutLocation: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await createOperationsDashboardTransport(async () => 'caller-token').health('workspace A');
    expect(fetchMock).toHaveBeenCalledWith('/api/operations-dashboard/health?workspaceId=workspace%20A', { headers: { authorization: 'Bearer caller-token' } });
  });

  it('rejects a failed panel rather than substituting zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'database unavailable' }), { status: 400 })));
    await expect(createOperationsDashboardTransport(async () => 'token').health('workspace')).rejects.toThrow('database unavailable');
  });
});

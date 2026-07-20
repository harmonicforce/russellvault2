// HTTP transport for the Phase 4 acquisition staging-review interface.
//
// Every call goes to the server's /api/acquisition surface carrying the caller's
// own Supabase access token and an explicit workspace id. The server verifies
// that token against the shadow project and resolves membership under the same
// JWT; the database then enforces RLS and the governed RPCs. There is no
// service-role key anywhere in this path.
//
// This module never reads or writes inventory, listings, or sales; those remain
// exclusively on the legacy SQLite REST path. No dual-write exists.

import type {
  AcquisitionJobRow,
  AcquisitionOrderRow,
  AcquisitionTransport,
  ChannelRow,
  CommitOutcome,
  OrderDetail,
  PreviewSummary,
  SupplierCandidate,
} from './acquisitionReview';

export type TokenProvider = () => Promise<string | null>;

async function request<T>(
  getToken: TokenProvider,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('you are signed out; sign in to review acquisitions');

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api/acquisition${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function createAcquisitionTransport(getToken: TokenProvider): AcquisitionTransport {
  const get = <T>(path: string) => request<T>(getToken, 'GET', path);
  const post = <T>(path: string, body: unknown) => request<T>(getToken, 'POST', path, body);
  const ws = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

  return {
    async listJobs(workspaceId) {
      const r = await get<{ jobs: AcquisitionJobRow[] }>(`/jobs?${ws(workspaceId)}`);
      return r.jobs;
    },
    async listChannels(workspaceId) {
      const r = await get<{ channels: ChannelRow[] }>(`/channels?${ws(workspaceId)}`);
      return r.channels;
    },
    async listOrders(workspaceId, limit, offset) {
      return get<{ total: number; orders: AcquisitionOrderRow[] }>(
        `/orders?${ws(workspaceId)}&limit=${limit}&offset=${offset}`
      );
    },
    async getOrderDetail(workspaceId, orderId) {
      return get<OrderDetail>(`/orders/${encodeURIComponent(orderId)}?${ws(workspaceId)}`);
    },
    async listSupplierCandidates(workspaceId) {
      const r = await get<{ candidates: SupplierCandidate[] }>(
        `/supplier-candidates?${ws(workspaceId)}`
      );
      return r.candidates;
    },
    async listAuditEvents(workspaceId) {
      const r = await get<{ auditEvents: Array<Record<string, unknown>> }>(
        `/audit-events?${ws(workspaceId)}`
      );
      return r.auditEvents;
    },
    async preview(workspaceId, sourceImportJobId) {
      return post<PreviewSummary>('/preview', { workspaceId, sourceImportJobId });
    },
    async commit(workspaceId, input) {
      return post<CommitOutcome>('/commit', { workspaceId, ...input });
    },
  };
}

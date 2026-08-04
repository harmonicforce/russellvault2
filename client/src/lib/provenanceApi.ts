// HTTP transport for the Phase 3 staging import-review interface.
//
// Every call goes to the server's /api/provenance surface carrying the caller's
// own Supabase access token and an explicit workspace id. The server verifies
// that token against the shadow project and resolves membership under the same
// JWT; the database then enforces RLS and the governed RPCs. There is no
// service-role key anywhere in this path and no privileged bypass.
//
// This module handles import PROVENANCE only. It never reads or writes the
// governed inventory domains, and it never touches the legacy SQLite domains
// (legacy inventory, purchases, cost links, listings, sales) — those remain on
// the legacy REST path. See dataTopology.ts for which system owns which
// domain. No dual-write exists in either direction.

import type {
  AuditEventRow,
  CrosswalkState,
  DataQualityIssueRow,
  DataQualityStatus,
  ImportJobRow,
  SourceCrosswalkRow,
  SourceRecordRow,
} from './database.types';
import type {
  CommitOutcome,
  FixtureSummary,
  PreviewSummary,
  ProvenanceTransport,
  SourceSystemSummary,
} from './importReview';

/** Supplies the current access token, or null when signed out. */
export type TokenProvider = () => Promise<string | null>;

async function request<T>(
  getToken: TokenProvider,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('you are signed out; sign in to review imports');

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api/provenance${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    // The server and database are the authority on why something was refused;
    // surface their message rather than inventing a local explanation.
    throw new Error(detail?.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function createProvenanceTransport(getToken: TokenProvider): ProvenanceTransport {
  const get = <T>(path: string) => request<T>(getToken, 'GET', path);
  const post = <T>(path: string, body: unknown) =>
    request<T>(getToken, 'POST', path, body);
  const ws = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

  return {
    async listFixtures(workspaceId) {
      const r = await get<{ fixtures: FixtureSummary[] }>(`/fixtures?${ws(workspaceId)}`);
      return r.fixtures;
    },

    async listSourceSystems(workspaceId) {
      const r = await get<{ sourceSystems: SourceSystemSummary[] }>(
        `/source-systems?${ws(workspaceId)}`
      );
      return r.sourceSystems;
    },

    async preview(workspaceId, filename) {
      return post<PreviewSummary>('/preview', { workspaceId, filename });
    },

    async commit(workspaceId, input) {
      return post<CommitOutcome>('/commit', { workspaceId, ...input });
    },

    async listJobs(workspaceId) {
      const r = await get<{ jobs: ImportJobRow[] }>(`/jobs?${ws(workspaceId)}`);
      return r.jobs;
    },

    async getJob(workspaceId, jobId) {
      const r = await get<{ job: ImportJobRow }>(
        `/jobs/${encodeURIComponent(jobId)}?${ws(workspaceId)}`
      );
      return r.job;
    },

    async listRecords(workspaceId, jobId, limit, offset) {
      return get<{ total: number; records: SourceRecordRow[] }>(
        `/jobs/${encodeURIComponent(jobId)}/records?${ws(workspaceId)}` +
          `&limit=${limit}&offset=${offset}`
      );
    },

    async listIssues(workspaceId, jobId) {
      const r = await get<{ issues: DataQualityIssueRow[] }>(
        `/jobs/${encodeURIComponent(jobId)}/issues?${ws(workspaceId)}`
      );
      return r.issues;
    },

    async listCrosswalks(workspaceId, states: CrosswalkState[]) {
      const r = await get<{ crosswalks: SourceCrosswalkRow[] }>(
        `/crosswalks?${ws(workspaceId)}&states=${states.join(',')}`
      );
      return r.crosswalks;
    },

    async listAuditEvents(workspaceId) {
      const r = await get<{ auditEvents: AuditEventRow[] }>(
        `/audit-events?${ws(workspaceId)}`
      );
      return r.auditEvents;
    },

    async confirmCrosswalk(workspaceId, id, note) {
      await post(`/crosswalks/${encodeURIComponent(id)}/confirm`, { workspaceId, note });
    },

    async rejectCrosswalk(workspaceId, id, note) {
      await post(`/crosswalks/${encodeURIComponent(id)}/reject`, { workspaceId, note });
    },

    async supersedeCrosswalk(workspaceId, id, replacementId, note) {
      await post(`/crosswalks/${encodeURIComponent(id)}/supersede`, {
        workspaceId,
        replacementId,
        note,
      });
    },

    async resolveIssue(workspaceId, id, status: DataQualityStatus, note) {
      await post(`/issues/${encodeURIComponent(id)}/resolve`, { workspaceId, status, note });
    },
  };
}

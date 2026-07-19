// Phase 3 provenance data access.
//
// Two distinct sources, deliberately kept separate:
//
//   1. The repository-fixture ADAPTER (/api/provenance/*) — the deterministic,
//      read-only transformation of files committed to this repository. It
//      computes hashes and builds an import plan. It writes nothing.
//
//   2. The shadow SUPABASE database — where committed provenance actually
//      lives. Every read and every review action here runs under the caller's
//      own JWT, so the Phase 3 RLS policies and the governed SECURITY DEFINER
//      functions are the authorization boundary. There is no service-role key
//      in the client and no server-side bypass.
//
// This module is NOT a data adapter for business records. It never reads or
// writes inventory, purchases, listings, or sales; those remain exclusively on
// the legacy SQLite REST path (see dataAdapter.ts). No dual-write exists.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  AuditEventRow,
  CrosswalkState,
  DataQualityIssueRow,
  DataQualityStatus,
  ImportJobRow,
  SourceCrosswalkRow,
  SourceRecordRow,
} from './database.types';

// --- Adapter (repository fixtures, read-only) -------------------------------

export interface FixtureSummary {
  filename: string;
  shape: string;
  description: string;
}

export interface ImportPlanSummary {
  mode: 'preview' | 'commit';
  sourceLabel: string;
  fileSha256: string;
  contentSha256: string;
  parserVersion: string;
  mappingVersion: string;
  sourceRowCount: number;
  acceptedRowCount: number;
  issueRowCount: number;
  sourceTotals: Record<string, number>;
  crosswalkCandidateCount: number;
  issueCount: number;
  staging: true;
  authoritative: false;
  committed?: boolean;
  idempotencyKey?: string | null;
}

async function adapterRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/provenance${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(detail.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function listFixtures() {
  return adapterRequest<{
    parserVersion: string;
    mappingVersion: string;
    fixtures: FixtureSummary[];
  }>('/fixtures');
}

/** Preview an import. Creates and modifies nothing. */
export function previewImport(filename: string) {
  return adapterRequest<ImportPlanSummary>('/preview', { filename });
}

export function previewRecords(filename: string, limit = 25, offset = 0) {
  return adapterRequest<{
    total: number;
    records: Array<{
      sourceRowIndex: number;
      sourceRowKey: string | null;
      rawPayload: unknown;
      normalizedHash: string;
      parseStatus: 'parsed' | 'malformed';
      errors: Array<{ field: string; code: string; message: string }>;
    }>;
  }>('/preview/records', { filename, limit, offset });
}

export function previewIssues(filename: string) {
  return adapterRequest<{
    total: number;
    issues: Array<{
      issueType: string;
      severity: string;
      message: string;
      detail: Record<string, unknown>;
    }>;
  }>('/preview/issues', { filename });
}

export function previewCrosswalks(filename: string) {
  return adapterRequest<{
    total: number;
    crosswalks: Array<{
      sourceRowIndex: number;
      proposedEntityType: string;
      proposedEntityKey: string;
      matchMethod: string;
      confidence: number;
      reviewState: 'candidate';
    }>;
  }>('/preview/crosswalks', { filename });
}

/** Build a commit plan. The idempotency key is mandatory. */
export function buildCommitPlan(filename: string, idempotencyKey: string) {
  return adapterRequest<ImportPlanSummary>('/commit-plan', { filename, idempotencyKey });
}

// --- Stored provenance (shadow Supabase, RLS-enforced) ----------------------

type Client = SupabaseClient<Database>;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('no data returned');
  return result.data;
}

export async function listImportJobs(
  client: Client,
  workspaceId: string,
  limit = 50
): Promise<ImportJobRow[]> {
  return unwrap(
    await client.from('import_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(limit)
  );
}

export async function getImportJob(
  client: Client,
  jobId: string
): Promise<ImportJobRow> {
  const rows = unwrap<ImportJobRow[]>(
    await client.from('import_jobs').select('*').eq('id', jobId).limit(1)
  );
  if (rows.length === 0) throw new Error('import job not found');
  return rows[0];
}

export async function listSourceRecords(
  client: Client,
  jobId: string,
  limit = 50,
  offset = 0
): Promise<SourceRecordRow[]> {
  return unwrap(
    await client.from('source_records')
      .select('*')
      .eq('import_job_id', jobId)
      .order('source_row_index', { ascending: true })
      .range(offset, offset + limit - 1)
  );
}

export async function listParseIssues(
  client: Client,
  jobId: string
): Promise<DataQualityIssueRow[]> {
  return unwrap(
    await client.from('data_quality_issues')
      .select('*')
      .eq('import_job_id', jobId)
      .order('created_at', { ascending: true })
  );
}

export async function listCrosswalks(
  client: Client,
  workspaceId: string,
  states: CrosswalkState[] = ['candidate', 'rejected', 'superseded']
): Promise<SourceCrosswalkRow[]> {
  return unwrap(
    await client.from('source_crosswalks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('review_state', states)
      .order('created_at', { ascending: false })
  );
}

export async function listAuditEvents(
  client: Client,
  workspaceId: string,
  limit = 100
): Promise<AuditEventRow[]> {
  return unwrap(
    await client.from('audit_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('event_seq', { ascending: false })
      .limit(limit)
  );
}

// --- Governed review actions (RPC only) -------------------------------------
// Each of these is a SECURITY DEFINER function that authorizes internally.
// There is deliberately no direct-table-update path for any of them: the
// review-state columns are not updatable from the client at all.

async function rpc(client: Client, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) throw new Error((error as { message: string }).message);
  return data as string;
}

/** Commit requires the idempotency key the job was created with. */
export function commitImportJob(
  client: Client,
  importJobId: string,
  idempotencyKey: string
) {
  if (!idempotencyKey || idempotencyKey.trim().length < 8) {
    throw new Error('commit requires an idempotency key of at least 8 characters');
  }
  return rpc(client, 'commit_import_job', {
    p_import_job_id: importJobId,
    p_idempotency_key: idempotencyKey,
  });
}

export function confirmCrosswalk(client: Client, crosswalkId: string, note?: string) {
  return rpc(client, 'confirm_source_crosswalk', {
    p_crosswalk_id: crosswalkId,
    p_note: note ?? null,
  });
}

export function rejectCrosswalk(client: Client, crosswalkId: string, note?: string) {
  return rpc(client, 'reject_source_crosswalk', {
    p_crosswalk_id: crosswalkId,
    p_note: note ?? null,
  });
}

export function supersedeCrosswalk(
  client: Client,
  crosswalkId: string,
  replacementId: string,
  note?: string
) {
  return rpc(client, 'supersede_source_crosswalk', {
    p_crosswalk_id: crosswalkId,
    p_replacement_id: replacementId,
    p_note: note ?? null,
  });
}

export function resolveIssue(
  client: Client,
  issueId: string,
  status: DataQualityStatus,
  note?: string
) {
  return rpc(client, 'resolve_data_quality_issue', {
    p_issue_id: issueId,
    p_status: status,
    p_note: note ?? null,
  });
}

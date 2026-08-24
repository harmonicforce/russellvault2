// Reads an already-COMMITTED Phase 3 import job's source records back out of the
// shadow database, under the caller's own JWT, so the acquisition adapter can
// map them. This is the provenance-dependency boundary in the service layer:
// Phase 4 never re-reads a fixture file to build authoritative acquisition rows;
// it consumes what Phase 3 committed.

import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages } from '../rpcContract.js';
import type { CommittedSourceRow } from './adapter.js';

const PAGE = 1000;

export class SourceReadError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Load the committed source records of one import job as adapter input. Only
 * successfully-parsed rows become acquisition lines; a malformed row stays in
 * provenance as evidence and is surfaced as a data-quality issue, never mapped
 * into an authoritative acquisition fact.
 */
export async function readCommittedSourceRows(
  client: SupabaseClient,
  workspaceId: string,
  sourceImportJobId: string
): Promise<CommittedSourceRow[]> {
  // PROVENANCE DEPENDENCY: never read a job's rows for mapping unless that job is
  // actually COMMITTED. A preview has no begin_acquisition_import_job to enforce
  // this, so it is enforced here — a preview of a non-committed (or absent) job
  // is refused before any source_record is read.
  const { data: jobRows, error: jobErr } = await client
    .from('import_jobs')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('id', sourceImportJobId)
    .limit(1);
  if (jobErr) throw new SourceReadError(jobErr.message, 400);
  if (!jobRows || jobRows.length === 0) {
    throw new SourceReadError('source import job not found', 404);
  }
  if ((jobRows[0] as { status: string }).status !== 'committed') {
    throw new SourceReadError(
      'source import job is not committed; only a committed Phase 3 import may be mapped',
      409
    );
  }

  const records = await readAllPages(PAGE, (from, to) =>
    client
      .from('source_records')
      .select('id, source_row_index, raw_payload, parse_status')
      .eq('workspace_id', workspaceId)
      .eq('import_job_id', sourceImportJobId)
      .eq('parse_status', 'parsed')
      .order('source_row_index', { ascending: true })
      .range(from, to),
    (message) => new SourceReadError(message, 400),
  );

  // Map each source record to its scoped source-row-key external identifier so
  // the acquisition line retains that link too.
  const identifiers = await readAllPages(PAGE, (from, to) =>
    client
      .from('external_identifiers')
      .select('id, source_record_id, identifier_type')
      .eq('workspace_id', workspaceId)
      .eq('identifier_type', 'source_row_key')
      .range(from, to),
    (message) => new SourceReadError(message, 400),
  );
  const extIdBySource = new Map<string, string>();
  for (const row of identifiers) {
    if (row.source_record_id) extIdBySource.set(String(row.source_record_id), String(row.id));
  }

  return records.map((r) => ({
    sourceRecordId: String(r.id),
    externalIdentifierId: extIdBySource.get(String(r.id)) ?? null,
    sourceRowIndex: Number(r.source_row_index),
    rawPayload: r.raw_payload as CommittedSourceRow['rawPayload'],
  }));
}

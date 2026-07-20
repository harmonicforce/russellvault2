// Reads an already-COMMITTED Phase 3 import job's source records back out of the
// shadow database, under the caller's own JWT, so the acquisition adapter can
// map them. This is the provenance-dependency boundary in the service layer:
// Phase 4 never re-reads a fixture file to build authoritative acquisition rows;
// it consumes what Phase 3 committed.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommittedSourceRow } from './adapter.js';

const PAGE = 1000;

export class SourceReadError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readAll(
  client: SupabaseClient,
  table: string,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: (q: any) => any
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let from = 0;
  for (;;) {
    const query = filter(client.from(table).select(columns));
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new SourceReadError((error as { message: string }).message, 400);
    const page = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return out;
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
  const records = await readAll(
    client,
    'source_records',
    'id, source_row_index, raw_payload, parse_status',
    (q) =>
      q
        .eq('workspace_id', workspaceId)
        .eq('import_job_id', sourceImportJobId)
        .eq('parse_status', 'parsed')
        .order('source_row_index', { ascending: true })
  );

  // Map each source record to its scoped source-row-key external identifier so
  // the acquisition line retains that link too.
  const identifiers = await readAll(
    client,
    'external_identifiers',
    'id, source_record_id, identifier_type',
    (q) =>
      q
        .eq('workspace_id', workspaceId)
        .eq('identifier_type', 'source_row_key')
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

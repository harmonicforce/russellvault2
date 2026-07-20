// End-to-end governed import driver.
//
// Turns an import plan (deterministic, computed from repository fixture bytes)
// into persisted provenance, by calling the governed RPCs in order under the
// CALLER'S OWN JWT. The server holds no privileged database credential; every
// statement below is subject to the same RLS and role checks a browser would
// face. Its only advantage is locality: it reads the fixture from disk and
// streams the rows to the database in batches.
//
// WHY THE SERVER DRIVES THIS
// The Whatnot fixture is 2,149 rows / ~1.3 MB. Shipping that to a browser and
// back would be an unreasonable HTTP payload. Instead the browser sends one
// small request (workspace, source system, fixture name, idempotency key) and
// the server performs the batched staging locally. No batch exceeds
// RECORD_BATCH_SIZE rows, so no single RPC argument is ever large.
//
// ORDER IS FIXED AND ENFORCED ON BOTH SIDES
//   1. begin_import_job          — open the governed job
//   2. stage_source_records      — EXACT raw payloads, in batches, first
//   3. stage_external_identifiers— scoped aliases, addressed by row index
//   4. stage_import_derivatives  — issues + candidate crosswalks
//   5. finalize_import_job       — recounts everything, then commits
// The database refuses steps 3-5 if step 2 is incomplete, so a bug here cannot
// produce a committed job with missing evidence.
//
// FAILURE BEHAVIOR
// If any step throws, the job is marked failed via fail_import_job and the
// error is surfaced. A failed job is visibly failed, never committed, keeps its
// staged raw rows as evidence, and a corrected run proceeds under a new
// idempotency key. If even the fail call cannot be made, the job simply remains
// in 'preview' — still not committed, and resumable with the same key.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportPlan } from './adapter.js';

export const RECORD_BATCH_SIZE = 250;
export const IDENTIFIER_BATCH_SIZE = 250;

export interface CommitOutcome {
  readonly importJobId: string;
  readonly status: 'committed';
  readonly resumed: boolean;
  readonly sourceRows: number;
  readonly acceptedRows: number;
  readonly issueRows: number;
  readonly issues: number;
  readonly crosswalks: number;
  readonly externalIdentifiers: number;
  readonly batches: number;
}

export class CommitError extends Error {
  readonly status: number;
  readonly importJobId: string | null;
  constructor(message: string, status: number, importJobId: string | null = null) {
    super(message);
    this.status = status;
    this.importJobId = importJobId;
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function rpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) {
    // Surface the database's own message: it is the authority on why this was
    // refused, and duplicating that reasoning here would let the two drift.
    throw new CommitError((error as { message: string }).message, 409);
  }
  return data as T;
}

// External identifiers derived from the source's own row keys. These are
// SCOPED aliases, never canonical keys: the scope is namespaced per source
// label so an identical-looking value from another source stays distinct.
function buildIdentifiers(plan: ImportPlan): Array<Record<string, unknown>> {
  const scope = `fixture.${plan.sourceLabel.replace(/\.json$/, '')}`;
  const out: Array<Record<string, unknown>> = [];
  for (const record of plan.records) {
    if (!record.sourceRowKey) continue;
    out.push({
      source_row_index: record.sourceRowIndex,
      scope,
      identifier_type: 'source_row_key',
      identifier_value: record.sourceRowKey,
    });
  }
  return out;
}

export async function commitImportPlan(
  client: SupabaseClient,
  workspaceId: string,
  sourceSystemId: string,
  plan: ImportPlan
): Promise<CommitOutcome> {
  if (plan.mode !== 'commit' || !plan.idempotencyKey) {
    throw new CommitError('a commit plan with an idempotency key is required', 400);
  }

  // 1. Open the governed job. A repeated key resumes rather than duplicating.
  const begun = await rpc<{ id: string; status: string; resumed: boolean }>(
    client,
    'begin_import_job',
    {
      p_workspace_id: workspaceId,
      p_source_system_id: sourceSystemId,
      p_source_label: plan.sourceLabel,
      p_file_sha256: plan.fileSha256,
      p_content_sha256: plan.contentSha256,
      p_parser_version: plan.parserVersion,
      p_mapping_version: plan.mappingVersion,
      p_idempotency_key: plan.idempotencyKey,
      p_source_row_count: plan.sourceRowCount,
      p_source_totals: plan.sourceTotals,
    }
  );

  const importJobId = begun.id;
  if (begun.status === 'committed') {
    throw new CommitError(
      'this import is already committed; re-running it would duplicate nothing and changes nothing',
      409,
      importJobId
    );
  }

  let batches = 0;

  try {
    // 2. RAW ROWS FIRST — the exact payloads, before anything derived.
    const recordBatches = chunk(plan.records, RECORD_BATCH_SIZE);
    for (const batch of recordBatches) {
      await rpc(client, 'stage_source_records', {
        p_import_job_id: importJobId,
        p_records: batch.map((r) => ({
          source_row_index: r.sourceRowIndex,
          source_row_key: r.sourceRowKey,
          raw_payload: r.rawPayload,
          normalized_hash: r.normalizedHash,
          parse_status: r.parseStatus,
          parser_output: r.parserOutput,
          errors: r.errors,
          warnings: r.warnings,
        })),
      });
      batches += 1;
    }

    // 3. Scoped external identifiers, addressed by already-staged row index.
    const identifiers = buildIdentifiers(plan);
    for (const batch of chunk(identifiers, IDENTIFIER_BATCH_SIZE)) {
      await rpc(client, 'stage_external_identifiers', {
        p_import_job_id: importJobId,
        p_identifiers: batch,
      });
      batches += 1;
    }

    // 4. Issues and CANDIDATE crosswalks. review_state is not sent at all:
    //    the database forces candidate and refuses anything else.
    await rpc(client, 'stage_import_derivatives', {
      p_import_job_id: importJobId,
      p_issues: plan.issues.map((i) => ({
        source_row_index: i.sourceRowIndex,
        issue_type: i.issueType,
        severity: i.severity,
        message: i.message,
        detail: i.detail,
        raw_payload_snapshot: i.rawPayloadSnapshot,
      })),
      p_crosswalks: plan.crosswalks.map((c) => ({
        source_row_index: c.sourceRowIndex,
        proposed_entity_type: c.proposedEntityType,
        proposed_entity_key: c.proposedEntityKey,
        confidence: c.confidence,
        match_method: c.matchMethod,
        evidence: c.evidence,
      })),
    });
    batches += 1;

    // 5. Finalize. The database recounts everything and refuses to commit
    //    anything incomplete or inconsistent with these expectations. All six
    //    counts are ALWAYS supplied, explicitly, even when the true count is
    //    zero — finalize_import_job has no default and no null-skip for any
    //    of them, so there is no way to accidentally omit an expectation just
    //    because a derivative happens to be empty for this plan.
    const finalized = await rpc<{
      id: string;
      status: string;
      source_rows: number;
      accepted_rows: number;
      issue_rows: number;
      issues: number;
      crosswalks: number;
      external_identifiers: number;
    }>(client, 'finalize_import_job', {
      p_import_job_id: importJobId,
      p_idempotency_key: plan.idempotencyKey,
      p_expected_source_rows: plan.sourceRowCount,
      p_expected_accepted_rows: plan.acceptedRowCount,
      p_expected_issue_rows: plan.issueRowCount,
      p_expected_total_issues: plan.issues.length,
      p_expected_crosswalks: plan.crosswalks.length,
      p_expected_external_identifiers: identifiers.length,
    });

    return {
      importJobId,
      status: 'committed',
      resumed: begun.resumed,
      sourceRows: finalized.source_rows,
      acceptedRows: finalized.accepted_rows,
      issueRows: finalized.issue_rows,
      issues: finalized.issues,
      crosswalks: finalized.crosswalks,
      externalIdentifiers: finalized.external_identifiers,
      batches,
    };
  } catch (err) {
    // Mark the attempt visibly failed. Best-effort: if this cannot be recorded
    // the job stays 'preview', which is still not committed and still resumable.
    const detail = err instanceof Error ? err.message : 'unknown error';
    try {
      await rpc(client, 'fail_import_job', {
        p_import_job_id: importJobId,
        p_failure_code: 'staging_failed',
        p_failure_detail: detail.slice(0, 4000),
      });
    } catch {
      // Deliberately swallowed: the original failure is the useful one.
    }
    if (err instanceof CommitError) {
      throw new CommitError(err.message, err.status, importJobId);
    }
    throw new CommitError(detail, 500, importJobId);
  }
}

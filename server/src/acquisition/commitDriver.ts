// End-to-end governed acquisition-mapping driver (Phase 4).
//
// Turns an ACQUISITION PLAN (deterministic, computed from committed Phase 3
// provenance) into persisted acquisition rows, by calling the governed RPCs in
// order under the CALLER'S OWN JWT. The server holds no privileged database
// credential; every statement below is subject to the same RLS and role checks
// a browser would face.
//
// WHY THE SERVER DRIVES THIS
// The Whatnot job is 2,149 lines. Shipping that to a browser and back would be
// an unreasonable HTTP payload, so the browser sends one small request
// (workspace, channel, source import job, idempotency key) and the server does
// the batched staging locally. No batch exceeds BATCH_SIZE rows.
//
// ORDER IS FIXED AND ENFORCED ON BOTH SIDES
//   1. begin_acquisition_import_job    open the governed job (requires a
//                                      COMMITTED Phase 3 source job)
//   2. stage_acquisition_orders        one row per distinct source order
//   3. stage_acquisition_lots          the order/show/package grouping layer
//   4. stage_acquisition_line_items    canonical lines + their lot placement
//   5. stage_acquisition_cost_components  typed, priced, attributed cost facts
//   6. finalize_acquisition_import_job  recounts everything, then commits
// Between stages the driver reads back the ids it needs (orders → lots → lines),
// exactly as a real client must, because each stage function returns only
// counts and resolves identity by uuid, not by re-deriving strings internally.
// The database refuses steps 3-6 if an earlier step is incomplete, so a bug
// here cannot produce a committed job with missing rows.
//
// FAILURE BEHAVIOR
// If any step throws, the job is marked failed via fail_acquisition_import_job.
// A failed job is visibly failed, never committed, keeps its staged rows as
// evidence, and a corrected run proceeds under a new idempotency key.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionPlan } from './adapter.js';

export const BATCH_SIZE = 250;
/** Supabase returns at most 1000 rows per select; page readbacks under that. */
export const READBACK_PAGE = 1000;

export interface AcquisitionCommitOutcome {
  readonly importJobId: string;
  readonly status: 'committed';
  readonly resumed: boolean;
  readonly orders: number;
  readonly lots: number;
  readonly lineItems: number;
  readonly costComponents: number;
  readonly unresolvedSupplierCandidates: number;
  readonly unresolvedCostComponents: number;
  readonly batches: number;
}

export class AcquisitionCommitError extends Error {
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
    throw new AcquisitionCommitError((error as { message: string }).message, 409);
  }
  return data as T;
}

// Paged readback of one table's rows for this job. Kept under READBACK_PAGE so
// a 2,149-row job is fetched in a few bounded pages rather than one huge query
// that the database would silently truncate to its default row cap.
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
    const { data, error } = await query.range(from, from + READBACK_PAGE - 1);
    if (error) {
      throw new AcquisitionCommitError((error as { message: string }).message, 409);
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...page);
    if (page.length < READBACK_PAGE) break;
    from += READBACK_PAGE;
  }
  return out;
}

export async function commitAcquisitionPlan(
  client: SupabaseClient,
  workspaceId: string,
  channelId: string,
  sourceImportJobId: string,
  plan: AcquisitionPlan,
  idempotencyKey: string
): Promise<AcquisitionCommitOutcome> {
  const key = (idempotencyKey ?? '').trim();
  if (key.length < 8) {
    throw new AcquisitionCommitError(
      'commit requires an idempotency key of at least 8 characters',
      400
    );
  }

  // 1. Open the governed job. A repeated key resumes rather than duplicating.
  const begun = await rpc<{ id: string; status: string; resumed: boolean }>(
    client,
    'begin_acquisition_import_job',
    {
      p_workspace_id: workspaceId,
      p_channel_id: channelId,
      p_source_import_job_id: sourceImportJobId,
      p_idempotency_key: key,
      p_expected_line_count: plan.expectedLineItems,
    }
  );

  const importJobId = begun.id;
  if (begun.status === 'committed') {
    throw new AcquisitionCommitError(
      'this acquisition import is already committed; re-running changes nothing',
      409,
      importJobId
    );
  }

  let batches = 0;

  try {
    // 2. Orders (also find-or-creates each seller's supplier alias).
    for (const batch of chunk(plan.orders, BATCH_SIZE)) {
      await rpc(client, 'stage_acquisition_orders', {
        p_import_job_id: importJobId,
        p_orders: batch.map((o) => ({
          source_order_reference: o.sourceOrderReference,
          seller_raw_handle: o.sellerRawHandle,
          first_source_record_id: o.firstSourceRecordId,
          order_status: o.orderStatus,
          source_reported_status: o.sourceReportedStatus,
          ...(o.sourceReportedTotalMinor !== null
            ? { source_reported_total_minor: o.sourceReportedTotalMinor }
            : {}),
          currency: o.currency,
          ...(o.occurredAt ? { occurred_at: o.occurredAt } : {}),
        })),
      });
      batches += 1;
    }

    // Read back order ids by source reference.
    const orderRows = await readAll(
      client,
      'acquisition_orders',
      'id, source_order_reference',
      (q) => q.eq('acquisition_import_job_id', importJobId)
    );
    const orderIdByRef = new Map<string, string>();
    for (const row of orderRows) {
      orderIdByRef.set(String(row.source_order_reference), String(row.id));
    }

    // 3. Lots, one per order (the order/show/package grouping layer).
    const lotPayload = plan.lots.map((lot) => {
      const orderId = orderIdByRef.get(lot.sourceOrderReference);
      if (!orderId) {
        throw new AcquisitionCommitError(
          `no staged order for reference ${lot.sourceOrderReference}`,
          500,
          importJobId
        );
      }
      return { order_id: orderId, sequence_no: lot.sequenceNo, label: lot.label };
    });
    for (const batch of chunk(lotPayload, BATCH_SIZE)) {
      await rpc(client, 'stage_acquisition_lots', {
        p_import_job_id: importJobId,
        p_lots: batch,
      });
      batches += 1;
    }

    // Read back lot ids by their order's source reference (sequence 1).
    const lotRows = await readAll(
      client,
      'acquisition_lots',
      'id, sequence_no, acquisition_orders!inner(source_order_reference, acquisition_import_job_id)',
      (q) => q.eq('acquisition_orders.acquisition_import_job_id', importJobId)
    );
    const lotIdByRef = new Map<string, string>();
    for (const row of lotRows) {
      const nested = row['acquisition_orders'] as { source_order_reference: string } | null;
      if (nested && Number(row.sequence_no) === 1) {
        lotIdByRef.set(String(nested.source_order_reference), String(row.id));
      }
    }

    // 4. Line items + their initial active lot placement.
    const linePayload = plan.lineItems.map((line) => {
      const lotId = lotIdByRef.get(line.sourceOrderReference);
      if (!lotId) {
        throw new AcquisitionCommitError(
          `no staged lot for order ${line.sourceOrderReference}`,
          500,
          importJobId
        );
      }
      return {
        public_id: line.publicId,
        lot_id: lotId,
        source_record_id: line.sourceRecordId,
        ...(line.externalIdentifierId
          ? { external_identifier_id: line.externalIdentifierId }
          : {}),
        quantity: line.quantity,
        description: line.description,
        reference_number: line.referenceNumber,
        source_detail: line.sourceDetail,
      };
    });
    for (const batch of chunk(linePayload, BATCH_SIZE)) {
      await rpc(client, 'stage_acquisition_line_items', {
        p_import_job_id: importJobId,
        p_lines: batch,
      });
      batches += 1;
    }

    // Read back line item ids by public id.
    const lineRows = await readAll(
      client,
      'acquisition_line_items',
      'id, public_id',
      (q) => q.eq('acquisition_import_job_id', importJobId)
    );
    const lineIdByPublicId = new Map<string, string>();
    for (const row of lineRows) {
      lineIdByPublicId.set(String(row.public_id), String(row.id));
    }

    // 5. Cost components, scoped to their line item (attribution derived).
    const componentPayload = plan.costComponents.map((c) => {
      const lineItemId = lineIdByPublicId.get(c.lineItemPublicId);
      if (!lineItemId) {
        throw new AcquisitionCommitError(
          `no staged line item for public id ${c.lineItemPublicId}`,
          500,
          importJobId
        );
      }
      return {
        line_item_id: lineItemId,
        component_type: c.componentType,
        amount_state: c.amountState,
        ...(c.amountMinor !== null ? { amount_minor: c.amountMinor } : {}),
        currency: c.currency,
        ...(c.evidenceNote ? { evidence_note: c.evidenceNote } : {}),
        source_record_id: c.sourceRecordId,
      };
    });
    for (const batch of chunk(componentPayload, BATCH_SIZE)) {
      await rpc(client, 'stage_acquisition_cost_components', {
        p_import_job_id: importJobId,
        p_components: batch,
      });
      batches += 1;
    }

    // 6. Finalize. The database recounts everything and refuses to commit
    //    anything inconsistent with these six expectations. All six are ALWAYS
    //    supplied explicitly, even when zero.
    const finalized = await rpc<{
      id: string;
      status: string;
      orders: number;
      lots: number;
      line_items: number;
      cost_components: number;
      unresolved_supplier_candidates: number;
      unresolved_cost_components: number;
    }>(client, 'finalize_acquisition_import_job', {
      p_import_job_id: importJobId,
      p_idempotency_key: key,
      p_expected_orders: plan.expectedOrders,
      p_expected_lots: plan.expectedLots,
      p_expected_line_items: plan.expectedLineItems,
      p_expected_cost_components: plan.expectedCostComponents,
      p_expected_unresolved_supplier_candidates: plan.expectedUnresolvedSupplierCandidates,
      p_expected_unresolved_cost_components: plan.expectedUnresolvedCostComponents,
    });

    return {
      importJobId,
      status: 'committed',
      resumed: begun.resumed,
      orders: finalized.orders,
      lots: finalized.lots,
      lineItems: finalized.line_items,
      costComponents: finalized.cost_components,
      unresolvedSupplierCandidates: finalized.unresolved_supplier_candidates,
      unresolvedCostComponents: finalized.unresolved_cost_components,
      batches,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    try {
      await rpc(client, 'fail_acquisition_import_job', {
        p_import_job_id: importJobId,
        p_failure_code: 'staging_failed',
        p_failure_detail: detail.slice(0, 4000),
      });
    } catch {
      // Deliberately swallowed: the original failure is the useful one.
    }
    if (err instanceof AcquisitionCommitError) {
      throw new AcquisitionCommitError(err.message, err.status, importJobId);
    }
    throw new AcquisitionCommitError(detail, 500, importJobId);
  }
}

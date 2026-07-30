// Cycle count transport.
//
// Every call runs under the caller's own Supabase session. Reads go through the
// governed SECURITY DEFINER read functions added in
// 20260730000100_cycle_count_application_layer — not through the base tables —
// because those functions are what decide blind-count disclosure and clamp the
// page size. Writes go through the governed lifecycle functions, which
// authorize internally. There is no service-role key here and no second
// authorization model.
//
// The types below are hand-written to match the governed contracts, following
// the same convention as locationsApi and inventoryData: database.types.ts is
// generated only as far as 20260719000500, so mirroring these by hand is the
// repository-standard typed wrapper rather than a shortcut around it.

import type {
  CycleCountStatus, DiscrepancyKind, DiscrepancyStatus, ItemObservationKind,
  Progress, Readiness, ResolutionAction, ScanResultLike, ScopePreview,
} from './cycleCount';

export interface SessionListRow {
  readonly session_id: string;
  readonly public_id: string;
  readonly status: CycleCountStatus;
  readonly scope_type: 'single_location' | 'location_and_descendants';
  readonly include_descendants: boolean;
  readonly blind_count: boolean;
  readonly subtype_filter: string | null;
  readonly vertical_filter: string | null;
  readonly notes: string | null;
  readonly root_location_code: string;
  readonly root_location_display_name: string | null;
  readonly scope_location_count: number;
  readonly expected_item_count: number;
  readonly observed_item_count: number;
  readonly expected_lot_count: number;
  readonly observed_lot_count: number;
  readonly open_discrepancy_count: number;
  readonly total_discrepancy_count: number;
  readonly created_at: string;
  readonly created_by_email: string | null;
  readonly started_at: string | null;
  readonly snapshot_frozen_at: string | null;
  readonly submitted_at: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
}

export interface Paged<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ScopeLocation {
  readonly location_id: string;
  readonly location_code: string;
  readonly location_display_name: string | null;
  readonly depth: number;
}

export interface SessionDetail {
  readonly session_id: string;
  readonly public_id: string;
  readonly status: CycleCountStatus;
  readonly scope_type: 'single_location' | 'location_and_descendants';
  readonly include_descendants: boolean;
  readonly subtype_filter: string | null;
  readonly vertical_filter: string | null;
  readonly blind_count: boolean;
  readonly notes: string | null;
  readonly root_location_code: string;
  readonly created_at: string;
  readonly created_by_email: string | null;
  readonly started_at: string | null;
  readonly started_by_email: string | null;
  readonly snapshot_frozen_at: string | null;
  readonly submitted_at: string | null;
  readonly submitted_by_email: string | null;
  readonly completed_at: string | null;
  readonly completed_by_email: string | null;
  readonly completion_note: string | null;
  readonly completion_summary: unknown;
  readonly cancelled_at: string | null;
  readonly cancelled_by_email: string | null;
  readonly cancellation_reason: string | null;
}

export interface ReviewTotals {
  readonly missing_item_count: number;
  readonly unexpected_item_count: number;
  readonly wrong_location_count: number;
  readonly lot_shortage_count: number;
  readonly lot_overage_count: number;
  readonly lot_uncounted_count: number;
  readonly shortage_units: number;
  readonly overage_units: number;
  readonly open_count: number;
  readonly recount_requested_count: number;
  readonly resolved_count: number;
  readonly deferred_count: number;
  readonly total_count: number;
}

export interface SessionBundle {
  readonly found: boolean;
  readonly viewer_role?: 'owner' | 'operator' | 'viewer';
  readonly can_count?: boolean;
  readonly quantities_withheld?: boolean;
  readonly current_round?: number;
  readonly session?: SessionDetail;
  readonly scope?: readonly ScopeLocation[];
  readonly progress?: Progress;
  readonly review_totals?: ReviewTotals | null;
}

export interface ItemQueueRow {
  readonly expected_item_id: string;
  readonly item_id: string;
  readonly item_public_id: string;
  readonly display_name: string;
  readonly scan_sku: string;
  readonly certificate_number: string | null;
  readonly serial_number: string | null;
  readonly grading_company: string | null;
  readonly inventory_subtype: string;
  readonly business_vertical: string;
  readonly expected_location_code: string;
  readonly item_state: string;
  readonly observation_id: string | null;
  readonly observation_kind: ItemObservationKind | null;
  readonly observed_at: string | null;
  readonly observed_location_code: string | null;
}

export interface LotQueueRow {
  readonly expected_lot_id: string;
  readonly lot_id: string;
  readonly lot_public_id: string;
  readonly display_name: string;
  readonly inventory_subtype: string;
  readonly business_vertical: string;
  readonly expected_location_code: string;
  readonly lot_state: string;
  /** Absent — null — while an active blind count is being counted. */
  readonly expected_quantity: number | null;
  readonly observation_id: string | null;
  readonly observed_quantity: number | null;
  readonly variance: number | null;
  readonly observation_note: string | null;
  readonly observed_at: string | null;
  readonly count_status: 'uncounted' | 'saved' | 'matched' | 'short' | 'over';
}

export interface ObservationFeedRow {
  readonly observation_id: string;
  readonly subject_kind: 'item' | 'lot';
  readonly count_round: number;
  readonly outcome: string;
  readonly subject_public_id: string | null;
  readonly display_name: string | null;
  readonly raw_identifier: string | null;
  readonly note: string | null;
  readonly observed_at: string;
  readonly observed_location_code: string | null;
  readonly expected_location_code: string | null;
  readonly observed_quantity: number | null;
  readonly expected_quantity: number | null;
  readonly voided_at: string | null;
  readonly void_reason: string | null;
  readonly observed_by_email: string | null;
  readonly is_current_round: boolean;
}

export interface ObservationHistoryRow {
  readonly observation_id: string;
  readonly count_round: number;
  readonly outcome: string;
  readonly observed_at: string;
  readonly observed_by_email: string | null;
  readonly note: string | null;
  readonly raw_identifier?: string | null;
  readonly observed_location_code?: string | null;
  readonly observed_quantity?: number | null;
  readonly expected_quantity?: number | null;
  readonly variance?: number | null;
  readonly voided_at: string | null;
  readonly void_reason: string | null;
}

export interface ActivityRow {
  readonly activity_kind: string;
  readonly activity_public_id: string | null;
  readonly occurred_at: string;
  readonly detail: string | null;
  readonly from_value: string | null;
  readonly to_value: string | null;
}

export interface ResolutionRow {
  readonly resolution_id: string;
  readonly action: ResolutionAction;
  readonly note: string | null;
  readonly succeeded: boolean;
  readonly failure_detail: string | null;
  readonly resolved_at: string;
  readonly resolved_by_email: string | null;
  readonly movement_id: string | null;
  readonly adjustment_id: string | null;
}

export interface DiscrepancyRow {
  readonly discrepancy_id: string;
  readonly public_id: string;
  readonly discrepancy_kind: DiscrepancyKind;
  readonly status: DiscrepancyStatus;
  readonly expected_quantity: number | null;
  readonly observed_quantity: number | null;
  readonly variance: number;
  readonly detected_at: string;
  readonly recount_requested_at: string | null;
  readonly recount_requested_by_email: string | null;
  readonly resolved_at: string | null;
  readonly resolved_by_email: string | null;
  readonly deferral_reason: string | null;
  readonly subject_public_id: string | null;
  readonly subject_display_name: string;
  readonly subject_kind: 'item' | 'lot';
  readonly item_id: string | null;
  readonly lot_id: string | null;
  readonly certificate_number: string | null;
  readonly serial_number: string | null;
  readonly grading_company: string | null;
  readonly expected_location_code: string | null;
  readonly observed_location_code: string | null;
  readonly observations: readonly ObservationHistoryRow[];
  readonly post_snapshot_activity: readonly ActivityRow[];
  readonly resolutions: readonly ResolutionRow[];
}

export interface AuditRecord extends SessionBundle {
  readonly expected_items?: readonly {
    readonly item_public_id: string; readonly display_name: string;
    readonly expected_location_code: string; readonly item_state: string;
    readonly item_id: string;
    readonly certificate_number: string | null; readonly serial_number: string | null;
  }[];
  readonly expected_lots?: readonly {
    readonly lot_public_id: string; readonly display_name: string;
    readonly expected_location_code: string; readonly expected_quantity: number;
    readonly lot_state: string; readonly lot_id: string;
  }[];
  readonly observations?: readonly ObservationFeedRow[];
  readonly discrepancies?: readonly DiscrepancyRow[];
  readonly resolutions?: readonly (ResolutionRow & {
    readonly discrepancy_public_id: string;
    readonly affected_item_id: string | null;
    readonly affected_lot_id: string | null;
  })[];
  readonly loss_events?: readonly {
    readonly loss_public_id: string; readonly item_id: string;
    readonly item_public_id: string; readonly reason: string;
    readonly recorded_at: string; readonly recorded_by_email: string | null;
  }[];
  readonly row_limit?: number;
}

export interface WorkbenchSummary {
  readonly active_count: number;
  readonly awaiting_review_count: number;
  readonly recount_required_count: number;
  readonly unresolved_discrepancy_count: number;
  readonly intake_followup_count: number;
  readonly deferred_count: number;
  readonly examples: readonly {
    readonly session_id: string; readonly public_id: string;
    readonly status: CycleCountStatus; readonly root_location_code: string;
    readonly blind_count: boolean;
    readonly expected_item_count: number; readonly observed_item_count: number;
    readonly expected_lot_count: number; readonly observed_lot_count: number;
    readonly open_discrepancy_count: number; readonly created_at: string;
  }[];
  readonly example_limit: number;
}

export interface LossHistoryRow {
  readonly loss_public_id: string;
  readonly previous_item_state: string;
  readonly new_item_state: string;
  readonly reason: string;
  readonly recorded_at: string;
  readonly recorded_by_email: string | null;
  readonly cycle_count_public_id: string | null;
  readonly cycle_count_session_id: string | null;
  readonly discrepancy_public_id: string | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface CycleCountClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
}

export interface CycleCountApi {
  listSessions(opts?: {
    statuses?: readonly CycleCountStatus[]; locationCode?: string | null;
    blindOnly?: boolean | null; limit?: number; offset?: number;
  }): Promise<Paged<SessionListRow>>;
  getSession(sessionId: string): Promise<SessionBundle>;
  createSession(input: {
    rootLocationCode: string; includeDescendants: boolean;
    subtypeFilter: string | null; verticalFilter: string | null;
    blindCount: boolean; notes: string | null;
  }): Promise<{ id: string; public_id: string }>;
  previewScope(sessionId: string): Promise<ScopePreview>;
  startSession(sessionId: string): Promise<void>;
  itemQueue(sessionId: string, filter: 'all' | 'uncounted' | 'counted', limit: number, offset: number): Promise<Paged<ItemQueueRow> & { count_round: number }>;
  lotQueue(sessionId: string, filter: 'all' | 'uncounted' | 'counted' | 'variances', limit: number, offset: number): Promise<Paged<LotQueueRow> & { count_round: number; quantities_withheld: boolean }>;
  observationFeed(sessionId: string, limit: number, currentRoundOnly: boolean): Promise<{ rows: readonly ObservationFeedRow[]; count_round: number; quantities_withheld: boolean }>;
  observeItem(sessionId: string, identifier: string, locationCode: string, note: string | null): Promise<ScanResultLike>;
  observeLot(sessionId: string, lotPublicId: string, observedQuantity: number, note: string | null): Promise<{ outcome: string; variance: number | null }>;
  voidObservation(observationId: string, subjectKind: 'item' | 'lot', reason: string | null): Promise<void>;
  submitForReview(sessionId: string, confirmUncounted: boolean): Promise<{ outcome: string; discrepancy_count?: number }>;
  review(sessionId: string, opts?: {
    kinds?: readonly DiscrepancyKind[]; statuses?: readonly DiscrepancyStatus[];
    limit?: number; offset?: number;
  }): Promise<Paged<DiscrepancyRow>>;
  readiness(sessionId: string): Promise<Readiness>;
  requestRecount(discrepancyId: string, note: string | null): Promise<void>;
  resolve(discrepancyId: string, action: ResolutionAction, note: string | null, toLocationCode: string | null): Promise<{ outcome: string }>;
  complete(sessionId: string, allowDeferred: boolean, note: string | null): Promise<unknown>;
  cancel(sessionId: string, reason: string): Promise<void>;
  auditRecord(sessionId: string): Promise<AuditRecord>;
  workbenchSummary(): Promise<WorkbenchSummary>;
  lossHistory(itemId: string): Promise<readonly LossHistoryRow[]>;
}

export function createCycleCountApi(client: CycleCountClient, workspaceId: string): CycleCountApi {
  // Fail closed and loudly. An unreadable count is never rendered as an empty
  // one: "no discrepancies" and "we could not read the discrepancies" must not
  // look the same on a review screen.
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(fn, { p_workspace_id: workspaceId, ...args });
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async listSessions(opts = {}) {
      const data = await call('list_cycle_counts', {
        p_statuses: opts.statuses && opts.statuses.length ? opts.statuses : null,
        p_location_code: opts.locationCode ?? null,
        p_blind_only: opts.blindOnly ?? null,
        p_limit: opts.limit ?? 25,
        p_offset: opts.offset ?? 0,
      });
      return data as Paged<SessionListRow>;
    },

    async getSession(sessionId) {
      return (await call('get_cycle_count', { p_session_id: sessionId })) as SessionBundle;
    },

    async createSession(input) {
      const data = await call('create_cycle_count', {
        p_root_location_code: input.rootLocationCode,
        p_include_descendants: input.includeDescendants,
        p_subtype_filter: input.subtypeFilter,
        p_vertical_filter: input.verticalFilter,
        p_blind_count: input.blindCount,
        p_notes: input.notes,
      });
      return data as { id: string; public_id: string };
    },

    async previewScope(sessionId) {
      return (await call('preview_cycle_count_scope', { p_session_id: sessionId })) as ScopePreview;
    },

    async startSession(sessionId) {
      await call('start_cycle_count', { p_session_id: sessionId });
    },

    async itemQueue(sessionId, filter, limit, offset) {
      const data = await call('cycle_count_item_queue', {
        p_session_id: sessionId, p_filter: filter, p_limit: limit, p_offset: offset,
      });
      return data as Paged<ItemQueueRow> & { count_round: number };
    },

    async lotQueue(sessionId, filter, limit, offset) {
      const data = await call('cycle_count_lot_queue', {
        p_session_id: sessionId, p_filter: filter, p_limit: limit, p_offset: offset,
      });
      return data as Paged<LotQueueRow> & { count_round: number; quantities_withheld: boolean };
    },

    async observationFeed(sessionId, limit, currentRoundOnly) {
      const data = await call('cycle_count_observation_feed', {
        p_session_id: sessionId, p_limit: limit, p_current_round_only: currentRoundOnly,
      });
      return data as { rows: readonly ObservationFeedRow[]; count_round: number; quantities_withheld: boolean };
    },

    async observeItem(sessionId, identifier, locationCode, note) {
      const data = await call('observe_cycle_count_item', {
        p_session_id: sessionId, p_identifier: identifier,
        p_observed_location_code: locationCode, p_note: note,
      });
      return (data ?? {}) as ScanResultLike;
    },

    async observeLot(sessionId, lotPublicId, observedQuantity, note) {
      const data = await call('observe_cycle_count_lot', {
        p_session_id: sessionId, p_lot_public_id: lotPublicId,
        p_observed_quantity: observedQuantity, p_note: note,
      });
      return (data ?? {}) as { outcome: string; variance: number | null };
    },

    async voidObservation(observationId, subjectKind, reason) {
      await call('void_cycle_count_observation', {
        p_observation_id: observationId, p_subject_kind: subjectKind, p_reason: reason,
      });
    },

    async submitForReview(sessionId, confirmUncounted) {
      const data = await call('submit_cycle_count_for_review', {
        p_session_id: sessionId, p_confirm_uncounted: confirmUncounted,
      });
      return (data ?? {}) as { outcome: string; discrepancy_count?: number };
    },

    async review(sessionId, opts = {}) {
      const data = await call('cycle_count_review', {
        p_session_id: sessionId,
        p_kinds: opts.kinds && opts.kinds.length ? opts.kinds : null,
        p_statuses: opts.statuses && opts.statuses.length ? opts.statuses : null,
        p_limit: opts.limit ?? 50,
        p_offset: opts.offset ?? 0,
      });
      return data as Paged<DiscrepancyRow>;
    },

    async readiness(sessionId) {
      return (await call('cycle_count_completion_readiness', { p_session_id: sessionId })) as Readiness;
    },

    async requestRecount(discrepancyId, note) {
      await call('request_cycle_count_recount', { p_discrepancy_id: discrepancyId, p_note: note });
    },

    async resolve(discrepancyId, action, note, toLocationCode) {
      const data = await call('resolve_cycle_count_discrepancy', {
        p_discrepancy_id: discrepancyId, p_action: action, p_note: note,
        p_to_location_code: toLocationCode,
      });
      return (data ?? {}) as { outcome: string };
    },

    async complete(sessionId, allowDeferred, note) {
      return await call('complete_cycle_count', {
        p_session_id: sessionId, p_allow_deferred: allowDeferred, p_note: note,
      });
    },

    async cancel(sessionId, reason) {
      await call('cancel_cycle_count', { p_session_id: sessionId, p_reason: reason });
    },

    async auditRecord(sessionId) {
      return (await call('cycle_count_audit_record', { p_session_id: sessionId })) as AuditRecord;
    },

    async workbenchSummary() {
      return (await call('cycle_count_workbench_summary', { p_example_limit: 5 })) as WorkbenchSummary;
    },

    async lossHistory(itemId) {
      const data = await call('inventory_item_loss_history', { p_item_id: itemId });
      return ((data as { rows?: readonly LossHistoryRow[] })?.rows ?? []) as readonly LossHistoryRow[];
    },
  };
}

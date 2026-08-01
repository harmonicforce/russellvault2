// Inventory data access for movement, media, lots, scanning and the
// workbench.
//
// These run under the CALLER'S OWN Supabase session. Every read goes through a
// security-invoker view or an RLS-protected table, and every write is either an
// RLS-protected insert or a governed SECURITY DEFINER function that authorizes
// internally (move_inventory_item / move_inventory_lot). There is no
// service-role key here and no second authorization model: the database is the
// boundary, exactly as it is for the intake kernel.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createdColumn, endOfDayIso, recentCutoffIso, sortSpec, startOfDayIso,
  type ReadModel, type SortKey,
} from './inventoryQuery';

export type AnyClient = SupabaseClient<never, never, never>;

export interface ItemOverviewRow {
  item_id: string;
  item_public_id: string;
  scan_sku: string;
  grading_company: string | null;
  certificate_number: string | null;
  serial_number: string | null;
  item_created_at: string;
  lot_id: string;
  lot_public_id: string;
  tracking_mode: 'lot_managed' | 'serialized';
  lot_quantity: number;
  location_id: string | null;
  location_code: string | null;
  location_display_name: string | null;
  location_retired_at: string | null;
  needs_location: boolean;
  sku_public_id: string;
  business_vertical: string;
  inventory_subtype: string;
  needs_condition_details: boolean;
  last_moved_at: string | null;
  product_public_id: string;
  product_display_name: string;
  numeric_grade: string | null;
  grade_designation: string | null;
  condition_or_quality: string | null;
  product_format: string | null;
  shoe_size: string | null;
  size_system: string | null;
  size_label: string | null;
  media_count: number;
  primary_media_path: string | null;
}

export interface LotOverviewRow {
  lot_id: string;
  lot_public_id: string;
  sku_id: string;
  tracking_mode: 'lot_managed' | 'serialized';
  quantity: number;
  lot_state: 'active' | 'absorbed' | 'void';
  /** Active, and holding something. What "can be sold or moved" means. */
  is_available: boolean;
  lot_created_at: string;
  location_id: string | null;
  location_code: string | null;
  location_display_name: string | null;
  location_retired_at: string | null;
  needs_location: boolean;
  sku_public_id: string;
  business_vertical: string;
  inventory_subtype: string;
  needs_condition_details: boolean;
  last_moved_at: string | null;
  product_public_id: string;
  product_display_name: string;
  condition_or_quality: string | null;
  product_format: string | null;
  seal_or_packaging_condition: string | null;
  size_label: string | null;
  shoe_size: string | null;
  serialized_child_count: number;
  media_count: number;
  primary_media_path: string | null;
}

/**
 * One row of Current Inventory, at either grain. Serialized parent lots are
 * absent by construction — they are represented by their own units.
 */
export interface RecordOverviewRow {
  record_kind: 'item' | 'lot';
  record_id: string;
  record_public_id: string;
  parent_lot_id: string | null;
  product_display_name: string;
  business_vertical: string;
  inventory_subtype: string;
  quantity: number;
  tracking_mode: 'lot_managed' | 'serialized';
  condition_or_grade: string | null;
  condition_or_quality: string | null;
  grading_company: string | null;
  location_id: string | null;
  location_code: string | null;
  location_display_name: string | null;
  location_retired_at: string | null;
  needs_location: boolean;
  needs_condition_details: boolean;
  scan_identifier: string;
  created_at: string;
  last_moved_at: string | null;
  media_count: number;
  primary_media_path: string | null;
  detail_line: string | null;
}

export interface RecordPage {
  rows: RecordOverviewRow[];
  /** Every record matching the filters, not just this page. */
  total: number;
  itemCount: number;
  lotCount: number;
}

/** Mirrors public.quantity_adjustment_reason. */
export const ADJUSTMENT_REASONS = [
  'received', 'recount', 'damaged', 'lost', 'stolen', 'donated',
  'internal_use', 'returned_to_supplier', 'sold_elsewhere', 'lot_split',
  'lot_merge', 'other',
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** The reasons an operator can choose. Splits and merges write their own. */
export const OPERATOR_ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  'received', 'recount', 'damaged', 'lost', 'stolen', 'donated',
  'internal_use', 'returned_to_supplier', 'sold_elsewhere', 'other',
];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  received: 'Inventory received',
  recount: 'Recount correction',
  damaged: 'Damaged',
  lost: 'Lost',
  stolen: 'Stolen',
  donated: 'Donated',
  internal_use: 'Internal use',
  returned_to_supplier: 'Returned to supplier',
  sold_elsewhere: 'Sale recorded elsewhere',
  lot_split: 'Lot split',
  lot_merge: 'Lot merge',
  other: 'Other',
};

export interface QuantityAdjustmentRow {
  id: string;
  public_id: string;
  lot_id: string;
  previous_quantity: number;
  change_amount: number;
  resulting_quantity: number;
  reason: AdjustmentReason;
  note: string | null;
  source_reference: string | null;
  adjusted_at: string;
}

export interface LotLineageRow {
  id: string;
  public_id: string;
  event_kind: 'split' | 'merge';
  quantity: number;
  note: string | null;
  created_at: string;
  parent_lot_id: string;
  parent_public_id: string;
  child_lot_id: string;
  child_public_id: string;
}

/** Mirrors public.correction_issue_type. */
export const CORRECTION_ISSUE_TYPES = [
  'wrong_category', 'wrong_product_name', 'wrong_set', 'wrong_card_number',
  'wrong_grade', 'wrong_grader', 'wrong_certificate', 'wrong_serial',
  'wrong_size', 'wrong_style_code', 'wrong_model', 'wrong_condition',
  'wrong_product_format', 'wrong_quantity', 'duplicate_record', 'other',
] as const;

export type CorrectionIssueType = (typeof CORRECTION_ISSUE_TYPES)[number];

export const CORRECTION_ISSUE_LABELS: Record<CorrectionIssueType, string> = {
  wrong_category: 'Wrong category',
  wrong_product_name: 'Wrong product name',
  wrong_set: 'Wrong set',
  wrong_card_number: 'Wrong card number',
  wrong_grade: 'Wrong grade',
  wrong_grader: 'Wrong grading company',
  wrong_certificate: 'Wrong certificate number',
  wrong_serial: 'Wrong serial number',
  wrong_size: 'Wrong size',
  wrong_style_code: 'Wrong style code',
  wrong_model: 'Wrong model',
  wrong_condition: 'Wrong condition',
  wrong_product_format: 'Wrong product format',
  wrong_quantity: 'Wrong quantity',
  duplicate_record: 'Duplicate record',
  other: 'Other data problem',
};

export type CorrectionState = 'open' | 'approved' | 'rejected' | 'resolved';

export const CORRECTION_STATE_LABELS: Record<CorrectionState, string> = {
  open: 'Open',
  approved: 'Approved — awaiting a corrected record',
  rejected: 'Rejected',
  resolved: 'Resolved',
};

export interface CorrectionRow {
  id: string;
  public_id: string;
  subject_kind: 'item' | 'lot';
  subject_id: string;
  subject_public_id: string;
  subject_display_name: string | null;
  issue_type: CorrectionIssueType;
  explanation: string;
  proposed_values: Record<string, string>;
  state: CorrectionState;
  requested_at: string;
  reviewed_at: string | null;
  resolution_note: string | null;
  replacement_id: string | null;
  replacement_public_id: string | null;
}

export interface MediaRow {
  id: string;
  subject_kind: 'item' | 'lot';
  item_id: string | null;
  lot_id: string | null;
  storage_path: string;
  slot_label: string | null;
  sort_order: number;
  is_primary: boolean;
  content_type: string;
  byte_size: number;
  created_at: string;
}

export interface MovementRow {
  id: string;
  public_id: string;
  subject_kind: 'item' | 'lot';
  from_location_id: string | null;
  to_location_id: string;
  note: string | null;
  moved_at: string;
}

export const MEDIA_BUCKET = 'inventory-media';

export interface InventoryFilters {
  q?: string;
  locationId?: string;
  gradingCompany?: string;
  businessVertical?: string;
  /** The exact category — graded_card, apparel, electronics, … */
  subtype?: string;
  condition?: string;
  trackingMode?: 'lot_managed' | 'serialized' | '';
  hasPhotos?: boolean;
  needsPhotos?: boolean;
  /** Records with no active storage location — the workbench's queue. */
  needsLocation?: boolean;
  needsConditionDetails?: boolean;
  /** Added, or moved, inside the last RECENT_DAYS. */
  recentlyAdded?: boolean;
  recentlyMoved?: boolean;
  /** Inclusive calendar-day bounds on when the record was added. */
  addedFrom?: string;
  addedTo?: string;
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

/** Escape the characters PostgREST's `or=` filter treats structurally. */
function escapeFilterValue(term: string): string {
  return term.replace(/[,()%\\]/g, (c) => `\\${c}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Query = any;

/**
 * The filters both read models share, applied identically to each. Every one
 * of these runs in the database over the whole workspace — none of them
 * narrows a page that was already fetched, which is the only way a filtered
 * view and the workbench count that opened it can agree.
 */
function applyShared(q: Query, filters: InventoryFilters, view: ReadModel): Query {
  const created = createdColumn(view);
  const condition = view === 'record' ? 'condition_or_grade' : 'condition_or_quality';

  const term = (filters.q ?? '').trim();
  if (term) {
    // search_text is the view's lowercased haystack of every searchable
    // identity fact, so one match reaches set names, style codes, colorways
    // and serials alike. Lowercased here because the column already is.
    q = q.ilike('search_text', `%${escapeFilterValue(term.toLowerCase())}%`);
  }
  if (filters.locationId) q = q.eq('location_id', filters.locationId);
  if (filters.businessVertical) q = q.eq('business_vertical', filters.businessVertical);
  if (filters.subtype) q = q.eq('inventory_subtype', filters.subtype);
  if (filters.condition) q = q.eq(condition, filters.condition);
  if (filters.trackingMode) q = q.eq('tracking_mode', filters.trackingMode);
  if (filters.hasPhotos) q = q.gt('media_count', 0);
  if (filters.needsPhotos) q = q.eq('media_count', 0);
  if (filters.needsLocation) q = q.eq('needs_location', true);
  if (filters.needsConditionDetails) q = q.eq('needs_condition_details', true);
  if (filters.recentlyAdded) q = q.gte(created, recentCutoffIso());
  if (filters.recentlyMoved) q = q.gte('last_moved_at', recentCutoffIso());

  const from = filters.addedFrom ? startOfDayIso(filters.addedFrom) : null;
  const to = filters.addedTo ? endOfDayIso(filters.addedTo) : null;
  if (from) q = q.gte(created, from);
  if (to) q = q.lte(created, to);
  return q;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createInventoryData(client: AnyClient, workspaceId: string) {
  const db = client as unknown as {
    from(t: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    storage: {
      from(b: string): {
        upload(path: string, file: File, opts?: { contentType?: string; upsert?: boolean }): PromiseLike<{ error: { message: string } | null }>;
        createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
        remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };

  const fail = (error: { message: string } | null): void => {
    // Fail closed and loudly: an unreadable result is never rendered as "none".
    if (error) throw new Error(error.message);
  };

  return {
    /**
     * The page Current Inventory renders. One query over the union read model,
     * so the sort, the filters, the page window and the total all describe the
     * same set — and the browser never receives more than one page.
     *
     * `scope` narrows to one grain; the per-grain counts are reported for the
     * combined view either way, because "240 items and 37 lots" is a different
     * and more useful fact than "277 records".
     */
    async listRecords(
      filters: InventoryFilters & { scope?: 'all' | 'items' | 'lots' } = {}
    ): Promise<RecordPage> {
      // The select spec is passed in rather than re-selected on a shared
      // builder: PostgREST builders are not reusable once a select is applied,
      // so each of the three queries below is constructed from scratch with
      // exactly the same filters.
      const build = (columns: string, head: boolean) => {
        let q = db
          .from('inventory_record_overview')
          .select(columns, { count: 'exact', head })
          .eq('workspace_id', workspaceId);
        if (filters.scope === 'items') q = q.eq('record_kind', 'item');
        if (filters.scope === 'lots') q = q.eq('record_kind', 'lot');
        if (filters.gradingCompany) q = q.eq('grading_company', filters.gradingCompany);
        return applyShared(q, filters, 'record');
      };

      const spec = sortSpec(filters.sort ?? 'newest', 'record');
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      const [page, itemHead, lotHead] = await Promise.all([
        build('*', false)
          .order(spec.column, { ascending: spec.ascending, nullsFirst: spec.nullsFirst })
          // Records of two grains can share every sortable value, so the page
          // window needs a tiebreaker that is unique across the whole union.
          .order('record_public_id', { ascending: true })
          .range(offset, offset + limit - 1),
        build('record_id', true).eq('record_kind', 'item'),
        build('record_id', true).eq('record_kind', 'lot'),
      ]);

      fail(page.error);
      fail(itemHead.error);
      fail(lotHead.error);
      return {
        rows: (page.data ?? []) as RecordOverviewRow[],
        total: page.count ?? 0,
        itemCount: itemHead.count ?? 0,
        lotCount: lotHead.count ?? 0,
      };
    },

    async listItems(filters: InventoryFilters = {}): Promise<{ rows: ItemOverviewRow[]; total: number }> {
      let q = db
        .from('inventory_item_overview')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId);
      q = applyShared(q, filters, 'item');
      if (filters.gradingCompany) q = q.eq('grading_company', filters.gradingCompany);
      const spec = sortSpec(filters.sort ?? 'newest', 'item');
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      const { data, error, count } = await q
        // A second, always-unique key so a page boundary can never drop or
        // repeat a row when many records share the primary sort value.
        .order(spec.column, { ascending: spec.ascending, nullsFirst: spec.nullsFirst })
        .order('item_public_id', { ascending: true })
        .range(offset, offset + limit - 1);
      fail(error);
      return { rows: (data ?? []) as ItemOverviewRow[], total: count ?? 0 };
    },

    async listLots(filters: InventoryFilters = {}): Promise<{ rows: LotOverviewRow[]; total: number }> {
      let q = db
        .from('inventory_lot_overview')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId);
      // Serialized lots are represented by their individual units in the item
      // view; listing both would count the same physical stock twice. An
      // explicit tracking-mode filter may narrow this further but can never
      // widen it back to serialized parents.
      q = q.eq('tracking_mode', 'lot_managed');
      q = applyShared(q, filters, 'lot');
      const spec = sortSpec(filters.sort ?? 'newest', 'lot');
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      const { data, error, count } = await q
        .order(spec.column, { ascending: spec.ascending, nullsFirst: spec.nullsFirst })
        .order('lot_public_id', { ascending: true })
        .range(offset, offset + limit - 1);
      fail(error);
      return { rows: (data ?? []) as LotOverviewRow[], total: count ?? 0 };
    },

    /**
     * The highest-confidence answer to a search: the record whose identifier IS
     * the term. Scanning a certificate number should land on that slab, not on
     * whatever else happens to mention those digits somewhere in a name.
     *
     * Deliberately conservative. Two hits is an ambiguous answer, not a
     * confident one, so it returns nothing and lets the ranked list speak.
     */
    async findExactRecord(term: string): Promise<RecordOverviewRow | null> {
      const t = term.trim();
      if (!t) return null;
      const esc = escapeFilterValue(t);
      const { data, error } = await db
        .from('inventory_record_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .or(`record_public_id.eq.${esc},scan_identifier.eq.${esc}`)
        .limit(2);
      fail(error);
      const rows = (data ?? []) as RecordOverviewRow[];
      if (rows.length === 1) return rows[0];
      if (rows.length > 1) return null;

      // Certificate and serial live only at the item grain.
      const { data: byIdentifier, error: identifierError } = await db
        .from('inventory_item_overview')
        .select('item_id')
        .eq('workspace_id', workspaceId)
        .or(`certificate_number.eq.${esc},serial_number.eq.${esc}`)
        .limit(2);
      fail(identifierError);
      const hits = (byIdentifier ?? []) as { item_id: string }[];
      if (hits.length !== 1) return null;

      const { data: record, error: recordError } = await db
        .from('inventory_record_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('record_kind', 'item')
        .eq('record_id', hits[0].item_id)
        .maybeSingle();
      fail(recordError);
      return (record as RecordOverviewRow) ?? null;
    },

    /**
     * Change a lot's quantity. `expectedQuantity` is the number the operator
     * was looking at: if the lot moved since, the database raises rather than
     * applying the delta to a number they never saw.
     */
    async adjustLotQuantity(input: {
      lotId: string; change: number; reason: AdjustmentReason;
      expectedQuantity: number | null; note: string | null; sourceReference?: string | null;
    }): Promise<void> {
      const { error } = await db.rpc('adjust_lot_quantity', {
        p_workspace_id: workspaceId,
        p_lot_id: input.lotId,
        p_change: input.change,
        p_reason: input.reason,
        p_expected_quantity: input.expectedQuantity,
        p_note: input.note,
        p_source_reference: input.sourceReference ?? null,
      });
      fail(error);
    },

    /** Counting a shelf produces a number, not a difference. */
    async recountLotQuantity(input: {
      lotId: string; countedQuantity: number; expectedQuantity: number | null; note: string | null;
    }): Promise<void> {
      const { error } = await db.rpc('recount_lot_quantity', {
        p_workspace_id: workspaceId,
        p_lot_id: input.lotId,
        p_counted_quantity: input.countedQuantity,
        p_expected_quantity: input.expectedQuantity,
        p_note: input.note,
      });
      fail(error);
    },

    async splitLot(input: {
      lotId: string; quantity: number; toLocationCode: string; note: string | null;
    }): Promise<{ child_lot_id: string; child_public_id: string; source_quantity: number }> {
      const { data, error } = await db.rpc('split_inventory_lot', {
        p_workspace_id: workspaceId,
        p_lot_id: input.lotId,
        p_quantity: input.quantity,
        p_to_location_code: input.toLocationCode,
        p_note: input.note,
      });
      fail(error);
      return data as { child_lot_id: string; child_public_id: string; source_quantity: number };
    },

    async mergeLots(input: {
      survivorLotId: string; absorbedLotIds: readonly string[]; note: string | null;
    }): Promise<{ survivor_quantity: number; absorbed_count: number }> {
      const { data, error } = await db.rpc('merge_inventory_lots', {
        p_workspace_id: workspaceId,
        p_survivor_lot_id: input.survivorLotId,
        p_absorbed_lot_ids: input.absorbedLotIds as string[],
        p_note: input.note,
      });
      fail(error);
      return data as { survivor_quantity: number; absorbed_count: number };
    },

    /** Why two lots can or cannot merge, in the operator's words. */
    async mergeCompatibility(survivorLotId: string, absorbedLotId: string): Promise<{
      compatible: boolean; reasons: string[]; combined_quantity: number;
    }> {
      const { data, error } = await db.rpc('lot_merge_compatibility', {
        p_workspace_id: workspaceId,
        p_survivor_lot_id: survivorLotId,
        p_absorbed_lot_id: absorbedLotId,
      });
      fail(error);
      return data as { compatible: boolean; reasons: string[]; combined_quantity: number };
    },

    /** Lots that could plausibly merge into this one: same SKU, same shelf. */
    async mergeCandidates(lot: LotOverviewRow): Promise<LotOverviewRow[]> {
      let q = db
        .from('inventory_lot_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('sku_id', lot.sku_id)
        .eq('tracking_mode', 'lot_managed')
        .eq('lot_state', 'active')
        .neq('lot_id', lot.lot_id);
      q = lot.location_id ? q.eq('location_id', lot.location_id) : q.is('location_id', null);
      const { data, error } = await q.limit(50);
      fail(error);
      return (data ?? []) as LotOverviewRow[];
    },

    async quantityHistory(lotId: string): Promise<QuantityAdjustmentRow[]> {
      const { data, error } = await db
        .from('inventory_quantity_adjustments')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('lot_id', lotId)
        .order('adjusted_at', { ascending: false })
        .limit(200);
      fail(error);
      return (data ?? []) as QuantityAdjustmentRow[];
    },

    async lotLineage(lotId: string): Promise<LotLineageRow[]> {
      const { data, error } = await db
        .from('inventory_lot_lineage_view')
        .select('*')
        .eq('workspace_id', workspaceId)
        .or(`parent_lot_id.eq.${lotId},child_lot_id.eq.${lotId}`)
        .order('created_at', { ascending: false })
        .limit(100);
      fail(error);
      return (data ?? []) as LotLineageRow[];
    },

    /**
     * Raise a correction against a committed record. This is a claim, not a
     * change: nothing about the record moves until an owner or operator has
     * decided and then explicitly superseded it.
     */
    async requestCorrection(input: {
      subjectKind: 'item' | 'lot';
      subjectId: string;
      issueType: CorrectionIssueType;
      explanation: string;
      proposedValues?: Record<string, string>;
      supportingMediaId?: string | null;
    }): Promise<void> {
      const { error } = await db.rpc('request_inventory_correction', {
        p_workspace_id: workspaceId,
        p_subject_kind: input.subjectKind,
        p_subject_id: input.subjectId,
        p_issue_type: input.issueType,
        p_explanation: input.explanation,
        p_proposed_values: input.proposedValues ?? {},
        p_supporting_media_id: input.supportingMediaId ?? null,
      });
      fail(error);
    },

    /** Approve or reject. Approving records agreement; it does not fix. */
    async reviewCorrection(input: {
      correctionId: string; decision: 'approve' | 'reject'; note: string | null;
    }): Promise<void> {
      const { error } = await db.rpc('review_inventory_correction', {
        p_workspace_id: workspaceId,
        p_correction_id: input.correctionId,
        p_decision: input.decision,
        p_resolution_note: input.note,
      });
      fail(error);
    },

    /**
     * Retire a wrong or duplicate record in favour of one that already exists.
     * The replacement is never created here — identity is only ever minted
     * through intake.
     */
    async supersedeRecord(input: {
      subjectKind: 'item' | 'lot';
      subjectId: string;
      replacementId: string;
      reason: string;
      correctionId?: string | null;
    }): Promise<void> {
      const { error } = await db.rpc('supersede_inventory_record', {
        p_workspace_id: workspaceId,
        p_subject_kind: input.subjectKind,
        p_subject_id: input.subjectId,
        p_replacement_id: input.replacementId,
        p_reason: input.reason,
        p_correction_id: input.correctionId ?? null,
      });
      fail(error);
    },

    async listCorrections(states?: readonly CorrectionState[]): Promise<CorrectionRow[]> {
      let q = db
        .from('inventory_correction_overview')
        .select('*')
        .eq('workspace_id', workspaceId);
      if (states && states.length > 0) q = q.in('state', states as string[]);
      const { data, error } = await q.order('requested_at', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []) as CorrectionRow[];
    },

    /** The correction history shown on a record's own page. */
    async correctionsForRecord(
      subjectKind: 'item' | 'lot', subjectId: string
    ): Promise<CorrectionRow[]> {
      const { data, error } = await db
        .from('inventory_correction_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('subject_kind', subjectKind)
        .eq('subject_id', subjectId)
        .order('requested_at', { ascending: false });
      fail(error);
      return (data ?? []) as CorrectionRow[];
    },

    async openCorrectionCount(): Promise<number> {
      const { count, error } = await db
        .from('inventory_correction_overview')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .in('state', ['open', 'approved']);
      fail(error);
      return count ?? 0;
    },

    /** Resolve a selection of records by id, for bulk actions. */
    async recordsByIds(ids: readonly string[]): Promise<RecordOverviewRow[]> {
      if (ids.length === 0) return [];
      const { data, error } = await db
        .from('inventory_record_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('record_id', ids as string[]);
      fail(error);
      return (data ?? []) as RecordOverviewRow[];
    },

    async getItem(itemId: string): Promise<ItemOverviewRow | null> {
      const { data, error } = await db
        .from('inventory_item_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('item_id', itemId)
        .maybeSingle();
      fail(error);
      return (data as ItemOverviewRow) ?? null;
    },

    async getLot(lotId: string): Promise<LotOverviewRow | null> {
      const { data, error } = await db
        .from('inventory_lot_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('lot_id', lotId)
        .maybeSingle();
      fail(error);
      return (data as LotOverviewRow) ?? null;
    },

    // ---- media ------------------------------------------------------------
    /** Short-lived signed URL. The bucket is private; there is no public URL. */
    async signedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
      const { data, error } = await db.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      if (error) return null;
      return data?.signedUrl ?? null;
    },

    // ---- movement ---------------------------------------------------------
    async moveItem(itemId: string, toLocationCode: string, note: string | null): Promise<void> {
      const { error } = await db.rpc('move_inventory_item', {
        p_workspace_id: workspaceId,
        p_item_id: itemId,
        p_to_location_code: toLocationCode,
        p_note: note,
      });
      fail(error);
    },

    async moveLot(lotId: string, toLocationCode: string, note: string | null): Promise<void> {
      const { error } = await db.rpc('move_inventory_lot', {
        p_workspace_id: workspaceId,
        p_lot_id: lotId,
        p_to_location_code: toLocationCode,
        p_note: note,
      });
      fail(error);
    },

    async movementHistory(subjectKind: 'item' | 'lot', subjectId: string): Promise<MovementRow[]> {
      const { data, error } = await db
        .from('inventory_movements')
        .select('id, public_id, subject_kind, from_location_id, to_location_id, note, moved_at')
        .eq('workspace_id', workspaceId)
        .eq(subjectKind === 'item' ? 'item_id' : 'lot_id', subjectId)
        .order('moved_at', { ascending: false })
        .limit(50);
      fail(error);
      return (data ?? []) as MovementRow[];
    },

    // ---- workbench --------------------------------------------------------
    async workQueueCounts(): Promise<{ needsLocation: number; needsPhotos: number; total: number }> {
      const [loc, photos, total] = await Promise.all([
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId).eq('needs_location', true),
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId).eq('needs_photos', true),
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId),
      ]);
      for (const r of [loc, photos, total]) fail(r.error);
      return {
        needsLocation: loc.count ?? 0,
        needsPhotos: photos.count ?? 0,
        total: total.count ?? 0,
      };
    },

    /**
     * Queues read from the SAME view Current Inventory pages, so a count here
     * and the filtered list it opens can never disagree — that mismatch is
     * exactly what made the old workbench untrustworthy.
     */
    async operationsQueueCounts(): Promise<{
      unclassified: number; needsConditionDetails: number; zeroQuantity: number;
    }> {
      const base = () => db
        .from('inventory_record_overview')
        .select('record_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      const [unclassified, condition, zero] = await Promise.all([
        base().eq('inventory_subtype', 'unclassified'),
        base().eq('needs_condition_details', true),
        base().eq('record_kind', 'lot').eq('quantity', 0),
      ]);
      for (const r of [unclassified, condition, zero]) fail(r.error);
      return {
        unclassified: unclassified.count ?? 0,
        needsConditionDetails: condition.count ?? 0,
        zeroQuantity: zero.count ?? 0,
      };
    },

    /** The first few records of an operations queue, for the workbench card. */
    async operationsQueueRows(
      kind: 'unclassified' | 'needs_condition_details' | 'zero_quantity',
      limit = 5
    ): Promise<RecordOverviewRow[]> {
      let q = db
        .from('inventory_record_overview')
        .select('*')
        .eq('workspace_id', workspaceId);
      if (kind === 'unclassified') q = q.eq('inventory_subtype', 'unclassified');
      if (kind === 'needs_condition_details') q = q.eq('needs_condition_details', true);
      if (kind === 'zero_quantity') q = q.eq('record_kind', 'lot').eq('quantity', 0);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
      fail(error);
      return (data ?? []) as RecordOverviewRow[];
    },

    async workQueue(kind: 'needs_location' | 'needs_photos', limit = 10) {
      const { data, error } = await db
        .from('inventory_work_queue')
        .select('subject_kind, subject_id, subject_public_id, display_name, created_at')
        .eq('workspace_id', workspaceId)
        .eq(kind, true)
        .order('created_at', { ascending: false })
        .limit(limit);
      fail(error);
      return (data ?? []) as {
        subject_kind: 'item' | 'lot';
        subject_id: string;
        subject_public_id: string;
        display_name: string;
        created_at: string;
      }[];
    },
  };
}

export type InventoryData = ReturnType<typeof createInventoryData>;


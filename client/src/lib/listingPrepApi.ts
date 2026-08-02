// Listing Prep transport.
//
// Everything goes through /api/listing-prep, which calls the governed
// SECURITY DEFINER functions under the caller's own token. Readiness is
// computed by the database on every read, so nothing here caches or infers
// whether a record is listable.

import type { SubjectKind } from './mediaApi';

export type { SubjectKind };

export type PrepStatus =
  | 'not_started' | 'in_preparation' | 'blocked' | 'needs_review'
  | 'ready_to_list' | 'listed' | 'cancelled';

export type PrepPriority = 'low' | 'normal' | 'high' | 'urgent';

export type CheckState = 'unknown' | 'confirmed' | 'not_applicable';

export type PrepReadiness =
  | 'ready' | 'blocked' | 'needs_photos' | 'needs_identity_review'
  | 'needs_condition_review' | 'needs_measurements' | 'needs_quantity'
  | 'needs_package_details' | 'needs_price' | 'needs_content' | 'needs_owner_review';

/** One reason a record cannot be listed yet, in the owner's own terms. */
export interface PrepBlocker {
  readonly code: string;
  readonly kind: string;
  readonly label: string;
}

export interface PrepContent {
  readonly working_title: string | null;
  readonly condition_summary: string | null;
  readonly description_notes: string | null;
  readonly defects_disclosures: string | null;
  readonly included_items: string | null;
  readonly research_notes: string | null;
  readonly listing_format: string | null;
  readonly quantity_to_list: number | null;
  readonly currency: string | null;
  readonly asking_price_minor: number | null;
  readonly minimum_price_minor: number | null;
  readonly shipping_policy_ref: string | null;
  readonly return_policy_ref: string | null;
  readonly package_weight_grams: number | null;
  readonly package_length_mm: number | null;
  readonly package_width_mm: number | null;
  readonly package_height_mm: number | null;
}

export interface PrepCheck {
  readonly requirement_key: string;
  readonly label: string;
  readonly requirement_kind: string;
  readonly is_required: boolean;
  readonly display_order: number;
  readonly state: CheckState;
  readonly note: string | null;
  readonly confirmed_by: string | null;
  readonly updated_at: string | null;
}

export interface PrepEvent {
  readonly id: string;
  readonly event_type: string;
  readonly from_status: PrepStatus | null;
  readonly to_status: PrepStatus | null;
  readonly actor_id: string;
  readonly reason: string | null;
  readonly detail: Record<string, unknown>;
  readonly created_at: string;
}

export interface PrepIdentity {
  readonly public_id: string | null;
  readonly display_name: string | null;
  readonly detail_line: string | null;
  readonly subtype: string | null;
  readonly record_state: string | null;
  readonly is_available: boolean | null;
  readonly quantity: number | null;
  readonly tracking_mode: string | null;
  readonly condition_or_grade: string | null;
  readonly grading_company: string | null;
  readonly scan_identifier: string | null;
  readonly location_code: string | null;
  readonly location_display_name: string | null;
  readonly open_correction_count: number | null;
  readonly media_count: number | null;
}

export interface PrepRecord {
  readonly id: string;
  readonly public_id: string;
  readonly subject_kind: SubjectKind;
  readonly subject_id: string;
  readonly subtype: string | null;
  readonly status: PrepStatus;
  readonly priority: PrepPriority;
  readonly assigned_to: string | null;
  readonly owner_notes: string | null;
  readonly blocked_reason: string | null;
  readonly content: PrepContent;
  readonly listed_at: string | null;
  readonly external_listing_ref: string | null;
  readonly readiness_status: PrepReadiness;
  readonly blockers: readonly PrepBlocker[];
  readonly subject_state: string | null;
  readonly identity: PrepIdentity;
  readonly checks: readonly PrepCheck[];
  readonly events: readonly PrepEvent[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PrepQueueRow {
  readonly id: string;
  readonly public_id: string;
  readonly status: PrepStatus;
  readonly priority: PrepPriority;
  readonly assigned_to: string | null;
  readonly subject_kind: SubjectKind;
  readonly subject_id: string;
  readonly subject_public_id: string | null;
  readonly display_name: string | null;
  readonly detail_line: string | null;
  readonly subtype: string | null;
  readonly subject_state: string | null;
  readonly working_title: string | null;
  readonly readiness_status: PrepReadiness;
  readonly blockers: readonly PrepBlocker[];
  readonly blocker_count: number;
  readonly asking_price_minor: number | null;
  readonly currency: string | null;
  readonly blocked_reason: string | null;
  readonly listed_at: string | null;
  readonly external_listing_ref: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PrepQueuePage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly rows: readonly PrepQueueRow[];
}

export interface PrepSummary {
  /** Raw lifecycle tally: how many rows hold each status, unchanged. */
  readonly by_status: Partial<Record<PrepStatus, number>>;
  readonly by_readiness: Partial<Record<PrepReadiness, number>>;
  readonly unassigned: number;
  readonly listed_last_7_days: number;
  readonly never_started: number;
  /** Status says ready AND live readiness agrees. */
  readonly ready_now: number;
  /** Status still says ready, but a blocker has appeared since. */
  readonly regressed_ready: number;
}

/** Current inventory carrying no live preparation. */
export interface PrepCandidate {
  readonly subject_kind: SubjectKind;
  readonly subject_id: string;
  readonly public_id: string;
  readonly display_name: string | null;
  readonly detail_line: string | null;
  readonly subtype: string | null;
  readonly quantity: number | null;
  readonly tracking_mode: string | null;
  readonly needs_photos: boolean;
  readonly created_at: string;
}

export interface PrepCandidatePage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly rows: readonly PrepCandidate[];
}

/**
 * Every status a preparation can hold while it is still live work. A readiness
 * filter must span all of these: a `ready_to_list` record that has since
 * regressed is counted under its blocker, so restricting the drill-down to the
 * queue tab's statuses would hide exactly the records the tile counted.
 */
export const LIVE_PREP_STATUSES: readonly PrepStatus[] = [
  'not_started', 'in_preparation', 'blocked', 'needs_review', 'ready_to_list',
];

export interface PackagePreset {
  readonly id: string;
  readonly name: string;
  readonly package_weight_grams: number | null;
  readonly package_length_mm: number | null;
  readonly package_width_mm: number | null;
  readonly package_height_mm: number | null;
  readonly shipping_policy_ref: string | null;
  readonly return_policy_ref: string | null;
  readonly retired_at: string | null;
}

export interface QueueFilters {
  readonly status?: readonly PrepStatus[];
  readonly readiness?: readonly PrepReadiness[];
  readonly subtype?: readonly string[];
  readonly priority?: readonly PrepPriority[];
  readonly assignedTo?: string | null;
  readonly unassigned?: boolean;
  readonly subjectKind?: SubjectKind | null;
  readonly search?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

export type BulkAction =
  | 'assign' | 'set_priority' | 'apply_package_preset' | 'request_review'
  | 'mark_blocked' | 'unblock' | 'cancel' | 'mark_ready';

export interface BulkOutcome {
  readonly action: BulkAction;
  readonly requested: number;
  readonly applied: number;
  readonly failed: number;
  readonly results: readonly { prep_id: string; outcome: 'applied' | 'failed'; error?: string }[];
}

export interface ListingPrepTransport {
  queue(filters?: QueueFilters): Promise<PrepQueuePage>;
  candidates(filters?: { search?: string | null; subjectKind?: SubjectKind | null; limit?: number; offset?: number }): Promise<PrepCandidatePage>;
  summary(): Promise<PrepSummary>;
  get(prepId: string): Promise<PrepRecord>;
  forSubject(kind: SubjectKind, subjectId: string): Promise<{ exists: boolean; prep?: PrepRecord }>;
  readiness(prepId: string): Promise<{ readiness_status: PrepReadiness; blockers: readonly PrepBlocker[]; blocker_count: number }>;
  start(kind: SubjectKind, subjectId: string, priority?: PrepPriority): Promise<PrepRecord>;
  saveContent(prepId: string, content: Partial<PrepContent> & { owner_notes?: string | null }): Promise<PrepRecord>;
  setCheck(prepId: string, requirementKey: string, state: CheckState, note?: string | null): Promise<PrepRecord>;
  assign(prepId: string, assignedTo: string | null): Promise<PrepRecord>;
  setPriority(prepId: string, priority: PrepPriority): Promise<PrepRecord>;
  transition(prepId: string, status: Exclude<PrepStatus, 'listed'>, reason?: string | null): Promise<PrepRecord>;
  markListed(prepId: string, externalListingRef: string, listedAt?: string | null): Promise<PrepRecord>;
  presets(includeRetired?: boolean): Promise<readonly PackagePreset[]>;
  createPreset(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  retirePreset(presetId: string): Promise<Record<string, unknown>>;
  applyPreset(prepId: string, presetId: string): Promise<PrepRecord>;
  bulk(action: BulkAction, prepIds: readonly string[], params?: Record<string, unknown>): Promise<BulkOutcome>;
}

export type TokenProvider = () => Promise<string | null>;

/**
 * Fallbacks only. The routes pass the database's own sentence through as
 * `detail`, and that sentence names the actual blocker, so it is preferred
 * over anything written here.
 */
const MESSAGES: Record<string, string> = {
  not_found: 'That preparation is no longer in this workspace.',
  forbidden: 'You do not have permission to do that here.',
  lifecycle_conflict: 'This preparation has already moved on; refresh and try again.',
  conflict: 'Something with that name already exists.',
  invalid_request: 'That change could not be accepted.',
};

/** Money is stored and sent as integer minor units; only display divides. */
export function formatMoney(minor: number | null, currency: string | null): string {
  if (minor === null || minor === undefined) return '—';
  const code = currency ?? 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

/** Parses typed currency into whole minor units, or null when it is not a number. */
export function parseMoneyToMinor(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number.parseFloat(trimmed) * 100);
}

export const READINESS_LABELS: Record<PrepReadiness, string> = {
  ready: 'Ready to list',
  blocked: 'Blocked',
  needs_photos: 'Needs photos',
  needs_identity_review: 'Needs identity review',
  needs_condition_review: 'Needs condition review',
  needs_measurements: 'Needs measurements',
  needs_quantity: 'Needs quantity',
  needs_package_details: 'Needs package details',
  needs_price: 'Needs a price',
  needs_content: 'Needs title and description',
  needs_owner_review: 'Waiting on owner review',
};

export const STATUS_LABELS: Record<PrepStatus, string> = {
  not_started: 'Not started',
  in_preparation: 'In preparation',
  blocked: 'Blocked',
  needs_review: 'Needs review',
  ready_to_list: 'Ready to list',
  listed: 'Listed',
  cancelled: 'Cancelled',
};

export function createListingPrepTransport(
  token: TokenProvider,
  workspaceId: () => string | null,
): ListingPrepTransport {
  const ws = () => {
    const id = workspaceId();
    if (!id) throw new Error('No workspace selected.');
    return id;
  };

  async function request<T>(
    method: string, path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const jwt = await token();
    if (!jwt) throw new Error('Sign in again to work on listings.');
    const search = new URLSearchParams({ workspaceId: ws() });
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') search.set(key, value);
    }
    const response = await fetch(`/api/listing-prep${path}?${search.toString()}`, {
      method,
      headers: {
        authorization: `Bearer ${jwt}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify({ workspaceId: ws(), ...body }) : undefined,
    });
    if (!response.ok) {
      let code = 'governed_operation_failed';
      let detail: string | undefined;
      try {
        const payload = (await response.json()) as { error?: string; detail?: string; field?: string };
        code = payload.error ?? code;
        detail = payload.detail ?? (payload.field ? `Check the ${payload.field} field.` : undefined);
      } catch { /* non-JSON error */ }
      if (response.status === 404 && code === 'not found') {
        throw new Error('Listing preparation is not enabled on this deployment.');
      }
      throw new Error(detail ?? MESSAGES[code] ?? `Listing preparation failed (${response.status}).`);
    }
    return (await response.json()) as T;
  }

  return {
    queue: (filters = {}) => request<PrepQueuePage>('GET', '', undefined, {
      status: filters.status?.join(','),
      readiness: filters.readiness?.join(','),
      subtype: filters.subtype?.join(','),
      priority: filters.priority?.join(','),
      assignedTo: filters.assignedTo ?? undefined,
      unassigned: filters.unassigned ? 'true' : undefined,
      subjectKind: filters.subjectKind ?? undefined,
      search: filters.search ?? undefined,
      limit: filters.limit === undefined ? undefined : String(filters.limit),
      offset: filters.offset === undefined ? undefined : String(filters.offset),
    }),
    candidates: (filters = {}) => request<PrepCandidatePage>('GET', '/candidates', undefined, {
      search: filters.search ?? undefined,
      subjectKind: filters.subjectKind ?? undefined,
      limit: filters.limit === undefined ? undefined : String(filters.limit),
      offset: filters.offset === undefined ? undefined : String(filters.offset),
    }),
    summary: () => request<PrepSummary>('GET', '/summary'),
    get: (prepId) => request<PrepRecord>('GET', `/${prepId}`),
    forSubject: (kind, subjectId) =>
      request('GET', '/for-subject', undefined, { subjectKind: kind, subjectId }),
    readiness: (prepId) => request('GET', `/${prepId}/readiness`),
    start: (kind, subjectId, priority) =>
      request<PrepRecord>('POST', '', { subjectKind: kind, subjectId, ...(priority ? { priority } : {}) }),
    saveContent: (prepId, content) =>
      request<PrepRecord>('PATCH', `/${prepId}/content`, { content }),
    setCheck: (prepId, requirementKey, state, note = null) =>
      request<PrepRecord>('POST', `/${prepId}/checks`, { requirementKey, state, note }),
    assign: (prepId, assignedTo) =>
      request<PrepRecord>('POST', `/${prepId}/assign`, { assignedTo }),
    setPriority: (prepId, priority) =>
      request<PrepRecord>('POST', `/${prepId}/priority`, { priority }),
    transition: (prepId, status, reason = null) =>
      request<PrepRecord>('POST', `/${prepId}/transition`, { status, reason }),
    markListed: (prepId, externalListingRef, listedAt = null) =>
      request<PrepRecord>('POST', `/${prepId}/listed`, { externalListingRef, listedAt }),
    presets: (includeRetired = false) =>
      request<readonly PackagePreset[]>('GET', '/presets', undefined, {
        includeRetired: includeRetired ? 'true' : undefined,
      }),
    createPreset: (input) => request('POST', '/presets', input),
    retirePreset: (presetId) => request('POST', `/presets/${presetId}/retire`, {}),
    applyPreset: (prepId, presetId) =>
      request<PrepRecord>('POST', `/${prepId}/package-preset`, { presetId }),
    bulk: (action, prepIds, params = {}) =>
      request<BulkOutcome>('POST', '/bulk', { action, prepIds: [...prepIds], ...params }),
  };
}

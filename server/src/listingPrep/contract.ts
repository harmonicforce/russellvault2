// Listing Prep transport contract.
//
// Pure request-shape validation, kept out of the router so it can be tested
// directly. Nothing here grants authority: every route still resolves the
// caller and their workspace role, and the database re-checks both the role
// and the readiness of the record before anything changes.
//
// The generic shape helpers are imported rather than copied. A second
// implementation of "is this a UUID" is how two surfaces come to disagree
// about what they accept.

import { asText, asUuid, asUuidArray, type SubjectKind } from '../media/contract.js';

export { asText, asUuid, asUuidArray };
export type { SubjectKind };

/** Mirrors public.listing_prep_status. */
export const PREP_STATUSES = [
  'not_started', 'in_preparation', 'blocked', 'needs_review',
  'ready_to_list', 'listed', 'cancelled',
] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

/** Mirrors public.listing_prep_priority. */
export const PREP_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type PrepPriority = (typeof PREP_PRIORITIES)[number];

/** Mirrors public.listing_prep_check_state. */
export const CHECK_STATES = ['unknown', 'confirmed', 'not_applicable'] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/** Mirrors public.inventory_subtype. */
export const INVENTORY_SUBTYPES = [
  'graded_card', 'raw_card', 'sealed_tcg', 'footwear', 'apparel',
  'electronics', 'other_collectible', 'unclassified',
] as const;

/** The readiness values the database view can return. */
export const READINESS_STATUSES = [
  'ready', 'blocked', 'needs_photos', 'needs_identity_review',
  'needs_condition_review', 'needs_measurements', 'needs_quantity',
  'needs_package_details', 'needs_price', 'needs_content', 'needs_owner_review',
] as const;

export const BULK_ACTIONS = [
  'assign', 'set_priority', 'apply_package_preset', 'request_review',
  'mark_blocked', 'unblock', 'cancel', 'mark_ready',
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

function member<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export const asPrepStatus = (v: unknown) => member(PREP_STATUSES, v);
export const asPrepPriority = (v: unknown) => member(PREP_PRIORITIES, v);
export const asCheckState = (v: unknown) => member(CHECK_STATES, v);
export const asBulkAction = (v: unknown) => member(BULK_ACTIONS, v);

/**
 * A repeated query parameter, accepted either as `?status=a&status=b` or as a
 * single comma-separated value. Returns null when the caller supplied nothing,
 * and `[]` never — an empty filter and an absent filter mean different things
 * to the query, and conflating them silently hides rows.
 */
export function asEnumFilter<T extends string>(
  allowed: readonly T[], value: unknown,
): T[] | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out: T[] = [];
  for (const entry of raw) {
    const v = member(allowed, typeof entry === 'string' ? entry.trim() : entry);
    if (!v) return 'invalid';
    out.push(v);
  }
  return out.length > 0 ? [...new Set(out)] : 'invalid';
}

export function asRequirementKey(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null;
}

export function asPageSize(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function asOffset(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

// ---- listing content -------------------------------------------------------

/**
 * The editable content fields, with how each one is checked. The database
 * enforces all of this again; validating here means a mistake comes back as a
 * named field the form can highlight instead of a database error string.
 */
const TEXT_FIELDS: Readonly<Record<string, number>> = {
  working_title: 200,
  condition_summary: 1000,
  description_notes: 8000,
  defects_disclosures: 4000,
  included_items: 2000,
  research_notes: 4000,
  owner_notes: 4000,
  shipping_policy_ref: 120,
  return_policy_ref: 120,
};

/** Whole units. Money is minor units; a fraction means a float leaked in. */
const INTEGER_FIELDS: readonly string[] = [
  'quantity_to_list', 'asking_price_minor', 'minimum_price_minor',
  'package_weight_grams', 'package_length_mm', 'package_width_mm', 'package_height_mm',
];

const LISTING_FORMATS = ['fixed_price', 'auction', 'accepts_offers'] as const;

export const CONTENT_FIELDS: readonly string[] = [
  ...Object.keys(TEXT_FIELDS), ...INTEGER_FIELDS, 'currency', 'listing_format',
];

export interface ContentPatchResult {
  readonly patch?: Record<string, unknown>;
  readonly invalidField?: string;
}

/**
 * A key that is present sets the field, including to null, which is how a
 * value is cleared. A key that is absent leaves the field alone. A key nobody
 * recognizes is rejected rather than silently dropped, so a client typo does
 * not look like a successful save.
 */
export function asContentPatch(value: unknown): ContentPatchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { invalidField: 'content' };
  }
  const input = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!CONTENT_FIELDS.includes(key)) return { invalidField: key };

    if (raw === null) { patch[key] = null; continue; }

    if (key in TEXT_FIELDS) {
      if (typeof raw !== 'string') return { invalidField: key };
      const trimmed = raw.trim();
      if (trimmed.length > TEXT_FIELDS[key]) return { invalidField: key };
      patch[key] = trimmed === '' ? null : trimmed;
      continue;
    }

    if (INTEGER_FIELDS.includes(key)) {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return { invalidField: key };
      if (raw < 0) return { invalidField: key };
      if (key === 'quantity_to_list' && raw < 1) return { invalidField: key };
      patch[key] = raw;
      continue;
    }

    if (key === 'currency') {
      if (typeof raw !== 'string' || !/^[A-Za-z]{3}$/.test(raw.trim())) return { invalidField: key };
      patch[key] = raw.trim().toUpperCase();
      continue;
    }

    if (key === 'listing_format') {
      const fmt = member(LISTING_FORMATS, typeof raw === 'string' ? raw.trim() : raw);
      if (!fmt) return { invalidField: key };
      patch[key] = fmt;
      continue;
    }
  }

  if (Object.keys(patch).length === 0) return { invalidField: 'content' };

  // A floor above the asking price is a data-entry slip, and catching it here
  // names the field rather than surfacing a constraint violation.
  const asking = patch.asking_price_minor;
  const floor = patch.minimum_price_minor;
  if (typeof asking === 'number' && typeof floor === 'number' && floor > asking) {
    return { invalidField: 'minimum_price_minor' };
  }

  return { patch };
}

/** Bulk work is bounded so one request cannot become an unbounded batch. */
export const MAX_BULK_RECORDS = 200;

export function asBulkIds(value: unknown): string[] | null {
  const ids = asUuidArray(value);
  if (!ids || ids.length > MAX_BULK_RECORDS) return null;
  return ids;
}

// Phase 6A intake kernel — pure, non-authoritative request helpers.
//
// IMPORTANT: this module holds NO rule engine. The database is the single
// authority for applicability, requiredness, allowed values, serialization
// requirements, and commit blockers (see supabase/migrations/*intake_kernel*).
// These helpers only validate request SHAPE and map a governed category to its
// business vertical for display — they never decide whether a draft is valid or
// what it commits to.

import type { IntakeCategory } from './contract.js';

export class IntakeRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const CATEGORIES: readonly IntakeCategory[] = [
  'graded_tcg',
  'raw_tcg',
  'sealed_tcg',
  'footwear',
  'other',
];

/** Display-only mapping from category to Phase 5 business vertical. */
export function categoryVertical(category: IntakeCategory): 'tcg' | 'footwear' | 'other' {
  switch (category) {
    case 'graded_tcg':
    case 'raw_tcg':
    case 'sealed_tcg':
      return 'tcg';
    case 'footwear':
      return 'footwear';
    default:
      return 'other';
  }
}

export function isIntakeCategory(v: unknown): v is IntakeCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new IntakeRequestError(`${field} must be a UUID`);
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireUuid(value, field);
}

/** A positive integer quantity within the governed bound. */
export function requireQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) {
    throw new IntakeRequestError('quantity must be an integer between 1 and 100000');
  }
  return n;
}

/** A client idempotency key: 8..200 chars, no surrounding whitespace. */
export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') throw new IntakeRequestError('idempotencyKey is required');
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new IntakeRequestError('idempotencyKey must be 8 to 200 characters');
  }
  return key;
}

export function requireContentHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new IntakeRequestError('contentHash must be a 64-char hex digest from a preview');
  }
  return value;
}

export function requireVersion(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new IntakeRequestError('expectedVersion must be a positive integer');
  }
  return n;
}

/** A jsonb-bound plain object attribute bag (never an array or scalar). */
export function requireAttrs(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new IntakeRequestError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

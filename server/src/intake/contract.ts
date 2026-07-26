// Phase 6A intake kernel — shared backend/client contract types.
//
// These types describe the server-authoritative intake state machine and
// transactional commit kernel exposed by routes/intake.ts, which are thin
// wrappers over the governed SECURITY DEFINER database functions. The client
// may PREVIEW rules and outcomes but must not maintain a competing rule engine
// or a second committed identity model; the database is authoritative for every
// decision. Nothing here is authoritative on its own — it is the wire shape.

/** The governed intake group state machine. Invalid transitions fail closed. */
export type IntakeGroupState = 'draft' | 'ready_to_commit' | 'committed' | 'abandoned';

/** A session's lifecycle. */
export type IntakeSessionState = 'open' | 'abandoned';

/**
 * Source provenance posture of a draft. Facts are never invented: an intake
 * draft's source is explicitly unknown until a real state is asserted, and a
 * candidate acquisition line is EVIDENCE only, never a financial fact.
 */
export type IntakeSourceState = 'unknown' | 'candidate' | 'stated';

/** The governed Phase 6A category shortcuts. Category drives vertical + policy. */
export type IntakeCategory = 'graded_tcg' | 'raw_tcg' | 'sealed_tcg' | 'footwear' | 'other';

/** Phase 5 tracking mode, reused unchanged. */
export type TrackingMode = 'lot_managed' | 'serialized';

/**
 * The Phase 6A next-action vocabulary. Every successful commit returns exactly
 * one of these. Deliberately small — no Daily Workbench, listing-readiness,
 * media, or movement workflow is modeled in Phase 6A.
 */
export type IntakeNextAction =
  | 'CONDITION_DETAILS_NEEDED'
  | 'LOCATION_ASSIGNMENT_NEEDED'
  | 'PHOTOS_NEEDED'
  | 'SOURCE_REVIEW_NEEDED'
  | 'READY_FOR_FUTURE_LISTING_PREP'
  | 'NO_IMMEDIATE_ACTION';

/** The distinct outcomes a commit call can report. */
export type CommitOutcome = 'committed' | 'conflict' | 'blocked' | 'failed';

/** A single structured commit blocker from the authoritative rule engine. */
export interface IntakeBlocker {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

/** Server-authoritative rule evaluation for a draft group. */
export interface IntakeRuleEvaluation {
  readonly ready: boolean;
  readonly blockers: readonly IntakeBlocker[];
  readonly rule_version: string;
}

/** One serialized child in a commit receipt. */
export interface IntakeReceiptItem {
  readonly entry_id: string;
  readonly entry_index: number;
  readonly item_id: string;
  readonly item_public_id: string;
  /** The opaque Phase 5 Crockford unit scan SKU. */
  readonly scan_sku: string;
}

/** The immutable commit receipt returned on a successful (or replayed) commit. */
export interface IntakeCommitReceipt {
  readonly outcome: 'committed';
  readonly idempotent_replay: boolean;
  readonly session_id: string;
  readonly group_id: string;
  readonly group_public_id: string;
  readonly idempotency_key: string;
  readonly product_id: string;
  readonly product_public_id: string;
  readonly product_created: boolean;
  readonly sku_id: string;
  readonly sku_public_id: string;
  readonly sku_fingerprint: string;
  readonly sku_created: boolean;
  readonly lot_id: string;
  readonly lot_public_id: string;
  readonly tracking_mode: TrackingMode;
  readonly quantity: number;
  readonly items: readonly IntakeReceiptItem[];
  /** The explicit source posture and its governed evidence at commit time. */
  readonly source_state: IntakeSourceState;
  readonly source_evidence: Record<string, unknown>;
  /** Deterministically ordered candidate acquisition evidence (financially inert). */
  readonly candidates: readonly Record<string, unknown>[];
  readonly applied_rule_version: string;
  readonly next_action: IntakeNextAction;
  readonly actor: string;
  readonly committed_at: string;
}

/** A structured conflict response (stale version, idempotency, already committed). */
export interface IntakeCommitConflict {
  readonly outcome: 'conflict';
  readonly conflict_type:
    | 'stale_version'
    | 'content_hash_mismatch'
    | 'idempotency_content_changed'
    | 'already_committed';
  readonly message: string;
  readonly group_id: string;
  readonly expected_version?: number;
  readonly actual_version?: number;
}

/** A structured "blocked" response when authoritative rules reject the commit. */
export interface IntakeCommitBlocked {
  readonly outcome: 'blocked';
  readonly blockers: readonly IntakeBlocker[];
  readonly rule_version: string;
  readonly group_id: string;
}

/**
 * A structured "failed" response: a genuine mid-write failure was fully rolled
 * back (no partial Product/SKU/Lot/Item persists, the draft is recoverable) and
 * a durable commit_failed audit event was written. The reason is sanitized — no
 * secrets or raw internal error dumps.
 */
export interface IntakeCommitFailed {
  readonly outcome: 'failed';
  readonly failure_class:
    | 'duplicate_identity'
    | 'check_violation'
    | 'foreign_key_violation'
    | 'internal_error';
  readonly sqlstate: string;
  readonly message: string;
  readonly group_id: string;
}

export type IntakeCommitResult =
  | IntakeCommitReceipt
  | IntakeCommitConflict
  | IntakeCommitBlocked
  | IntakeCommitFailed;

/** Request body to commit a draft group. */
export interface IntakeCommitRequest {
  readonly workspaceId: string;
  readonly groupId: string;
  /** Client-generated idempotency key (8..200 chars). */
  readonly idempotencyKey: string;
  /** Optimistic-concurrency token: the draft version the client last saw. */
  readonly expectedVersion: number;
  /** The content hash from a preview, binding the key to exact content. */
  readonly contentHash: string;
}

/** Narrowing helpers so callers handle each outcome explicitly. */
export function isCommitReceipt(r: IntakeCommitResult): r is IntakeCommitReceipt {
  return r.outcome === 'committed';
}
export function isCommitConflict(r: IntakeCommitResult): r is IntakeCommitConflict {
  return r.outcome === 'conflict';
}
export function isCommitBlocked(r: IntakeCommitResult): r is IntakeCommitBlocked {
  return r.outcome === 'blocked';
}
export function isCommitFailed(r: IntakeCommitResult): r is IntakeCommitFailed {
  return r.outcome === 'failed';
}

// Cycle count — the decisions the client makes on its own.
//
// Everything in this file is pure. No Supabase, no React. The database remains
// the authority on every rule these functions anticipate; they exist so the
// operator finds out on the shop floor instead of after a round trip, and so
// the awkward parts — an untouched field is not a zero, a blind count has no
// expected quantity to show, a discrepancy kind only permits certain actions —
// are decided in one place that can be tested directly.

export type CycleCountStatus = 'draft' | 'in_progress' | 'review' | 'completed' | 'cancelled';

export type DiscrepancyKind =
  | 'item_missing' | 'item_unexpected' | 'item_wrong_location'
  | 'lot_shortage' | 'lot_overage' | 'lot_uncounted';

export type DiscrepancyStatus = 'open' | 'recount_requested' | 'resolved' | 'deferred';

export type ResolutionAction =
  | 'recount_requested'
  | 'item_moved_to_counted_location'
  | 'item_loss_recorded'
  | 'lot_quantity_adjusted'
  | 'observation_mistaken'
  | 'confirmed_system_location'
  | 'routed_to_intake'
  | 'explained_by_post_snapshot_activity'
  | 'deferred';

export type ItemObservationKind = 'expected_found' | 'wrong_location' | 'unexpected_found';

export type LotCountStatus = 'uncounted' | 'saved' | 'matched' | 'short' | 'over';

// ---------------------------------------------------------------------------
// Terminology
// ---------------------------------------------------------------------------
// A lost unit is not a unit that never existed. `void` language elsewhere in
// the app means "this record was a mistake"; a write-off means "the record is
// right and the object is gone". Keeping those apart in the words the operator
// reads is the whole point of the separate item state.
export const LOSS_TERM = 'Lost — missing from physical inventory';
export const LOSS_SHORT = 'Lost';

export const STATUS_LABEL: Record<CycleCountStatus, string> = {
  draft: 'Draft',
  in_progress: 'Counting',
  review: 'Awaiting review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const DISCREPANCY_LABEL: Record<DiscrepancyKind, string> = {
  item_missing: 'Missing unit',
  item_unexpected: 'Unexpected unit',
  item_wrong_location: 'Wrong location',
  lot_shortage: 'Lot short',
  lot_overage: 'Lot over',
  lot_uncounted: 'Lot never counted',
};

export const ACTION_LABEL: Record<ResolutionAction, string> = {
  recount_requested: 'Request a recount',
  item_moved_to_counted_location: 'Move the unit to where it was found',
  item_loss_recorded: 'Write the unit off as lost',
  lot_quantity_adjusted: 'Adjust the lot to the counted quantity',
  observation_mistaken: 'The observation was mistaken',
  confirmed_system_location: 'Confirm the recorded location is right',
  // Bookkeeping only. The database creates no inventory for this action, so the
  // label must not imply that anything was received.
  routed_to_intake: 'Mark for Intake follow-up',
  explained_by_post_snapshot_activity: 'Explained by activity after the snapshot',
  deferred: 'Defer with a reason',
};

/** Actions that change inventory and therefore need explicit confirmation. */
export const INVENTORY_CHANGING_ACTIONS: readonly ResolutionAction[] = [
  'item_moved_to_counted_location', 'item_loss_recorded', 'lot_quantity_adjusted',
];

export function isInventoryChanging(action: ResolutionAction): boolean {
  return INVENTORY_CHANGING_ACTIONS.includes(action);
}

export function requiresConfirmation(action: ResolutionAction): boolean {
  return isInventoryChanging(action);
}

/** Actions whose note is not optional. */
export function requiresNote(action: ResolutionAction): boolean {
  return action === 'deferred' || action === 'item_loss_recorded';
}

export function isTerminal(status: CycleCountStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * Where a session belongs. A terminal session must never land on a counting or
 * review screen that offers controls the database would refuse.
 */
export function canonicalPath(sessionId: string, status: CycleCountStatus): string {
  if (status === 'in_progress') return `/cycle-counts/${sessionId}/count`;
  if (status === 'review') return `/cycle-counts/${sessionId}/review`;
  if (isTerminal(status)) return `/cycle-counts/${sessionId}/audit`;
  return `/cycle-counts/${sessionId}`;
}

// ---------------------------------------------------------------------------
// Observed quantity entry
// ---------------------------------------------------------------------------

export type QuantityEntry =
  /** The operator has not touched this row. Emphatically not a zero. */
  | { readonly kind: 'untouched' }
  /** A real number the operator typed, including a deliberate zero. */
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'invalid'; readonly problem: string };

/**
 * The single most dangerous conversion in this feature. An empty field, a blur
 * with nothing typed, a form default and `Number(undefined)` must all stay
 * "uncounted" — turning any of them into an observed zero would tell the
 * database that a shelf is empty when nobody looked at it.
 */
export function parseObservedQuantity(raw: string | null | undefined): QuantityEntry {
  if (raw === null || raw === undefined) return { kind: 'untouched' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'untouched' };
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid', problem: 'Enter a whole number of units, or leave it blank if you have not counted it.' };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { kind: 'invalid', problem: 'That number is too large.' };
  }
  return { kind: 'value', value };
}

/** True only for a quantity that is safe to send to the database. */
export function isSubmittableQuantity(entry: QuantityEntry): entry is { kind: 'value'; value: number } {
  return entry.kind === 'value';
}

/**
 * The status a lot row shows. `quantitiesWithheld` is the server's word, not a
 * guess: during an active blind count the expected figure is absent from the
 * payload, so short/over cannot be computed and must not be implied.
 */
export function lotCountStatus(input: {
  readonly hasObservation: boolean;
  readonly expectedQuantity: number | null;
  readonly observedQuantity: number | null;
  readonly quantitiesWithheld: boolean;
}): LotCountStatus {
  if (!input.hasObservation) return 'uncounted';
  if (input.quantitiesWithheld || input.expectedQuantity === null || input.observedQuantity === null) {
    return 'saved';
  }
  const variance = input.observedQuantity - input.expectedQuantity;
  if (variance === 0) return 'matched';
  return variance < 0 ? 'short' : 'over';
}

export const LOT_STATUS_LABEL: Record<LotCountStatus, string> = {
  uncounted: 'Not counted',
  saved: 'Saved',
  matched: 'Matches',
  short: 'Short',
  over: 'Over',
};

/**
 * Status carries a shape as well as a colour. An operator counting under a
 * warehouse light, or anyone who does not distinguish red from green, still has
 * to be able to read the queue.
 */
export const LOT_STATUS_MARK: Record<LotCountStatus, string> = {
  uncounted: '○',
  saved: '●',
  matched: '✓',
  short: '−',
  over: '+',
};

// ---------------------------------------------------------------------------
// Scan feedback
// ---------------------------------------------------------------------------

export type ScanOutcome =
  | 'expected_found' | 'wrong_location' | 'unexpected_found'
  | 'duplicate' | 'ambiguous' | 'not_found' | 'inactive'
  | 'invalid_location' | 'unauthorized' | 'error';

export type FeedbackTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface ScanFeedback {
  readonly outcome: ScanOutcome;
  readonly tone: FeedbackTone;
  readonly headline: string;
  readonly detail: string | null;
  /** True when the evidence changed, so progress needs refreshing. */
  readonly recorded: boolean;
}

/**
 * The shape observe_cycle_count_item actually returns. Note that a refusal is
 * a returned outcome, not a raised error: not_found, ambiguous and
 * inactive_record all come back as ordinary results, which is why they are
 * handled here rather than in the error translator.
 */
export interface ScanResultLike {
  readonly outcome?: string | null;
  readonly identifier?: string | null;
  readonly match_count?: number | null;
  readonly observation_id?: string | null;
  readonly item_public_id?: string | null;
  readonly item_state?: string | null;
  readonly display_name?: string | null;
  readonly certificate_number?: string | null;
  readonly serial_number?: string | null;
  readonly expected_location_code?: string | null;
  readonly observed_location_code?: string | null;
  readonly first_observed_at?: string | null;
  readonly count_round?: number | null;
}

/** Enough identity to confirm the physical object in the operator's hand. */
export function scanIdentity(result: ScanResultLike): string {
  const parts = [
    result.display_name,
    result.item_public_id,
    result.certificate_number ? `cert ${result.certificate_number}` : null,
    result.serial_number ? `serial ${result.serial_number}` : null,
  ].filter((p): p is string => Boolean(p));
  return parts.join(' · ');
}

export function scanFeedback(result: ScanResultLike): ScanFeedback {
  const identity = scanIdentity(result) || null;
  switch (result.outcome) {
    case 'expected_found':
      return { outcome: 'expected_found', tone: 'good', headline: 'Found where expected', detail: identity, recorded: true };
    case 'wrong_location':
      return {
        outcome: 'wrong_location', tone: 'warn', headline: 'Found in the wrong place',
        detail: [identity, result.expected_location_code && result.observed_location_code
          ? `recorded in ${result.expected_location_code}, found in ${result.observed_location_code}`
          : null].filter(Boolean).join(' — ') || null,
        recorded: true,
      };
    case 'unexpected_found':
      return {
        outcome: 'unexpected_found', tone: 'warn', headline: 'Not expected here',
        detail: [identity, 'this unit was not in the frozen snapshot for this count'].filter(Boolean).join(' — '),
        recorded: true,
      };
    case 'duplicate':
      return {
        outcome: 'duplicate', tone: 'neutral', headline: 'Already counted this round',
        detail: [identity, result.first_observed_at ? `first scanned ${result.first_observed_at}` : null]
          .filter(Boolean).join(' — ') || null,
        // The scan was refused as new evidence. Counting it again as a second
        // physical unit is the error this exists to prevent.
        recorded: false,
      };
    case 'ambiguous':
      return {
        outcome: 'ambiguous', tone: 'bad', headline: 'That identifier matches more than one unit',
        detail: `${result.match_count ?? 'Several'} units answer to “${result.identifier ?? ''}”. Nothing was recorded — choosing between them would put a false sighting in the evidence. Scan a unique identifier or type the unit ID.`,
        recorded: false,
      };
    case 'not_found':
      return {
        outcome: 'not_found', tone: 'bad', headline: 'No unit matches that identifier',
        detail: `Nothing in this workspace answers to “${result.identifier ?? ''}”. Nothing was recorded.`,
        recorded: false,
      };
    case 'inactive_record':
      return {
        outcome: 'inactive', tone: 'bad', headline: 'That unit is no longer countable stock',
        detail: [identity, result.item_state ? `it is ${result.item_state}` : null]
          .filter(Boolean).join(' — ') || null,
        recorded: false,
      };
    default:
      return { outcome: 'error', tone: 'bad', headline: 'Not recorded', detail: identity, recorded: false };
  }
}

/**
 * A database refusal, in the operator's words. The original message is what
 * gets logged and what a diagnostic needs; this is only what gets displayed,
 * and anything unrecognised passes through rather than being guessed at.
 */
export function friendlyCycleCountError(message: string): ScanFeedback {
  const m = message.toLowerCase();
  if (/matches more than one|ambiguous/.test(m)) {
    return {
      outcome: 'ambiguous', tone: 'bad', headline: 'That identifier matches more than one unit',
      detail: 'Scan a unique identifier, or type the unit ID. Nothing was recorded — guessing between two units would put a false sighting in the evidence.',
      recorded: false,
    };
  }
  if (/no unit|not found|does not match|unknown identifier/.test(m)) {
    return {
      outcome: 'not_found', tone: 'bad', headline: 'No unit matches that identifier',
      detail: 'Check the scan and try again. Nothing was recorded.', recorded: false,
    };
  }
  if (/already (lost|void|superseded|sold)|is not active|already lost/.test(m)) {
    return {
      outcome: 'inactive', tone: 'bad', headline: 'That unit is no longer countable stock',
      detail: message, recorded: false,
    };
  }
  if (/location .* (not found|does not exist)|not in scope|outside the scope/.test(m)) {
    return {
      outcome: 'invalid_location', tone: 'bad', headline: 'That location is not part of this count',
      detail: message, recorded: false,
    };
  }
  if (/permission denied|row-level security|only an owner|not a member|cannot/.test(m)) {
    return {
      outcome: 'unauthorized', tone: 'bad', headline: 'You do not have permission to do that',
      detail: message, recorded: false,
    };
  }
  return { outcome: 'error', tone: 'bad', headline: 'The database refused that', detail: message, recorded: false };
}

/** A lot whose quantity moved after the snapshot. The count cannot be applied blindly. */
export function isStaleQuantityConflict(message: string): boolean {
  return /reload and try again|already holds the counted quantity/i.test(message);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface Progress {
  readonly expected_item_count: number;
  readonly found_item_count: number;
  readonly wrong_location_count: number;
  readonly unexpected_item_count: number;
  readonly uncounted_item_count: number;
  readonly expected_lot_count: number;
  readonly counted_lot_count: number;
  readonly uncounted_lot_count: number;
  readonly matched_lot_count: number;
  readonly variance_lot_count: number;
  readonly observed_zero_lot_count: number;
  readonly total_observation_count: number;
}

/**
 * A single completion figure across both grains. Voided observations never
 * reach here — the server excludes them — and neither do previous rounds: the
 * server scopes progress to the current round, because a unit counted in round
 * one is not evidence about round two.
 */
export function completionPercent(progress: Progress): number {
  const total = progress.expected_item_count + progress.expected_lot_count;
  if (total === 0) return 100;
  const done =
    (progress.expected_item_count - progress.uncounted_item_count) +
    (progress.expected_lot_count - progress.uncounted_lot_count);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function isScopeEmpty(progress: Progress): boolean {
  return progress.expected_item_count === 0 && progress.expected_lot_count === 0;
}

export interface SubmissionReadiness {
  readonly uncountedItems: number;
  readonly uncountedLots: number;
  readonly observedZeroLots: number;
  readonly wrongLocation: number;
  readonly unexpected: number;
  readonly totalObservations: number;
  /**
   * True when submitting will turn untouched records into discrepancies. The
   * operator has to be told that in words before it happens — silently
   * converting "nobody looked" into "it is missing" is the thing this feature
   * must never do.
   */
  readonly convertsUncounted: boolean;
}

export function submissionReadiness(progress: Progress): SubmissionReadiness {
  const uncounted = progress.uncounted_item_count + progress.uncounted_lot_count;
  return {
    uncountedItems: progress.uncounted_item_count,
    uncountedLots: progress.uncounted_lot_count,
    observedZeroLots: progress.observed_zero_lot_count,
    wrongLocation: progress.wrong_location_count,
    unexpected: progress.unexpected_item_count,
    totalObservations: progress.total_observation_count,
    convertsUncounted: uncounted > 0,
  };
}

// ---------------------------------------------------------------------------
// Discrepancy grouping and resolution
// ---------------------------------------------------------------------------

export interface DiscrepancyLike {
  readonly discrepancy_id: string;
  readonly discrepancy_kind: DiscrepancyKind;
  readonly status: DiscrepancyStatus;
  readonly resolutions?: readonly { readonly succeeded: boolean }[];
}

export type ReviewGroupKey =
  | 'item_missing' | 'item_unexpected' | 'item_wrong_location'
  | 'lot_shortage' | 'lot_overage' | 'lot_uncounted'
  | 'recount_requested' | 'deferred' | 'resolved' | 'failed';

export const REVIEW_GROUP_LABEL: Record<ReviewGroupKey, string> = {
  item_missing: 'Missing units',
  item_unexpected: 'Unexpected units',
  item_wrong_location: 'Units in the wrong place',
  lot_shortage: 'Lot shortages',
  lot_overage: 'Lot overages',
  lot_uncounted: 'Lots never counted',
  recount_requested: 'Waiting for a recount',
  deferred: 'Deferred',
  resolved: 'Resolved',
  failed: 'Failed resolution attempts',
};

export const REVIEW_GROUP_ORDER: readonly ReviewGroupKey[] = [
  'failed', 'recount_requested',
  'item_missing', 'item_unexpected', 'item_wrong_location',
  'lot_shortage', 'lot_overage', 'lot_uncounted',
  'deferred', 'resolved',
];

/** A discrepancy whose last word was a failure. It is not resolved. */
export function hasUnresolvedFailure(d: DiscrepancyLike): boolean {
  const attempts = d.resolutions ?? [];
  return attempts.some((r) => !r.succeeded) && !attempts.some((r) => r.succeeded);
}

/**
 * One discrepancy appears in exactly one group. Status wins over kind: a
 * deferred shortage is waiting on a person, not on a count, and filing it under
 * "shortages" would hide that.
 */
export function reviewGroupOf(d: DiscrepancyLike): ReviewGroupKey {
  if (hasUnresolvedFailure(d)) return 'failed';
  if (d.status === 'recount_requested') return 'recount_requested';
  if (d.status === 'deferred') return 'deferred';
  if (d.status === 'resolved') return 'resolved';
  return d.discrepancy_kind;
}

export function groupDiscrepancies<T extends DiscrepancyLike>(
  rows: readonly T[]
): readonly { readonly key: ReviewGroupKey; readonly label: string; readonly rows: readonly T[] }[] {
  const buckets = new Map<ReviewGroupKey, T[]>();
  for (const row of rows) {
    const key = reviewGroupOf(row);
    const existing = buckets.get(key);
    if (existing) existing.push(row);
    else buckets.set(key, [row]);
  }
  return REVIEW_GROUP_ORDER
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: REVIEW_GROUP_LABEL[key], rows: buckets.get(key)! }));
}

/**
 * The actions the database will actually accept for this discrepancy. Offering
 * an action it would refuse produces a failed resolution row for nothing, so
 * the menu is derived from the kind rather than being one fixed list.
 */
export function availableActions(kind: DiscrepancyKind): readonly ResolutionAction[] {
  switch (kind) {
    case 'item_missing':
      return ['recount_requested', 'item_loss_recorded',
        'explained_by_post_snapshot_activity', 'observation_mistaken', 'deferred'];
    case 'item_unexpected':
      return ['item_moved_to_counted_location', 'confirmed_system_location', 'routed_to_intake',
        'observation_mistaken', 'explained_by_post_snapshot_activity', 'deferred'];
    case 'item_wrong_location':
      return ['item_moved_to_counted_location', 'confirmed_system_location', 'recount_requested',
        'observation_mistaken', 'deferred'];
    case 'lot_shortage':
    case 'lot_overage':
      return ['recount_requested', 'lot_quantity_adjusted',
        'explained_by_post_snapshot_activity', 'observation_mistaken', 'deferred'];
    case 'lot_uncounted':
      return ['recount_requested', 'observation_mistaken', 'deferred'];
  }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface Readiness {
  readonly status: CycleCountStatus;
  readonly can_complete: boolean;
  readonly can_complete_with_deferrals: boolean;
  readonly open_count: number;
  readonly recount_requested_count: number;
  readonly resolved_count: number;
  readonly deferred_count: number;
  readonly failed_resolution_count: number;
  readonly inventory_changing_resolution_count: number;
  readonly blockers: readonly string[];
}

export interface CompletionGate {
  /** The ordinary button. Deferrals block it by default. */
  readonly standardEnabled: boolean;
  /** The separate, explicit path. Never the default. */
  readonly deferredPathOffered: boolean;
  readonly deferredCount: number;
  readonly blockers: readonly string[];
}

export function completionGate(readiness: Readiness): CompletionGate {
  return {
    standardEnabled: readiness.can_complete,
    deferredPathOffered: readiness.can_complete_with_deferrals,
    deferredCount: readiness.deferred_count,
    blockers: readiness.blockers,
  };
}

/** A completion with deferrals is not allowed to proceed on a shrug. */
export function validateDeferredCompletion(input: {
  readonly acknowledged: boolean;
  readonly reason: string;
  readonly deferredCount: number;
}): { readonly ok: boolean; readonly problem: string | null } {
  if (input.deferredCount === 0) {
    return { ok: false, problem: 'There are no deferred discrepancies — use the ordinary completion.' };
  }
  if (!input.acknowledged) {
    return {
      ok: false,
      problem: `Confirm that you are completing this count with ${input.deferredCount} deferred discrepancy(s) still outstanding.`,
    };
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, problem: 'Give a reason for completing with deferred work — at least a sentence.' };
  }
  return { ok: true, problem: null };
}

export function validateCancellation(reason: string): { readonly ok: boolean; readonly problem: string | null } {
  if (reason.trim() === '') {
    return { ok: false, problem: 'Say why this count is being cancelled.' };
  }
  return { ok: true, problem: null };
}

// ---------------------------------------------------------------------------
// Creating a count
// ---------------------------------------------------------------------------

export interface NewCountInput {
  readonly rootLocationCode: string;
  readonly includeDescendants: boolean;
  readonly subtypeFilter: string | null;
  readonly verticalFilter: string | null;
  readonly blindCount: boolean;
  readonly notes: string;
}

export function validateNewCount(input: NewCountInput): { readonly ok: boolean; readonly problem: string | null } {
  if (!input.rootLocationCode.trim()) {
    return { ok: false, problem: 'Choose the location to count.' };
  }
  if (input.notes.length > 2000) {
    return { ok: false, problem: 'Notes are limited to 2000 characters.' };
  }
  return { ok: true, problem: null };
}

export interface ScopePreview {
  readonly location_count: number;
  readonly expected_item_count: number;
  readonly expected_lot_count: number;
  readonly expected_unit_count: number | null;
}

export function previewWarnings(preview: ScopePreview): readonly string[] {
  const warnings: string[] = [];
  if (preview.location_count === 0) {
    warnings.push('That scope resolves to no active locations.');
  }
  if (preview.expected_item_count === 0 && preview.expected_lot_count === 0) {
    warnings.push('There is nothing countable in that scope. Starting the count would freeze an empty snapshot.');
  }
  return warnings;
}

/** A count over an empty scope is legal but almost never intended. */
export function requiresEmptyScopeConfirmation(preview: ScopePreview): boolean {
  return preview.expected_item_count === 0 && preview.expected_lot_count === 0;
}

// ---------------------------------------------------------------------------
// Concurrent change by another operator
// ---------------------------------------------------------------------------

/**
 * The page was open on one screen while somebody else moved the session on.
 * The operator gets told what happened and where they are going, rather than
 * having a control fail underneath them.
 */
export function describeStatusChange(
  from: CycleCountStatus,
  to: CycleCountStatus
): string | null {
  if (from === to) return null;
  switch (to) {
    case 'review': return 'This count was submitted for review somewhere else.';
    case 'completed': return 'This count was completed somewhere else.';
    case 'cancelled': return 'This count was cancelled somewhere else.';
    case 'in_progress':
      return from === 'review'
        ? 'A recount was opened somewhere else, so this count is being counted again.'
        : 'This count was started somewhere else.';
    default: return `This count is now ${STATUS_LABEL[to].toLowerCase()}.`;
  }
}

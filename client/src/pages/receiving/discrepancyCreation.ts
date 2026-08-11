// Recording a discrepancy is the one governed receiving operation that CANNOT
// be retried.
//
// WHY THIS MODULE EXISTS
//
// Every other Batch 1 and Batch 2 mutation has governed replay semantics.
// Opening a receipt carries an idempotency key. Recording a line is keyed on
// the (receipt, acquisition line) grain. Correcting is a compare-and-set.
// Cancel, submit, reconcile and discrepancy transitions all return `replayed`
// when the record already holds the target state. Unlink replays on the same
// link identity and the same reason. For all of those, resending the identical
// semantic operation after a lost response is safe, and the database says so.
//
// `raise_acquisition_discrepancy` has NO idempotency key and returns NO
// `replayed` flag, because a human-raised discrepancy is new evidence every
// time it is raised. So a lost response is genuinely dangerous: the request may
// have committed, and pressing the button again would record a SECOND durable
// discrepancy against the same physical problem. Nobody on this page can tell
// the two cases apart from the failure alone.
//
// The recovery is therefore VERIFY-FIRST, never retry-first:
//
//   1. the intended evidence is retained locally, exactly as confirmed;
//   2. creation is LOCKED — there is no button to press again;
//   3. the operator asks for an authoritative re-read;
//   4. the re-read is compared against the discrepancy identities known BEFORE
//      the attempt;
//   5. a new matching discrepancy means the attempt COMMITTED: do not resend,
//      and send the operator to review what is now on record;
//   6. no new matching discrepancy, on a complete successful read, means the
//      attempt did not commit: a NEW confirmed attempt is permitted;
//   7. a failed verification leaves the outcome UNKNOWN: creation stays locked,
//      and the operator is never told "nothing was sent".
//
// This module is pure. It performs no I/O and holds no React state; the page
// supplies the re-read and this decides what the answer means.

import type { Discrepancy, DiscrepancyKind } from '../../lib/receivingApi';

/** The immutable evidence an operator confirmed, retained across the attempt. */
export interface DiscrepancyIntent {
  readonly orderPublicId: string;
  readonly receiptPublicId: string | null;
  readonly receiptLinePublicId: string | null;
  readonly kind: DiscrepancyKind;
  readonly quantityExpected: number | null;
  readonly quantityObserved: number | null;
  readonly detail: string;
}

export type DiscrepancyCreationPhase =
  /** Nothing in flight. A confirmed attempt may be started. */
  | { readonly phase: 'idle' }
  /** The request is in flight. */
  | { readonly phase: 'submitting'; readonly intent: DiscrepancyIntent }
  /**
   * The response never arrived, or arrived as a failure that does not prove the
   * request was refused. Creation is LOCKED until verification.
   */
  | { readonly phase: 'unknown'; readonly intent: DiscrepancyIntent; readonly knownBefore: readonly string[] }
  /** An authoritative re-read is in progress. */
  | { readonly phase: 'verifying'; readonly intent: DiscrepancyIntent; readonly knownBefore: readonly string[] }
  /**
   * Verification PROVED the attempt committed. Resending is forbidden; the
   * operator is directed to the discrepancy that is now on record.
   */
  | { readonly phase: 'committed'; readonly intent: DiscrepancyIntent; readonly discrepancyPublicId: string }
  /**
   * Verification PROVED the attempt did not commit. A new confirmed attempt is
   * permitted — and it is a NEW attempt, not a resend.
   */
  | { readonly phase: 'absent'; readonly intent: DiscrepancyIntent }
  /**
   * Verification itself failed. The outcome remains unknown and creation stays
   * locked. This is deliberately NOT the same as `absent`.
   */
  | { readonly phase: 'unverified'; readonly intent: DiscrepancyIntent; readonly knownBefore: readonly string[] };

/** May a NEW confirmed creation attempt be started right now? */
export function creationAllowed(state: DiscrepancyCreationPhase): boolean {
  return state.phase === 'idle' || state.phase === 'absent';
}

/** Is the outcome of a previous attempt still genuinely unknown? */
export function outcomeUnknown(state: DiscrepancyCreationPhase): boolean {
  return state.phase === 'unknown' || state.phase === 'unverified';
}

/**
 * Exact nullable quantity equality.
 *
 * `null` matches `null`. A number matches only the same number. `null` never
 * matches a number, and one number never matches another. There is no
 * tolerance and no coercion: these are immutable evidence values, and "close
 * enough" is not a thing a discrepancy record can be.
 */
function sameQuantity(candidate: number | null, intended: number | null): boolean {
  return candidate === null ? intended === null : candidate === intended;
}

/**
 * Does this recorded discrepancy match the evidence that was attempted?
 *
 * WHY QUANTITIES ARE COMPARED, WHEN THEY ONCE WERE NOT.
 *
 * The first version of this function ignored `quantityExpected` and
 * `quantityObserved`, on the reasoning that they were "optional evidence" and
 * that scope, kind and detail already identified the report. That was wrong,
 * and wrong in the direction this whole module exists to prevent.
 *
 * `raise_acquisition_discrepancy` PERSISTS both quantities as immutable
 * discrepancy evidence when they are supplied. A record carrying different
 * quantities is therefore a different piece of evidence — it may be a
 * colleague's report of the same physical problem, raised seconds earlier with
 * their own count. Treating it as proof that the OPERATOR's attempt committed
 * would tell them "it did reach the database" on evidence that does not
 * establish it, and would suppress a record that genuinely never happened.
 *
 * So every field the intent carries must match exactly. Nothing here is fuzzy,
 * and nothing is skipped because it happens to be null: a null the operator
 * confirmed is itself part of what they confirmed.
 */
export function matchesIntent(candidate: Discrepancy, intent: DiscrepancyIntent): boolean {
  return (
    candidate.kind === intent.kind
    && candidate.orderPublicId === intent.orderPublicId
    && (candidate.receiptPublicId ?? null) === intent.receiptPublicId
    && (candidate.receiptLinePublicId ?? null) === intent.receiptLinePublicId
    && sameQuantity(candidate.quantityExpected ?? null, intent.quantityExpected)
    && sameQuantity(candidate.quantityObserved ?? null, intent.quantityObserved)
    && candidate.detail.trim() === intent.detail.trim()
  );
}

/**
 * Interpret an authoritative re-read.
 *
 * `current` must be a COMPLETE governed list for the order. A partial or
 * filtered list could omit the very record that proves the attempt committed,
 * and concluding "absent" from an incomplete read is exactly how a duplicate
 * gets created.
 */
export function verify(
  state: DiscrepancyCreationPhase,
  current: readonly Discrepancy[],
): DiscrepancyCreationPhase {
  if (state.phase !== 'verifying') return state;
  const before = new Set(state.knownBefore);
  const appeared = current.filter((candidate) => !before.has(candidate.discrepancyPublicId));
  const match = appeared.find((candidate) => matchesIntent(candidate, state.intent));
  if (match) {
    return { phase: 'committed', intent: state.intent, discrepancyPublicId: match.discrepancyPublicId };
  }
  return { phase: 'absent', intent: state.intent };
}

/** The re-read itself failed. The outcome is still unknown, and stays locked. */
export function verificationFailed(state: DiscrepancyCreationPhase): DiscrepancyCreationPhase {
  if (state.phase !== 'verifying') return state;
  return { phase: 'unverified', intent: state.intent, knownBefore: state.knownBefore };
}

export function beginSubmit(intent: DiscrepancyIntent): DiscrepancyCreationPhase {
  return { phase: 'submitting', intent };
}

export function submitFailed(
  intent: DiscrepancyIntent,
  knownBefore: readonly string[],
): DiscrepancyCreationPhase {
  return { phase: 'unknown', intent, knownBefore: [...knownBefore] };
}

export function beginVerify(state: DiscrepancyCreationPhase): DiscrepancyCreationPhase {
  if (state.phase !== 'unknown' && state.phase !== 'unverified') return state;
  return { phase: 'verifying', intent: state.intent, knownBefore: state.knownBefore };
}

/**
 * The operator-facing sentence for each phase.
 *
 * None of these says "nothing was sent". That claim cannot be made about a
 * request whose response never arrived, and making it is precisely the false
 * guarantee S1.6.6 was written to remove from this codebase.
 */
export function creationMessage(state: DiscrepancyCreationPhase): string {
  switch (state.phase) {
    case 'unknown':
      return (
        'The discrepancy request did not return a usable answer, so whether it was recorded is unknown. '
        + 'Recording a discrepancy has no governed replay, so pressing again could create a second record '
        + 'of the same problem. Check what is on record before deciding.'
      );
    case 'verifying':
      return 'Re-reading the governed discrepancy list to establish what was actually recorded…';
    case 'committed':
      // The claim is exactly as strong as the check behind it: a NEW record
      // whose every confirmed field — scope, kind, both quantities and detail —
      // matches what the operator confirmed. Anything weaker would be asserting
      // more than the evidence establishes.
      return (
        'The governed record now contains a new discrepancy matching the evidence you confirmed — same '
        + 'scope, kind, quantities and detail — and it was not there before your attempt, so it did reach '
        + `the database as ${state.discrepancyPublicId}. It was not recorded twice. Review it below rather `
        + 'than reporting the problem again.'
      );
    case 'absent':
      return (
        'The governed discrepancy list was re-read in full and contains no new record matching the evidence '
        + 'you confirmed, so the previous attempt did not reach the database. You can record it again.'
      );
    case 'unverified':
      return (
        'The governed discrepancy list could not be re-read, so whether the earlier attempt was recorded '
        + 'remains unknown. Recording is still locked, because creating another one now could duplicate a '
        + 'discrepancy that already exists.'
      );
    default:
      return '';
  }
}

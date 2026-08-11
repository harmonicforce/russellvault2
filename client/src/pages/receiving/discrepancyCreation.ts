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
 * Does this recorded discrepancy match the evidence that was attempted?
 *
 * Deliberately strict on the fields that identify WHAT was reported — scope,
 * kind and detail — because a looser match would let an unrelated discrepancy
 * raised by a colleague seconds earlier be mistaken for the operator's own,
 * which would suppress a record that genuinely never happened.
 *
 * Quantities are deliberately NOT compared: they are optional evidence, and a
 * discrepancy raised with the same scope, kind and detail is the same report.
 */
export function matchesIntent(candidate: Discrepancy, intent: DiscrepancyIntent): boolean {
  return (
    candidate.kind === intent.kind
    && candidate.orderPublicId === intent.orderPublicId
    && (candidate.receiptPublicId ?? null) === intent.receiptPublicId
    && (candidate.receiptLinePublicId ?? null) === intent.receiptLinePublicId
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
      return (
        'The governed record now contains a matching discrepancy that was not there before your attempt, '
        + `so it did reach the database as ${state.discrepancyPublicId}. It was not recorded twice. `
        + 'Review it below rather than reporting the problem again.'
      );
    case 'absent':
      return (
        'The governed discrepancy list was re-read in full and contains no matching new record, so the '
        + 'previous attempt did not reach the database. You can record it again.'
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

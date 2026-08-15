// Withdrawing a proposal is the second governed cost operation that CANNOT be
// retried.
//
// WHY THIS IS NOT THE SAME MODULE AS `proposalCreation`
//
// Proposing and withdrawing both lack an idempotency key, so both need
// verify-first recovery. But they are verified against DIFFERENT evidence and
// have DIFFERENT outcomes.
//
// A proposal is verified by asking "did the split I confirmed appear?".
// A withdrawal is verified by asking "did the exact allocations I was looking
// at stop being candidates, and if so, WHY?" — and "why" matters, because
// `withdraw_cost_allocation` and `confirm_cost_allocation` both empty the
// candidate set. One retracts the proposal; the other turns it into the cost
// basis. Confusing them is not a cosmetic error.
//
// So the recovery retains the EXACT allocation public identities that existed
// when the owner confirmed withdrawal, and the re-read is compared against
// those specific rows rather than against a count or a state name.
//
//   1. those exact allocations are now `withdrawn`
//        → the withdrawal COMMITTED. Do not resend.
//
//   2. those exact allocations are now `confirmed`, or the component is
//      `allocated`
//        → a CONFIRMATION won the race. The withdrawal did not take effect, and
//          resending it would be refused anyway — but more importantly the
//          owner must be told a cost basis now exists, which is the opposite of
//          what they were trying to achieve.
//
//   3. those exact allocations are still `candidate`, unchanged
//        → the withdrawal is PROVEN ABSENT. A new confirmed attempt is allowed.
//
//   4. the candidate set changed in some other way — different identities,
//      a partial overlap, rows that vanished entirely
//        → the outcome is NOT SAFELY ATTRIBUTABLE. Stay locked and say so.
//          Guessing here would either hide a withdrawal that happened or invite
//          a second one against a proposal somebody else has since replaced.
//
//   5. the re-read itself failed
//        → the outcome remains UNKNOWN. Stay locked.
//
// Nothing here ever says "nothing was sent".
//
// This module is pure. It performs no I/O and holds no React state; the page
// supplies the re-read and this decides what the answer means.

import type { AllocationRecord, CostComponentDetail } from '../../lib/costApi';

/** The exact proposal an owner was looking at when they confirmed withdrawal. */
export interface WithdrawalIntent {
  readonly componentPublicId: string;
  /**
   * The allocation public identities that were CANDIDATES at confirmation time.
   *
   * Identities, not a count and not a total: a count cannot tell a withdrawal
   * apart from a confirmation, and a total cannot tell this proposal apart from
   * a replacement that happens to sum the same.
   */
  readonly candidatePublicIds: readonly string[];
  readonly reason: string;
}

export type WithdrawalPhase =
  /** Nothing in flight. A confirmed attempt may be started. */
  | { readonly phase: 'idle' }
  /** The request is in flight. */
  | { readonly phase: 'submitting'; readonly intent: WithdrawalIntent }
  /**
   * The response never arrived, or arrived as a failure that does not prove the
   * request was refused. Withdrawal is LOCKED until verification.
   */
  | { readonly phase: 'unknown'; readonly intent: WithdrawalIntent }
  /** An authoritative re-read is in progress. */
  | { readonly phase: 'verifying'; readonly intent: WithdrawalIntent }
  /** Verification PROVED the withdrawal committed. */
  | { readonly phase: 'committed'; readonly intent: WithdrawalIntent; readonly withdrawnCount: number }
  /**
   * Verification PROVED a confirmation won instead. The proposal became the
   * cost basis; the withdrawal did not happen.
   */
  | { readonly phase: 'confirmed_instead'; readonly intent: WithdrawalIntent }
  /**
   * Verification PROVED the withdrawal did not commit. The same proposal is
   * still pending, so a NEW confirmed attempt is permitted.
   */
  | { readonly phase: 'absent'; readonly intent: WithdrawalIntent }
  /**
   * The candidate set moved in a way that cannot be attributed to this attempt.
   * Deliberately NOT `absent` and deliberately NOT `committed`.
   */
  | { readonly phase: 'inconclusive'; readonly intent: WithdrawalIntent; readonly detail: string }
  /** Verification itself failed. The outcome remains unknown and locked. */
  | { readonly phase: 'unverified'; readonly intent: WithdrawalIntent };

/** May a NEW confirmed withdrawal be started right now? */
export function withdrawalAllowed(state: WithdrawalPhase): boolean {
  return state.phase === 'idle' || state.phase === 'absent';
}

/** Is the outcome of a previous attempt still genuinely unknown? */
export function outcomeUnknown(state: WithdrawalPhase): boolean {
  return state.phase === 'unknown' || state.phase === 'unverified';
}

/** The allocation identities to retain before an attempt. */
export function candidateIdentities(component: CostComponentDetail): readonly string[] {
  return component.allocations
    .filter((row) => row.state === 'candidate')
    .map((row) => row.allocationPublicId)
    .sort();
}

function byIdentity(
  allocations: readonly AllocationRecord[],
  identities: readonly string[],
): readonly AllocationRecord[] {
  const wanted = new Set(identities);
  return allocations.filter((row) => wanted.has(row.allocationPublicId));
}

/**
 * Interpret an authoritative re-read.
 *
 * `component` must be the COMPLETE governed record. A partial read could omit
 * the very rows that say what happened, and concluding "absent" from an
 * incomplete read would invite a second withdrawal against a proposal that no
 * longer exists.
 */
export function verify(
  state: WithdrawalPhase,
  component: CostComponentDetail,
): WithdrawalPhase {
  if (state.phase !== 'verifying') return state;
  const { intent } = state;

  const mine = byIdentity(component.allocations, intent.candidatePublicIds);

  // Every retained identity must still be readable. If some have vanished from
  // the governed record entirely, nothing can be concluded about them.
  if (mine.length !== intent.candidatePublicIds.length) {
    return {
      phase: 'inconclusive',
      intent,
      detail:
        'Some of the allocations that were pending when you confirmed are no longer in the governed '
        + 'record at all.',
    };
  }

  const states = new Set(mine.map((row) => row.state));

  // A single, uniform outcome across exactly the retained rows is the only
  // thing that can be attributed to this attempt.
  if (states.size === 1) {
    const [only] = [...states];
    if (only === 'withdrawn') {
      return { phase: 'committed', intent, withdrawnCount: mine.length };
    }
    if (only === 'confirmed') return { phase: 'confirmed_instead', intent };
    if (only === 'candidate') {
      // Still pending — but only if the component ALSO has no other candidates
      // that appeared meanwhile, which would mean the proposal is not the one
      // the owner reviewed.
      const nowCandidates = candidateIdentities(component);
      const unchanged = nowCandidates.length === intent.candidatePublicIds.length
        && nowCandidates.every((id, index) => id === [...intent.candidatePublicIds].sort()[index]);
      return unchanged
        ? { phase: 'absent', intent }
        : {
            phase: 'inconclusive',
            intent,
            detail:
              'The allocations you reviewed are still pending, but the pending set as a whole has '
              + 'changed since then.',
          };
    }
  }

  // The component moved past the proposal entirely.
  if (component.workflowState === 'allocated') {
    return { phase: 'confirmed_instead', intent };
  }

  return {
    phase: 'inconclusive',
    intent,
    detail:
      'The allocations you reviewed are no longer in a single consistent state, so what happened to '
      + 'your request cannot be attributed from the record.',
  };
}

/** The re-read itself failed. The outcome is still unknown, and stays locked. */
export function verificationFailed(state: WithdrawalPhase): WithdrawalPhase {
  if (state.phase !== 'verifying') return state;
  return { phase: 'unverified', intent: state.intent };
}

export function beginSubmit(intent: WithdrawalIntent): WithdrawalPhase {
  return { phase: 'submitting', intent };
}

export function submitFailed(intent: WithdrawalIntent): WithdrawalPhase {
  return { phase: 'unknown', intent };
}

export function beginVerify(state: WithdrawalPhase): WithdrawalPhase {
  if (state.phase !== 'unknown' && state.phase !== 'unverified') return state;
  return { phase: 'verifying', intent: state.intent };
}

/**
 * The operator-facing sentence for each phase.
 *
 * None of these says "nothing was sent", and none of them describes withdrawal
 * as deletion.
 */
export function withdrawalMessage(state: WithdrawalPhase): string {
  switch (state.phase) {
    case 'unknown':
      return (
        'The withdrawal request did not return a usable answer, so whether the proposal was withdrawn '
        + 'is unknown. Withdrawing has no governed replay, and confirming and withdrawing both empty '
        + 'the pending set — so pressing again could act on a proposal that has already become the '
        + 'cost basis. Check what is on record before deciding.'
      );
    case 'verifying':
      return 'Re-reading the governed cost component to establish what actually happened…';
    case 'committed':
      return (
        `The ${state.withdrawnCount} allocations you reviewed are now recorded as withdrawn, so your `
        + 'request did reach the database. They were not deleted: the amounts and method remain on '
        + 'record as history, and a corrected split can now be proposed.'
      );
    case 'confirmed_instead':
      return (
        'The proposal you tried to withdraw was CONFIRMED instead — it is now the governed cost basis '
        + 'for the lines it names. Your withdrawal did not take effect. If this basis is wrong, '
        + 'reverse it rather than withdrawing it; reversal is the governed operation for a confirmed '
        + 'allocation, and it also preserves the rows.'
      );
    case 'absent':
      return (
        'The governed record was re-read in full and the same proposal is still pending, unchanged, so '
        + 'the previous attempt did not reach the database. You can withdraw it again.'
      );
    case 'inconclusive':
      return (
        `${state.detail} That means the outcome of your request cannot be safely attributed, so `
        + 'withdrawing is still locked. Review the allocations below before acting: withdrawing again '
        + 'could act on a proposal that is not the one you reviewed.'
      );
    case 'unverified':
      return (
        'The governed cost component could not be re-read, so whether the earlier attempt was recorded '
        + 'remains unknown. Withdrawing is still locked.'
      );
    default:
      return '';
  }
}

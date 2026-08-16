// The non-idempotent withdrawal contract, tested as pure logic.
//
// THE DISTINCTION THIS FILE EXISTS TO PROVE
//
// `withdraw_cost_allocation` and `confirm_cost_allocation` BOTH empty the
// candidate set. After a lost response, "the proposal is no longer pending" is
// therefore not an answer — it is the question. Only the per-row outcome can
// say which of the two happened, and the difference is between "the proposal
// was retracted" and "the proposal is now the cost basis".
//
// These tests pin all five outcomes, and in particular that a set which moved
// in an unattributable way is neither treated as a success nor as an absence.

import { describe, expect, it } from 'vitest';
import {
  beginSubmit, beginVerify, candidateIdentities, outcomeUnknown, submitFailed,
  verificationFailed, verify, withdrawalAllowed, withdrawalMessage,
  type WithdrawalIntent,
} from './withdrawalCreation';
import type { AllocationRecord, CostComponentDetail } from '../../lib/costApi';

function allocation(over: Partial<AllocationRecord> = {}): AllocationRecord {
  return {
    allocationPublicId: 'RV-ACALLOC-AAA111',
    sourceSystemPublicId: 'RV-SS-WHATNOT',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    amountMinor: '750',
    method: 'manual_quantity',
    state: 'candidate',
    reviewedAt: null,
    reversedAt: null,
    createdAt: '2026-08-10T11:00:00.000Z',
    ...over,
  };
}

const PAIR: AllocationRecord[] = [
  allocation(),
  allocation({
    allocationPublicId: 'RV-ACALLOC-BBB222',
    acquisitionLinePublicId: 'RV-AL-BBB222',
    amountMinor: '250',
  }),
];

const INTENT: WithdrawalIntent = {
  componentPublicId: 'RV-ACOST-AAA111',
  candidatePublicIds: ['RV-ACALLOC-AAA111', 'RV-ACALLOC-BBB222'],
  reason: 'The split used the wrong weighting',
};

function component(over: Partial<CostComponentDetail> = {}): CostComponentDetail {
  return {
    componentPublicId: 'RV-ACOST-AAA111',
    componentType: 'shipping',
    amount: { state: 'known', minor: '1000', currency: 'USD' },
    attributionState: 'unresolved',
    workflowState: 'proposed_awaiting_confirmation',
    scopeKind: 'order',
    orderPublicId: 'RV-ACQ-AAA111',
    lotPublicId: null,
    directLinePublicId: null,
    evidenceNote: null,
    candidateCount: 2,
    confirmedCount: 0,
    createdAt: '2026-08-10T10:00:00.000Z',
    isReversed: false,
    order: null,
    scopeLines: [],
    allocations: PAIR,
    candidateTotalMinor: '1000',
    conservationDeltaMinor: '0',
    ...over,
  };
}

/** Move the retained rows to a state, as the governed function would. */
function asState(state: AllocationRecord['state']): AllocationRecord[] {
  return PAIR.map((row) => ({ ...row, state }));
}

describe('withdrawing is locked the moment an outcome becomes unknown', () => {
  it('allows a first attempt from idle', () => {
    expect(withdrawalAllowed({ phase: 'idle' })).toBe(true);
  });

  it('forbids another attempt while the outcome is unknown', () => {
    const state = submitFailed(INTENT);
    expect(state.phase).toBe('unknown');
    expect(withdrawalAllowed(state)).toBe(false);
    expect(outcomeUnknown(state)).toBe(true);
  });

  it('never claims nothing was sent', () => {
    for (const state of [
      submitFailed(INTENT),
      verificationFailed(beginVerify(submitFailed(INTENT))),
    ]) {
      expect(withdrawalMessage(state)).not.toMatch(/nothing was sent|was not sent|no request/i);
      expect(withdrawalMessage(state)).toMatch(/unknown/i);
    }
  });

  // The reason a blind retry is dangerous here is SPECIFIC, and the message
  // has to carry it: confirm and withdraw are indistinguishable by absence.
  it('says why a blind retry is dangerous for this operation in particular', () => {
    expect(withdrawalMessage(submitFailed(INTENT)))
      .toMatch(/confirming and withdrawing both empty the pending set/i);
  });
});

describe('the retained identities are what gets verified', () => {
  it('captures exactly the candidate identities, sorted', () => {
    expect(candidateIdentities(component())).toEqual(['RV-ACALLOC-AAA111', 'RV-ACALLOC-BBB222']);
  });

  it('ignores rows that were never candidates', () => {
    const detail = component({
      allocations: [...PAIR, allocation({ allocationPublicId: 'RV-ACALLOC-OLD', state: 'reversed' })],
    });
    expect(candidateIdentities(detail)).toEqual(['RV-ACALLOC-AAA111', 'RV-ACALLOC-BBB222']);
  });
});

describe('verification against an authoritative re-read', () => {
  // 1. The withdrawal committed.
  it('proves the withdrawal COMMITTED when the retained rows are withdrawn', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ allocations: asState('withdrawn'), candidateCount: 0, workflowState: 'awaiting_proposal' }));
    expect(settled.phase).toBe('committed');
    expect(settled).toMatchObject({ withdrawnCount: 2 });
    expect(withdrawalAllowed(settled)).toBe(false);
    expect(withdrawalMessage(settled)).toMatch(/did reach the database/i);
    // And it never describes the outcome as a deletion.
    expect(withdrawalMessage(settled)).toMatch(/were not deleted/i);
    expect(withdrawalMessage(settled)).not.toMatch(/removed|erased/i);
  });

  // 2. THE RACE THAT MATTERS. A confirmation won.
  it('reports a CONFIRMATION winning as its own outcome, never as a withdrawal', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({
        allocations: asState('confirmed'), candidateCount: 0, confirmedCount: 2,
        workflowState: 'allocated', attributionState: 'allocated',
      }));
    expect(settled.phase).toBe('confirmed_instead');
    expect(withdrawalAllowed(settled)).toBe(false);
    expect(withdrawalMessage(settled)).toMatch(/was CONFIRMED instead/);
    expect(withdrawalMessage(settled)).toMatch(/now the governed cost basis/i);
    // And it points at the RIGHT governed operation for that situation.
    expect(withdrawalMessage(settled)).toMatch(/reverse it rather than withdrawing it/i);
    expect(withdrawalMessage(settled)).not.toMatch(/did reach the database/i);
  });

  it('reports a confirmation that moved the component even if rows read oddly', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({
        allocations: [
          { ...PAIR[0], state: 'confirmed' },
          { ...PAIR[1], state: 'reversed' },
        ],
        workflowState: 'allocated',
      }));
    expect(settled.phase).toBe('confirmed_instead');
  });

  // 3. Proven absent.
  it('proves the withdrawal did NOT commit when the same proposal is still pending', () => {
    const settled = verify(beginVerify(submitFailed(INTENT)), component());
    expect(settled.phase).toBe('absent');
    // Only now may a NEW confirmed attempt be made.
    expect(withdrawalAllowed(settled)).toBe(true);
    expect(withdrawalMessage(settled)).toMatch(/still pending, unchanged/i);
  });

  // 4. THE LOAD-BEARING AMBIGUITY CASES.
  it('is inconclusive when a retained row has vanished from the record', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ allocations: [PAIR[0]], candidateCount: 1 }));
    expect(settled.phase).toBe('inconclusive');
    expect(withdrawalAllowed(settled)).toBe(false);
    expect(withdrawalMessage(settled)).toMatch(/no longer in the governed record/i);
    expect(withdrawalMessage(settled)).toMatch(/still locked/i);
  });

  it('is inconclusive when the retained rows are still pending but the set has grown', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({
        allocations: [
          ...PAIR,
          allocation({ allocationPublicId: 'RV-ACALLOC-CCC333', acquisitionLinePublicId: 'RV-AL-CCC333', amountMinor: '0' }),
        ],
        candidateCount: 3,
      }));
    expect(settled.phase).toBe('inconclusive');
    expect(withdrawalAllowed(settled)).toBe(false);
    expect(withdrawalMessage(settled)).toMatch(/pending set as a whole has changed/i);
  });

  it('is inconclusive when the retained rows ended in mixed states', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({
        allocations: [
          { ...PAIR[0], state: 'withdrawn' },
          { ...PAIR[1], state: 'candidate' },
        ],
      }));
    expect(settled.phase).toBe('inconclusive');
    expect(withdrawalMessage(settled)).toMatch(/single consistent state/i);
  });

  // An inconclusive outcome must never be reported as either success or absence.
  it('never claims success or absence from an unattributable set', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ allocations: [PAIR[0]], candidateCount: 1 }));
    expect(settled.phase).not.toBe('committed');
    expect(settled.phase).not.toBe('absent');
    expect(withdrawalMessage(settled)).not.toMatch(/did reach the database|did not reach the database/i);
  });

  // 5. A failed verification is not an absence.
  it('keeps withdrawing locked when verification itself fails', () => {
    const settled = verificationFailed(beginVerify(submitFailed(INTENT)));
    expect(settled.phase).toBe('unverified');
    expect(withdrawalAllowed(settled)).toBe(false);
    expect(outcomeUnknown(settled)).toBe(true);
    expect(withdrawalMessage(settled)).toMatch(/could not be re-read/i);
    expect(withdrawalMessage(settled)).toMatch(/still locked/i);
  });

  it('can be re-verified after a failed verification', () => {
    const retry = beginVerify(verificationFailed(beginVerify(submitFailed(INTENT))));
    expect(retry.phase).toBe('verifying');
    expect(verify(retry, component({ allocations: asState('withdrawn') })).phase).toBe('committed');
  });
});

describe('nothing describes withdrawal as deletion', () => {
  const everyPhase = () => [
    submitFailed(INTENT),
    beginVerify(submitFailed(INTENT)),
    verify(beginVerify(submitFailed(INTENT)), component({ allocations: asState('withdrawn') })),
    verify(beginVerify(submitFailed(INTENT)), component({ allocations: asState('confirmed'), workflowState: 'allocated' })),
    verify(beginVerify(submitFailed(INTENT)), component()),
    verify(beginVerify(submitFailed(INTENT)), component({ allocations: [PAIR[0]] })),
    verificationFailed(beginVerify(submitFailed(INTENT))),
  ];

  /*
   * The assertion forbids AFFIRMATIVE deletion claims, not the word itself.
   *
   * "They were not deleted" is the opposite of the thing being guarded
   * against — it is the denial the governed semantics require — so a blanket
   * ban on the word would fail the one sentence that gets this most right.
   * What must never appear is a claim that something WAS removed.
   */
  const AFFIRMATIVE_DELETION =
    /\b(?<!not )(deleted|removed|erased|purged|discarded)\b|\bdeletes?\b|\bdeleting\b/i;

  it('never affirmatively claims a row was deleted, in any phase', () => {
    for (const state of everyPhase()) {
      expect(withdrawalMessage(state), state.phase).not.toMatch(AFFIRMATIVE_DELETION);
    }
  });

  it('does explicitly deny deletion where the outcome is a withdrawal', () => {
    const committed = verify(
      beginVerify(submitFailed(INTENT)), component({ allocations: asState('withdrawn') }));
    expect(withdrawalMessage(committed)).toMatch(/not deleted/i);
    expect(withdrawalMessage(committed)).toMatch(/remain on record as history/i);
  });
});

describe('phase transitions are total', () => {
  it('ignores a verify that was never begun', () => {
    const submitting = beginSubmit(INTENT);
    expect(verify(submitting, component()).phase).toBe('submitting');
    expect(verificationFailed(submitting).phase).toBe('submitting');
  });

  it('ignores beginVerify from a phase with nothing to verify', () => {
    expect(beginVerify({ phase: 'idle' }).phase).toBe('idle');
  });
});

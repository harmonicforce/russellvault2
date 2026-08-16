// The non-idempotent proposal contract, tested as pure logic.
//
// THE DISTINCTION THIS FILE EXISTS TO PROVE
//
// `propose_cost_allocation` has no idempotency key AND no way to withdraw what
// it wrote. A lost response therefore has FOUR possible truths, not two, and
// they demand different actions:
//
//   * the attempt landed             → do not resend; confirm what is there;
//   * somebody else's proposal is    → do not confirm what is there, because it
//     pending                          is not the split this operator chose;
//   * the attempt did not land       → propose again;
//   * we could not find out          → stay locked.
//
// These tests pin all four, and in particular that a FAILED verification is not
// treated as an absence, and that a NON-MATCHING pending proposal is not
// treated as proof the attempt committed.

import { describe, expect, it } from 'vitest';
import {
  beginSubmit, beginVerify, candidatesOf, matchesIntent, outcomeUnknown, proposalAllowed,
  proposalMessage, submitFailed, verificationFailed, verify,
  type ProposalIntent,
} from './proposalCreation';
import type { AllocationRecord, CostComponentDetail } from '../../lib/costApi';

const INTENT: ProposalIntent = {
  componentPublicId: 'RV-ACOST-AAA111',
  method: 'manual_quantity',
  lines: [
    { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750' },
    { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '250' },
  ],
};

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

/** The pair of candidates that exactly match INTENT. */
const MATCHING: AllocationRecord[] = [
  allocation(),
  allocation({
    allocationPublicId: 'RV-ACALLOC-BBB222',
    acquisitionLinePublicId: 'RV-AL-BBB222',
    amountMinor: '250',
  }),
];

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
    allocations: MATCHING,
    candidateTotalMinor: '1000',
    conservationDeltaMinor: '0',
    ...over,
  };
}

describe('proposing is locked the moment an outcome becomes unknown', () => {
  it('allows a first attempt from idle', () => {
    expect(proposalAllowed({ phase: 'idle' })).toBe(true);
  });

  it('forbids another attempt while the outcome is unknown', () => {
    const state = submitFailed(INTENT);
    expect(state.phase).toBe('unknown');
    expect(proposalAllowed(state)).toBe(false);
    expect(outcomeUnknown(state)).toBe(true);
  });

  it('never claims nothing was sent', () => {
    for (const state of [
      submitFailed(INTENT),
      verificationFailed(beginVerify(submitFailed(INTENT))),
    ]) {
      expect(proposalMessage(state)).not.toMatch(/nothing was sent|was not sent|no request/i);
      expect(proposalMessage(state)).toMatch(/unknown/i);
    }
  });

  // The message has to carry WHY this is worse than an ordinary lost write.
  it('says a proposal cannot be withdrawn', () => {
    expect(proposalMessage(submitFailed(INTENT))).toMatch(/cannot be withdrawn|no governed replay/i);
  });
});

describe('verification against an authoritative re-read', () => {
  it('proves the attempt COMMITTED when the pending proposal matches exactly', () => {
    const settled = verify(beginVerify(submitFailed(INTENT)), component());
    expect(settled.phase).toBe('committed');
    // And proposing stays locked: resending would be refused anyway, and the
    // right next step is confirmation, not another attempt.
    expect(proposalAllowed(settled)).toBe(false);
    expect(proposalMessage(settled)).toMatch(/did reach the database/i);
    expect(proposalMessage(settled)).toMatch(/not recorded twice/i);
  });

  it('proves the attempt did NOT commit when no candidate exists at all', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ allocations: [], candidateCount: 0, workflowState: 'awaiting_proposal' }));
    expect(settled.phase).toBe('absent');
    // Only now may the owner make a NEW confirmed attempt.
    expect(proposalAllowed(settled)).toBe(true);
  });

  // THE LOAD-BEARING CASE FOR THIS DOMAIN.
  //
  // A pending proposal that is not the one attempted is neither proof it
  // landed nor proof it did not. Confirming it would write a cost basis the
  // owner never chose.
  it('reports a NON-MATCHING pending proposal as its own outcome', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({
        allocations: [
          allocation({ amountMinor: '900' }),
          allocation({
            allocationPublicId: 'RV-ACALLOC-BBB222',
            acquisitionLinePublicId: 'RV-AL-BBB222',
            amountMinor: '100',
          }),
        ],
      }));
    expect(settled.phase).toBe('foreign');
    expect(proposalAllowed(settled)).toBe(false);
    expect(proposalMessage(settled)).toMatch(/not the split you confirmed/i);
    expect(proposalMessage(settled)).toMatch(/do not confirm/i);
    // And it does NOT claim the attempt landed.
    expect(proposalMessage(settled)).not.toMatch(/did reach the database/i);
  });

  it('treats a different METHOD as a different proposal', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ allocations: MATCHING.map((row) => ({ ...row, method: 'manual_equal' })) }));
    expect(settled.phase).toBe('foreign');
  });

  it('reports a component that became allocated while the outcome was unknown', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ workflowState: 'allocated' }));
    expect(settled.phase).toBe('superseded');
    expect(proposalAllowed(settled)).toBe(false);
    // It does not claim the confirmed split is the operator's.
    expect(proposalMessage(settled)).toMatch(/not something this screen can establish/i);
  });

  it('reports a component that was reversed while the outcome was unknown', () => {
    const settled = verify(
      beginVerify(submitFailed(INTENT)),
      component({ workflowState: 'component_reversed' }));
    expect(settled.phase).toBe('superseded');
    expect(proposalMessage(settled)).toMatch(/has been reversed/i);
  });

  // THE OTHER LOAD-BEARING CASE. A failed verification is not an absence.
  it('keeps proposing locked when verification itself fails', () => {
    const settled = verificationFailed(beginVerify(submitFailed(INTENT)));
    expect(settled.phase).toBe('unverified');
    expect(proposalAllowed(settled)).toBe(false);
    expect(outcomeUnknown(settled)).toBe(true);
    expect(proposalMessage(settled)).toMatch(/could not be re-read/i);
    expect(proposalMessage(settled)).toMatch(/still locked|remains unknown/i);
  });

  it('can be re-verified after a failed verification', () => {
    const retry = beginVerify(verificationFailed(beginVerify(submitFailed(INTENT))));
    expect(retry.phase).toBe('verifying');
    expect(verify(retry, component()).phase).toBe('committed');
  });
});

describe('matching an attempt against the governed record', () => {
  it('matches regardless of the order the database returned rows in', () => {
    expect(matchesIntent([...MATCHING].reverse(), INTENT)).toBe(true);
  });

  it('does not match when a line is missing', () => {
    expect(matchesIntent([MATCHING[0]], INTENT)).toBe(false);
  });

  it('does not match when an extra line is present', () => {
    expect(matchesIntent(
      [...MATCHING, allocation({ allocationPublicId: 'RV-ACALLOC-CCC333', acquisitionLinePublicId: 'RV-AL-CCC333', amountMinor: '0' })],
      INTENT,
    )).toBe(false);
  });

  // No tolerance. `confirm_cost_allocation` allows one minor unit of slack
  // against the component TOTAL; that is a rule about conservation, not about
  // identity, and borrowing it here would let a colleague's off-by-one split be
  // mistaken for this owner's.
  it('does not match when an amount differs by even one minor unit', () => {
    expect(matchesIntent(
      [allocation({ amountMinor: '751' }), MATCHING[1]],
      INTENT,
    )).toBe(false);
  });

  it('does not match when a line targets a different source system', () => {
    expect(matchesIntent(
      [allocation({ sourceSystemPublicId: 'RV-SS-EBAY' }), MATCHING[1]],
      INTENT,
    )).toBe(false);
  });

  // Only candidates were written by a proposal. Confirmed and reversed rows are
  // a different question.
  it('considers only candidate rows', () => {
    const detail = component({
      allocations: [
        ...MATCHING,
        allocation({ allocationPublicId: 'RV-ACALLOC-OLD', state: 'reversed', amountMinor: '999' }),
      ],
    });
    expect(candidatesOf(detail)).toHaveLength(2);
    expect(matchesIntent(candidatesOf(detail), INTENT)).toBe(true);
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

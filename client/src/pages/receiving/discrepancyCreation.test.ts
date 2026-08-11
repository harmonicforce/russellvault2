// The non-idempotent discrepancy-creation contract, tested as pure logic.
//
// THE DISTINCTION THIS FILE EXISTS TO PROVE
//
// Every other governed receiving mutation has replay semantics, so a lost
// response can be resolved by resending the identical operation.
// `raise_acquisition_discrepancy` has no idempotency key, so resending could
// create a SECOND durable record of the same physical problem.
//
// The recovery is therefore verify-first. These tests pin the three outcomes
// that must stay distinguishable — committed, absent, and still-unknown — and
// in particular that a FAILED verification is not treated as "absent".

import { describe, expect, it } from 'vitest';
import {
  beginSubmit, beginVerify, creationAllowed, creationMessage, matchesIntent,
  outcomeUnknown, submitFailed, verificationFailed, verify,
  type DiscrepancyIntent,
} from './discrepancyCreation';
import type { Discrepancy } from '../../lib/receivingApi';

const INTENT: DiscrepancyIntent = {
  orderPublicId: 'RV-ACQ-AAA111',
  receiptPublicId: 'RV-ARCPT-AAA111',
  receiptLinePublicId: 'RV-ARL-AAA111',
  kind: 'over_shipped',
  quantityExpected: 3,
  quantityObserved: 5,
  detail: 'Two extra units in the box',
};

function makeDiscrepancy(over: Partial<Discrepancy> = {}): Discrepancy {
  return {
    discrepancyPublicId: 'RV-ADISC-AAA111',
    kind: 'over_shipped',
    status: 'open',
    orderPublicId: 'RV-ACQ-AAA111',
    receiptPublicId: 'RV-ARCPT-AAA111',
    receiptLinePublicId: 'RV-ARL-AAA111',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    quantityExpected: 3,
    quantityObserved: 5,
    detail: 'Two extra units in the box',
    resolutionNote: null,
    resolvedAt: null,
    createdAt: '2026-08-06T10:00:00.000Z',
    ...over,
  };
}

describe('creation is locked the moment an outcome becomes unknown', () => {
  it('allows a first attempt from idle', () => {
    expect(creationAllowed({ phase: 'idle' })).toBe(true);
  });

  it('forbids another attempt while the outcome is unknown', () => {
    const state = submitFailed(INTENT, ['RV-ADISC-OLD']);
    expect(state.phase).toBe('unknown');
    expect(creationAllowed(state)).toBe(false);
    expect(outcomeUnknown(state)).toBe(true);
  });

  it('never claims nothing was sent', () => {
    for (const state of [
      submitFailed(INTENT, []),
      verificationFailed(beginVerify(submitFailed(INTENT, []))),
    ]) {
      expect(creationMessage(state)).not.toMatch(/nothing was sent|was not sent|no request/i);
      expect(creationMessage(state)).toMatch(/unknown/i);
    }
  });
});

describe('verification against an authoritative re-read', () => {
  it('proves the attempt COMMITTED when a matching record appeared', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-OLD']));
    const settled = verify(verifying, [makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-NEW' })]);
    expect(settled.phase).toBe('committed');
    // And creation stays locked: resending would duplicate it.
    expect(creationAllowed(settled)).toBe(false);
    expect(creationMessage(settled)).toMatch(/RV-ADISC-NEW/);
    expect(creationMessage(settled)).toMatch(/not recorded twice/i);
  });

  it('proves the attempt did NOT commit when no matching record appeared', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-OLD']));
    const settled = verify(verifying, [makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-OLD' })]);
    expect(settled.phase).toBe('absent');
    // Only now may the operator make a NEW confirmed attempt.
    expect(creationAllowed(settled)).toBe(true);
  });

  // A record that was ALREADY there is not evidence that this attempt landed.
  it('ignores a matching record that existed before the attempt', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-AAA111']));
    expect(verify(verifying, [makeDiscrepancy()]).phase).toBe('absent');
  });

  // A colleague's unrelated discrepancy must not be mistaken for the operator's.
  it('ignores a new record that does not match the attempted evidence', () => {
    const verifying = beginVerify(submitFailed(INTENT, []));
    const settled = verify(verifying, [
      makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-OTHER', kind: 'damaged', detail: 'Crushed corner' }),
    ]);
    expect(settled.phase).toBe('absent');
  });

  // THE POST-MERGE CORRECTION, AT THE VERIFICATION LEVEL.
  //
  // A colleague raising the same problem with a different count must NOT settle
  // the operator's unknown attempt as committed.
  it('does not settle as committed when a new record differs only in quantities', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-OLD']));
    const settled = verify(verifying, [
      makeDiscrepancy({
        discrepancyPublicId: 'RV-ADISC-COLLEAGUE',
        // Same order, receipt, receipt line, kind and detail — different count.
        quantityObserved: 6,
      }),
    ]);
    expect(settled.phase).not.toBe('committed');
    expect(settled.phase).toBe('absent');
  });

  it('permits a NEW confirmed attempt once a complete read holds no exact match', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-OLD']));
    const settled = verify(verifying, [
      makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-COLLEAGUE', quantityExpected: 4 }),
    ]);
    expect(settled.phase).toBe('absent');
    // Absent is the ONLY phase besides idle that unlocks creation, and it is
    // reached only after a complete authoritative read.
    expect(creationAllowed(settled)).toBe(true);
  });

  // Selection must not depend on which record the read happened to return first.
  it('selects the exact record even when a similar one appears before it', () => {
    const verifying = beginVerify(submitFailed(INTENT, []));
    const settled = verify(verifying, [
      makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-SIMILAR', quantityObserved: 6 }),
      makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-EXACT' }),
    ]);
    expect(settled.phase).toBe('committed');
    expect(settled).toMatchObject({ discrepancyPublicId: 'RV-ADISC-EXACT' });
    expect(creationMessage(settled)).toMatch(/RV-ADISC-EXACT/);
    // And the message claims exactly what was checked, no more.
    expect(creationMessage(settled)).toMatch(/scope, kind, quantities and detail/i);
  });

  // THE LOAD-BEARING CASE. A failed verification is not an absence.
  it('keeps creation locked when verification itself fails', () => {
    const verifying = beginVerify(submitFailed(INTENT, ['RV-ADISC-OLD']));
    const settled = verificationFailed(verifying);
    expect(settled.phase).toBe('unverified');
    expect(creationAllowed(settled)).toBe(false);
    expect(outcomeUnknown(settled)).toBe(true);
    expect(creationMessage(settled)).toMatch(/could not be re-read/i);
    expect(creationMessage(settled)).toMatch(/still locked|remains unknown/i);
  });

  it('can be re-verified after a failed verification', () => {
    const failed = verificationFailed(beginVerify(submitFailed(INTENT, [])));
    const retry = beginVerify(failed);
    expect(retry.phase).toBe('verifying');
    expect(verify(retry, [makeDiscrepancy({ discrepancyPublicId: 'RV-ADISC-NEW' })]).phase).toBe('committed');
  });
});

describe('matching an attempt against the governed record', () => {
  it('matches on scope, kind and detail', () => {
    expect(matchesIntent(makeDiscrepancy(), INTENT)).toBe(true);
  });

  it.each([
    ['kind', { kind: 'damaged' as const }],
    ['order', { orderPublicId: 'RV-ACQ-OTHER' }],
    ['receipt', { receiptPublicId: 'RV-ARCPT-OTHER' }],
    ['receipt line', { receiptLinePublicId: 'RV-ARL-OTHER' }],
    ['detail', { detail: 'Something else entirely' }],
  ])('does not match when the %s differs', (_label, over) => {
    expect(matchesIntent(makeDiscrepancy(over), INTENT)).toBe(false);
  });

  // POST-MERGE CORRECTION.
  //
  // This block replaces an assertion that said quantities could differ and the
  // record would still count as "the same report". That was wrong:
  // `raise_acquisition_discrepancy` PERSISTS both quantities as immutable
  // evidence, so a record carrying different ones is different evidence — very
  // plausibly a colleague's report of the same physical problem with their own
  // count. Accepting it would have told the operator their attempt committed on
  // evidence that does not establish it.
  it('matches when both quantities are exactly equal', () => {
    expect(matchesIntent(makeDiscrepancy({ quantityExpected: 3, quantityObserved: 5 }), INTENT)).toBe(true);
  });

  it('does not match when quantityExpected differs', () => {
    expect(matchesIntent(makeDiscrepancy({ quantityExpected: 4 }), INTENT)).toBe(false);
  });

  it('does not match when quantityObserved differs', () => {
    expect(matchesIntent(makeDiscrepancy({ quantityObserved: 6 }), INTENT)).toBe(false);
  });

  // A null is not a wildcard. It is part of what the operator confirmed.
  it('does not match a null expected against a numeric expected', () => {
    expect(matchesIntent(makeDiscrepancy({ quantityExpected: null }), INTENT)).toBe(false);
    expect(matchesIntent(
      makeDiscrepancy({ quantityExpected: 3 }),
      { ...INTENT, quantityExpected: null },
    )).toBe(false);
  });

  it('does not match a null observed against a numeric observed', () => {
    expect(matchesIntent(makeDiscrepancy({ quantityObserved: null }), INTENT)).toBe(false);
    expect(matchesIntent(
      makeDiscrepancy({ quantityObserved: 5 }),
      { ...INTENT, quantityObserved: null },
    )).toBe(false);
  });

  it('matches null against null when the intent genuinely carried nulls', () => {
    const nullIntent: DiscrepancyIntent = { ...INTENT, quantityExpected: null, quantityObserved: null };
    expect(matchesIntent(
      makeDiscrepancy({ quantityExpected: null, quantityObserved: null }),
      nullIntent,
    )).toBe(true);
  });

  it('treats an order-scoped never_arrived report as its own scope', () => {
    const orderIntent: DiscrepancyIntent = {
      ...INTENT, kind: 'never_arrived', receiptPublicId: null, receiptLinePublicId: null,
    };
    const orderRecord = makeDiscrepancy({
      kind: 'never_arrived', receiptPublicId: null, receiptLinePublicId: null,
    });
    expect(matchesIntent(orderRecord, orderIntent)).toBe(true);
    // A receipt-scoped record is NOT the same report.
    expect(matchesIntent(makeDiscrepancy({ kind: 'never_arrived' }), orderIntent)).toBe(false);
  });
});

describe('phase transitions are total', () => {
  it('ignores a verify that was never begun', () => {
    const submitting = beginSubmit(INTENT);
    expect(verify(submitting, []).phase).toBe('submitting');
    expect(verificationFailed(submitting).phase).toBe('submitting');
  });

  it('ignores beginVerify from a phase with nothing to verify', () => {
    expect(beginVerify({ phase: 'idle' }).phase).toBe('idle');
  });
});

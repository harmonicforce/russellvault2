// The decisions the cycle-count client makes on its own.
//
// The awkward ones are here on purpose: an untouched quantity field is not a
// zero, a blind count has no expected quantity to show, and a discrepancy kind
// only permits certain resolutions.

import { describe, expect, it } from 'vitest';
import {
  availableActions, canonicalPath, completionGate, completionPercent, describeStatusChange,
  friendlyCycleCountError, groupDiscrepancies, hasUnresolvedFailure, isScopeEmpty,
  isStaleQuantityConflict, isSubmittableQuantity, isTerminal, lotCountStatus,
  parseObservedQuantity, previewWarnings, requiresConfirmation, requiresNote,
  requiresEmptyScopeConfirmation, reviewGroupOf, scanFeedback, scanIdentity,
  submissionReadiness, validateCancellation, validateDeferredCompletion, validateNewCount,
  type DiscrepancyKind, type Progress, type Readiness,
} from './cycleCount';

const progress = (over: Partial<Progress> = {}): Progress => ({
  expected_item_count: 0, found_item_count: 0, wrong_location_count: 0,
  unexpected_item_count: 0, uncounted_item_count: 0,
  expected_lot_count: 0, counted_lot_count: 0, uncounted_lot_count: 0,
  matched_lot_count: 0, variance_lot_count: 0, observed_zero_lot_count: 0,
  total_observation_count: 0, ...over,
});

const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  status: 'review', can_complete: false, can_complete_with_deferrals: false,
  open_count: 0, recount_requested_count: 0, resolved_count: 0, deferred_count: 0,
  failed_resolution_count: 0, inventory_changing_resolution_count: 0, blockers: [], ...over,
});

describe('observed quantity entry', () => {
  it('treats an empty field as untouched, never as a counted zero', () => {
    expect(parseObservedQuantity('')).toEqual({ kind: 'untouched' });
    expect(parseObservedQuantity('   ')).toEqual({ kind: 'untouched' });
  });

  it('treats a missing value as untouched — undefined must never coerce to 0', () => {
    expect(parseObservedQuantity(undefined)).toEqual({ kind: 'untouched' });
    expect(parseObservedQuantity(null)).toEqual({ kind: 'untouched' });
  });

  it('accepts a deliberate zero as a real observation', () => {
    expect(parseObservedQuantity('0')).toEqual({ kind: 'value', value: 0 });
    expect(isSubmittableQuantity(parseObservedQuantity('0'))).toBe(true);
  });

  it('refuses anything that is not a whole number of units', () => {
    for (const bad of ['-1', '1.5', 'four', '1e3', '٣']) {
      expect(parseObservedQuantity(bad).kind).toBe('invalid');
    }
  });

  it('never reports an untouched field as submittable', () => {
    expect(isSubmittableQuantity(parseObservedQuantity(''))).toBe(false);
  });

  it('accepts an ordinary count', () => {
    expect(parseObservedQuantity(' 12 ')).toEqual({ kind: 'value', value: 12 });
  });
});

describe('lot count status', () => {
  it('is uncounted when nobody has looked', () => {
    expect(lotCountStatus({
      hasObservation: false, expectedQuantity: 10, observedQuantity: null, quantitiesWithheld: false,
    })).toBe('uncounted');
  });

  it('reports short, matched and over against the frozen expectation', () => {
    const base = { hasObservation: true, expectedQuantity: 10, quantitiesWithheld: false };
    expect(lotCountStatus({ ...base, observedQuantity: 8 })).toBe('short');
    expect(lotCountStatus({ ...base, observedQuantity: 10 })).toBe('matched');
    expect(lotCountStatus({ ...base, observedQuantity: 12 })).toBe('over');
  });

  it('says only "saved" during a blind count — short or over would leak the variance', () => {
    expect(lotCountStatus({
      hasObservation: true, expectedQuantity: null, observedQuantity: 8, quantitiesWithheld: true,
    })).toBe('saved');
  });

  it('still says only "saved" if a quantity somehow arrives while withheld', () => {
    expect(lotCountStatus({
      hasObservation: true, expectedQuantity: 10, observedQuantity: 8, quantitiesWithheld: true,
    })).toBe('saved');
  });

  it('falls back to "saved" rather than guessing when the expectation is absent', () => {
    expect(lotCountStatus({
      hasObservation: true, expectedQuantity: null, observedQuantity: 8, quantitiesWithheld: false,
    })).toBe('saved');
  });
});

describe('scan feedback', () => {
  it('reports a unit found where it was expected', () => {
    const f = scanFeedback({ outcome: 'expected_found', item_public_id: 'RV-ITEM-1' });
    expect(f.tone).toBe('good');
    expect(f.recorded).toBe(true);
  });

  it('distinguishes a wrong-location find and names both places', () => {
    const f = scanFeedback({
      outcome: 'wrong_location', item_public_id: 'RV-ITEM-1',
      expected_location_code: 'BIN-A', observed_location_code: 'BIN-B',
    });
    expect(f.outcome).toBe('wrong_location');
    expect(f.detail).toContain('BIN-A');
    expect(f.detail).toContain('BIN-B');
    expect(f.recorded).toBe(true);
  });

  it('reports an unexpected unit as recorded but flagged', () => {
    const f = scanFeedback({ outcome: 'unexpected_found', item_public_id: 'RV-ITEM-9' });
    expect(f.tone).toBe('warn');
    expect(f.recorded).toBe(true);
  });

  it('never counts a duplicate scan as new evidence', () => {
    const f = scanFeedback({
      outcome: 'duplicate', item_public_id: 'RV-ITEM-1', first_observed_at: '2026-07-30T10:00:00Z',
    });
    expect(f.outcome).toBe('duplicate');
    expect(f.recorded).toBe(false);
    expect(f.detail).toContain('2026-07-30T10:00:00Z');
  });

  it('refuses an ambiguous identifier rather than choosing a unit', () => {
    const f = scanFeedback({ outcome: 'ambiguous', identifier: 'ABC', match_count: 2 });
    expect(f.outcome).toBe('ambiguous');
    expect(f.recorded).toBe(false);
    expect(f.detail).toContain('2');
  });

  it('reports an unmatched identifier without recording anything', () => {
    const f = scanFeedback({ outcome: 'not_found', identifier: 'NOPE' });
    expect(f.outcome).toBe('not_found');
    expect(f.recorded).toBe(false);
  });

  it('reports an inactive unit as no longer countable', () => {
    const f = scanFeedback({ outcome: 'inactive_record', item_public_id: 'RV-ITEM-2', item_state: 'lost' });
    expect(f.outcome).toBe('inactive');
    expect(f.recorded).toBe(false);
    expect(f.detail).toContain('lost');
  });

  it('treats an unrecognised outcome as not recorded rather than as success', () => {
    expect(scanFeedback({ outcome: 'something_new' }).recorded).toBe(false);
  });

  it('builds enough identity to confirm the physical object', () => {
    const identity = scanIdentity({
      display_name: 'Charizard', item_public_id: 'RV-ITEM-1',
      certificate_number: 'C1', serial_number: 'S1',
    });
    expect(identity).toContain('Charizard');
    expect(identity).toContain('RV-ITEM-1');
    expect(identity).toContain('cert C1');
    expect(identity).toContain('serial S1');
  });
});

describe('error translation', () => {
  it('recognises an ambiguous match', () => {
    expect(friendlyCycleCountError('identifier matches more than one unit').outcome).toBe('ambiguous');
  });

  it('recognises an authorization refusal', () => {
    expect(friendlyCycleCountError('permission denied for table x').outcome).toBe('unauthorized');
    expect(friendlyCycleCountError('only an owner or operator can write off a unit').outcome).toBe('unauthorized');
  });

  it('recognises a scope or location refusal', () => {
    expect(friendlyCycleCountError('location BIN-Z does not exist').outcome).toBe('invalid_location');
  });

  it('passes an unrecognised message through instead of guessing', () => {
    const f = friendlyCycleCountError('some novel database complaint');
    expect(f.outcome).toBe('error');
    expect(f.detail).toBe('some novel database complaint');
  });

  it('never reports a translated error as recorded', () => {
    for (const m of ['permission denied', 'no unit matches', 'anything at all']) {
      expect(friendlyCycleCountError(m).recorded).toBe(false);
    }
  });

  it('spots a stale-quantity conflict', () => {
    expect(isStaleQuantityConflict('quantity changed, reload and try again')).toBe(true);
    expect(isStaleQuantityConflict('this lot already holds the counted quantity')).toBe(true);
    expect(isStaleQuantityConflict('permission denied')).toBe(false);
  });
});

describe('progress', () => {
  it('is complete when there is nothing to count', () => {
    expect(completionPercent(progress())).toBe(100);
    expect(isScopeEmpty(progress())).toBe(true);
  });

  it('counts both grains towards one figure', () => {
    expect(completionPercent(progress({
      expected_item_count: 2, uncounted_item_count: 1,
      expected_lot_count: 2, uncounted_lot_count: 0,
    }))).toBe(75);
  });

  it('reports nothing counted as zero rather than as complete', () => {
    expect(completionPercent(progress({
      expected_item_count: 4, uncounted_item_count: 4,
    }))).toBe(0);
  });
});

describe('submission readiness', () => {
  it('warns that submitting converts uncounted records into discrepancies', () => {
    const r = submissionReadiness(progress({ expected_item_count: 3, uncounted_item_count: 1 }));
    expect(r.convertsUncounted).toBe(true);
    expect(r.uncountedItems).toBe(1);
  });

  it('does not warn when everything has been looked at', () => {
    expect(submissionReadiness(progress({
      expected_item_count: 2, uncounted_item_count: 0,
      expected_lot_count: 1, uncounted_lot_count: 0,
    })).convertsUncounted).toBe(false);
  });

  it('reports observed zeros separately from uncounted lots', () => {
    const r = submissionReadiness(progress({
      expected_lot_count: 2, uncounted_lot_count: 1, observed_zero_lot_count: 1,
    }));
    expect(r.uncountedLots).toBe(1);
    expect(r.observedZeroLots).toBe(1);
  });
});

describe('discrepancy grouping', () => {
  const d = (over: Partial<Parameters<typeof reviewGroupOf>[0]> = {}) => ({
    discrepancy_id: 'd1', discrepancy_kind: 'lot_shortage' as DiscrepancyKind,
    status: 'open' as const, resolutions: [], ...over,
  });

  it('groups an open discrepancy by its kind', () => {
    expect(reviewGroupOf(d({ discrepancy_kind: 'item_missing' }))).toBe('item_missing');
  });

  it('files a failed attempt under failures, whatever its kind', () => {
    expect(reviewGroupOf(d({ resolutions: [{ succeeded: false }] }))).toBe('failed');
  });

  it('stops treating it as failed once a retry succeeds', () => {
    expect(reviewGroupOf(d({
      status: 'resolved', resolutions: [{ succeeded: false }, { succeeded: true }],
    }))).toBe('resolved');
  });

  it('does not consider a discrepancy resolved after a failure', () => {
    expect(hasUnresolvedFailure(d({ resolutions: [{ succeeded: false }] }))).toBe(true);
    expect(hasUnresolvedFailure(d({ resolutions: [{ succeeded: false }, { succeeded: true }] }))).toBe(false);
  });

  it('lets status win over kind, so deferred work is not hidden among shortages', () => {
    expect(reviewGroupOf(d({ status: 'deferred' }))).toBe('deferred');
    expect(reviewGroupOf(d({ status: 'recount_requested' }))).toBe('recount_requested');
  });

  it('puts failures and recounts first, and resolved work last', () => {
    const groups = groupDiscrepancies([
      d({ discrepancy_id: 'a', status: 'resolved', resolutions: [{ succeeded: true }] }),
      d({ discrepancy_id: 'b', discrepancy_kind: 'item_missing' }),
      d({ discrepancy_id: 'c', resolutions: [{ succeeded: false }] }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['failed', 'item_missing', 'resolved']);
  });

  it('puts every discrepancy in exactly one group', () => {
    const rows = [
      d({ discrepancy_id: 'a' }), d({ discrepancy_id: 'b', status: 'deferred' }),
      d({ discrepancy_id: 'c', discrepancy_kind: 'lot_uncounted' }),
    ];
    const total = groupDiscrepancies(rows).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(rows.length);
  });
});

describe('available resolution actions', () => {
  it('never offers a move for a missing unit — there is nothing to move', () => {
    expect(availableActions('item_missing')).not.toContain('item_moved_to_counted_location');
    expect(availableActions('item_missing')).toContain('item_loss_recorded');
  });

  it('never offers a write-off for a lot variance', () => {
    expect(availableActions('lot_shortage')).not.toContain('item_loss_recorded');
    expect(availableActions('lot_shortage')).toContain('lot_quantity_adjusted');
  });

  it('offers Intake follow-up only for an unexpected unit', () => {
    expect(availableActions('item_unexpected')).toContain('routed_to_intake');
    for (const k of ['item_missing', 'lot_shortage', 'lot_overage', 'lot_uncounted'] as DiscrepancyKind[]) {
      expect(availableActions(k)).not.toContain('routed_to_intake');
    }
  });

  it('never offers a quantity adjustment for a lot nobody counted', () => {
    expect(availableActions('lot_uncounted')).not.toContain('lot_quantity_adjusted');
  });

  it('always allows a deferral with a reason', () => {
    const kinds: DiscrepancyKind[] = [
      'item_missing', 'item_unexpected', 'item_wrong_location',
      'lot_shortage', 'lot_overage', 'lot_uncounted',
    ];
    for (const k of kinds) expect(availableActions(k)).toContain('deferred');
  });
});

describe('confirmation and required reasons', () => {
  it('requires confirmation for everything that changes inventory', () => {
    expect(requiresConfirmation('item_loss_recorded')).toBe(true);
    expect(requiresConfirmation('item_moved_to_counted_location')).toBe(true);
    expect(requiresConfirmation('lot_quantity_adjusted')).toBe(true);
  });

  it('does not demand confirmation for a bookkeeping outcome', () => {
    expect(requiresConfirmation('observation_mistaken')).toBe(false);
    expect(requiresConfirmation('confirmed_system_location')).toBe(false);
    expect(requiresConfirmation('routed_to_intake')).toBe(false);
  });

  it('requires a reason for a deferral and for a write-off', () => {
    expect(requiresNote('deferred')).toBe(true);
    expect(requiresNote('item_loss_recorded')).toBe(true);
    expect(requiresNote('confirmed_system_location')).toBe(false);
  });
});

describe('completion', () => {
  it('blocks the ordinary button while anything is open', () => {
    const gate = completionGate(readiness({ open_count: 2, blockers: ['2 open'] }));
    expect(gate.standardEnabled).toBe(false);
    expect(gate.blockers).toHaveLength(1);
  });

  it('blocks the ordinary button on deferrals and offers the separate path instead', () => {
    const gate = completionGate(readiness({
      can_complete: false, can_complete_with_deferrals: true, deferred_count: 3,
    }));
    expect(gate.standardEnabled).toBe(false);
    expect(gate.deferredPathOffered).toBe(true);
    expect(gate.deferredCount).toBe(3);
  });

  it('enables the ordinary button only when nothing is outstanding', () => {
    expect(completionGate(readiness({ can_complete: true })).standardEnabled).toBe(true);
  });

  it('refuses a deferred completion without an explicit acknowledgement', () => {
    const check = validateDeferredCompletion({
      acknowledged: false, reason: 'a perfectly adequate reason', deferredCount: 2,
    });
    expect(check.ok).toBe(false);
    expect(check.problem).toContain('2');
  });

  it('refuses a deferred completion without a real reason', () => {
    expect(validateDeferredCompletion({ acknowledged: true, reason: 'later', deferredCount: 2 }).ok)
      .toBe(false);
  });

  it('accepts a deferred completion that is acknowledged and explained', () => {
    expect(validateDeferredCompletion({
      acknowledged: true, reason: 'The supplier will confirm the shortfall next week.', deferredCount: 2,
    }).ok).toBe(true);
  });

  it('sends a caller with no deferrals back to the ordinary path', () => {
    expect(validateDeferredCompletion({
      acknowledged: true, reason: 'a perfectly adequate reason', deferredCount: 0,
    }).ok).toBe(false);
  });
});

describe('cancellation', () => {
  it('requires a reason', () => {
    expect(validateCancellation('   ').ok).toBe(false);
    expect(validateCancellation('Counted the wrong aisle.').ok).toBe(true);
  });
});

describe('creating a count', () => {
  const input = {
    rootLocationCode: 'BIN-A', includeDescendants: true,
    subtypeFilter: null, verticalFilter: null, blindCount: false, notes: '',
  };

  it('requires a location', () => {
    expect(validateNewCount({ ...input, rootLocationCode: '  ' }).ok).toBe(false);
  });

  it('accepts a minimal valid configuration', () => {
    expect(validateNewCount(input).ok).toBe(true);
  });

  it('rejects notes the database would refuse anyway', () => {
    expect(validateNewCount({ ...input, notes: 'x'.repeat(2001) }).ok).toBe(false);
  });
});

describe('scope preview', () => {
  it('warns about a scope that resolves to no locations', () => {
    const warnings = previewWarnings({
      location_count: 0, expected_item_count: 0, expected_lot_count: 0, expected_unit_count: 0,
    });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns about a scope with nothing countable, and demands confirmation', () => {
    const preview = {
      location_count: 3, expected_item_count: 0, expected_lot_count: 0, expected_unit_count: 0,
    };
    expect(previewWarnings(preview).join(' ')).toContain('nothing countable');
    expect(requiresEmptyScopeConfirmation(preview)).toBe(true);
  });

  it('does not warn about a scope with inventory in it', () => {
    const preview = {
      location_count: 2, expected_item_count: 5, expected_lot_count: 1, expected_unit_count: 12,
    };
    expect(previewWarnings(preview)).toHaveLength(0);
    expect(requiresEmptyScopeConfirmation(preview)).toBe(false);
  });
});

describe('routing by status', () => {
  it('sends each status to the page that belongs to it', () => {
    expect(canonicalPath('s1', 'draft')).toBe('/cycle-counts/s1');
    expect(canonicalPath('s1', 'in_progress')).toBe('/cycle-counts/s1/count');
    expect(canonicalPath('s1', 'review')).toBe('/cycle-counts/s1/review');
    expect(canonicalPath('s1', 'completed')).toBe('/cycle-counts/s1/audit');
    expect(canonicalPath('s1', 'cancelled')).toBe('/cycle-counts/s1/audit');
  });

  it('knows which statuses are terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('in_progress')).toBe(false);
    expect(isTerminal('review')).toBe(false);
  });
});

describe('a session changed by someone else', () => {
  it('says nothing when nothing changed', () => {
    expect(describeStatusChange('in_progress', 'in_progress')).toBeNull();
  });

  it('explains a submission, completion and cancellation made elsewhere', () => {
    expect(describeStatusChange('in_progress', 'review')).toContain('submitted');
    expect(describeStatusChange('review', 'completed')).toContain('completed');
    expect(describeStatusChange('in_progress', 'cancelled')).toContain('cancelled');
  });

  it('explains a recount as a recount, not as a restart', () => {
    expect(describeStatusChange('review', 'in_progress')).toContain('recount');
    expect(describeStatusChange('draft', 'in_progress')).toContain('started');
  });
});

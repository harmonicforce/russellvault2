// These mirror refusals the database makes for itself. They exist so the
// operator hears about a problem while typing rather than after a round trip;
// if the two ever disagree, the database wins.
import { describe, expect, it } from 'vitest';
import {
  isStaleQuantityError, validateAdjust, validateRecount, validateSplit,
} from './lotOperations';

const base = { direction: 'remove' as const, amount: '', reason: 'damaged', note: '', currentQuantity: 12 };

describe('adjusting a quantity', () => {
  it('computes the signed change and the resulting quantity', () => {
    expect(validateAdjust({ ...base, direction: 'add', amount: '3' }))
      .toMatchObject({ ok: true, change: 3, resulting: 15 });
    expect(validateAdjust({ ...base, direction: 'remove', amount: '5' }))
      .toMatchObject({ ok: true, change: -5, resulting: 7 });
  });

  it('never lets a lot go negative', () => {
    const v = validateAdjust({ ...base, amount: '40' });
    expect(v.ok).toBe(false);
    expect(v.problem).toContain('would leave -28');
  });

  it('allows a lot to reach exactly zero', () => {
    // Selling out is not an error.
    expect(validateAdjust({ ...base, amount: '12' }))
      .toMatchObject({ ok: true, resulting: 0 });
  });

  it('refuses an adjustment of zero rather than writing a no-op event', () => {
    expect(validateAdjust({ ...base, amount: '0' }).ok).toBe(false);
  });

  it('refuses anything that is not a whole number of units', () => {
    for (const amount of ['1.5', '-3', 'twelve', '3a', ' ']) {
      expect(validateAdjust({ ...base, amount }).ok).toBe(false);
    }
  });

  it('requires a reason', () => {
    expect(validateAdjust({ ...base, amount: '2', reason: '' }).problem).toMatch(/reason/i);
  });

  it('requires a note when the reason is "other", because that is not an explanation', () => {
    expect(validateAdjust({ ...base, amount: '2', reason: 'other', note: '' }).ok).toBe(false);
    expect(validateAdjust({ ...base, amount: '2', reason: 'other', note: 'dropped a box' }).ok).toBe(true);
  });
});

describe('recounting', () => {
  it('turns a counted number into a difference so the operator never does the arithmetic', () => {
    expect(validateRecount({ counted: '9', currentQuantity: 12 }))
      .toMatchObject({ ok: true, change: -3, resulting: 9 });
    expect(validateRecount({ counted: '15', currentQuantity: 12 }))
      .toMatchObject({ ok: true, change: 3, resulting: 15 });
  });

  it('accepts a count of zero', () => {
    expect(validateRecount({ counted: '0', currentQuantity: 4 }))
      .toMatchObject({ ok: true, change: -4, resulting: 0 });
  });

  it('writes nothing when the count matches what is recorded', () => {
    const v = validateRecount({ counted: '12', currentQuantity: 12 });
    expect(v.ok).toBe(false);
    expect(v.problem).toMatch(/nothing to correct/i);
  });

  it('refuses a count that is not a whole number', () => {
    expect(validateRecount({ counted: '-1', currentQuantity: 12 }).ok).toBe(false);
    expect(validateRecount({ counted: '2.5', currentQuantity: 12 }).ok).toBe(false);
  });
});

describe('splitting', () => {
  const split = { quantity: '', toLocationCode: 'SHELF-2', currentQuantity: 12 };

  it('reports what stays behind and what goes', () => {
    expect(validateSplit({ ...split, quantity: '4' }))
      .toMatchObject({ ok: true, quantity: 4, remaining: 8 });
  });

  it('refuses more than the lot holds', () => {
    expect(validateSplit({ ...split, quantity: '13' }).ok).toBe(false);
  });

  it('refuses zero', () => {
    expect(validateSplit({ ...split, quantity: '0' }).ok).toBe(false);
  });

  it('sends a whole-lot split to Move Entire Lot instead', () => {
    // Splitting everything leaves an empty parent behind and describes a move
    // in lineage that the movement history should own.
    const v = validateSplit({ ...split, quantity: '12' });
    expect(v.ok).toBe(false);
    expect(v.isWholeLot).toBe(true);
    expect(v.problem).toMatch(/Move Entire Lot/);
  });

  it('requires a destination', () => {
    expect(validateSplit({ ...split, quantity: '4', toLocationCode: '' }).problem)
      .toMatch(/where/i);
  });
});

describe('recognising a stale-quantity conflict', () => {
  it('spots the database refusing to overwrite newer work', () => {
    expect(isStaleQuantityError('this lot now holds 9, not 12 — reload and try again')).toBe(true);
    expect(isStaleQuantityError('destination location NOWHERE is not active')).toBe(false);
  });
});

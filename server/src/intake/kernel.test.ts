// Phase 6A intake kernel — pure request-helper unit tests. These verify only
// SHAPE validation and display mapping; the authoritative rules live in the
// database and are proven by the pgTAP suite.
import { describe, it, expect } from 'vitest';
import {
  IntakeRequestError,
  categoryVertical,
  isIntakeCategory,
  optionalUuid,
  requireAttrs,
  requireContentHash,
  requireIdempotencyKey,
  requireQuantity,
  requireUuid,
  requireVersion,
} from './kernel.js';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('categoryVertical', () => {
  it('maps TCG categories to the tcg vertical', () => {
    expect(categoryVertical('graded_tcg')).toBe('tcg');
    expect(categoryVertical('raw_tcg')).toBe('tcg');
    expect(categoryVertical('sealed_tcg')).toBe('tcg');
  });
  it('maps footwear and other', () => {
    expect(categoryVertical('footwear')).toBe('footwear');
    expect(categoryVertical('other')).toBe('other');
  });
});

describe('isIntakeCategory', () => {
  it('accepts governed categories and rejects everything else', () => {
    expect(isIntakeCategory('graded_tcg')).toBe(true);
    expect(isIntakeCategory('nonsense')).toBe(false);
    expect(isIntakeCategory(42)).toBe(false);
  });
});

describe('requireUuid / optionalUuid', () => {
  it('accepts a valid uuid', () => {
    expect(requireUuid(UUID, 'x')).toBe(UUID);
    expect(optionalUuid(UUID, 'x')).toBe(UUID);
    expect(optionalUuid(undefined, 'x')).toBeNull();
    expect(optionalUuid(null, 'x')).toBeNull();
  });
  it('rejects a non-uuid', () => {
    expect(() => requireUuid('not-a-uuid', 'x')).toThrow(IntakeRequestError);
    expect(() => requireUuid(5, 'x')).toThrow(IntakeRequestError);
  });
});

describe('requireQuantity', () => {
  it('accepts a positive integer', () => {
    expect(requireQuantity(1)).toBe(1);
    expect(requireQuantity('6')).toBe(6);
  });
  it('rejects zero, negatives, and non-integers', () => {
    for (const bad of [0, -1, 1.5, 'x', 200001]) {
      expect(() => requireQuantity(bad)).toThrow(IntakeRequestError);
    }
  });
});

describe('requireIdempotencyKey', () => {
  it('accepts an 8..200 char key and trims it', () => {
    expect(requireIdempotencyKey('  key-00001  ')).toBe('key-00001');
  });
  it('rejects a short or missing key', () => {
    expect(() => requireIdempotencyKey('short')).toThrow(IntakeRequestError);
    expect(() => requireIdempotencyKey(undefined)).toThrow(IntakeRequestError);
  });
});

describe('requireContentHash', () => {
  it('accepts a 64-char hex digest', () => {
    expect(requireContentHash('a'.repeat(64))).toBe('a'.repeat(64));
  });
  it('rejects a non-hex or wrong-length value', () => {
    expect(() => requireContentHash('deadbeef')).toThrow(IntakeRequestError);
    expect(() => requireContentHash('z'.repeat(64))).toThrow(IntakeRequestError);
  });
});

describe('requireVersion', () => {
  it('accepts a positive integer', () => {
    expect(requireVersion(1)).toBe(1);
    expect(requireVersion('3')).toBe(3);
  });
  it('rejects zero and non-integers', () => {
    expect(() => requireVersion(0)).toThrow(IntakeRequestError);
    expect(() => requireVersion('x')).toThrow(IntakeRequestError);
  });
});

describe('requireAttrs', () => {
  it('accepts an object and defaults null/undefined to {}', () => {
    expect(requireAttrs({ a: 1 }, 'x')).toEqual({ a: 1 });
    expect(requireAttrs(undefined, 'x')).toEqual({});
    expect(requireAttrs(null, 'x')).toEqual({});
  });
  it('rejects arrays and scalars (no EAV smuggling via a non-object bag)', () => {
    expect(() => requireAttrs([1, 2], 'x')).toThrow(IntakeRequestError);
    expect(() => requireAttrs('str', 'x')).toThrow(IntakeRequestError);
  });
});

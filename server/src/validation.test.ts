import { describe, it, expect } from 'vitest';
import { requirePositiveInteger, requireNonNegativeNumber, ValidationError } from './validation.js';

describe('requirePositiveInteger', () => {
  it('accepts positive integers, including numeric strings', () => {
    expect(requirePositiveInteger(1, 'q')).toBe(1);
    expect(requirePositiveInteger(42, 'q')).toBe(42);
    expect(requirePositiveInteger('7', 'q')).toBe(7);
  });

  it('rejects zero, negative, fractional, NaN, and missing values', () => {
    for (const bad of [0, -1, -5, 1.5, NaN, undefined, null, '', 'abc']) {
      expect(() => requirePositiveInteger(bad, 'q')).toThrow(ValidationError);
    }
  });
});

describe('requireNonNegativeNumber', () => {
  it('accepts zero and positive numbers', () => {
    expect(requireNonNegativeNumber(0, 'cost')).toBe(0);
    expect(requireNonNegativeNumber(12.5, 'cost')).toBe(12.5);
  });

  it('rejects negative numbers and non-numeric input', () => {
    for (const bad of [-1, -0.01, NaN, undefined, null, 'abc']) {
      expect(() => requireNonNegativeNumber(bad, 'cost')).toThrow(ValidationError);
    }
  });
});

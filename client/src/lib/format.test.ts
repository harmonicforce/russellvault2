import { describe, it, expect } from 'vitest';
import { money, num, shortDate } from './format';

// Smoke tests over pure formatting helpers. Behavior-only; no product logic.
describe('format helpers (smoke)', () => {
  it('formats currency', () => {
    expect(money(12.5)).toBe('$12.50');
  });

  it('renders an em dash for null/NaN money', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money(Number.NaN)).toBe('—');
  });

  it('formats integers with grouping', () => {
    expect(num(1000)).toBe('1,000');
  });

  it('passes through an unparseable date string unchanged', () => {
    expect(shortDate('not-a-date')).toBe('not-a-date');
  });

  it('renders an em dash for an empty date', () => {
    expect(shortDate(null)).toBe('—');
  });
});

// Money, tested as pure arithmetic.
//
// WHAT THESE PROVE THAT READING CANNOT
//
//   * no amount ever passes through a float, so a figure that goes in comes
//     out unchanged — including the ones IEEE 754 gets wrong;
//   * a formatted amount is EXACT, not an approximation placed by division;
//   * an unknown amount never renders a figure, and never renders zero;
//   * an operator's typed amount is refused when it carries more precision
//     than the currency has, rather than quietly rounded;
//   * the conservation check uses the DATABASE's tolerance, never a tighter one.

import { describe, expect, it } from 'vitest';
import {
  CONSERVATION_TOLERANCE_MINOR,
  checkConservation,
  conserves,
  describeAmount,
  formatMinor,
  isCanonicalMinor,
  minorExponent,
  parseMajorInput,
  splittableTotal,
  sumMinor,
  toMinor,
} from './costMoney';
import type { Amount } from '../../lib/costApi';

const known = (minor: string, currency = 'USD'): Amount => ({ state: 'known', minor, currency });

describe('minor units are parsed exactly or not at all', () => {
  it.each(['0', '1', '-1', '999', '999999999999999999999999'])('accepts %s', (value) => {
    expect(isCanonicalMinor(value)).toBe(true);
    expect(toMinor(value)).toBe(BigInt(value));
  });

  it.each(['', ' ', '1.0', '01', '+1', '1e3', '1,000', 'abc', '- 1'])('refuses %p', (value) => {
    expect(isCanonicalMinor(value)).toBe(false);
    expect(toMinor(value)).toBeNull();
  });

  it('refuses null and undefined rather than treating them as zero', () => {
    expect(toMinor(null)).toBeNull();
    expect(toMinor(undefined)).toBeNull();
  });

  // A total missing one of its terms is not a total.
  it('refuses to sum when any term is unreadable', () => {
    expect(sumMinor(['1', '2', '3'])).toBe(6n);
    expect(sumMinor(['1', 'x', '3'])).toBeNull();
  });

  it('carries a value far beyond what a float preserves', () => {
    const huge = '9007199254740993'; // 2^53 + 1 — not representable as a double.
    expect(toMinor(huge)?.toString()).toBe(huge);
    expect(sumMinor([huge, '1'])?.toString()).toBe('9007199254740994');
  });
});

describe('formatting places the decimal point by index, never by division', () => {
  it.each([
    [0n, 'USD', '0.00'],
    [1n, 'USD', '0.01'],
    [99n, 'USD', '0.99'],
    [100n, 'USD', '1.00'],
    [123456n, 'USD', '1,234.56'],
    [-123456n, 'USD', '-1,234.56'],
    [1234567890n, 'USD', '12,345,678.90'],
  ])('renders %s %s as %s', (minor, currency, expected) => {
    expect(formatMinor(minor as bigint, currency as string)).toBe(expected);
  });

  it('respects a zero-decimal currency', () => {
    expect(minorExponent('JPY')).toBe(0);
    expect(formatMinor(1234n, 'JPY')).toBe('1,234');
  });

  it('respects a three-decimal currency', () => {
    expect(minorExponent('KWD')).toBe(3);
    expect(formatMinor(1234n, 'KWD')).toBe('1.234');
  });

  it('falls back to two places for a currency it does not know, rather than refusing to show a real amount', () => {
    expect(minorExponent('ZZZ')).toBe(2);
    expect(formatMinor(1234n, 'ZZZ')).toBe('12.34');
  });

  // The canonical float failure, proved not to happen.
  it('adds amounts that a float would get wrong', () => {
    const total = sumMinor(['10', '20']);
    expect(formatMinor(total!, 'USD')).toBe('0.30');
    // For contrast, the float version of the same sum is not 0.3.
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('an amount states what kind of fact it is', () => {
  it('renders a known amount with its currency', () => {
    const described = describeAmount(known('123456'));
    expect(described.text).toBe('1,234.56 USD');
    expect(described.hasFigure).toBe(true);
  });

  // THE LOAD-BEARING TRUTH RULE.
  it('renders an unknown amount as WORDS, never as a figure and never as zero', () => {
    const described = describeAmount({ state: 'unknown', currency: 'USD' });
    expect(described.hasFigure).toBe(false);
    expect(described.text).not.toMatch(/[0-9]/);
    expect(described.text).toMatch(/not reported/i);
    expect(described.detail).toMatch(/not the same as zero/i);
  });

  // A documented zero is a DIFFERENT fact from an unknown one and must never
  // look the same.
  it('renders a documented free amount as a real, evidenced zero', () => {
    const described = describeAmount({ state: 'documented_free', minor: '0', currency: 'USD' });
    expect(described.text).toBe('0.00 USD');
    expect(described.hasFigure).toBe(true);
    expect(described.detail).toMatch(/genuinely free/i);
  });

  it('says a figure is too large to display rather than showing a rounded one', () => {
    const described = describeAmount({ state: 'unrepresentable', currency: 'USD' });
    expect(described.hasFigure).toBe(false);
    expect(described.text).not.toMatch(/[0-9]/);
  });

  it('never offers a splittable total for anything but a known amount', () => {
    expect(splittableTotal(known('100'))).toBe(100n);
    expect(splittableTotal({ state: 'documented_free', minor: '0', currency: 'USD' })).toBeNull();
    expect(splittableTotal({ state: 'unknown', currency: 'USD' })).toBeNull();
    expect(splittableTotal({ state: 'unrepresentable', currency: 'USD' })).toBeNull();
  });
});

describe('conservation uses the governed tolerance, never a tighter one', () => {
  it('quotes one minor unit', () => {
    expect(CONSERVATION_TOLERANCE_MINOR).toBe(1n);
  });

  it('accepts a set off by exactly one, as the database does', () => {
    expect(conserves(1000n, [500n, 501n])).toBe(true);
    expect(conserves(1000n, [500n, 499n])).toBe(true);
  });

  it('refuses a set off by two', () => {
    expect(conserves(1000n, [500n, 502n])).toBe(false);
  });

  it.each([
    ['balanced', ['750', '250'], 'balanced', 0n],
    ['one over', ['750', '251'], 'within_tolerance', 1n],
    ['one under', ['750', '249'], 'within_tolerance', -1n],
    ['forty short', ['750', '210'], 'out_of_balance', -40n],
    ['forty over', ['750', '290'], 'out_of_balance', 40n],
  ])('reports %s with the exact signed difference', (_label, shares, kind, delta) => {
    const verdict = checkConservation(known('1000'), shares as string[]);
    expect(verdict.kind).toBe(kind);
    expect(verdict).toMatchObject({ deltaMinor: delta });
  });

  // An unreadable amount is not a difference of zero.
  it('reports an unreadable share as its own outcome', () => {
    expect(checkConservation(known('1000'), ['750', 'oops']).kind).toBe('unreadable');
  });

  it('reports having no total to conserve against as its own outcome', () => {
    expect(checkConservation({ state: 'unknown', currency: 'USD' }, ['1']).kind).toBe('no_total');
  });
});

describe('what an operator types', () => {
  it.each([
    ['10', 'USD', 1000n],
    ['10.5', 'USD', 1050n],
    ['10.50', 'USD', 1050n],
    ['0.01', 'USD', 1n],
    ['-3.25', 'USD', -325n],
    ['1,234.56', 'USD', 123456n],
    ['1234', 'JPY', 1234n],
    ['1.234', 'KWD', 1234n],
  ])('parses %s in %s as %s minor units', (input, currency, expected) => {
    expect(parseMajorInput(input as string, currency as string)).toBe(expected);
  });

  // THE ANTI-ROUNDING CASE. Half a cent is not something the ledger holds, and
  // quietly changing the operator's figure is how a split stops adding up.
  it('REFUSES more precision than the currency has, rather than rounding it away', () => {
    expect(parseMajorInput('10.005', 'USD')).toBeNull();
    expect(parseMajorInput('10.999', 'USD')).toBeNull();
    expect(parseMajorInput('10.5', 'JPY')).toBeNull();
  });

  // Trailing zeroes beyond the exponent carry no value, so they are allowed.
  it('accepts trailing zeroes past the exponent, which change nothing', () => {
    expect(parseMajorInput('10.500', 'USD')).toBe(1050n);
    expect(parseMajorInput('10.00', 'JPY')).toBe(10n);
  });

  it.each(['', ' ', 'abc', '1.2.3', '$10', '1e3', '--1'])('refuses %p', (input) => {
    expect(parseMajorInput(input, 'USD')).toBeNull();
  });

  // Round trip: what an operator types, formatted back, is what they typed.
  it('round-trips a typed amount through formatting unchanged', () => {
    for (const input of ['0.01', '9.99', '1234.56', '0.00']) {
      const minor = parseMajorInput(input, 'USD')!;
      expect(formatMinor(minor, 'USD')).toBe(input.replace(/^(\d)(\d{3})/, '$1,$2'));
    }
  });
});

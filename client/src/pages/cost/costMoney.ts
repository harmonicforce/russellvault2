// Money, in the only representation this application treats as authoritative.
//
// THE RULE
//
// Every amount is an integer number of MINOR UNITS, carried as a canonical
// decimal string and computed on as a `bigint`. There is no path in this module
// that produces a `number` from an amount, and no path that parses a formatted
// string back into one. Formatting is one-way, and happens once, at the edge.
//
// WHY, CONCRETELY
//
// A cost basis is a figure someone reconciles against a bank statement months
// later. `0.1 + 0.2 !== 0.3` in IEEE 754, and a split of a shipping charge
// across seven lines is exactly the shape of arithmetic that accumulates that
// error. The governed database stores `bigint` minor units for the same reason.
// Turning that into a float anywhere between the database and the screen would
// reintroduce, in the presentation layer, the exact problem the schema was
// designed to avoid.
//
// The minor-unit EXPONENT is a display concern only. `minorExponent` below is
// used to place a decimal point in a string; it never scales an amount into a
// float, and no arithmetic anywhere in this application uses it.

import type { Amount } from '../../lib/costApi';

/**
 * How many minor units make one major unit, per ISO 4217.
 *
 * Only the currencies with a NON-2 exponent are listed. Everything else uses 2,
 * which is the overwhelming majority. A currency this table does not know is
 * rendered with 2 places rather than refused: getting the decimal point wrong
 * in a display string is a presentation defect, and refusing to show a real
 * governed amount because of a missing lookup entry would be worse.
 */
const MINOR_EXPONENT: Readonly<Record<string, number>> = {
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

export function minorExponent(currency: string): number {
  return MINOR_EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Is this a canonical decimal integer string this module will operate on? */
export function isCanonicalMinor(value: string): boolean {
  return /^-?(0|[1-9][0-9]{0,30})$/.test(value);
}

/**
 * Parse a canonical minor-unit string.
 *
 * Returns null rather than throwing or coercing, because every caller has
 * somewhere honest to put "this is not a number I can work with" and none of
 * them has anywhere honest to put a guess.
 */
export function toMinor(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !isCanonicalMinor(value)) return null;
  return BigInt(value);
}

export function sumMinor(values: readonly string[]): bigint | null {
  let total = 0n;
  for (const value of values) {
    const parsed = toMinor(value);
    // One unreadable term makes the whole total unreadable. A sum missing a
    // term is not a sum, and returning the partial figure would be a smaller,
    // confident, wrong number.
    if (parsed === null) return null;
    total += parsed;
  }
  return total;
}

/**
 * Render minor units as a decimal string, exactly.
 *
 * String surgery, not division: the digits are placed either side of the point
 * by index. Nothing is scaled, rounded, or passed through a float, so the
 * output is the stored figure and not an approximation of it.
 */
export function formatMinor(minor: bigint, currency: string): string {
  const exponent = minorExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent) || '0';
  const grouped = whole.replace(/\B(?=([0-9]{3})+(?!\d))/g, ',');
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}

/**
 * The operator-facing sentence for a governed amount.
 *
 * Each state gets its OWN words. In particular:
 *
 *   * `unknown` never renders a figure, and never renders `0`, `—` alone, or a
 *     blank cell that reads like nothing was owed. The source did not report an
 *     amount, and that is what it says.
 *   * `documented_free` renders a real zero, because that zero is evidenced —
 *     the schema requires an evidence note for it. It is a different fact from
 *     `unknown` and must never look the same.
 *   * `unrepresentable` says the figure exists and could not be carried, rather
 *     than showing a rounded one.
 */
export function describeAmount(amount: Amount): {
  readonly text: string;
  readonly detail: string;
  readonly hasFigure: boolean;
} {
  switch (amount.state) {
    case 'known': {
      const minor = toMinor(amount.minor);
      if (minor === null) {
        return {
          text: 'Amount unreadable',
          detail: 'The governed amount did not arrive in a form this screen can display exactly.',
          hasFigure: false,
        };
      }
      return {
        text: `${formatMinor(minor, amount.currency)} ${amount.currency}`,
        detail: 'A priced amount recorded by the source.',
        hasFigure: true,
      };
    }
    case 'documented_free':
      return {
        text: `${formatMinor(0n, amount.currency)} ${amount.currency}`,
        detail: 'A documented zero: the source recorded this as genuinely free, with evidence.',
        hasFigure: true,
      };
    case 'unknown':
      return {
        text: 'Not reported',
        detail:
          'The source never reported an amount for this component. That is not the same as zero, and '
          + 'nothing here treats it as zero.',
        hasFigure: false,
      };
    case 'unrepresentable':
      return {
        text: 'Amount too large to display exactly',
        detail:
          'The governed record holds a figure outside the range this screen can carry without changing '
          + 'it. A rounded figure is not shown, because it would not be the real one.',
        hasFigure: false,
      };
  }
}

/** The exact total to conserve, or null when there is nothing to conserve. */
export function splittableTotal(amount: Amount): bigint | null {
  return amount.state === 'known' ? toMinor(amount.minor) : null;
}

/**
 * The one-minor-unit tolerance `confirm_cost_allocation` allows.
 *
 * Quoted from the governed function rather than chosen here. A screen that
 * applied a tighter rule would warn about a split the database would accept.
 */
export const CONSERVATION_TOLERANCE_MINOR = 1n;

export function conserves(total: bigint, shares: readonly bigint[]): boolean {
  const sum = shares.reduce<bigint>((running, share) => running + share, 0n);
  const delta = sum - total;
  return (delta < 0n ? -delta : delta) <= CONSERVATION_TOLERANCE_MINOR;
}

/**
 * How a proposed set of amounts stands against the total it must conserve.
 *
 * Returns the exact signed difference so the UI can say "this is 40 short"
 * rather than a bare "does not balance". `unreadable` is its own outcome
 * because an unparseable amount is not a difference of zero.
 */
export type ConservationVerdict =
  | { readonly kind: 'balanced'; readonly deltaMinor: bigint }
  | { readonly kind: 'within_tolerance'; readonly deltaMinor: bigint }
  | { readonly kind: 'out_of_balance'; readonly deltaMinor: bigint }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'no_total' };

export function checkConservation(
  amount: Amount,
  shares: readonly string[],
): ConservationVerdict {
  const total = splittableTotal(amount);
  if (total === null) return { kind: 'no_total' };
  const sum = sumMinor(shares);
  if (sum === null) return { kind: 'unreadable' };
  const delta = sum - total;
  if (delta === 0n) return { kind: 'balanced', deltaMinor: delta };
  const magnitude = delta < 0n ? -delta : delta;
  return magnitude <= CONSERVATION_TOLERANCE_MINOR
    ? { kind: 'within_tolerance', deltaMinor: delta }
    : { kind: 'out_of_balance', deltaMinor: delta };
}

/**
 * Parse what an operator typed into a minor-unit amount.
 *
 * Accepts a MAJOR-unit decimal the way a person writes one (`10`, `10.5`,
 * `10.50`, `-3.25`, `1,234.56`) and converts by string surgery, never by
 * multiplying a float. `10.005` in a 2-place currency is REFUSED rather than
 * rounded: the operator meant something the ledger cannot hold, and quietly
 * changing their figure by half a cent is how a split stops adding up.
 */
export function parseMajorInput(input: string, currency: string): bigint | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const match = /^(-?)([0-9]{1,25})(?:\.([0-9]{0,10}))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, fractionRaw = ''] = match;
  const exponent = minorExponent(currency);
  if (fractionRaw.length > exponent) {
    // More precision than the currency has. Refused, not rounded.
    if (!/^0*$/.test(fractionRaw.slice(exponent))) return null;
  }
  const fraction = fractionRaw.slice(0, exponent).padEnd(exponent, '0');
  const magnitude = BigInt(`${whole}${fraction}`);
  return sign === '-' ? -magnitude : magnitude;
}

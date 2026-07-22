// Exact money conversion for the acquisition ledger.
//
// Authoritative money is stored as bigint MINOR UNITS (cents), never as a
// floating-point value. Multiplying dollars by 100 in floating point is unsafe:
// in this very fixture 175 of 2,149 rows have a value like 9.54 whose nearest
// double, times 100, is 953.999… — a silent off-by-one cent. So the conversion
// works on the DECIMAL STRING with integer arithmetic and refuses any value it
// cannot represent exactly in minor units, rather than rounding sub-cent
// precision away.

export class MoneyError extends Error {}

/**
 * Convert a decimal money value (a JSON number or numeric string) to integer
 * minor units. Exact or it throws — a value with more than two decimal places
 * of real precision is refused, never rounded.
 */
export function decimalToMinor(value: number | string): number {
  // Number.prototype.toString yields the shortest string that round-trips to
  // the same double, so a clean two-decimal fixture value like 9.54 stringifies
  // back to exactly "9.54" — never "9.5400000001".
  const s = (typeof value === 'number' ? value.toString() : String(value)).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    throw new MoneyError(`not a decimal money value: ${JSON.stringify(value)}`);
  }
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2];
  let frac = m[3] ?? '';
  if (frac.length > 2) {
    // Anything beyond two decimals must be pure zeros; a real sub-cent amount is
    // refused rather than silently truncated.
    if (!/^0*$/.test(frac.slice(2))) {
      throw new MoneyError(`sub-cent precision cannot be represented exactly: ${s}`);
    }
    frac = frac.slice(0, 2);
  }
  frac = (frac + '00').slice(0, 2);
  return sign * (Number(whole) * 100 + Number(frac));
}

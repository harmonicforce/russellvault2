// Validating a quantity change before it reaches the database.
//
// The database is the authority and refuses every one of these itself — that
// is not duplicated here for safety, it is duplicated for speed of feedback.
// The operator finds out that 40 units cannot come off a lot of 12 while they
// are still typing, instead of after a round trip. If these two ever disagree,
// the database wins and the error it raises is what gets shown.

export type AdjustDirection = 'add' | 'remove';

export interface AdjustInput {
  readonly direction: AdjustDirection;
  readonly amount: string;
  readonly reason: string;
  readonly note: string;
  readonly currentQuantity: number;
}

export interface Validation {
  readonly ok: boolean;
  readonly problem: string | null;
  /** The signed change to send, once valid. */
  readonly change: number;
  readonly resulting: number;
}

function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export function validateAdjust(input: AdjustInput): Validation {
  const none = { change: 0, resulting: input.currentQuantity };
  const amount = parseCount(input.amount);
  if (input.amount.trim() === '') {
    return { ok: false, problem: 'Enter how many units.', ...none };
  }
  if (amount === null) {
    return { ok: false, problem: 'Enter a whole number of units.', ...none };
  }
  if (amount === 0) {
    return { ok: false, problem: 'An adjustment of zero changes nothing.', ...none };
  }
  const change = input.direction === 'add' ? amount : -amount;
  const resulting = input.currentQuantity + change;
  if (resulting < 0) {
    return {
      ok: false,
      problem: `This lot holds ${input.currentQuantity}. Removing ${amount} would leave ${resulting}.`,
      change, resulting,
    };
  }
  if (!input.reason) {
    return { ok: false, problem: 'Choose a reason.', change, resulting };
  }
  // "Other" is a category, not an explanation. The database refuses it too.
  if (input.reason === 'other' && input.note.trim() === '') {
    return { ok: false, problem: 'Say what happened.', change, resulting };
  }
  return { ok: true, problem: null, change, resulting };
}

export interface RecountInput {
  readonly counted: string;
  readonly currentQuantity: number;
}

export function validateRecount(input: RecountInput): Validation {
  const none = { change: 0, resulting: input.currentQuantity };
  const counted = parseCount(input.counted);
  if (input.counted.trim() === '') {
    return { ok: false, problem: 'Enter the number you counted.', ...none };
  }
  if (counted === null) {
    return { ok: false, problem: 'Enter a whole number.', ...none };
  }
  if (counted === input.currentQuantity) {
    return {
      ok: false,
      problem: 'That matches the recorded quantity — nothing to correct.',
      change: 0, resulting: counted,
    };
  }
  return {
    ok: true, problem: null,
    change: counted - input.currentQuantity,
    resulting: counted,
  };
}

export interface SplitInput {
  readonly quantity: string;
  readonly toLocationCode: string;
  readonly currentQuantity: number;
}

export interface SplitValidation {
  readonly ok: boolean;
  readonly problem: string | null;
  readonly quantity: number;
  readonly remaining: number;
  /** True when the operator asked to split everything — a move, not a split. */
  readonly isWholeLot: boolean;
}

export function validateSplit(input: SplitInput): SplitValidation {
  const none = { quantity: 0, remaining: input.currentQuantity, isWholeLot: false };
  const quantity = parseCount(input.quantity);
  if (input.quantity.trim() === '') {
    return { ok: false, problem: 'Enter how many units to split off.', ...none };
  }
  if (quantity === null || quantity === 0) {
    return { ok: false, problem: 'Enter a whole number of units, at least one.', ...none };
  }
  if (quantity > input.currentQuantity) {
    return {
      ok: false,
      problem: `This lot holds ${input.currentQuantity}, so ${quantity} cannot be split off.`,
      quantity, remaining: 0, isWholeLot: false,
    };
  }
  if (quantity === input.currentQuantity) {
    // Splitting everything leaves an empty parent and a lineage entry
    // describing something Move Entire Lot records properly.
    return {
      ok: false,
      problem: 'That is the whole lot — use Move Entire Lot instead.',
      quantity, remaining: 0, isWholeLot: true,
    };
  }
  if (!input.toLocationCode) {
    return {
      ok: false, problem: 'Choose where the split units are going.',
      quantity, remaining: input.currentQuantity - quantity, isWholeLot: false,
    };
  }
  return {
    ok: true, problem: null,
    quantity, remaining: input.currentQuantity - quantity, isWholeLot: false,
  };
}

/** A stale-quantity conflict from the database, in the operator's words. */
export function isStaleQuantityError(message: string): boolean {
  return /reload and try again/i.test(message);
}

// Shared request-body validation for mutation routes. Centralized so every
// route rejects the same way (structured 4xx JSON) instead of each handler
// inventing its own coercion rules — the old `Number(x) || fallback` pattern
// silently turned invalid input (negative, zero, NaN, fractional) into a
// fallback value instead of rejecting it.

export class ValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// Physical quantities (inventory quantity, allocated_quantity, quantity_to_list,
// quantity_sold) must be whole, positive counts. Rejects negative, zero,
// fractional, and non-numeric input.
export function requirePositiveInteger(value: unknown, field: string): number {
  const n = coerceNumber(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return n;
}

// Money-like fields (allocated_cost, etc.) must be finite and non-negative.
// This does not enforce integer cents — that migration is out of scope here.
export function requireNonNegativeNumber(value: unknown, field: string): number {
  const n = coerceNumber(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${field} must be a non-negative number`);
  }
  return n;
}

export function sendValidationError(res: { status: (n: number) => any }, err: unknown): boolean {
  if (err instanceof ValidationError) {
    (res.status(err.status) as any).json({ error: err.message });
    return true;
  }
  return false;
}

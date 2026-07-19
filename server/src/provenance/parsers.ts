// Deterministic row parsers for the repository fixtures.
//
// PARSER_VERSION and MAPPING_VERSION are governed values recorded on every
// import job and every source record. Changing how a row is READ is a parser
// change; changing what a field MEANS downstream is a mapping change. Bumping
// either produces a new governed import rather than overwriting history — the
// database enforces this via the committed-identity unique index.
//
// Every parser is pure: same input bytes always produce the same output, with
// no clock, no randomness, no I/O, and no environment dependence.

import type { JsonValue } from './hash.js';
import type { FixtureDefinition } from './fixtures.js';

export const PARSER_VERSION = '1.0.0';
export const MAPPING_VERSION = '1.0.0';

export interface ParseIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ParsedRow {
  readonly status: 'parsed' | 'malformed';
  /** Normalized output. Null when the row could not be parsed. */
  readonly output: Record<string, JsonValue> | null;
  readonly errors: ParseIssue[];
  readonly warnings: ParseIssue[];
}

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Numeric coercion that refuses silent nonsense: an unparseable non-empty
// value is an ERROR, not a zero. Losing a bad number to a default is exactly
// the kind of silent overwrite this phase exists to prevent.
function readNumber(
  row: Record<string, JsonValue>,
  field: string,
  errors: ParseIssue[],
  required: boolean
): number | null {
  const raw = row[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      errors.push({ field, code: 'missing_required', message: `${field} is required` });
    }
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      errors.push({ field, code: 'not_finite', message: `${field} is not a finite number` });
      return null;
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (cleaned === '' || Number.isNaN(n)) {
      errors.push({ field, code: 'not_numeric', message: `${field} is not numeric: ${raw}` });
      return null;
    }
    return n;
  }
  errors.push({ field, code: 'not_numeric', message: `${field} is not numeric` });
  return null;
}

function readText(
  row: Record<string, JsonValue>,
  field: string,
  errors: ParseIssue[],
  required: boolean
): string | null {
  const raw = row[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      errors.push({ field, code: 'missing_required', message: `${field} is required` });
    }
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, code: 'not_text', message: `${field} is not text` });
    return null;
  }
  return raw;
}

// Name normalization used ONLY to propose similarity candidates. It never
// rewrites the stored value and never merges two rows: case, punctuation and
// whitespace are folded purely to notice that a human should look.
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function parseRow(fixture: FixtureDefinition, raw: JsonValue): ParsedRow {
  const errors: ParseIssue[] = [];
  const warnings: ParseIssue[] = [];

  if (!isPlainObject(raw)) {
    return {
      status: 'malformed',
      output: null,
      errors: [{ field: '$', code: 'not_an_object', message: 'source row is not a JSON object' }],
      warnings,
    };
  }

  let output: Record<string, JsonValue>;

  switch (fixture.shape) {
    case 'whatnot_purchase': {
      const lineId = readText(raw, 'acquisition_line_id', errors, true);
      const orderId = readText(raw, 'order_id', errors, true);
      const seller = readText(raw, 'seller', errors, true);
      const quantity = readNumber(raw, 'quantity_purchased', errors, true);
      const totalPaid = readNumber(raw, 'total_paid', errors, true);
      const unitCost = readNumber(raw, 'unit_cost', errors, false);

      if (quantity !== null && quantity <= 0) {
        warnings.push({
          field: 'quantity_purchased',
          code: 'non_positive',
          message: 'quantity is not positive',
        });
      }
      output = {
        acquisition_line_id: lineId,
        order_id: orderId,
        seller,
        seller_normalized: seller === null ? null : normalizeName(seller),
        product_name: readText(raw, 'product_name', errors, false),
        quantity_purchased: quantity,
        total_paid: totalPaid,
        unit_cost: unitCost,
        order_status: readText(raw, 'order_status', errors, false),
      };
      break;
    }
    case 'ebay_listing': {
      output = {
        listing_id: readText(raw, 'listing_id', errors, true),
        inventory_lot_id: readText(raw, 'inventory_lot_id', errors, false),
        sellable_sku: readText(raw, 'sellable_sku', errors, false),
        product_name: readText(raw, 'product_name', errors, false),
        available_quantity: readNumber(raw, 'available_quantity', errors, false),
        quantity_to_list: readNumber(raw, 'quantity_to_list', errors, false),
      };
      break;
    }
    case 'check': {
      output = {
        check_id: readText(raw, 'check_id', errors, true),
        test: readText(raw, 'test', errors, false),
        actual: readNumber(raw, 'actual', errors, false),
        expected: readNumber(raw, 'expected', errors, false),
        difference: readNumber(raw, 'difference', errors, false),
        status: readText(raw, 'status', errors, false),
      };
      break;
    }
    case 'generic_row': {
      // Staged verbatim: the raw payload is the record of truth and no
      // domain interpretation is applied in this phase.
      output = { field_count: Object.keys(raw).length };
      break;
    }
  }

  if (errors.length > 0) return { status: 'malformed', output: null, errors, warnings };
  return { status: 'parsed', output, errors, warnings };
}

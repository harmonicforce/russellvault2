// "Add another like this" — building a NEW intake form from an existing record.
//
// The point is to save typing on the facts two copies genuinely share: what
// the thing is, who graded it, what condition it is in, where it lives. The
// hard rule is the opposite one:
//
//   A unique identifier is never copied into a new record.
//
// A certificate number, a serial number, a scan SKU and a public id each name
// ONE physical object. Copying one into a new form is how a second record ends
// up claiming to be the same slab — and the operator, who did not type it,
// would have no reason to notice. Everything about identity is left blank so
// it has to be entered deliberately for the object actually in hand.
//
// Pure logic only: no React, no network.

import type { CategoryValues, IntakeCategoryKey } from './intakeCategories';
import type { ItemOverviewRow, LotOverviewRow } from './inventoryData';

export interface IntakePrefill {
  readonly categoryKey: IntakeCategoryKey;
  readonly values: CategoryValues;
}

/**
 * Field keys that identify one specific physical object. Nothing here is ever
 * carried into a new record, from any source, under any category.
 *
 * Kept as an exported constant so a test can assert the guarantee directly
 * rather than restating it.
 */
export const NEVER_PREFILLED_KEYS: readonly string[] = [
  'certificate_number',
  'serial_number',
  'scan_sku',
  'item_public_id',
  'lot_public_id',
  'sku_public_id',
  'product_public_id',
  'source_reference',
];

/** Drop blanks and, above all, anything that names one specific object. */
function safeValues(candidate: Record<string, string | null | undefined>): CategoryValues {
  const values: CategoryValues = {};
  for (const [key, raw] of Object.entries(candidate)) {
    if (NEVER_PREFILLED_KEYS.includes(key)) continue;
    const value = (raw ?? '').trim();
    if (value !== '') values[key] = value;
  }
  return values;
}

/**
 * Which category a stored record was entered under is not recorded on the read
 * model, so it is inferred from the facts that ARE stored. A graded slab is
 * the only one with a grading company; footwear is the only one with a shoe
 * size. Anything ambiguous falls back to the vertical's general category,
 * where every prefilled field still exists.
 */
export function categoryForItem(row: ItemOverviewRow): IntakeCategoryKey {
  if (row.grading_company) return 'graded_card';
  if (row.business_vertical === 'footwear') return 'footwear';
  if (row.business_vertical === 'tcg') return 'raw_card';
  return 'other_collectible';
}

export function categoryForLot(row: LotOverviewRow): IntakeCategoryKey {
  if (row.business_vertical === 'tcg') return row.product_format ? 'sealed_tcg' : 'raw_card';
  if (row.business_vertical === 'footwear') return 'footwear';
  return 'other_collectible';
}

/**
 * Prefill a new single-item form from an existing item. Quantity is always 1:
 * "another like this" is one more object, and a quantity carried over from a
 * lot would silently create several.
 */
export function prefillFromItem(row: ItemOverviewRow): IntakePrefill {
  const categoryKey = categoryForItem(row);
  const shared: Record<string, string | null | undefined> = {
    quantity: '1',
    location_code: row.location_retired_at ? null : row.location_code,
    condition: row.condition_or_quality,
    // Graded slabs record the grader and the grade, which the next slab of the
    // same card very often shares — but never its certificate number.
    grading_company: row.grading_company,
    numeric_grade: row.numeric_grade == null ? null : String(row.numeric_grade),
    grade_designation: row.grade_designation,
    product_format: row.product_format,
    size_system: row.size_system,
    size: row.shoe_size ?? row.size_label,
  };
  if (categoryKey === 'footwear') {
    shared.brand = row.product_display_name;
  } else if (categoryKey === 'other_collectible') {
    shared.item_name = row.product_display_name;
  } else {
    shared.card_name = row.product_display_name;
  }
  return { categoryKey, values: safeValues(shared) };
}

/** The same, from a quantity-tracked lot. */
export function prefillFromLot(row: LotOverviewRow): IntakePrefill {
  const categoryKey = categoryForLot(row);
  const shared: Record<string, string | null | undefined> = {
    quantity: '1',
    location_code: row.location_retired_at ? null : row.location_code,
    condition: row.condition_or_quality,
    product_format: row.product_format,
    packaging_condition: row.seal_or_packaging_condition,
    size: row.shoe_size ?? row.size_label,
  };
  if (categoryKey === 'footwear') {
    shared.brand = row.product_display_name;
  } else if (categoryKey === 'sealed_tcg') {
    shared.product_name = row.product_display_name;
  } else if (categoryKey === 'other_collectible') {
    shared.item_name = row.product_display_name;
  } else {
    shared.card_name = row.product_display_name;
  }
  return { categoryKey, values: safeValues(shared) };
}

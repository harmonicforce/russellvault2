// The one rule that matters here: a unique identifier is never carried into a
// new record. Everything else is convenience.
import { describe, expect, it } from 'vitest';
import {
  NEVER_PREFILLED_KEYS, categoryForItem, categoryForLot, prefillFromItem, prefillFromLot,
} from './intakePrefill';
import type { ItemOverviewRow, LotOverviewRow } from './inventoryData';

function item(over: Partial<ItemOverviewRow> = {}): ItemOverviewRow {
  return {
    item_id: 'i-1',
    item_public_id: 'RV-I-0000000001',
    scan_sku: 'RVSKU-000123',
    grading_company: 'PSA',
    certificate_number: 'CERT-98765',
    serial_number: 'SER-ABC',
    item_created_at: '2026-07-01T00:00:00.000Z',
    lot_id: 'l-1',
    lot_public_id: 'RV-L-0000000001',
    tracking_mode: 'serialized',
    lot_quantity: 1,
    location_id: 'loc-1',
    location_code: 'SHELF-1',
    location_display_name: 'Shelf One',
    location_retired_at: null,
    needs_location: false,
    needs_condition_details: false,
    last_moved_at: null,
    sku_public_id: 'RV-S-0000000001',
    business_vertical: 'tcg',
    inventory_subtype: 'graded_card',
    product_public_id: 'RV-P-0000000001',
    product_display_name: 'Charizard',
    numeric_grade: '10',
    grade_designation: 'GEM MINT',
    condition_or_quality: 'Near Mint',
    product_format: null,
    shoe_size: null,
    size_system: null,
    size_label: null,
    media_count: 2,
    active_media_count: 2,
    needs_photos: false,
    primary_media_path: 'ws/1.jpg',
    ...over,
  };
}

function lot(over: Partial<LotOverviewRow> = {}): LotOverviewRow {
  return {
    lot_id: 'l-2',
    lot_public_id: 'RV-L-0000000002',
    tracking_mode: 'lot_managed',
    quantity: 12,
    lot_created_at: '2026-07-01T00:00:00.000Z',
    location_id: 'loc-1',
    location_code: 'SHELF-1',
    location_display_name: 'Shelf One',
    location_retired_at: null,
    needs_location: false,
    needs_condition_details: false,
    last_moved_at: null,
    sku_public_id: 'RV-S-0000000002',
    business_vertical: 'tcg',
    inventory_subtype: 'sealed_tcg',
    product_public_id: 'RV-P-0000000002',
    product_display_name: 'Jungle Booster Box',
    condition_or_quality: 'New',
    product_format: 'Booster Box',
    seal_or_packaging_condition: 'Sealed',
    size_label: null,
    shoe_size: null,
    serialized_child_count: 0,
    media_count: 0,
    active_media_count: 0,
    needs_photos: true,
    primary_media_path: null,
    ...over,
  } as LotOverviewRow;
}

describe('identifiers are never copied into a new record', () => {
  it('omits every identifying field when prefilling from an item', () => {
    const { values } = prefillFromItem(item());
    for (const key of NEVER_PREFILLED_KEYS) {
      expect(values[key]).toBeUndefined();
    }
    // Stated explicitly, because these two are the ones that would actually
    // create a false duplicate claim.
    expect(values.certificate_number).toBeUndefined();
    expect(values.serial_number).toBeUndefined();
  });

  it('omits every identifying field when prefilling from a lot', () => {
    const { values } = prefillFromLot(lot());
    for (const key of NEVER_PREFILLED_KEYS) {
      expect(values[key]).toBeUndefined();
    }
  });

  it("never contains the source record's own identifier values anywhere", () => {
    const source = item();
    const { values } = prefillFromItem(source);
    const carried = Object.values(values);
    for (const identifier of [
      source.certificate_number, source.serial_number, source.scan_sku,
      source.item_public_id, source.lot_public_id, source.sku_public_id,
    ]) {
      expect(carried).not.toContain(identifier);
    }
  });
});

describe('what a prefill does carry', () => {
  it('carries the shared product and grading facts', () => {
    const { categoryKey, values } = prefillFromItem(item());
    expect(categoryKey).toBe('graded_card');
    expect(values.card_name).toBe('Charizard');
    expect(values.grading_company).toBe('PSA');
    expect(values.numeric_grade).toBe('10');
    expect(values.grade_designation).toBe('GEM MINT');
    expect(values.location_code).toBe('SHELF-1');
  });

  it("always sets quantity to one, never the source lot's quantity", () => {
    // "Another like this" is one more object. Carrying 12 across would create
    // twelve records from a single click.
    expect(prefillFromLot(lot({ quantity: 12 })).values.quantity).toBe('1');
    expect(prefillFromItem(item({ lot_quantity: 9 })).values.quantity).toBe('1');
  });

  it('does not send the operator to a location that has been retired', () => {
    const { values } = prefillFromItem(item({ location_retired_at: '2026-07-20T00:00:00.000Z' }));
    expect(values.location_code).toBeUndefined();
  });

  it('drops blanks rather than prefilling empty strings', () => {
    const { values } = prefillFromItem(item({ condition_or_quality: null, grade_designation: '  ' }));
    expect('condition' in values).toBe(false);
    expect('grade_designation' in values).toBe(false);
  });
});

describe('choosing the category to prefill into', () => {
  it('reads the category straight off the stored subtype', () => {
    expect(categoryForItem(item())).toBe('graded_card');
    expect(categoryForItem(item({ inventory_subtype: 'raw_card' }))).toBe('raw_card');
    expect(categoryForItem(item({ inventory_subtype: 'footwear' }))).toBe('footwear');
    expect(categoryForLot(lot())).toBe('sealed_tcg');
  });

  it('keeps apparel and electronics apart, which the vertical alone cannot', () => {
    // Both live in the `other` vertical. Before the subtype was stored, both
    // reopened as Other Collectible and the operator's original choice was lost.
    expect(categoryForItem(item({
      business_vertical: 'other', inventory_subtype: 'apparel', grading_company: null,
    }))).toBe('apparel');
    expect(categoryForItem(item({
      business_vertical: 'other', inventory_subtype: 'electronics', grading_company: null,
    }))).toBe('electronics');
    expect(categoryForLot(lot({
      business_vertical: 'other', inventory_subtype: 'apparel',
    }))).toBe('apparel');
  });

  it('falls back to the stored facts when the subtype is unclassified', () => {
    // Records committed before the subtype existed, and records whose facts
    // did not identify one, still have to open SOME form.
    expect(categoryForItem(item({ inventory_subtype: 'unclassified' }))).toBe('graded_card');
    expect(categoryForItem(item({ inventory_subtype: 'unclassified', grading_company: null })))
      .toBe('raw_card');
    expect(categoryForItem(item({
      inventory_subtype: 'unclassified', grading_company: null, business_vertical: 'footwear',
    }))).toBe('footwear');
    expect(categoryForLot(lot({ inventory_subtype: 'unclassified', product_format: null })))
      .toBe('raw_card');
    expect(categoryForItem(item({
      inventory_subtype: 'unclassified', grading_company: null, business_vertical: 'other',
    }))).toBe('other_collectible');
  });

  it('carries footwear sizing into the footwear form', () => {
    expect(prefillFromItem(item({
      inventory_subtype: 'footwear', grading_company: null, business_vertical: 'footwear',
      product_display_name: 'Nike', shoe_size: '10.5', size_system: 'US',
    })).values.size).toBe('10.5');
  });
});

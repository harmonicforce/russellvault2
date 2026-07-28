// Category payload mapping, quantity/tracking rules, label content and
// barcode encoding. Pure logic — no DOM, no network, no Supabase.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, MAX_SINGLE_ITEM_UNITS, buildEntryPayload, buildGroupPayload, categoryByKey,
  displayNameFor, emptyValues, identifierBlockers, localBlockers, parseQuantity,
  resolveTracking, unitSerialKey, usesPerUnitIdentifiers,
  type CategoryValues,
} from './intakeCategories';
import { code128BBars, code128BWidths, isEncodableCode128B, labelForItem, labelForLot } from './labels';
import { resolveExactTarget } from '../pages/ScanFind';
import type { ItemOverviewRow, LotOverviewRow } from './inventoryData';

function values(key: Parameters<typeof categoryByKey>[0], over: CategoryValues): CategoryValues {
  return { ...emptyValues(categoryByKey(key)), ...over };
}

describe('quantity parsing', () => {
  it('defaults an empty quantity to one', () => {
    expect(parseQuantity('')).toBe(1);
    expect(parseQuantity(undefined)).toBe(1);
  });

  it('accepts positive whole numbers only', () => {
    expect(parseQuantity('3')).toBe(3);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('1.5')).toBeNull();
    expect(parseQuantity('two')).toBeNull();
  });
});

describe('tracking mode is chosen, never guessed', () => {
  it('graded cards and footwear are always individually tracked', () => {
    expect(resolveTracking(categoryByKey('graded_card'), values('graded_card', {}))).toBe('serialized');
    expect(resolveTracking(categoryByKey('footwear'), values('footwear', {}))).toBe('serialized');
  });

  it('raw and sealed cards are tracked by quantity', () => {
    expect(resolveTracking(categoryByKey('raw_card'), values('raw_card', {}))).toBe('lot_managed');
    expect(resolveTracking(categoryByKey('sealed_tcg'), values('sealed_tcg', {}))).toBe('lot_managed');
  });

  it('apparel follows the operator\'s explicit choice', () => {
    const def = categoryByKey('apparel');
    expect(resolveTracking(def, values('apparel', { tracking_choice: 'quantity' }))).toBe('lot_managed');
    expect(resolveTracking(def, values('apparel', { tracking_choice: 'individual' }))).toBe('serialized');
  });

  it('a real electronics serial number implies individual tracking', () => {
    const def = categoryByKey('electronics');
    expect(resolveTracking(def, values('electronics', {}))).toBe('lot_managed');
    expect(resolveTracking(def, values('electronics', { serial_number: 'SN-123' }))).toBe('serialized');
  });
});

describe('payload mapping per category', () => {
  it('a graded card is one serialized unit carrying its certificate', () => {
    const def = categoryByKey('graded_card');
    const v = values('graded_card', {
      certificate_number: 'PSA-88002', grading_company: 'PSA', numeric_grade: '10',
      card_name: 'Blastoise', set_name: 'Base Set', card_number: '2', language: 'English',
    });
    const group = buildGroupPayload(def, v);
    expect(group.category).toBe('graded_tcg');
    expect(group.quantity).toBe(1);
    expect(group.trackingMode).toBe('serialized');
    expect(group.serializedChildCount).toBe(1);
    expect(group.productAttrs).toEqual({
      featured_subject: 'Blastoise', set_name: 'Base Set', card_number: '2', language: 'English',
    });
    expect(group.skuAttrs.grading_company).toBe('PSA');
    expect(group.skuAttrs.product_format).toBe('Graded slab');

    const entry = buildEntryPayload(def, v);
    expect(entry.certificateNumber).toBe('PSA-88002');
    expect(entry.gradingCompany).toBe('PSA');
  });

  it('a raw-card lot keeps its quantity and condition without serializing', () => {
    const def = categoryByKey('raw_card');
    const group = buildGroupPayload(def, values('raw_card', {
      card_name: 'Pikachu', set_name: 'Jungle', card_number: '60', condition: 'Near Mint', quantity: '4',
    }));
    expect(group.quantity).toBe(4);
    expect(group.trackingMode).toBe('lot_managed');
    expect(group.serializedChildCount).toBe(0);
    expect(group.skuAttrs.condition_or_quality).toBe('Near Mint');
  });

  it('never upgrades an unassessed condition into a stronger one', () => {
    const def = categoryByKey('raw_card');
    const group = buildGroupPayload(def, values('raw_card', {
      card_name: 'Pikachu', condition: 'Unassessed', quantity: '1',
    }));
    expect(group.skuAttrs.condition_or_quality).toBe('Unassessed');
    expect(group.conditionState).toBe('Unassessed');
  });

  it('a sealed product carries its format and packaging condition', () => {
    const group = buildGroupPayload(categoryByKey('sealed_tcg'), values('sealed_tcg', {
      product_name: 'Evolving Skies Booster Box', set_name: 'Evolving Skies',
      product_format: 'Booster Box', packaging_condition: 'Sealed', quantity: '2',
    }));
    expect(group.category).toBe('sealed_tcg');
    expect(group.quantity).toBe(2);
    expect(group.skuAttrs.product_format).toBe('Booster Box');
    expect(group.skuAttrs.seal_or_packaging_condition).toBe('Sealed');
  });

  it('footwear serializes every unit so each pair is its own record', () => {
    const group = buildGroupPayload(categoryByKey('footwear'), values('footwear', {
      brand: 'Nike', model: 'Air Max 1', style_code: 'DZ4549', size_system: 'US', size: '10',
      condition: 'New', quantity: '3',
    }));
    expect(group.trackingMode).toBe('serialized');
    expect(group.quantity).toBe(3);
    // Every unit must have its own entry or the kernel refuses the commit.
    expect(group.serializedChildCount).toBe(3);
    expect(group.productAttrs.style_code).toBe('DZ4549');
    expect(group.skuAttrs.shoe_size).toBe('10');
    expect(group.skuAttrs.size_system).toBe('US');
  });

  it('apparel and electronics map onto the governed generic attributes', () => {
    const apparel = buildGroupPayload(categoryByKey('apparel'), values('apparel', {
      brand: 'Supreme', item_name: 'Box Logo Hoodie', garment_type: 'Hoodie',
      size: 'L', color: 'Black', condition: 'Good',
    }));
    expect(apparel.category).toBe('other');
    expect(apparel.productAttrs).toEqual({
      brand: 'Supreme', product_line: 'Box Logo Hoodie', item_category: 'Apparel',
    });
    expect(apparel.skuAttrs.size_label).toBe('L');

    const electronics = buildGroupPayload(categoryByKey('electronics'), values('electronics', {
      brand: 'Apple', item_name: 'iPhone 13', model: 'A2482', condition: 'Like New',
    }));
    expect(electronics.productAttrs.item_category).toBe('Electronics');
    expect(electronics.productAttrs.model_number).toBe('A2482');
  });

  it('never invents a value the operator did not enter', () => {
    const group = buildGroupPayload(categoryByKey('electronics'), values('electronics', {
      brand: 'Apple', item_name: 'iPhone',
    }));
    // No condition, model, variant or colour was typed, so none is emitted.
    expect(group.skuAttrs.condition_or_quality).toBeUndefined();
    expect(group.productAttrs.model_number).toBeUndefined();
    expect(group.sourceEvidence).toEqual({});
  });

  it('an explicit individual-tracking choice is recorded as a unique condition', () => {
    const group = buildGroupPayload(categoryByKey('other_collectible'), values('other_collectible', {
      item_category: 'Comic', item_name: 'Amazing Fantasy 15', tracking_choice: 'individual',
    }));
    expect(group.uniqueCondition).toBe(true);
    expect(group.trackingMode).toBe('serialized');
  });

  it('every category produces a non-empty display name from real input', () => {
    for (const def of CATEGORIES) {
      const filled = values(def.key, {
        card_name: 'X', product_name: 'X', item_name: 'X', brand: 'B', model: 'M', item_category: 'C',
      });
      expect(displayNameFor(def, filled).length).toBeGreaterThan(0);
    }
  });
});

describe('local blockers', () => {
  it('refuses an unnamed item and a nonsense quantity', () => {
    const def = categoryByKey('raw_card');
    expect(localBlockers(def, values('raw_card', {}))).toHaveLength(1);
    expect(localBlockers(def, values('raw_card', { card_name: 'Pikachu', quantity: 'x' }))).toEqual([
      'Quantity must be a whole number of at least 1.',
    ]);
    expect(localBlockers(def, values('raw_card', { card_name: 'Pikachu', quantity: '2' }))).toEqual([]);
  });
});

describe('labels', () => {
  const item = {
    product_display_name: 'Blastoise Base Set 2',
    scan_sku: 'RV-7K3F9Q2',
    item_public_id: 'RV-ITEM-ABC123',
    location_code: 'BIN-2',
    location_display_name: 'Bin 2',
  };

  it('a serialized label encodes the scan SKU, not a new identifier', () => {
    const label = labelForItem(item);
    expect(label.code).toBe('RV-7K3F9Q2');
    expect(label.codeLabel).toBe('Scan SKU');
    expect(label.locationLine).toBe('Bin 2 (BIN-2)');
  });

  it('a lot label encodes the lot public id and shows quantity', () => {
    const label = labelForLot({
      product_display_name: 'Evolving Skies Booster Box',
      lot_public_id: 'RV-C-0000001234',
      quantity: 6,
      location_code: 'SHELF-A',
      location_display_name: null,
    });
    expect(label.code).toBe('RV-C-0000001234');
    expect(label.quantityLine).toBe('Qty 6');
    expect(label.locationLine).toBe('SHELF-A');
  });

  it('truncates a long name rather than overflowing the label', () => {
    const label = labelForItem({ ...item, product_display_name: 'A'.repeat(120) });
    expect(label.title.length).toBeLessThanOrEqual(38);
    expect(label.title.endsWith('…')).toBe(true);
  });
});

describe('Code 128-B encoding', () => {
  it('accepts the identifier shapes the app actually mints', () => {
    expect(isEncodableCode128B('RV-7K3F9Q2')).toBe(true);
    expect(isEncodableCode128B('RV-ITEM-ABC123')).toBe(true);
    expect(isEncodableCode128B('')).toBe(false);
    expect(isEncodableCode128B('naïve')).toBe(false);
  });

  it('produces start, data, checksum and stop symbols', () => {
    const widths = code128BWidths('AB');
    // start(6) + 2 data(12) + checksum(6) + stop(7)
    expect(widths).not.toBeNull();
    expect(widths).toHaveLength(6 + 12 + 6 + 7);
  });

  it('computes the standard checksum for a known value', () => {
    // "A" -> start 104, value 33; checksum = (104 + 33*1) % 103 = 34, whose
    // Code 128 pattern is 131123.
    const widths = code128BWidths('A')!;
    const checksumPattern = widths.slice(12, 18).join('');
    expect(checksumPattern).toBe('131123');
  });

  it('renders bars that never exceed the encoded module width', () => {
    const encoded = code128BBars('RV-7K3F9Q2')!;
    expect(encoded.bars.length).toBeGreaterThan(0);
    for (const bar of encoded.bars) {
      expect(bar.x + bar.width).toBeLessThanOrEqual(encoded.totalModules);
    }
  });

  it('returns null rather than an unscannable barcode', () => {
    expect(code128BWidths('naïve')).toBeNull();
    expect(code128BBars('')).toBeNull();
  });
});

describe('scan resolution', () => {
  const item = { item_id: 'i-1', item_public_id: 'RV-ITEM-1', scan_sku: 'RV-7K3F9Q2',
    certificate_number: 'PSA-88002', serial_number: null } as unknown as ItemOverviewRow;
  const lot = { lot_id: 'l-1', lot_public_id: 'RV-C-0000001234' } as unknown as LotOverviewRow;

  it('opens an item on an exact scan SKU, item id, certificate or serial', () => {
    expect(resolveExactTarget('RV-7K3F9Q2', [item], [lot])).toEqual({ kind: 'item', id: 'i-1' });
    expect(resolveExactTarget('rv-item-1', [item], [lot])).toEqual({ kind: 'item', id: 'i-1' });
    expect(resolveExactTarget('PSA-88002', [item], [lot])).toEqual({ kind: 'item', id: 'i-1' });
  });

  it('opens a lot on an exact lot public id', () => {
    expect(resolveExactTarget('RV-C-0000001234', [item], [lot])).toEqual({ kind: 'lot', id: 'l-1' });
  });

  it('falls back to a result list when nothing matches exactly', () => {
    expect(resolveExactTarget('blast', [item], [lot])).toEqual({ kind: 'none' });
    expect(resolveExactTarget('   ', [item], [lot])).toEqual({ kind: 'none' });
  });
});

describe('per-unit identifiers', () => {
  const electronics = categoryByKey('electronics');

  it('a single unit still uses the shared serial field', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone', serial_number: 'SN-1', quantity: '1',
    });
    expect(usesPerUnitIdentifiers(electronics, v)).toBe(false);
    expect(buildEntryPayload(electronics, v, 1).serialNumber).toBe('SN-1');
  });

  it('never copies one serial onto every unit of a multi-unit group', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone', serial_number: 'SN-1',
      quantity: '3', tracking_choice: 'individual',
    });
    expect(usesPerUnitIdentifiers(electronics, v)).toBe(true);
    // The shared field is deliberately ignored for a multi-unit group...
    expect(buildEntryPayload(electronics, v, 1).serialNumber).toBeNull();
    expect(buildEntryPayload(electronics, v, 2).serialNumber).toBeNull();
    // ...and the operator is told why rather than having it silently dropped.
    expect(identifierBlockers(electronics, v).join(' ')).toMatch(/cannot describe several units/i);
  });

  it('gives each unit its own identifier', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone', quantity: '3', tracking_choice: 'individual',
      [unitSerialKey(1)]: 'SN-A', [unitSerialKey(2)]: 'SN-B', [unitSerialKey(3)]: 'SN-C',
    });
    expect(buildEntryPayload(electronics, v, 1).serialNumber).toBe('SN-A');
    expect(buildEntryPayload(electronics, v, 2).serialNumber).toBe('SN-B');
    expect(buildEntryPayload(electronics, v, 3).serialNumber).toBe('SN-C');
    expect(identifierBlockers(electronics, v)).toEqual([]);
  });

  it('rejects the same serial entered twice across units', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone', quantity: '2', tracking_choice: 'individual',
      [unitSerialKey(1)]: 'SN-A', [unitSerialKey(2)]: 'sn-a',
    });
    expect(identifierBlockers(electronics, v).join(' ')).toMatch(/repeats the serial/i);
  });

  it('allows blank per-unit serials, which mean "not recorded"', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone', quantity: '2', tracking_choice: 'individual',
    });
    expect(identifierBlockers(electronics, v)).toEqual([]);
    expect(buildEntryPayload(electronics, v, 1).serialNumber).toBeNull();
  });

  it('sends operators to Batch Intake beyond the single-form limit', () => {
    const v = values('electronics', {
      brand: 'Apple', item_name: 'iPhone',
      quantity: String(MAX_SINGLE_ITEM_UNITS + 1), tracking_choice: 'individual',
    });
    expect(identifierBlockers(electronics, v).join(' ')).toMatch(/Batch Intake/i);
  });

  it('a graded card has no quantity field at all — one slab, one certificate', () => {
    const graded = categoryByKey('graded_card');
    expect(graded.allowsQuantity).toBe(false);
    expect(graded.fields.some((f) => f.key === 'quantity')).toBe(false);
    expect(usesPerUnitIdentifiers(graded, values('graded_card', { quantity: '5' }))).toBe(false);
    expect(buildGroupPayload(graded, values('graded_card', { card_name: 'X' })).quantity).toBe(1);
  });
});

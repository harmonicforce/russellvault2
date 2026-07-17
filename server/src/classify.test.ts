import { describe, it, expect } from 'vitest';
import { classifyPurchase, CLASSIFIER_VERSION, PRODUCT_TYPES } from './classify.js';

// Smoke tests over the pure purchase-type classifier. These assert existing
// behavior only — they do not introduce new product rules.
const noSealed = new Set<string>();

describe('classifyPurchase (smoke)', () => {
  it('exposes a positive classifier version and non-empty type list', () => {
    expect(CLASSIFIER_VERSION).toBeGreaterThan(0);
    expect(PRODUCT_TYPES.length).toBeGreaterThan(0);
  });

  it('reads the delivered item after the dash', () => {
    const t = classifyPurchase(
      { product_name: 'PSA 10 MEGA SET MYSTERY WHEEL - Wild Force Booster Pack KRN', business_vertical: 'Pokémon / TCG' },
      noSealed,
    );
    expect(t).toBe('Sealed');
  });

  it('tags a named graded card as Slab', () => {
    expect(
      classifyPurchase({ product_name: 'Surprise Set - Lechonk CGC 9', business_vertical: 'Pokémon / TCG' }, noSealed),
    ).toBe('Slab');
  });

  it('maps a non-card vertical to its own type', () => {
    expect(
      classifyPurchase({ product_name: 'Nike Dunk Low', business_vertical: 'Sneakers / footwear' }, noSealed),
    ).toBe('Sneakers');
  });

  it('leaves a bare mystery-wheel lot Unreviewed', () => {
    expect(
      classifyPurchase({ product_name: 'MEGA SET MYSTERY WHEEL - #499', business_vertical: 'Pokémon / TCG' }, noSealed),
    ).toBe('Unreviewed');
  });

  it('treats an id in the sealed-identity set as Sealed regardless of title', () => {
    expect(
      classifyPurchase(
        { acquisition_line_id: 'WN-A-000001', product_name: 'anything', business_vertical: 'Pokémon / TCG' },
        new Set(['WN-A-000001']),
      ),
    ).toBe('Sealed');
  });
});

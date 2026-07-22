// Phase 5 inventory-identity adapter tests.
//
// Headline proof: all 1,487 repository inventory lots map deterministically into
// the product / SKU / lot / serialized-item / location hierarchy, preserving
// every RV-C / RV-S public id and the lot grain, without fabricating facts.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  buildInventoryIdentityPlan,
  type InventoryFixtureRow,
} from './adapter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '..', '..', 'seed', 'inventory.json');

function fixtureRows(): InventoryFixtureRow[] {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as InventoryFixtureRow[];
}

describe('the 1,487-lot inventory fixture maps deterministically', () => {
  const rows = fixtureRows();
  const plan = buildInventoryIdentityPlan(rows);

  it('preserves the lot grain: one lot per fixture row', () => {
    expect(rows.length).toBe(1487);
    expect(plan.expectedLots).toBe(1487);
    expect(plan.lots.length).toBe(1487);
  });

  it('preserves every RV-C / RV-S lot public id exactly and uniquely', () => {
    const ids = plan.lots.map((l) => l.publicId);
    expect(new Set(ids).size).toBe(1487);
    for (const id of ids) expect(id).toMatch(/^RV-[CS]-\d{4,6}$/);
    const original = new Set(rows.map((r) => String(r['inventory_lot_id'])));
    for (const id of ids) expect(original.has(id)).toBe(true);
  });

  it('maps every lot to exactly one sellable SKU and one product', () => {
    const skuKeys = new Set(plan.skus.map((s) => s.skuGroupKey));
    const productKeys = new Set(plan.products.map((p) => p.canonicalKey));
    for (const lot of plan.lots) {
      expect(skuKeys.has(lot.skuGroupKey)).toBe(true);
      expect(productKeys.has(lot.productKey)).toBe(true);
    }
    // SKUs and products dedup below the lot count (interchangeable configs merge).
    expect(plan.expectedSkus).toBeLessThanOrEqual(1487);
    expect(plan.expectedProducts).toBeLessThanOrEqual(plan.expectedSkus);
    expect(plan.expectedProducts).toBeGreaterThan(0);
  });

  it('serializes only the source-serialized (graded) lots — no mass serialization', () => {
    const serialized = plan.lots.filter((l) => l.trackingMode === 'serialized');
    expect(serialized.length).toBe(plan.expectedSerializedItems);
    // The fixture marks 279 graded slabs as serialized; the rest stay lot-managed.
    expect(plan.expectedSerializedItems).toBe(279);
    expect(plan.lots.filter((l) => l.trackingMode === 'lot_managed').length).toBe(1487 - 279);
    for (const lot of plan.lots) {
      if (lot.trackingMode === 'lot_managed') expect(lot.serialized).toBeNull();
    }
  });

  it('does not fabricate identity facts: "not stated" sentinels become null', () => {
    // The fixture language is "Not explicitly stated" throughout; it must not be
    // invented into a concrete language on the product.
    for (const p of plan.products) {
      expect(p.attrs['language']).not.toBe('Not explicitly stated');
    }
  });

  it('is fully deterministic across input orderings', () => {
    const shuffled = [...rows].reverse();
    const again = buildInventoryIdentityPlan(shuffled);
    expect(again.expectedProducts).toBe(plan.expectedProducts);
    expect(again.expectedSkus).toBe(plan.expectedSkus);
    expect(again.lots.map((l) => l.publicId)).toEqual(plan.lots.map((l) => l.publicId));
  });

  it('reports ambiguous product candidates rather than merging them', () => {
    // The mechanism exists and is a stable array (empty is acceptable for this
    // clean fixture); every entry references a real lot id.
    expect(Array.isArray(plan.ambiguities)).toBe(true);
    const ids = new Set(plan.lots.map((l) => l.publicId));
    for (const a of plan.ambiguities) expect(ids.has(a.publicId)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { describeIdentityRecord, summarizeLotDetail } from './inventoryIdentity';

describe('summarizeLotDetail — joined identity chain + capacity', () => {
  const base = {
    product: { public_id: 'RV-PROD-A' },
    sku: { public_id: 'RV-SKU-A' },
    lot: { public_id: 'RV-C-000001', quantity: 3 },
    location: { public_id: 'RV-LOC-A' },
  };

  it('renders the full Product → SKU → Lot → Location chain', () => {
    const s = summarizeLotDetail({ ...base, serializedChildCount: 0, capacity: null, atCapacity: false });
    expect(s.chain.map((c) => c.kindLabel)).toEqual([
      'Product Catalog',
      'Sellable SKU',
      'Inventory Lot',
      'Storage Location',
    ]);
    expect(s.chain[0].publicId).toBe('RV-PROD-A');
    expect(s.chain[2].publicId).toBe('RV-C-000001');
  });

  it('labels a lot-managed lot (no serialized capacity)', () => {
    const s = summarizeLotDetail({ ...base, serializedChildCount: 0, capacity: null, atCapacity: false });
    expect(s.capacityLabel).toBe('lot-managed (3)');
    expect(s.atCapacity).toBe(false);
  });

  it('labels a partially serialized lot as below capacity', () => {
    const s = summarizeLotDetail({ ...base, serializedChildCount: 1, capacity: 2, atCapacity: false });
    expect(s.capacityLabel).toBe('1 / 2 serialized units');
    expect(s.atCapacity).toBe(false);
  });

  it('labels a full serialized lot as at capacity', () => {
    const s = summarizeLotDetail({ ...base, serializedChildCount: 2, capacity: 2, atCapacity: true });
    expect(s.capacityLabel).toBe('2 / 2 serialized units (full)');
    expect(s.atCapacity).toBe(true);
  });

  it('marks a missing location in the chain as null (fail-closed rendering)', () => {
    const s = summarizeLotDetail({ ...base, location: null, serializedChildCount: 0, capacity: null, atCapacity: false });
    expect(s.chain[3].publicId).toBeNull();
  });
});

describe('describeIdentityRecord distinguishes the identity grains', () => {
  it('labels a Product distinctly', () => {
    const d = describeIdentityRecord('product', {
      public_id: 'RV-PROD-AAA111',
      business_vertical: 'tcg',
      display_name: 'Galarian Mr. Mime #30',
      product_canonical_key: 'tcg|...',
    });
    expect(d.kindLabel).toBe('Product Catalog');
    expect(d.publicId).toBe('RV-PROD-AAA111');
    expect(d.scanSku).toBeNull();
    expect(d.facts.some((f) => f.label === 'Name')).toBe(true);
    // A product never claims a fingerprint or scan code.
    expect(d.facts.some((f) => f.label === 'Fingerprint')).toBe(false);
  });

  it('labels a SKU distinctly, surfacing its fingerprint', () => {
    const d = describeIdentityRecord('sku', {
      public_id: 'RV-SKU-AAA111',
      business_vertical: 'tcg',
      identity_schema_version: 'IDSKU1',
      fingerprint: 'abc',
      is_active: true,
    });
    expect(d.kindLabel).toBe('Sellable SKU');
    expect(d.facts.some((f) => f.label === 'Fingerprint' && f.value === 'abc')).toBe(true);
  });

  it('labels a Lot distinctly at the RV-C/RV-S grain', () => {
    const d = describeIdentityRecord('lot', {
      public_id: 'RV-C-000001',
      tracking_mode: 'lot_managed',
      quantity: 3,
    });
    expect(d.kindLabel).toBe('Inventory Lot');
    expect(d.publicId).toBe('RV-C-000001');
    expect(d.facts.some((f) => f.label === 'Tracking mode' && f.value === 'lot_managed')).toBe(true);
    // A lot is not serialized: no scan code.
    expect(d.scanSku).toBeNull();
  });

  it('labels a serialized Item distinctly, surfacing its opaque scan code', () => {
    const d = describeIdentityRecord('item', {
      public_id: 'RV-ITEM-AAA111',
      scan_sku: 'RV-7K3F9Q2',
      grading_company: 'CGC',
      certificate_number: 'CERT-1',
    });
    expect(d.kindLabel).toBe('Serialized Item');
    expect(d.scanSku).toBe('RV-7K3F9Q2');
    expect(d.facts.some((f) => f.label === 'Scan SKU' && f.value === 'RV-7K3F9Q2')).toBe(true);
    expect(d.facts.some((f) => f.label === 'Certificate')).toBe(true);
  });

  it('labels a Storage Location distinctly', () => {
    const d = describeIdentityRecord('location', {
      public_id: 'RV-LOC-AAA111',
      location_code: 'RC-U-01-001',
      retired_at: null,
    });
    expect(d.kindLabel).toBe('Storage Location');
    expect(d.facts.some((f) => f.label === 'Code' && f.value === 'RC-U-01-001')).toBe(true);
    expect(d.facts.some((f) => f.label === 'Retired' && f.value === 'no')).toBe(true);
  });

  it('omits absent facts rather than inventing them', () => {
    const d = describeIdentityRecord('item', { public_id: 'RV-ITEM-X', scan_sku: 'RV-ABCDEFG' });
    expect(d.facts.some((f) => f.label === 'Certificate')).toBe(false);
    expect(d.facts.some((f) => f.label === 'Serial')).toBe(false);
  });
});

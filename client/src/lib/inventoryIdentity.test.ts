import { describe, it, expect } from 'vitest';
import { describeIdentityRecord } from './inventoryIdentity';

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

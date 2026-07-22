// Phase 5 canonical identity contract tests.
//
// These lock the Node half of the ONE normalization + fingerprint contract that
// PostgreSQL (app.norm_identity / app.sku_fingerprint) reproduces byte-for-byte.
// The same fixed vectors are asserted against the database in
// supabase/tests/19_inventory_identity_acceptance.sql, so a drift on either side is caught.

import { describe, it, expect } from 'vitest';
import { normalizeIdentityField, skuFingerprint, productCanonicalKey } from './identity.js';

describe('normalizeIdentityField — the shared normalization contract', () => {
  it('lowercases and collapses/trims whitespace', () => {
    expect(normalizeIdentityField('  Crown   ZENITH ')).toBe('crown zenith');
  });
  it('maps empty and whitespace-only to null', () => {
    expect(normalizeIdentityField('')).toBeNull();
    expect(normalizeIdentityField('   ')).toBeNull();
    expect(normalizeIdentityField(null)).toBeNull();
  });
  it('applies Unicode NFC so combining and precomposed forms are one value', () => {
    expect(normalizeIdentityField('café')).toBe(normalizeIdentityField('café'));
  });
});

// SHA-256 fingerprints below are asserted identically in the pgTAP suite; a
// change on either side breaks the contract.
const FP = {
  case: 'e6a7ee60a454fbb0a00a6531957194920f2c5d0b7c66cd3ddbdbc448d756c60f',
  nullEmpty: '7e91346b87bdae1efdeb06a65f2ff69ee68a4ed8c7632910ad745e36d2599c8f',
  nfc: 'f141f856f9e3100c1f7e0efe5187d9f51c05103189dccf4bf451a6ec358a5891',
  jp: 'e52f12bb7d283ef5b5193a10fd56052efb21a95a220596d8486e7728a55126e2',
  diff: '69f64b87ac07cadd7ca5e33df52d9109382b598677a5af1c5bd410fbe585a426',
};

describe('skuFingerprint — fixed vectors (Node == PostgreSQL)', () => {
  it('is invariant to case AND whitespace in identity-driving fields', () => {
    const a = skuFingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', { condition_or_quality: 'NEAR MINT' });
    const b = skuFingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', { condition_or_quality: 'near   mint' });
    expect(a).toBe(FP.case);
    expect(b).toBe(FP.case);
  });
  it('treats null and empty-string attributes as one value', () => {
    const a = skuFingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', { grading_company: '' });
    const b = skuFingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', { grading_company: null });
    expect(a).toBe(FP.nullEmpty);
    expect(b).toBe(FP.nullEmpty);
  });
  it('applies NFC across the whole canonical key', () => {
    const combining = skuFingerprint('IDSKU1', 'tcg', 'tcg|café|||', { condition_or_quality: 'x' });
    const precomposed = skuFingerprint('IDSKU1', 'tcg', 'tcg|café|||', { condition_or_quality: 'x' });
    expect(combining).toBe(FP.nfc);
    expect(precomposed).toBe(FP.nfc);
  });
  it('handles non-ASCII (Japanese) text deterministically', () => {
    expect(skuFingerprint('IDSKU1', 'tcg', 'tcg|ポケモン|||', {})).toBe(FP.jp);
  });
  it('changes when an identity-driving fact changes', () => {
    const nine5 = skuFingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', { numeric_grade: '9.5' });
    expect(nine5).toBe(FP.diff);
    expect(nine5).not.toBe(FP.case);
  });
});

describe('productCanonicalKey', () => {
  it('normalizes each part and is invariant to case/whitespace', () => {
    const a = productCanonicalKey('tcg', { name: 'Galarian  Mr. Mime', set: 'Crown Zenith', number: '30' });
    const b = productCanonicalKey('tcg', { name: 'galarian mr. mime', set: 'CROWN ZENITH', number: '30' });
    expect(a).toBe(b);
    expect(a).toBe('tcg|galarian mr. mime|crown zenith|30||');
  });
});

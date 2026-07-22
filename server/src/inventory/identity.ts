// Phase 5 canonical identity contract (Node half).
//
// This is the SINGLE normalization + fingerprint contract shared byte-for-byte
// with PostgreSQL (app.norm_identity / app.sku_fingerprint in migration
// 20260721000400). The adapter's grouping keys and the database fingerprint MUST
// apply the same normalization, ordering, null handling, and byte encoding, so
// two lots group into one SKU iff their database fingerprint inputs are equal.

import { createHash } from 'node:crypto';

export type InventoryVertical = 'tcg' | 'footwear' | 'other';

/**
 * THE canonical identity normalization, identical to app.norm_identity:
 *   1. Unicode NFC;
 *   2. collapse every run of POSIX/ASCII whitespace (space, \t, \n, \v, \f, \r)
 *      to a single space — matching Postgres regexp_replace(..., '[[:space:]]+');
 *   3. trim a single leading/trailing space (btrim of the space left by step 2);
 *   4. lowercase;
 *   5. empty -> null.
 */
export function normalizeIdentityField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let x = value.normalize('NFC');
  x = x.replace(/[\t\n\v\f\r ]+/g, ' ');
  x = x.replace(/^ /, '').replace(/ $/, '');
  x = x.toLowerCase();
  return x === '' ? null : x;
}

/** Length-prefixed field encoder, identical to app.dg_fld: null -> "~". */
function dgFld(x: string | null): string {
  return x === null ? '~' : `${Buffer.byteLength(x, 'utf8')}:${x}`;
}

/** Length-prefixed encoding of a NORMALIZED field, identical to app.dg_norm. */
function dgNorm(x: string | null | undefined): string {
  return dgFld(normalizeIdentityField(x ?? null));
}

/**
 * The deterministic product canonical key: vertical plus the normalized
 * identity-driving product fields, joined by '|'. Two raw product facts that
 * normalize equal produce the same key (and therefore the same product).
 */
export function productCanonicalKey(
  vertical: InventoryVertical,
  fields: {
    name?: string | null;
    set?: string | null;
    number?: string | null;
    subject?: string | null;
    language?: string | null;
  }
): string {
  const part = (v: string | null | undefined): string => normalizeIdentityField(v ?? null) ?? '';
  return [
    vertical,
    part(fields.name),
    part(fields.set),
    part(fields.number),
    part(fields.subject),
    part(fields.language),
  ].join('|');
}

export type SkuAttrs = Record<string, string | null | undefined>;

/**
 * The SKU fingerprint, byte-identical to app.sku_fingerprint: SHA-256 of a
 * length-prefixed canonical serialization of the identity-schema version, the
 * vertical, the product canonical key, and the identity-driving SKU attributes
 * in a FIXED order, each normalized through the shared contract.
 */
export function skuFingerprint(
  identitySchemaVersion: string,
  vertical: InventoryVertical,
  canonicalKey: string,
  attrs: SkuAttrs
): string {
  let block: string;
  if (vertical === 'tcg') {
    block =
      'TCG' +
      dgNorm(attrs['condition_or_quality']) +
      dgNorm(attrs['grading_company']) +
      dgNorm(attrs['numeric_grade']) +
      dgNorm(attrs['grade_designation']) +
      dgNorm(attrs['seal_or_packaging_condition']) +
      dgNorm(attrs['product_format']);
  } else if (vertical === 'footwear') {
    block =
      'FTW' +
      dgNorm(attrs['shoe_size']) +
      dgNorm(attrs['apparel_size']) +
      dgNorm(attrs['color']) +
      dgNorm(attrs['condition_or_quality']);
  } else {
    block = 'OTH';
  }
  const canonical =
    'SKU' + dgFld(identitySchemaVersion) + dgFld(vertical) + dgNorm(canonicalKey) + block;
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

// Deterministic inventory-identity mapping adapter (Phase 5).
//
// Consumes the repository inventory fixture (one row per inventory lot) and
// produces an IDENTITY PLAN: the product_catalog, sellable_skus, inventory_lots,
// optional serialized inventory_items, and storage_locations those rows
// normalize into. It is a pure function of its input rows plus the mapping
// version.
//
// PRINCIPLES
//   * Lot grain is preserved: every fixture row becomes exactly one lot, and
//     its existing RV-C / RV-S public id is carried verbatim.
//   * Product identifies the general product; Sellable SKU identifies the exact
//     interchangeable configuration. Lots group into one SKU iff their database
//     fingerprint inputs are equal — the grouping key here is exactly
//     app.sku_fingerprint's input, via the shared identity contract.
//   * Hybrid serialization: only rows the source already tracks as serialized
//     get a serialized child. Nothing is mass-serialized.
//   * No fabricated facts: source null / "not stated" sentinels become NULL.
//   * Ambiguity is reported, never merged away: two rows that normalize to the
//     same product key or SKU fingerprint but carry DIFFERENT raw identity facts
//     are flagged as a normalized-key collision rather than silently taking the
//     first row's attributes.
//
// This module performs NO database access and NO network access.

import type { JsonValue } from '../provenance/hash.js';
import {
  normalizeIdentityField,
  productCanonicalKey,
  skuFingerprint,
  type InventoryVertical,
  type SkuAttrs,
} from './identity.js';

export const INVENTORY_MAPPING_VERSION = '1.0.0';
export const INVENTORY_IDENTITY_SCHEMA_VERSION = 'IDSKU1';

export type { InventoryVertical } from './identity.js';
export type TrackingMode = 'lot_managed' | 'serialized';

export interface InventoryFixtureRow {
  readonly [key: string]: JsonValue;
}

export interface PlannedProduct {
  readonly canonicalKey: string;
  readonly vertical: InventoryVertical;
  /** Deterministic normalized display name (never the first raw row's casing). */
  readonly displayName: string;
  /** Normalized identity-driving product attributes. */
  readonly attrs: Record<string, string | null>;
}

export interface PlannedSku {
  readonly productKey: string;
  readonly vertical: InventoryVertical;
  /** Normalized identity-driving SKU attributes (the fingerprint inputs). */
  readonly attrs: Record<string, string | null>;
  /** The SKU fingerprint = app.sku_fingerprint of these inputs. */
  readonly fingerprint: string;
}

export interface PlannedSerializedItem {
  readonly gradingCompany: string | null;
  readonly certificateNumber: string | null;
  readonly serialNumber: string | null;
}

export interface PlannedLot {
  readonly publicId: string;
  readonly productKey: string;
  readonly fingerprint: string;
  readonly trackingMode: TrackingMode;
  readonly quantity: number;
  readonly locationCode: string | null;
  readonly recordOrigin: string | null;
  readonly serialized: PlannedSerializedItem | null;
}

export interface MappingAmbiguity {
  readonly kind:
    | 'missing_identity'
    | 'product_vertical_conflict'
    | 'normalized_product_collision'
    | 'normalized_sku_collision';
  readonly publicId: string;
  readonly detail: string;
}

export interface InventoryIdentityPlan {
  readonly mappingVersion: string;
  readonly identitySchemaVersion: string;
  readonly products: readonly PlannedProduct[];
  readonly skus: readonly PlannedSku[];
  readonly lots: readonly PlannedLot[];
  readonly locations: readonly string[];
  readonly ambiguities: readonly MappingAmbiguity[];
  readonly expectedLots: number;
  readonly expectedProducts: number;
  readonly expectedSkus: number;
  readonly expectedSerializedItems: number;
  readonly expectedLocations: number;
}

export class InventoryMappingError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

// Source sentinels that mean "unknown / not stated" — normalized to NULL so the
// mapping never fabricates an identity-driving fact.
const NULL_SENTINELS = new Set([
  '',
  'none',
  'null',
  'n/a',
  'na',
  'not explicitly stated',
  'not stated',
  'unspecified',
]);

function text(row: InventoryFixtureRow, field: string): string | null {
  const v = row[field];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || NULL_SENTINELS.has(s.toLowerCase())) return null;
  return s;
}

function mapVertical(raw: string | null): InventoryVertical {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('tcg') || s.includes('pokemon') || s.includes('card')) return 'tcg';
  if (s.includes('foot') || s.includes('sneaker') || s.includes('shoe')) return 'footwear';
  return 'other';
}

function readQuantity(row: InventoryFixtureRow): number {
  const v = row['quantity'];
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new InventoryMappingError(
      `quantity must be a non-negative integer, got ${JSON.stringify(v)}`
    );
  }
  return n;
}

function mapTrackingMode(raw: string | null): TrackingMode {
  return (raw ?? '').toLowerCase().startsWith('serial') ? 'serialized' : 'lot_managed';
}

function normalizeAttrs(attrs: SkuAttrs): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = normalizeIdentityField(v ?? null);
  return out;
}

/**
 * Build the inventory identity plan from the repository inventory fixture.
 * Rows are processed in a deterministic order (by lot public id) so the plan is
 * reproducible regardless of input ordering.
 */
export function buildInventoryIdentityPlan(
  rows: readonly InventoryFixtureRow[]
): InventoryIdentityPlan {
  const products = new Map<string, PlannedProduct>();
  const skus = new Map<string, PlannedSku>();
  const lots: PlannedLot[] = [];
  const locations = new Set<string>();
  const ambiguities: MappingAmbiguity[] = [];
  const seenLotIds = new Set<string>();
  let serializedCount = 0;

  // Collision tracking: distinct RAW identity tuples per normalized key.
  const productRaw = new Map<string, { tuples: Set<string>; firstLot: string }>();
  const skuRaw = new Map<string, { tuples: Set<string>; firstLot: string }>();

  const ordered = [...rows].sort((a, b) =>
    String(a['inventory_lot_id'] ?? '').localeCompare(String(b['inventory_lot_id'] ?? ''))
  );

  for (const row of ordered) {
    const publicId = text(row, 'inventory_lot_id');
    if (publicId === null) {
      throw new InventoryMappingError('a fixture row is missing inventory_lot_id');
    }
    if (seenLotIds.has(publicId)) {
      throw new InventoryMappingError(`duplicate inventory lot public id ${publicId}`);
    }
    seenLotIds.add(publicId);

    const vertical = mapVertical(text(row, 'business_vertical'));
    const rawName = text(row, 'product_name');
    const rawSet = text(row, 'variant_model_set');
    const rawNumber = text(row, 'card_number');
    const rawSubject = text(row, 'featured_subject');
    const rawLanguage = text(row, 'language');

    if (rawName === null) {
      ambiguities.push({
        kind: 'missing_identity',
        publicId,
        detail: 'row has no product_name; product identity cannot be resolved',
      });
    }

    const productKey = productCanonicalKey(vertical, {
      name: rawName,
      set: rawSet,
      number: rawNumber,
      subject: rawSubject,
      language: rawLanguage,
    });

    const productAttrs: Record<string, string | null> = normalizeAttrs({
      set_name: rawSet,
      card_number: rawNumber,
      featured_subject: rawSubject,
      language: rawLanguage,
    });
    const existingProduct = products.get(productKey);
    if (!existingProduct) {
      products.set(productKey, {
        canonicalKey: productKey,
        vertical,
        displayName: normalizeIdentityField(rawName) ?? `(unnamed ${vertical} product)`,
        attrs: productAttrs,
      });
    } else if (existingProduct.vertical !== vertical) {
      ambiguities.push({
        kind: 'product_vertical_conflict',
        publicId,
        detail: `product key ${productKey} maps to both ${existingProduct.vertical} and ${vertical}`,
      });
    }
    // Track raw product facts under this normalized key.
    const pr = productRaw.get(productKey) ?? { tuples: new Set<string>(), firstLot: publicId };
    pr.tuples.add(JSON.stringify([rawName, rawSet, rawNumber, rawSubject, rawLanguage]));
    productRaw.set(productKey, pr);

    // SKU identity-driving attributes and their fingerprint (= grouping key).
    const rawSkuAttrs: SkuAttrs =
      vertical === 'footwear'
        ? {
            shoe_size: text(row, 'shoe_size'),
            apparel_size: text(row, 'apparel_size'),
            color: text(row, 'color'),
            condition_or_quality: text(row, 'condition_or_quality'),
          }
        : {
            condition_or_quality: text(row, 'condition_or_quality'),
            grading_company: text(row, 'grading_company'),
            numeric_grade: text(row, 'numeric_grade'),
            grade_designation: text(row, 'grade_designation'),
            seal_or_packaging_condition: text(row, 'seal_or_packaging_condition'),
            product_format: text(row, 'product_format') ?? text(row, 'category'),
          };
    const fingerprint = skuFingerprint(
      INVENTORY_IDENTITY_SCHEMA_VERSION,
      vertical,
      productKey,
      rawSkuAttrs
    );
    if (!skus.has(fingerprint)) {
      skus.set(fingerprint, {
        productKey,
        vertical,
        attrs: normalizeAttrs(rawSkuAttrs),
        fingerprint,
      });
    }
    const sr = skuRaw.get(fingerprint) ?? { tuples: new Set<string>(), firstLot: publicId };
    sr.tuples.add(JSON.stringify(rawSkuAttrs));
    skuRaw.set(fingerprint, sr);

    const trackingMode = mapTrackingMode(text(row, 'tracking_mode'));
    const locationCode = text(row, 'location_code');
    if (locationCode !== null) locations.add(locationCode);

    let serialized: PlannedSerializedItem | null = null;
    if (trackingMode === 'serialized') {
      serialized = {
        gradingCompany: text(row, 'grading_company'),
        certificateNumber: text(row, 'certification_number'),
        serialNumber: text(row, 'serial_number'),
      };
      serializedCount += 1;
    }

    lots.push({
      publicId,
      productKey,
      fingerprint,
      trackingMode,
      quantity: readQuantity(row),
      locationCode,
      recordOrigin: text(row, 'record_origin'),
      serialized,
    });
  }

  // Report normalized-key collisions: same normalized identity, disagreeing raw
  // facts. Reported honestly rather than silently merged on the first row.
  for (const [key, info] of productRaw) {
    if (info.tuples.size > 1) {
      ambiguities.push({
        kind: 'normalized_product_collision',
        publicId: info.firstLot,
        detail: `product key ${key} was reached by ${info.tuples.size} differing raw fact sets`,
      });
    }
  }
  for (const [fp, info] of skuRaw) {
    if (info.tuples.size > 1) {
      ambiguities.push({
        kind: 'normalized_sku_collision',
        publicId: info.firstLot,
        detail: `sku fingerprint ${fp.slice(0, 12)}… was reached by ${info.tuples.size} differing raw attribute sets`,
      });
    }
  }

  return {
    mappingVersion: INVENTORY_MAPPING_VERSION,
    identitySchemaVersion: INVENTORY_IDENTITY_SCHEMA_VERSION,
    products: [...products.values()],
    skus: [...skus.values()],
    lots,
    locations: [...locations].sort(),
    ambiguities,
    expectedLots: lots.length,
    expectedProducts: products.size,
    expectedSkus: skus.size,
    expectedSerializedItems: serializedCount,
    expectedLocations: locations.size,
  };
}

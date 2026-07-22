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
//   * Product identifies the general product (card / sealed box); Sellable SKU
//     identifies the exact interchangeable configuration (condition + grade +
//     packaging). Lots that share a configuration share a SKU.
//   * Hybrid serialization: only rows the source already tracks as serialized
//     (graded / certified units) get a serialized child. Interchangeable
//     lot-managed quantity stays lot-only. Nothing is mass-serialized.
//   * No fabricated facts: source null / "not stated" sentinels become NULL,
//     never an invented default.
//   * Ambiguity is reported, never merged away: two rows that resolve to the
//     same product key but disagree on a product-level fact are flagged.
//
// This module performs NO database access and NO network access.

import type { JsonValue } from '../provenance/hash.js';

export const INVENTORY_MAPPING_VERSION = '1.0.0';
export const INVENTORY_IDENTITY_SCHEMA_VERSION = 'IDSKU1';

export type InventoryVertical = 'tcg' | 'footwear' | 'other';
export type TrackingMode = 'lot_managed' | 'serialized';

export interface InventoryFixtureRow {
  readonly [key: string]: JsonValue;
}

export interface PlannedProduct {
  readonly canonicalKey: string;
  readonly vertical: InventoryVertical;
  readonly displayName: string;
  readonly attrs: Record<string, string | null>;
}

export interface PlannedSku {
  readonly productKey: string;
  readonly vertical: InventoryVertical;
  // The deterministic identity-driving attributes, in the same governed set the
  // database hashes into the fingerprint. Used here only to group lots.
  readonly attrs: Record<string, string | null>;
  readonly skuGroupKey: string;
}

export interface PlannedSerializedItem {
  readonly gradingCompany: string | null;
  readonly certificateNumber: string | null;
  readonly serialNumber: string | null;
}

export interface PlannedLot {
  readonly publicId: string;
  readonly productKey: string;
  readonly skuGroupKey: string;
  readonly trackingMode: TrackingMode;
  readonly quantity: number;
  readonly locationCode: string | null;
  readonly recordOrigin: string | null;
  readonly fingerprintInputs: Record<string, string | null>;
  readonly serialized: PlannedSerializedItem | null;
}

export interface MappingAmbiguity {
  readonly kind: 'product_fact_conflict' | 'missing_identity';
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

/** A stable slug for building deterministic canonical keys. */
function slug(v: string | null): string {
  return (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[|]/g, '/');
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
    const productName = text(row, 'product_name');
    const setName = text(row, 'variant_model_set');
    const cardNumber = text(row, 'card_number');
    const subject = text(row, 'featured_subject');
    const language = text(row, 'language');

    if (productName === null) {
      // Cannot identify a product without at least a name — reported, not guessed.
      ambiguities.push({
        kind: 'missing_identity',
        publicId,
        detail: 'row has no product_name; product identity cannot be resolved',
      });
    }

    // Product canonical key: the general product, independent of condition/grade.
    const productKey = [
      vertical,
      slug(productName),
      slug(setName),
      slug(cardNumber),
      slug(subject),
      slug(language),
    ].join('|');

    const productAttrs: Record<string, string | null> = {
      set_name: setName,
      card_number: cardNumber,
      featured_subject: subject,
      language,
    };
    const existingProduct = products.get(productKey);
    if (!existingProduct) {
      products.set(productKey, {
        canonicalKey: productKey,
        vertical,
        displayName: productName ?? `(unnamed ${vertical} product)`,
        attrs: productAttrs,
      });
    } else if (existingProduct.vertical !== vertical) {
      ambiguities.push({
        kind: 'product_fact_conflict',
        publicId,
        detail: `product key ${productKey} maps to both ${existingProduct.vertical} and ${vertical}`,
      });
    }

    // SKU identity-driving attributes (the exact interchangeable configuration).
    const skuAttrs: Record<string, string | null> =
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
    const skuGroupKey =
      productKey +
      '#' +
      Object.keys(skuAttrs)
        .sort()
        .map((k) => `${k}=${slug(skuAttrs[k])}`)
        .join('&');
    if (!skus.has(skuGroupKey)) {
      skus.set(skuGroupKey, { productKey, vertical, attrs: skuAttrs, skuGroupKey });
    }

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
      skuGroupKey,
      trackingMode,
      quantity: readQuantity(row),
      locationCode,
      recordOrigin: text(row, 'record_origin'),
      fingerprintInputs: skuAttrs,
      serialized,
    });
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

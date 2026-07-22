// Phase 5 inventory-identity diagnostic helpers (pure, unit-testable).
//
// The diagnostic surface is READ-ONLY and non-authoritative: it distinguishes
// the four identity grains (Product, SKU, Lot, serialized Item) plus Storage
// Location clearly, so an operator can trace an exact public id or unit scan
// code back to its governed record without any mutation path.

export type IdentityKind = 'product' | 'sku' | 'lot' | 'item' | 'location';

export interface IdentityRecord {
  readonly [key: string]: unknown;
}

export interface IdentityDescription {
  readonly kind: IdentityKind;
  readonly kindLabel: string;
  readonly publicId: string | null;
  readonly scanSku: string | null;
  /** Ordered, human-readable identity facts for this grain. */
  readonly facts: ReadonlyArray<{ label: string; value: string }>;
}

export interface LotDetailLike {
  readonly product: IdentityRecord | null;
  readonly sku: IdentityRecord | null;
  readonly lot: IdentityRecord;
  readonly location: IdentityRecord | null;
  readonly serializedChildCount: number;
  readonly capacity: number | null;
  readonly atCapacity: boolean;
}

export interface LotDetailSummary {
  /** The identity chain, top to bottom, each labeled by grain. */
  readonly chain: ReadonlyArray<{ kindLabel: string; publicId: string | null }>;
  /** e.g. "2 / 2 serialized units (full)" or "lot-managed (3)". */
  readonly capacityLabel: string;
  readonly atCapacity: boolean;
}

export interface ItemDetailLike {
  readonly product: IdentityRecord | null;
  readonly sku: IdentityRecord | null;
  readonly lot: IdentityRecord | null;
  readonly item: IdentityRecord;
  readonly location: IdentityRecord | null;
}

export interface ItemDetailSummary {
  /** The full serialized-unit chain, top to bottom, each labeled by grain. */
  readonly chain: ReadonlyArray<{ kindLabel: string; publicId: string | null }>;
  /** The unit's opaque, non-sequential scan code (or null). */
  readonly scanSku: string | null;
}

/**
 * Summarize a joined lot detail as a clearly-labeled Product → SKU → Lot →
 * Location chain plus a serialized capacity read-out — for the diagnostic panel.
 */
export function summarizeLotDetail(detail: LotDetailLike): LotDetailSummary {
  const pid = (r: IdentityRecord | null): string | null =>
    r && r['public_id'] != null ? String(r['public_id']) : null;
  const chain = [
    { kindLabel: 'Product Catalog', publicId: pid(detail.product) },
    { kindLabel: 'Sellable SKU', publicId: pid(detail.sku) },
    { kindLabel: 'Inventory Lot', publicId: pid(detail.lot) },
    { kindLabel: 'Storage Location', publicId: pid(detail.location) },
  ];
  let capacityLabel: string;
  if (detail.capacity === null) {
    capacityLabel = `lot-managed (${String(detail.lot['quantity'] ?? '')})`;
  } else {
    capacityLabel =
      `${detail.serializedChildCount} / ${detail.capacity} serialized units` +
      (detail.atCapacity ? ' (full)' : '');
  }
  return { chain, capacityLabel, atCapacity: detail.atCapacity };
}

/**
 * Summarize a joined item detail as the complete Product → SKU → Lot →
 * serialized Item → Location chain, surfacing the item's public id (in the
 * chain) and its opaque scan SKU — for the diagnostic item-chain panel.
 * Any absent grain (a fail-closed null) renders as a null public id, never a
 * fabricated one.
 */
export function summarizeItemDetail(detail: ItemDetailLike): ItemDetailSummary {
  const pid = (r: IdentityRecord | null): string | null =>
    r && r['public_id'] != null ? String(r['public_id']) : null;
  const chain = [
    { kindLabel: 'Product Catalog', publicId: pid(detail.product) },
    { kindLabel: 'Sellable SKU', publicId: pid(detail.sku) },
    { kindLabel: 'Inventory Lot', publicId: pid(detail.lot) },
    { kindLabel: 'Serialized Item', publicId: pid(detail.item) },
    { kindLabel: 'Storage Location', publicId: pid(detail.location) },
  ];
  const scan = detail.item['scan_sku'];
  return { chain, scanSku: scan != null && scan !== '' ? String(scan) : null };
}

const KIND_LABEL: Record<IdentityKind, string> = {
  product: 'Product Catalog',
  sku: 'Sellable SKU',
  lot: 'Inventory Lot',
  item: 'Serialized Item',
  location: 'Storage Location',
};

function str(record: IdentityRecord, key: string): string | null {
  const v = record[key];
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

function fact(label: string, value: string | null): { label: string; value: string } | null {
  return value === null ? null : { label, value };
}

/**
 * Produce a labeled, grain-distinguished description of one identity record.
 * Each kind surfaces the facts that make IT distinct — a Product is the general
 * item, a SKU adds the fingerprinted configuration, a Lot is the RV-C/RV-S grain
 * bound to one SKU, and a serialized Item adds the opaque scan code and cert.
 */
export function describeIdentityRecord(
  kind: IdentityKind,
  record: IdentityRecord
): IdentityDescription {
  const facts: Array<{ label: string; value: string }> = [];
  const push = (f: { label: string; value: string } | null): void => {
    if (f) facts.push(f);
  };

  switch (kind) {
    case 'product':
      push(fact('Public ID', str(record, 'public_id')));
      push(fact('Vertical', str(record, 'business_vertical')));
      push(fact('Name', str(record, 'display_name')));
      push(fact('Canonical key', str(record, 'product_canonical_key')));
      break;
    case 'sku':
      push(fact('Public ID', str(record, 'public_id')));
      push(fact('Vertical', str(record, 'business_vertical')));
      push(fact('Identity schema', str(record, 'identity_schema_version')));
      push(fact('Fingerprint', str(record, 'fingerprint')));
      push(fact('Active', str(record, 'is_active')));
      break;
    case 'lot':
      push(fact('Public ID', str(record, 'public_id')));
      push(fact('Tracking mode', str(record, 'tracking_mode')));
      push(fact('Quantity', str(record, 'quantity')));
      push(fact('Record origin', str(record, 'record_origin')));
      break;
    case 'item':
      push(fact('Public ID', str(record, 'public_id')));
      push(fact('Scan SKU', str(record, 'scan_sku')));
      push(fact('Grading company', str(record, 'grading_company')));
      push(fact('Certificate', str(record, 'certificate_number')));
      push(fact('Serial', str(record, 'serial_number')));
      break;
    case 'location':
      push(fact('Public ID', str(record, 'public_id')));
      push(fact('Code', str(record, 'location_code')));
      push(fact('Retired', str(record, 'retired_at') === null ? 'no' : 'yes'));
      break;
  }

  return {
    kind,
    kindLabel: KIND_LABEL[kind],
    publicId: str(record, 'public_id'),
    scanSku: str(record, 'scan_sku'),
    facts,
  };
}

// Category definitions for the Intake Hub.
//
// This is PRESENTATION + PAYLOAD MAPPING ONLY. It decides which fields an
// operator sees for each category and how those answers map onto the existing
// intake kernel's governed product/sku/entry attributes. It contains no rule
// engine: readiness, blockers, identity, duplicate detection, serialization
// and commit remain the server's authority exactly as before.
//
// Every attr_key emitted here is registered in intake_field_registry — the
// database rejects an ungoverned attribute, so this file cannot invent one.

export type IntakeCategoryKey =
  | 'graded_card'
  | 'raw_card'
  | 'sealed_tcg'
  | 'footwear'
  | 'apparel'
  | 'electronics'
  | 'other_collectible';

/** The governed category enum the kernel already understands. */
export type ServerCategory = 'graded_tcg' | 'raw_tcg' | 'sealed_tcg' | 'footwear' | 'other';

export type FieldKind = 'text' | 'select' | 'number' | 'textarea';

export interface CategoryFieldDef {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly options?: readonly { value: string; label: string }[];
  /** Optional fields are labelled as such; required ones are still decided by the server. */
  readonly optional?: boolean;
  readonly placeholder?: string;
  /** Scanner-first fields receive initial focus. */
  readonly autoFocus?: boolean;
}

export type CategoryValues = Record<string, string>;

export interface CategoryGroupPayload {
  readonly category: ServerCategory;
  readonly displayName: string;
  readonly quantity: number;
  readonly trackingMode: 'lot_managed' | 'serialized';
  readonly serializedChildCount: number;
  readonly productAttrs: Record<string, string>;
  readonly skuAttrs: Record<string, string>;
  readonly sourceEvidence: Record<string, string>;
  readonly locationCode: string | null;
  readonly conditionState: string | null;
  /** Set when the operator explicitly chose individual tracking. */
  readonly uniqueCondition: boolean;
}

export interface CategoryEntryPayload {
  readonly gradingCompany: string | null;
  readonly numericGrade: string | null;
  readonly gradeDesignation: string | null;
  readonly certificateNumber: string | null;
  readonly serialNumber: string | null;
  readonly entryAttrs: Record<string, string>;
}

export interface CategoryDef {
  readonly key: IntakeCategoryKey;
  readonly label: string;
  readonly blurb: string;
  readonly serverCategory: ServerCategory;
  readonly fields: readonly CategoryFieldDef[];
  /** Quantity > 1 is meaningful for this category. */
  readonly allowsQuantity: boolean;
  /** The operator may choose individual vs quantity tracking. */
  readonly allowsTrackingChoice: boolean;
  /** Default photo slots — workflow guidance, never fabricated evidence. */
  readonly photoSlots: readonly string[];
}

const clean = (v: string | undefined): string => (v ?? '').trim();
function prune(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const c = clean(v);
    if (c !== '') out[k] = c;
  }
  return out;
}

// Presentation lists that MIRROR the governed reference options. They populate
// selects for convenience; the server still rejects anything it does not govern.
export const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'AGS'] as const;

export const RAW_CONDITIONS = [
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
  'Damaged',
  // Explicitly distinct from a graded condition: never silently upgraded.
  'Unassessed',
] as const;

export const SEALED_FORMATS = [
  'Booster Pack', 'Booster Box', 'Elite Trainer Box', 'Collection Box',
  'Premium Collection', 'Tin', 'Blister', 'Bundle', 'Deck', 'Special Set',
  'Other Sealed Product',
] as const;

export const LANGUAGES = ['English', 'Japanese', 'Other'] as const;

export const FOOTWEAR_CONDITIONS = ['New', 'Used'] as const;
export const SIZE_SYSTEMS = ['US', 'UK', 'EU', 'CM'] as const;
export const BOX_STATUSES = ['Original box', 'No box', 'Damaged box', 'Replacement box'] as const;

export const GENERAL_CONDITIONS = [
  'New', 'Like New', 'Good', 'Fair', 'Poor', 'For Parts', 'Unassessed',
] as const;

export const SOURCE_KINDS = [
  { value: 'personal_collection', label: 'Personal collection' },
  { value: 'retail_purchase', label: 'Retail purchase' },
  { value: 'marketplace_purchase', label: 'Marketplace purchase' },
  { value: 'trade', label: 'Trade' },
  { value: 'consignment', label: 'Consignment' },
  { value: 'other', label: 'Other' },
] as const;

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

const SOURCE_FIELD: CategoryFieldDef = {
  key: 'source_kind', label: 'Source', kind: 'select', options: SOURCE_KINDS.map((s) => ({ ...s })),
};
const SOURCE_REF_FIELD: CategoryFieldDef = {
  key: 'source_reference', label: 'Source reference', kind: 'text', optional: true,
  placeholder: 'Order number, seller, or where it came from',
};
const NOTES_FIELD: CategoryFieldDef = {
  key: 'operator_note', label: 'Notes', kind: 'textarea', optional: true,
};
const QUANTITY_FIELD: CategoryFieldDef = { key: 'quantity', label: 'Quantity', kind: 'number' };

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: 'graded_card',
    label: 'Graded Card',
    blurb: 'A slab with a grading company and certificate number.',
    serverCategory: 'graded_tcg',
    allowsQuantity: false,
    allowsTrackingChoice: false,
    photoSlots: ['Front', 'Back', 'Label close-up'],
    fields: [
      { key: 'certificate_number', label: 'Certificate number', kind: 'text', autoFocus: true },
      { key: 'grading_company', label: 'Grading company', kind: 'select', options: opts(GRADING_COMPANIES) },
      { key: 'numeric_grade', label: 'Numeric grade', kind: 'text' },
      { key: 'grade_designation', label: 'Grade designation', kind: 'text', optional: true, placeholder: 'e.g. GEM MINT' },
      { key: 'game', label: 'Game', kind: 'text', optional: true, placeholder: 'e.g. Pokémon' },
      { key: 'card_name', label: 'Card or featured subject', kind: 'text' },
      { key: 'set_name', label: 'Set', kind: 'text' },
      { key: 'card_number', label: 'Card number', kind: 'text' },
      { key: 'language', label: 'Language', kind: 'select', options: opts(LANGUAGES), optional: true },
      { key: 'variant_or_printing', label: 'Variant or printing', kind: 'text', optional: true, placeholder: 'e.g. 1st Edition' },
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'raw_card',
    label: 'Raw Card',
    blurb: 'Ungraded singles. Identical cards share one lot with a quantity.',
    serverCategory: 'raw_tcg',
    allowsQuantity: true,
    allowsTrackingChoice: false,
    photoSlots: ['Front', 'Back'],
    fields: [
      { key: 'card_name', label: 'Card or featured subject', kind: 'text', autoFocus: true },
      { key: 'game', label: 'Game', kind: 'text', optional: true, placeholder: 'e.g. Pokémon' },
      { key: 'set_name', label: 'Set', kind: 'text' },
      { key: 'card_number', label: 'Card number', kind: 'text' },
      { key: 'language', label: 'Language', kind: 'select', options: opts(LANGUAGES), optional: true },
      { key: 'variant_or_printing', label: 'Variant or printing', kind: 'text', optional: true },
      { key: 'condition', label: 'Condition', kind: 'select', options: opts(RAW_CONDITIONS) },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'sealed_tcg',
    label: 'Sealed TCG',
    blurb: 'Boxes, packs, tins and other factory-sealed product.',
    serverCategory: 'sealed_tcg',
    allowsQuantity: true,
    allowsTrackingChoice: false,
    photoSlots: ['Front', 'Back', 'Packaging condition'],
    fields: [
      { key: 'product_name', label: 'Product name', kind: 'text', autoFocus: true },
      { key: 'game', label: 'Game', kind: 'text', optional: true },
      { key: 'set_name', label: 'Set or release', kind: 'text' },
      { key: 'product_format', label: 'Product format', kind: 'select', options: opts(SEALED_FORMATS) },
      { key: 'language', label: 'Language', kind: 'select', options: opts(LANGUAGES), optional: true },
      { key: 'packaging_condition', label: 'Packaging condition', kind: 'text', optional: true, placeholder: 'e.g. Sealed, shelf wear' },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'footwear',
    label: 'Footwear',
    blurb: 'One pair is one tracked unit.',
    serverCategory: 'footwear',
    allowsQuantity: true,
    allowsTrackingChoice: false,
    photoSlots: ['Pair', 'Left side', 'Right side', 'Size tag', 'Box label', 'Soles'],
    fields: [
      { key: 'brand', label: 'Brand', kind: 'text', autoFocus: true },
      { key: 'model', label: 'Model or silhouette', kind: 'text' },
      { key: 'style_code', label: 'Style code', kind: 'text', optional: true },
      { key: 'colorway', label: 'Colorway', kind: 'text', optional: true },
      { key: 'size_system', label: 'Size system', kind: 'select', options: opts(SIZE_SYSTEMS) },
      { key: 'size', label: 'Size', kind: 'text' },
      { key: 'condition', label: 'Condition', kind: 'select', options: opts(FOOTWEAR_CONDITIONS) },
      { key: 'box_status', label: 'Box status', kind: 'select', options: opts(BOX_STATUSES), optional: true },
      { key: 'serial_number', label: 'Serial or unique identifier', kind: 'text', optional: true },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'apparel',
    label: 'Apparel',
    blurb: 'Clothing. Track by quantity, or individually for unique pieces.',
    serverCategory: 'other',
    allowsQuantity: true,
    allowsTrackingChoice: true,
    photoSlots: ['Front', 'Back', 'Brand or size tag', 'Condition detail'],
    fields: [
      { key: 'brand', label: 'Brand', kind: 'text', autoFocus: true },
      { key: 'item_name', label: 'Item name', kind: 'text' },
      { key: 'garment_type', label: 'Garment type', kind: 'text', optional: true, placeholder: 'e.g. Hoodie, Tee' },
      { key: 'size', label: 'Size', kind: 'text' },
      { key: 'color', label: 'Color', kind: 'text', optional: true },
      { key: 'condition', label: 'Condition', kind: 'select', options: opts(GENERAL_CONDITIONS) },
      { key: 'style_code', label: 'Style code', kind: 'text', optional: true },
      { key: 'serial_number', label: 'Serial or tag identifier', kind: 'text', optional: true },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'electronics',
    label: 'Electronics',
    blurb: 'Serial-numbered devices are tracked individually.',
    serverCategory: 'other',
    allowsQuantity: true,
    allowsTrackingChoice: true,
    photoSlots: ['Front', 'Back', 'Model or serial label', 'Included accessories', 'Condition detail'],
    fields: [
      { key: 'brand', label: 'Brand', kind: 'text', autoFocus: true },
      { key: 'item_name', label: 'Product name', kind: 'text' },
      { key: 'model', label: 'Model', kind: 'text', optional: true },
      { key: 'variant', label: 'Variant', kind: 'text', optional: true },
      { key: 'condition', label: 'Condition', kind: 'select', options: opts(GENERAL_CONDITIONS) },
      { key: 'serial_number', label: 'Serial number', kind: 'text', optional: true },
      { key: 'included_accessories', label: 'Included accessories', kind: 'text', optional: true },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
  {
    key: 'other_collectible',
    label: 'Other Collectible',
    blurb: 'Anything else, with a category you choose.',
    serverCategory: 'other',
    allowsQuantity: true,
    allowsTrackingChoice: true,
    photoSlots: ['Front', 'Back', 'Identifier or condition detail'],
    fields: [
      { key: 'item_category', label: 'Category', kind: 'text', autoFocus: true, placeholder: 'e.g. Comic, Figure, Coin' },
      { key: 'item_name', label: 'Item name', kind: 'text' },
      { key: 'brand', label: 'Brand or manufacturer', kind: 'text', optional: true },
      { key: 'model', label: 'Model or variant', kind: 'text', optional: true },
      { key: 'condition', label: 'Condition', kind: 'select', options: opts(GENERAL_CONDITIONS) },
      { key: 'serial_number', label: 'Serial or identifier', kind: 'text', optional: true },
      QUANTITY_FIELD,
      SOURCE_FIELD, SOURCE_REF_FIELD, NOTES_FIELD,
    ],
  },
];

export function categoryByKey(key: IntakeCategoryKey): CategoryDef {
  const found = CATEGORIES.find((c) => c.key === key);
  if (!found) throw new Error(`unknown intake category ${key}`);
  return found;
}

/** A blank draft — every factual field visibly empty, quantity defaulted to 1. */
export function emptyValues(def: CategoryDef): CategoryValues {
  const values: CategoryValues = {};
  for (const f of def.fields) values[f.key] = f.key === 'quantity' ? '1' : '';
  if (def.allowsTrackingChoice) values.tracking_choice = 'quantity';
  values.location_code = '';
  return values;
}

/** Quantity as a positive integer, or null when the operator typed something else. */
export function parseQuantity(raw: string | undefined): number | null {
  const trimmed = clean(raw);
  if (trimmed === '') return 1;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return null;
  return n;
}

/**
 * Individual tracking is chosen, not guessed. Graded cards and footwear are
 * always serialized (the kernel requires it); apparel/electronics/collectibles
 * serialize only when the operator asks, or — for electronics — when a real
 * serial number was supplied, since that is a genuine per-unit identifier.
 */
export function resolveTracking(
  def: CategoryDef,
  values: CategoryValues
): 'serialized' | 'lot_managed' {
  if (def.key === 'graded_card' || def.key === 'footwear') return 'serialized';
  if (!def.allowsTrackingChoice) return 'lot_managed';
  if (values.tracking_choice === 'individual') return 'serialized';
  if (def.key === 'electronics' && clean(values.serial_number) !== '') return 'serialized';
  return 'lot_managed';
}

/** The human name shown on the item, receipt, label and inventory row. */
export function displayNameFor(def: CategoryDef, values: CategoryValues): string {
  switch (def.key) {
    case 'graded_card':
    case 'raw_card':
      return clean(values.card_name);
    case 'sealed_tcg':
      return clean(values.product_name);
    case 'footwear':
      return [clean(values.brand), clean(values.model)].filter(Boolean).join(' ');
    default:
      return [clean(values.brand), clean(values.item_name)].filter(Boolean).join(' ') || clean(values.item_name);
  }
}

export function buildGroupPayload(
  def: CategoryDef,
  values: CategoryValues
): CategoryGroupPayload {
  const quantity = def.allowsQuantity ? (parseQuantity(values.quantity) ?? 1) : 1;
  const tracking = resolveTracking(def, values);
  const source = clean(values.source_kind);
  const sourceRef = clean(values.source_reference);

  let productAttrs: Record<string, string> = {};
  let skuAttrs: Record<string, string> = {};

  switch (def.key) {
    case 'graded_card':
      productAttrs = prune({
        featured_subject: values.card_name,
        set_name: values.set_name,
        card_number: values.card_number,
        language: values.language,
      });
      skuAttrs = prune({
        grading_company: values.grading_company,
        numeric_grade: values.numeric_grade,
        grade_designation: values.grade_designation,
        variant_or_printing: values.variant_or_printing,
        product_format: 'Graded slab',
      });
      break;
    case 'raw_card':
      productAttrs = prune({
        featured_subject: values.card_name,
        set_name: values.set_name,
        card_number: values.card_number,
        language: values.language,
      });
      skuAttrs = prune({
        condition_or_quality: values.condition,
        variant_or_printing: values.variant_or_printing,
        product_format: 'Raw card',
      });
      break;
    case 'sealed_tcg':
      productAttrs = prune({
        featured_subject: values.product_name,
        set_name: values.set_name,
        language: values.language,
      });
      skuAttrs = prune({
        product_format: values.product_format,
        seal_or_packaging_condition: values.packaging_condition,
      });
      break;
    case 'footwear':
      productAttrs = prune({
        silhouette: values.model,
        colorway_name: values.colorway,
        style_code: values.style_code,
      });
      skuAttrs = prune({
        shoe_size: values.size,
        size_system: values.size_system,
        color: values.colorway,
        condition_or_quality: values.condition,
        box_status: values.box_status,
      });
      break;
    case 'apparel':
      productAttrs = prune({
        brand: values.brand,
        product_line: values.item_name,
        item_category: 'Apparel',
        model_number: values.style_code,
      });
      skuAttrs = prune({
        size_label: values.size,
        color: values.color,
        condition_or_quality: values.condition,
        variant_label: values.garment_type,
      });
      break;
    case 'electronics':
      productAttrs = prune({
        brand: values.brand,
        product_line: values.item_name,
        item_category: 'Electronics',
        model_number: values.model,
      });
      skuAttrs = prune({
        condition_or_quality: values.condition,
        variant_label: values.variant,
      });
      break;
    case 'other_collectible':
      productAttrs = prune({
        brand: values.brand,
        product_line: values.item_name,
        item_category: values.item_category,
        model_number: values.model,
      });
      skuAttrs = prune({
        condition_or_quality: values.condition,
        variant_label: values.model,
      });
      break;
  }

  return {
    category: def.serverCategory,
    displayName: displayNameFor(def, values),
    quantity,
    trackingMode: tracking,
    // A serialized group must expand into exactly `quantity` units.
    serializedChildCount: tracking === 'serialized' ? quantity : 0,
    productAttrs,
    skuAttrs,
    sourceEvidence: prune({ source_kind: source, source_reference: sourceRef }),
    locationCode: clean(values.location_code) || null,
    conditionState: clean(values.condition) || null,
    // Explicit operator choice, never inferred from value or category.
    uniqueCondition: def.allowsTrackingChoice && values.tracking_choice === 'individual',
  };
}

export function buildEntryPayload(
  def: CategoryDef,
  values: CategoryValues
): CategoryEntryPayload {
  const entryAttrs = prune({
    operator_note: values.operator_note,
    included_accessories: def.key === 'electronics' ? values.included_accessories : undefined,
  });
  return {
    gradingCompany: def.key === 'graded_card' ? clean(values.grading_company) || null : null,
    numericGrade: def.key === 'graded_card' ? clean(values.numeric_grade) || null : null,
    gradeDesignation: def.key === 'graded_card' ? clean(values.grade_designation) || null : null,
    certificateNumber: def.key === 'graded_card' ? clean(values.certificate_number) || null : null,
    serialNumber: clean(values.serial_number) || null,
    entryAttrs,
  };
}

/** Fields the operator must fill before the draft can even be sent. The server
 * still owns real readiness; this only avoids obviously-empty round trips. */
export function localBlockers(def: CategoryDef, values: CategoryValues): string[] {
  const problems: string[] = [];
  if (displayNameFor(def, values) === '') {
    problems.push('Enter a name so this item can be identified.');
  }
  if (def.allowsQuantity && parseQuantity(values.quantity) === null) {
    problems.push('Quantity must be a whole number of at least 1.');
  }
  return problems;
}

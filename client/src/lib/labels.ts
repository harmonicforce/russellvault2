// Inventory label content and barcode encoding.
//
// The machine-readable value is always an EXISTING governed public identifier
// — a serialized unit's scan SKU, or a lot's public id. No second barcode
// identity is minted, so anything scanned off a label resolves through the
// same lookup path as anything typed in.
//
// Barcodes are drawn as inline SVG from a self-contained Code 128-B encoder:
// no CDN, no external library, and it prints from the ordinary browser dialog.

export type LabelSize = 'compact' | 'standard' | 'sheet';

export interface LabelSizeDef {
  readonly key: LabelSize;
  readonly label: string;
  /** Physical size in millimetres, used for print CSS. */
  readonly widthMm: number;
  readonly heightMm: number;
}

export const LABEL_SIZES: readonly LabelSizeDef[] = [
  { key: 'compact', label: 'Compact label (50 × 25 mm)', widthMm: 50, heightMm: 25 },
  { key: 'standard', label: 'Address label (89 × 36 mm)', widthMm: 89, heightMm: 36 },
  { key: 'sheet', label: 'Full-page test sheet', widthMm: 190, heightMm: 30 },
];

export interface LabelView {
  readonly brand: string;
  readonly title: string;
  readonly subtitle: string | null;
  /** The value encoded in the barcode AND printed beneath it. */
  readonly code: string;
  readonly codeLabel: string;
  readonly quantityLine: string | null;
}

export const LABEL_BRAND = 'Russell Vault';

function shorten(name: string, max = 38): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export interface RecordLabelSource {
  readonly record_kind: 'item' | 'lot';
  readonly record_public_id: string;
  readonly scan_identifier: string;
  readonly product_display_name: string;
  readonly quantity: number;
}

export interface ItemLabelSource {
  readonly product_display_name: string;
  readonly scan_sku: string;
  readonly item_public_id: string;
}

export interface LotLabelSource {
  readonly product_display_name: string;
  readonly lot_public_id: string;
  readonly quantity: number;
}

/** A serialized unit is identified by its opaque scan SKU. */
export function labelForItem(row: ItemLabelSource): LabelView {
  return {
    brand: LABEL_BRAND,
    title: shorten(row.product_display_name),
    subtitle: row.item_public_id,
    code: row.scan_sku,
    codeLabel: 'Scan SKU',
    quantityLine: null,
  };
}

/** Quantity-tracked inventory is identified by its lot public id. */
export function labelForLot(row: LotLabelSource): LabelView {
  return {
    brand: LABEL_BRAND,
    title: shorten(row.product_display_name),
    subtitle: null,
    code: row.lot_public_id,
    codeLabel: 'Lot ID',
    quantityLine: `Qty ${row.quantity}`,
  };
}

/**
 * A label for a row of Current Inventory, at either grain.
 *
 * The two grains are labelled with different identifiers on purpose: an
 * individual unit carries its own opaque scan SKU, while a quantity lot
 * carries its lot id and a count. Printing a lot id on a single unit would
 * make two different physical things scan to the same record.
 */
export function labelForRecord(row: RecordLabelSource): LabelView {
  const isItem = row.record_kind === 'item';
  return {
    brand: LABEL_BRAND,
    title: shorten(row.product_display_name),
    subtitle: isItem ? row.record_public_id : null,
    code: row.scan_identifier,
    codeLabel: isItem ? 'Scan SKU' : 'Lot ID',
    quantityLine: isItem ? null : `Qty ${row.quantity}`,
  };
}

// ---- Code 128-B ------------------------------------------------------------
// Each entry is the width, in modules, of six alternating elements starting
// with a bar. The final entry (stop) carries seven.
const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** True when every character can be represented in Code 128-B (ASCII 32–126). */
export function isEncodableCode128B(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/**
 * Encode a value as alternating bar/space module widths, beginning with a bar.
 * Returns null when the value cannot be represented, so a caller renders the
 * text alone rather than a barcode that would not scan.
 */
export function code128BWidths(value: string): number[] | null {
  if (!isEncodableCode128B(value)) return null;
  const codes: number[] = [START_B];
  for (const ch of value) codes.push(ch.charCodeAt(0) - 32);

  let checksum = START_B;
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  for (const code of codes) {
    for (const digit of CODE128_PATTERNS[code]) widths.push(Number(digit));
  }
  return widths;
}

export interface BarcodeBar {
  readonly x: number;
  readonly width: number;
}

/** Bars only (spaces are the gaps), plus the total module width. */
export function code128BBars(value: string): { bars: BarcodeBar[]; totalModules: number } | null {
  const widths = code128BWidths(value);
  if (!widths) return null;
  const bars: BarcodeBar[] = [];
  let x = 0;
  widths.forEach((w, index) => {
    // Even indices are bars, odd are spaces.
    if (index % 2 === 0) bars.push({ x, width: w });
    x += w;
  });
  return { bars, totalModules: x };
}

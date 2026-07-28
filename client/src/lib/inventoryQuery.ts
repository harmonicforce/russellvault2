// The vocabulary of an inventory query: subtypes, sorts, page sizes, and the
// URL round-trip.
//
// This module is deliberately pure. Every filter and sort the operator can
// choose is named here once, translated to database columns here once, and
// read back out of the URL here once -- so a filtered view can be bookmarked
// or shared, the browser Back button restores exactly what was on screen, and
// no page of Current Inventory can drift from what the workbench counted.
//
// Nothing here filters or sorts rows. Sorting a page in the browser is what
// produced the bug this replaces: it answers "the newest of the hundred rows
// that happened to load", not "the newest". Everything below is turned into a
// query the database answers over the whole workspace.

/** The exact category of a record. Mirrors public.inventory_subtype. */
export const INVENTORY_SUBTYPES = [
  'graded_card',
  'raw_card',
  'sealed_tcg',
  'footwear',
  'apparel',
  'electronics',
  'other_collectible',
  'unclassified',
] as const;

export type InventorySubtype = (typeof INVENTORY_SUBTYPES)[number];

const SUBTYPE_LABELS: Record<InventorySubtype, string> = {
  graded_card: 'Graded Card',
  raw_card: 'Raw Card',
  sealed_tcg: 'Sealed TCG',
  footwear: 'Footwear',
  apparel: 'Apparel',
  electronics: 'Electronics',
  other_collectible: 'Other Collectible',
  unclassified: 'Unclassified',
};

/** Operator-facing name. Never shows a raw enum value. */
export function subtypeLabel(value: string | null | undefined): string {
  if (!value) return 'Unclassified';
  return SUBTYPE_LABELS[value as InventorySubtype] ?? 'Unclassified';
}

export function isInventorySubtype(value: string): value is InventorySubtype {
  return (INVENTORY_SUBTYPES as readonly string[]).includes(value);
}

/** High-level vertical, kept because it is still how identity tables partition. */
export const BUSINESS_VERTICALS = ['tcg', 'footwear', 'other'] as const;

export const VERTICAL_LABELS: Record<string, string> = {
  tcg: 'Trading cards',
  footwear: 'Footwear',
  other: 'Other',
};

// Sorting --------------------------------------------------------------------

export const SORT_KEYS = [
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
  'quantity_desc',
  'quantity_asc',
  'location',
  'condition',
  'category',
  'recently_moved',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest added',
  oldest: 'Oldest added',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
  quantity_desc: 'Quantity high to low',
  quantity_asc: 'Quantity low to high',
  location: 'Location',
  condition: 'Condition or grade',
  category: 'Category',
  recently_moved: 'Recently moved',
};

export interface SortSpec {
  readonly column: string;
  readonly ascending: boolean;
  /** Rows with no value sort last regardless of direction. */
  readonly nullsFirst: boolean;
}

/**
 * The item and lot read models name the same concept with different columns
 * (`item_created_at` vs `lot_created_at`, `lot_quantity` vs `quantity`), so
 * the translation has to know which view it is aiming at. One sort choice,
 * two correct queries.
 */
export type ReadModel = 'item' | 'lot' | 'record';

/** The column each read model uses for "when was this added". */
export function createdColumn(view: ReadModel): string {
  if (view === 'item') return 'item_created_at';
  if (view === 'lot') return 'lot_created_at';
  return 'created_at';
}

export function sortSpec(key: SortKey, view: ReadModel): SortSpec {
  const created = createdColumn(view);
  const quantity = view === 'item' ? 'lot_quantity' : 'quantity';
  const condition = view === 'record' ? 'condition_or_grade' : 'condition_or_quality';
  switch (key) {
    case 'oldest':
      return { column: created, ascending: true, nullsFirst: false };
    case 'name_asc':
      return { column: 'product_display_name', ascending: true, nullsFirst: false };
    case 'name_desc':
      return { column: 'product_display_name', ascending: false, nullsFirst: false };
    case 'quantity_desc':
      return { column: quantity, ascending: false, nullsFirst: false };
    case 'quantity_asc':
      return { column: quantity, ascending: true, nullsFirst: false };
    case 'location':
      return { column: 'location_code', ascending: true, nullsFirst: false };
    case 'condition':
      return { column: condition, ascending: true, nullsFirst: false };
    case 'category':
      return { column: 'inventory_subtype', ascending: true, nullsFirst: false };
    case 'recently_moved':
      // A record that has never moved has no move date; it belongs at the end
      // of "recently moved", not at the top.
      return { column: 'last_moved_at', ascending: false, nullsFirst: false };
    case 'newest':
    default:
      return { column: created, ascending: false, nullsFirst: false };
  }
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

// Paging ---------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export function isPageSize(n: number): n is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(n);
}

/** 1-based page → the inclusive row range PostgREST wants. */
export function rangeForPage(page: number, pageSize: number): { from: number; to: number } {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/** "Showing 51–100 of 240" — inclusive, 1-based, and honest about a short last page. */
export function describeRange(page: number, pageSize: number, total: number, shown: number): string {
  if (total === 0) return 'No matching records';
  const first = (page - 1) * pageSize + 1;
  const last = first + shown - 1;
  return `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
}

// The query the operator built ------------------------------------------------

export type InventoryScope = 'all' | 'items' | 'lots';

export interface InventoryQuery {
  readonly scope: InventoryScope;
  readonly q: string;
  readonly subtype: InventorySubtype | '';
  readonly businessVertical: string;
  readonly locationId: string;
  readonly condition: string;
  readonly gradingCompany: string;
  readonly trackingMode: '' | 'lot_managed' | 'serialized';
  readonly hasPhotos: boolean;
  readonly needsPhotos: boolean;
  readonly needsLocation: boolean;
  readonly needsConditionDetails: boolean;
  readonly recentlyAdded: boolean;
  readonly recentlyMoved: boolean;
  readonly addedFrom: string;
  readonly addedTo: string;
  readonly sort: SortKey;
  readonly page: number;
  readonly pageSize: PageSize;
}

export const EMPTY_QUERY: InventoryQuery = {
  scope: 'all',
  q: '',
  subtype: '',
  businessVertical: '',
  locationId: '',
  condition: '',
  gradingCompany: '',
  trackingMode: '',
  hasPhotos: false,
  needsPhotos: false,
  needsLocation: false,
  needsConditionDetails: false,
  recentlyAdded: false,
  recentlyMoved: false,
  addedFrom: '',
  addedTo: '',
  sort: 'newest',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

/**
 * Every field of the query except the page number. Changing any of these means
 * the operator is looking at a different set of records, so the result must go
 * back to page one rather than leaving them stranded on a page that no longer
 * exists.
 */
function filterFingerprint(query: InventoryQuery): string {
  const { page: _page, ...rest } = query;
  void _page;
  return JSON.stringify(rest);
}

export function filtersChanged(a: InventoryQuery, b: InventoryQuery): boolean {
  return filterFingerprint(a) !== filterFingerprint(b);
}

const FLAGS = [
  'hasPhotos', 'needsPhotos', 'needsLocation', 'needsConditionDetails',
  'recentlyAdded', 'recentlyMoved',
] as const;

const TEXTS = [
  'q', 'subtype', 'businessVertical', 'locationId', 'condition',
  'gradingCompany', 'trackingMode', 'addedFrom', 'addedTo',
] as const;

/** Read a query out of the URL. Unknown or malformed values fall back to the
 *  default rather than throwing: a hand-edited or stale link still loads. */
export function queryFromSearchParams(params: URLSearchParams): InventoryQuery {
  const scopeRaw = params.get('scope');
  const scope: InventoryScope =
    scopeRaw === 'items' || scopeRaw === 'lots' ? scopeRaw : 'all';

  const subtypeRaw = params.get('subtype') ?? '';
  const trackingRaw = params.get('trackingMode') ?? '';
  const sortRaw = params.get('sort') ?? '';
  const sizeRaw = Number(params.get('pageSize'));
  const pageRaw = Number(params.get('page'));

  const out: InventoryQuery = {
    ...EMPTY_QUERY,
    scope,
    q: params.get('q') ?? '',
    subtype: isInventorySubtype(subtypeRaw) ? subtypeRaw : '',
    businessVertical: params.get('businessVertical') ?? '',
    locationId: params.get('locationId') ?? '',
    condition: params.get('condition') ?? '',
    gradingCompany: params.get('gradingCompany') ?? '',
    trackingMode:
      trackingRaw === 'lot_managed' || trackingRaw === 'serialized' ? trackingRaw : '',
    hasPhotos: params.get('hasPhotos') === '1',
    needsPhotos: params.get('needsPhotos') === '1',
    needsLocation: params.get('needsLocation') === '1',
    needsConditionDetails: params.get('needsConditionDetails') === '1',
    recentlyAdded: params.get('recentlyAdded') === '1',
    recentlyMoved: params.get('recentlyMoved') === '1',
    addedFrom: params.get('addedFrom') ?? '',
    addedTo: params.get('addedTo') ?? '',
    sort: isSortKey(sortRaw) ? sortRaw : 'newest',
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    pageSize: isPageSize(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE,
  };
  return out;
}

/** Write a query into the URL, omitting everything left at its default so a
 *  shared link stays short and readable. */
export function searchParamsFromQuery(query: InventoryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.scope !== 'all') params.set('scope', query.scope);
  for (const key of TEXTS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  for (const key of FLAGS) {
    if (query[key]) params.set(key, '1');
  }
  if (query.sort !== 'newest') params.set('sort', query.sort);
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}

/** How far back "recently" reaches. Deterministic, not adaptive. */
export const RECENT_DAYS = 7;

export function recentCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The end of a calendar day, so an `addedTo` of 2026-07-28 includes that day. */
export function endOfDayIso(yyyyMmDd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  return `${yyyyMmDd}T23:59:59.999Z`;
}

export function startOfDayIso(yyyyMmDd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  return `${yyyyMmDd}T00:00:00.000Z`;
}

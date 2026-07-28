// What a filtered inventory view promises: it can be shared, it can be paged,
// and the page you are looking at is a page of the whole workspace — not a
// re-sorted sample of whatever loaded first.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE, EMPTY_QUERY, INVENTORY_SUBTYPES, describeRange, filtersChanged,
  isInventorySubtype, pageCount, queryFromSearchParams, rangeForPage,
  searchParamsFromQuery, sortSpec, subtypeLabel, type InventoryQuery,
} from './inventoryQuery';

function q(over: Partial<InventoryQuery> = {}): InventoryQuery {
  return { ...EMPTY_QUERY, ...over };
}

describe('the query survives the URL', () => {
  it('round-trips every filter it can express', () => {
    const original = q({
      scope: 'lots', q: 'charizard', subtype: 'graded_card', businessVertical: 'tcg',
      locationId: 'loc-1', condition: 'Near Mint', gradingCompany: 'PSA',
      trackingMode: 'lot_managed', hasPhotos: true, needsLocation: true,
      needsConditionDetails: true, recentlyAdded: true, recentlyMoved: true,
      addedFrom: '2026-01-01', addedTo: '2026-07-01', sort: 'quantity_desc',
      page: 4, pageSize: 100,
    });
    expect(queryFromSearchParams(searchParamsFromQuery(original))).toEqual(original);
  });

  it('leaves defaults out of the URL so a shared link stays readable', () => {
    expect(searchParamsFromQuery(EMPTY_QUERY).toString()).toBe('');
    expect(searchParamsFromQuery(q({ needsPhotos: true })).toString()).toBe('needsPhotos=1');
  });

  it('falls back to defaults rather than throwing on a hand-edited link', () => {
    const params = new URLSearchParams({
      scope: 'nonsense', subtype: 'dinosaurs', sort: 'by_vibes',
      pageSize: '7', page: '-3', trackingMode: 'sideways',
    });
    const parsed = queryFromSearchParams(params);
    expect(parsed.scope).toBe('all');
    expect(parsed.subtype).toBe('');
    expect(parsed.sort).toBe('newest');
    expect(parsed.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parsed.page).toBe(1);
    expect(parsed.trackingMode).toBe('');
  });

  it('treats any change other than the page as a different set of records', () => {
    expect(filtersChanged(q(), q({ page: 5 }))).toBe(false);
    expect(filtersChanged(q(), q({ subtype: 'apparel' }))).toBe(true);
    expect(filtersChanged(q(), q({ sort: 'oldest' }))).toBe(true);
    expect(filtersChanged(q(), q({ pageSize: 100 }))).toBe(true);
  });
});

describe('paging', () => {
  it('maps a 1-based page to an inclusive row range', () => {
    expect(rangeForPage(1, 25)).toEqual({ from: 0, to: 24 });
    expect(rangeForPage(2, 25)).toEqual({ from: 25, to: 49 });
    expect(rangeForPage(3, 100)).toEqual({ from: 200, to: 299 });
  });

  it('treats a nonsense page as the first page rather than a negative offset', () => {
    expect(rangeForPage(0, 50).from).toBe(0);
    expect(rangeForPage(-4, 50).from).toBe(0);
    expect(rangeForPage(Number.NaN, 50).from).toBe(0);
  });

  it('counts pages without leaving a remainder unreachable', () => {
    expect(pageCount(240, 50)).toBe(5);
    expect(pageCount(250, 50)).toBe(5);
    expect(pageCount(251, 50)).toBe(6);
    expect(pageCount(0, 50)).toBe(1);
  });

  it('describes the visible range honestly, including a short last page', () => {
    expect(describeRange(1, 50, 240, 50)).toBe('Showing 1–50 of 240');
    expect(describeRange(5, 50, 240, 40)).toBe('Showing 201–240 of 240');
    expect(describeRange(1, 50, 0, 0)).toBe('No matching records');
  });
});

describe('sorting is translated per read model, not applied in the browser', () => {
  it('picks the right created-at column for each view', () => {
    expect(sortSpec('newest', 'item').column).toBe('item_created_at');
    expect(sortSpec('newest', 'lot').column).toBe('lot_created_at');
    expect(sortSpec('newest', 'record').column).toBe('created_at');
    expect(sortSpec('newest', 'record').ascending).toBe(false);
    expect(sortSpec('oldest', 'record').ascending).toBe(true);
  });

  it('picks the right quantity column for each grain', () => {
    expect(sortSpec('quantity_desc', 'item').column).toBe('lot_quantity');
    expect(sortSpec('quantity_desc', 'lot').column).toBe('quantity');
    expect(sortSpec('quantity_desc', 'record').column).toBe('quantity');
  });

  it('sorts records that have never moved to the end of "recently moved"', () => {
    const spec = sortSpec('recently_moved', 'record');
    expect(spec.column).toBe('last_moved_at');
    expect(spec.ascending).toBe(false);
    expect(spec.nullsFirst).toBe(false);
  });

  it('has a translation for every sort the operator can choose', () => {
    for (const view of ['item', 'lot', 'record'] as const) {
      for (const key of ['newest', 'oldest', 'name_asc', 'name_desc', 'quantity_desc',
        'quantity_asc', 'location', 'condition', 'category', 'recently_moved'] as const) {
        expect(sortSpec(key, view).column).toBeTruthy();
      }
    }
  });
});

describe('subtypes are a closed set with operator-facing names', () => {
  it('labels every subtype without exposing the stored value', () => {
    for (const s of INVENTORY_SUBTYPES) {
      expect(subtypeLabel(s)).not.toBe(s);
      expect(subtypeLabel(s).length).toBeGreaterThan(0);
    }
  });

  it('keeps apparel, electronics and other collectible distinct', () => {
    expect(subtypeLabel('apparel')).toBe('Apparel');
    expect(subtypeLabel('electronics')).toBe('Electronics');
    expect(subtypeLabel('other_collectible')).toBe('Other Collectible');
  });

  it('never invents a category for a value it does not know', () => {
    expect(subtypeLabel('sneakers_probably')).toBe('Unclassified');
    expect(subtypeLabel(null)).toBe('Unclassified');
    expect(isInventorySubtype('sneakers_probably')).toBe(false);
  });
});

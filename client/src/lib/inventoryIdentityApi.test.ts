// Phase 5 item-chain lookup tests.
//
// createItemChainLookup is the read-only, fail-closed helper the diagnostic page
// uses to resolve a serialized unit's full Product → SKU → Lot → Item → Location
// chain from an exact scan code, a public-id lookup result, or an internal item
// id. These drive it against a fake transport (no DOM, no network) to prove the
// complete chain, a missing optional location, not-found, request failure, and
// switching from one scanned item to another.

import { describe, it, expect } from 'vitest';
import {
  createItemChainLookup,
  type InventoryIdentityTransport,
  type ItemDetail,
  type IdentityLookupResult,
} from './inventoryIdentityApi';
import type { IdentityRecord } from './inventoryIdentity';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function itemDetailFor(id: string): ItemDetail {
  return {
    product: { public_id: `RV-PROD-${id}` },
    sku: { public_id: `RV-SKU-${id}` },
    lot: { public_id: `RV-S-${id}` },
    item: { id, public_id: `RV-ITEM-${id}`, scan_sku: `RV-SCAN-${id}` },
    location: { public_id: `RV-LOC-${id}` },
    session: null,
  };
}

interface FakeOpts {
  scan?: (scanSku: string) => IdentityLookupResult;
  detail?: (itemId: string) => ItemDetail;
}

function fakeTransport(opts: FakeOpts): InventoryIdentityTransport {
  const nyi = (): never => {
    throw new Error('not implemented in this test');
  };
  return {
    listLots: async () => nyi(),
    lookupPublicId: async () => nyi(),
    lookupScan: async (_ws, scanSku) =>
      opts.scan ? opts.scan(scanSku) : nyi(),
    lotDetail: async () => nyi(),
    itemDetail: async (_ws, itemId) => (opts.detail ? opts.detail(itemId) : nyi()),
    overview: async () => nyi(),
    summary: async () => nyi(),
  };
}

describe('createItemChainLookup — resolve the serialized-item chain', () => {
  it('byScan resolves an item scan to the complete joined chain', async () => {
    const chain = createItemChainLookup(
      fakeTransport({
        scan: (s) => ({ kind: 'item', record: { id: s.replace('RV-SCAN-', '') } }),
        detail: (id) => itemDetailFor(id),
      })
    );
    const out = await chain.byScan(WS, 'RV-SCAN-1');
    expect(out.summary.chain.map((c) => c.publicId)).toEqual([
      'RV-PROD-1',
      'RV-SKU-1',
      'RV-S-1',
      'RV-ITEM-1',
      'RV-LOC-1',
    ]);
    expect(out.summary.scanSku).toBe('RV-SCAN-1');
  });

  it('renders a missing optional location as null (fail-closed rendering)', async () => {
    const detail: ItemDetail = { ...itemDetailFor('1'), location: null };
    const chain = createItemChainLookup(
      fakeTransport({
        scan: () => ({ kind: 'item', record: { id: '1' } }),
        detail: () => detail,
      })
    );
    const out = await chain.byScan(WS, 'RV-SCAN-1');
    expect(out.summary.chain[4].publicId).toBeNull();
    expect(out.summary.chain[3].publicId).toBe('RV-ITEM-1');
  });

  it('rejects (not found) when the scan resolves to nothing', async () => {
    const chain = createItemChainLookup(
      fakeTransport({
        scan: () => {
          throw new Error('no serialized item with that scan sku');
        },
      })
    );
    await expect(chain.byScan(WS, 'RV-MISSING')).rejects.toThrow(
      'no serialized item with that scan sku'
    );
  });

  it('propagates a request failure from item detail (fails closed)', async () => {
    const chain = createItemChainLookup(
      fakeTransport({
        scan: () => ({ kind: 'item', record: { id: '1' } }),
        detail: () => {
          throw new Error('request failed (400)');
        },
      })
    );
    await expect(chain.byScan(WS, 'RV-SCAN-1')).rejects.toThrow('request failed (400)');
  });

  it('refuses a lookup result that is not a serialized item', async () => {
    const chain = createItemChainLookup(
      fakeTransport({ scan: () => ({ kind: 'lot', record: { id: 'lot-1' } as IdentityRecord }) })
    );
    await expect(chain.byScan(WS, 'RV-SCAN-LOT')).rejects.toThrow('did not resolve to a serialized item');
  });

  it('changes cleanly from one scanned item to another', async () => {
    const chain = createItemChainLookup(
      fakeTransport({
        scan: (s) => ({ kind: 'item', record: { id: s.replace('RV-SCAN-', '') } }),
        detail: (id) => itemDetailFor(id),
      })
    );
    const first = await chain.byScan(WS, 'RV-SCAN-1');
    expect(first.summary.chain[3].publicId).toBe('RV-ITEM-1');
    expect(first.summary.scanSku).toBe('RV-SCAN-1');

    const second = await chain.byScan(WS, 'RV-SCAN-2');
    expect(second.summary.chain[3].publicId).toBe('RV-ITEM-2');
    expect(second.summary.scanSku).toBe('RV-SCAN-2');
    // the two resolutions do not bleed into each other
    expect(second.summary.chain).not.toEqual(first.summary.chain);
  });

  it('byItemId resolves directly by internal id', async () => {
    const chain = createItemChainLookup(fakeTransport({ detail: (id) => itemDetailFor(id) }));
    const out = await chain.byItemId(WS, '9');
    expect(out.summary.chain[3].publicId).toBe('RV-ITEM-9');
  });
});

// The drill-down predicate must be the same fact the dashboard counted.
//
// The dashboard's "needs photos" work queue counts records with no LIVE
// photograph. Current Inventory used to filter `media_count = 0`, and
// media_count counts every lifecycle — so a record whose only photograph was
// reserved-and-abandoned or deleted was counted by the queue and then missing
// from the page the queue linked to. Set equality between the two is asserted
// in the database by `supabase/tests/50_active_media_semantics.sql`; this pins
// down that the client asks for the same column.
import { describe, expect, it } from 'vitest';
import { createInventoryData, type AnyClient } from './inventoryData';

interface Recorded { table: string; eq: Array<[string, unknown]>; gt: Array<[string, unknown]> }

function recordingClient() {
  const queries: Recorded[] = [];
  const from = (table: string) => {
    const rec: Recorded = { table, eq: [], gt: [] };
    queries.push(rec);
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: self,
      eq: (col: string, val: unknown) => { rec.eq.push([col, val]); return q; },
      gt: (col: string, val: unknown) => { rec.gt.push([col, val]); return q; },
      gte: self, lte: self, ilike: self, or: self, in: self, not: self,
      order: self,
      range: () => Promise.resolve({ data: [], error: null, count: 0 }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null, count: 0 })),
    });
    return q;
  };
  return { client: { from } as unknown as AnyClient, queries };
}

describe('current inventory photo filter', () => {
  it('asks for the authoritative needs_photos column, never media_count', async () => {
    const { client, queries } = recordingClient();
    await createInventoryData(client, 'ws-1').listRecords({ needsPhotos: true });

    const overview = queries.filter((q) => q.table === 'inventory_record_overview');
    expect(overview.length).toBeGreaterThan(0);
    for (const q of overview) {
      expect(q.eq).toContainEqual(['needs_photos', true]);
      // The old predicate must be gone, or the two surfaces diverge again.
      expect(q.eq.map(([col]) => col)).not.toContain('media_count');
      expect(q.gt.map(([col]) => col)).not.toContain('media_count');
    }
  });

  it('uses the same column, negated, for the has-photos filter', async () => {
    const { client, queries } = recordingClient();
    await createInventoryData(client, 'ws-1').listRecords({ hasPhotos: true });
    for (const q of queries.filter((x) => x.table === 'inventory_record_overview')) {
      expect(q.eq).toContainEqual(['needs_photos', false]);
      expect(q.gt.map(([col]) => col)).not.toContain('media_count');
    }
  });

  it('stays workspace-scoped while filtering', async () => {
    const { client, queries } = recordingClient();
    await createInventoryData(client, 'ws-42').listRecords({ needsPhotos: true });
    for (const q of queries.filter((x) => x.table === 'inventory_record_overview')) {
      expect(q.eq).toContainEqual(['workspace_id', 'ws-42']);
    }
  });

  it('does not apply a photo predicate when neither filter is set', async () => {
    const { client, queries } = recordingClient();
    await createInventoryData(client, 'ws-1').listRecords({});
    for (const q of queries.filter((x) => x.table === 'inventory_record_overview')) {
      expect(q.eq.map(([col]) => col)).not.toContain('needs_photos');
    }
  });
});

// A bulk move is a batch of individual governed moves. These tests hold it to
// what that means: no silent partial success, no record moved twice, no
// pretence that one failure undoes the moves that worked.
import { describe, expect, it, vi } from 'vitest';
import {
  planMove, recordsToRetry, runMovePlan, summarize,
  type Destination, type MovableRecord,
} from './bulkMove';

function item(over: Partial<MovableRecord> = {}): MovableRecord {
  return {
    record_kind: 'item',
    record_id: 'i-1',
    record_public_id: 'RV-I-0000000001',
    product_display_name: 'Charizard',
    tracking_mode: 'serialized',
    quantity: 1,
    location_id: 'loc-1',
    location_code: 'SHELF-1',
    location_display_name: 'Shelf One',
    ...over,
  };
}

function lot(over: Partial<MovableRecord> = {}): MovableRecord {
  return {
    record_kind: 'lot',
    record_id: 'l-1',
    record_public_id: 'RV-L-0000000001',
    product_display_name: 'Jungle Booster Box',
    tracking_mode: 'lot_managed',
    quantity: 12,
    location_id: 'loc-1',
    location_code: 'SHELF-1',
    location_display_name: 'Shelf One',
    ...over,
  };
}

const shelf2: Destination = {
  id: 'loc-2', location_code: 'SHELF-2', display_name: 'Shelf Two', retired_at: null,
};
const retired: Destination = {
  id: 'loc-9', location_code: 'SHELF-9', display_name: 'Old Shelf',
  retired_at: '2026-07-01T00:00:00.000Z',
};

describe('what a bulk move refuses to do', () => {
  it('refuses a retired destination', () => {
    const plan = planMove([item()], retired);
    expect(plan.blocker).toMatch(/retired/i);
  });

  it('refuses to run without a destination', () => {
    expect(planMove([item()], null).blocker).toMatch(/where/i);
  });

  it('refuses to move a serialized parent lot', () => {
    // Its units carry their own locations; moving the parent would claim a
    // move that did not happen to the things on the shelf.
    const plan = planMove([lot({ tracking_mode: 'serialized' })], shelf2);
    expect(plan.eligibleCount).toBe(0);
    expect(plan.moves[0].reason).toBe('serialized_parent_lot');
  });

  it('excludes a record that is already in the destination', () => {
    // A movement event recording no movement is noise in an audit trail.
    const plan = planMove([item({ location_id: 'loc-2' })], shelf2);
    expect(plan.eligibleCount).toBe(0);
    expect(plan.moves[0].reason).toBe('already_there');
  });

  it('blocks when nothing in the selection can move', () => {
    const plan = planMove([item({ location_id: 'loc-2' })], shelf2);
    expect(plan.blocker).toMatch(/none/i);
  });

  it('allows a mixed selection, because each grain has its own function', () => {
    const plan = planMove([item(), lot()], shelf2);
    expect(plan.eligibleCount).toBe(2);
    expect(plan.blocker).toBeNull();
  });
});

describe('running the plan', () => {
  it('sends each grain through its own governed function', async () => {
    const moveItem = vi.fn().mockResolvedValue(undefined);
    const moveLot = vi.fn().mockResolvedValue(undefined);
    const plan = planMove([item(), lot()], shelf2);

    await runMovePlan(plan, { moveItem, moveLot }, 'restock');

    expect(moveItem).toHaveBeenCalledExactlyOnceWith('i-1', 'SHELF-2', 'restock');
    expect(moveLot).toHaveBeenCalledExactlyOnceWith('l-1', 'SHELF-2', 'restock');
  });

  it('never calls a move for an ineligible record', async () => {
    const moveItem = vi.fn().mockResolvedValue(undefined);
    const moveLot = vi.fn().mockResolvedValue(undefined);
    const plan = planMove([item({ location_id: 'loc-2' }), lot()], shelf2);

    const results = await runMovePlan(plan, { moveItem, moveLot }, null);

    expect(moveItem).not.toHaveBeenCalled();
    expect(results.find((r) => r.record.record_id === 'i-1')!.outcome.state).toBe('skipped');
  });

  it('keeps the records that moved when a later one fails', async () => {
    const moveItem = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('location is retired'));
    const moveLot = vi.fn().mockResolvedValue(undefined);
    const plan = planMove(
      [item({ record_id: 'i-1' }), item({ record_id: 'i-2', record_public_id: 'RV-I-2' })],
      shelf2
    );

    const results = await runMovePlan(plan, { moveItem, moveLot }, null);

    expect(results[0].outcome.state).toBe('moved');
    expect(results[1].outcome).toEqual({ state: 'failed', message: 'location is retired' });
    // The batch did not abandon the rest, and did not un-move the first.
    expect(summarize(results)).toEqual({
      moved: 1, failed: 1, skipped: 0, allSucceeded: false,
    });
  });

  it('reports a result for every record, always', async () => {
    const moveItem = vi.fn().mockRejectedValue(new Error('nope'));
    const moveLot = vi.fn().mockResolvedValue(undefined);
    const records = [item({ record_id: 'i-1' }), lot(), item({ record_id: 'i-3', location_id: 'loc-2' })];
    const plan = planMove(records, shelf2);

    const results = await runMovePlan(plan, { moveItem, moveLot }, null);

    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.record.record_id))).toEqual(new Set(['i-1', 'l-1', 'i-3']));
  });

  it('reports progress as it goes', async () => {
    const onProgress = vi.fn();
    const plan = planMove([item(), lot()], shelf2);
    await runMovePlan(
      plan,
      { moveItem: vi.fn().mockResolvedValue(undefined), moveLot: vi.fn().mockResolvedValue(undefined) },
      null,
      onProgress
    );
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('refuses to run at all without a destination', async () => {
    await expect(
      runMovePlan(planMove([item()], null), {
        moveItem: vi.fn(), moveLot: vi.fn(),
      }, null)
    ).rejects.toThrow(/destination/i);
  });
});

describe('retrying', () => {
  it('retries the failures and nothing else', async () => {
    const moveItem = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('transient'));
    const plan = planMove(
      [item({ record_id: 'i-1' }), item({ record_id: 'i-2', record_public_id: 'RV-I-2' })],
      shelf2
    );
    const first = await runMovePlan(plan, { moveItem, moveLot: vi.fn() }, null);

    const retry = recordsToRetry(first);
    expect(retry.map((r) => r.record_id)).toEqual(['i-2']);

    // A record that already moved is not offered again — moving it twice would
    // write a second movement event for one physical move.
    expect(retry.some((r) => r.record_id === 'i-1')).toBe(false);
  });

  it('offers nothing to retry when everything succeeded', async () => {
    const plan = planMove([item()], shelf2);
    const results = await runMovePlan(
      plan, { moveItem: vi.fn().mockResolvedValue(undefined), moveLot: vi.fn() }, null
    );
    expect(recordsToRetry(results)).toEqual([]);
    expect(summarize(results).allSucceeded).toBe(true);
  });
});

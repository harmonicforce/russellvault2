// Moving several records in one operation.
//
// This is a batch of individual governed moves, and it says so. Each record
// goes through the same move_inventory_item / move_inventory_lot function a
// single move uses, produces its own immutable movement event, and reports its
// own result. There is no transaction spanning unrelated records, so this code
// never claims one: if the fourth record fails, the first three stay moved and
// are reported as moved.
//
// What is deliberately NOT here: partial quantity movement. Taking six of
// twelve units to another shelf is a lot split, which is a different governed
// operation with its own lineage. Letting it hide inside a generic "move
// selected" would silently rewrite a lot's identity.

export interface MovableRecord {
  readonly record_kind: 'item' | 'lot';
  readonly record_id: string;
  readonly record_public_id: string;
  readonly product_display_name: string;
  readonly tracking_mode: 'lot_managed' | 'serialized';
  readonly quantity: number;
  readonly location_id: string | null;
  readonly location_code: string | null;
  readonly location_display_name: string | null;
}

export interface Destination {
  readonly id: string;
  readonly location_code: string;
  readonly display_name: string | null;
  readonly retired_at: string | null;
}

export type IneligibleReason =
  | 'serialized_parent_lot'
  | 'already_there';

export interface PlannedMove {
  readonly record: MovableRecord;
  readonly eligible: boolean;
  readonly reason: IneligibleReason | null;
}

export interface MovePlan {
  readonly destination: Destination | null;
  readonly moves: readonly PlannedMove[];
  readonly eligibleCount: number;
  /** Why the operator cannot press Move yet, in their words. */
  readonly blocker: string | null;
}

export function explainIneligible(reason: IneligibleReason): string {
  switch (reason) {
    case 'serialized_parent_lot':
      return 'Individually tracked units move one by one, not as their parent group.';
    case 'already_there':
      return 'Already in this location.';
  }
}

/**
 * Decide what a bulk move would actually do, before anything is written.
 *
 * A record already sitting in the destination is excluded rather than moved:
 * a movement event that records no movement is noise in a history that is
 * supposed to be evidence.
 */
export function planMove(
  records: readonly MovableRecord[],
  destination: Destination | null
): MovePlan {
  const moves: PlannedMove[] = records.map((record) => {
    // A serialized lot is the parent of individually tracked units; the units
    // carry their own locations. It cannot appear in Current Inventory, but a
    // stale selection or a hand-built link could still reach here.
    if (record.record_kind === 'lot' && record.tracking_mode === 'serialized') {
      return { record, eligible: false, reason: 'serialized_parent_lot' as const };
    }
    if (destination && record.location_id === destination.id) {
      return { record, eligible: false, reason: 'already_there' as const };
    }
    return { record, eligible: true, reason: null };
  });

  const eligibleCount = moves.filter((m) => m.eligible).length;

  let blocker: string | null = null;
  if (records.length === 0) {
    blocker = 'Nothing selected.';
  } else if (!destination) {
    blocker = 'Choose where these records are going.';
  } else if (destination.retired_at) {
    blocker = 'That location is retired. Choose an active location.';
  } else if (eligibleCount === 0) {
    blocker = 'None of the selected records can move to that location.';
  }

  return { destination, moves, eligibleCount, blocker };
}

export type MoveOutcome =
  | { readonly state: 'moved' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'skipped'; readonly reason: IneligibleReason };

export interface MoveResult {
  readonly record: MovableRecord;
  readonly outcome: MoveOutcome;
}

export interface MoveTransport {
  moveItem(itemId: string, toLocationCode: string, note: string | null): Promise<void>;
  moveLot(lotId: string, toLocationCode: string, note: string | null): Promise<void>;
}

/**
 * Run the plan, one governed call per record, and report every record's own
 * outcome. Runs sequentially: these are writes against shared location state,
 * and a readable per-record result is worth more than saving a second.
 *
 * A rejected record does not stop the batch. The operator asked for the other
 * nine to move, and abandoning them because one failed would be a worse answer
 * than moving nine and saying so.
 */
export async function runMovePlan(
  plan: MovePlan,
  transport: MoveTransport,
  note: string | null,
  onProgress?: (done: number, total: number) => void
): Promise<MoveResult[]> {
  const destination = plan.destination;
  if (!destination) throw new Error('A destination is required.');

  const results: MoveResult[] = [];
  let done = 0;
  for (const planned of plan.moves) {
    if (!planned.eligible) {
      results.push({ record: planned.record, outcome: { state: 'skipped', reason: planned.reason! } });
      done += 1;
      onProgress?.(done, plan.moves.length);
      continue;
    }
    try {
      if (planned.record.record_kind === 'item') {
        await transport.moveItem(planned.record.record_id, destination.location_code, note);
      } else {
        await transport.moveLot(planned.record.record_id, destination.location_code, note);
      }
      results.push({ record: planned.record, outcome: { state: 'moved' } });
    } catch (e) {
      results.push({
        record: planned.record,
        outcome: { state: 'failed', message: (e as Error).message },
      });
    }
    done += 1;
    onProgress?.(done, plan.moves.length);
  }
  return results;
}

export interface MoveSummary {
  readonly moved: number;
  readonly failed: number;
  readonly skipped: number;
  readonly allSucceeded: boolean;
}

export function summarize(results: readonly MoveResult[]): MoveSummary {
  const moved = results.filter((r) => r.outcome.state === 'moved').length;
  const failed = results.filter((r) => r.outcome.state === 'failed').length;
  const skipped = results.filter((r) => r.outcome.state === 'skipped').length;
  return { moved, failed, skipped, allSucceeded: failed === 0 && moved > 0 };
}

/** The records a retry should attempt: the ones that failed, and only those. */
export function recordsToRetry(results: readonly MoveResult[]): MovableRecord[] {
  return results.filter((r) => r.outcome.state === 'failed').map((r) => r.record);
}

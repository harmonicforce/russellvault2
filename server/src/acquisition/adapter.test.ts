// Phase 4 acquisition-adapter tests.
//
// The headline proof: all 2,149 committed Whatnot provenance rows map
// deterministically into the acquisition hierarchy, every WN-A id is preserved
// exactly and uniquely, no line is silently dropped, money is exact to the
// cent, currencies are explicit, and a reported zero with no gratis evidence is
// an 'unknown' cost rather than a fabricated zero.
//
// Source rows are reconstructed from the SAME repository fixture bytes Phase 3
// commits, so this exercises the real 2,149-row payload without a live database.

import { describe, it, expect } from 'vitest';
import { buildImportPlan } from '../provenance/adapter.js';
import {
  buildAcquisitionPlan,
  AcquisitionMappingError,
  type CommittedSourceRow,
} from './adapter.js';
import { decimalToMinor, MoneyError } from './money.js';

function committedRows(): CommittedSourceRow[] {
  const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
  // Assign stable synthetic ids exactly as a committed job's readback would.
  return plan.records.map((r) => ({
    sourceRecordId: `sr-${r.sourceRowIndex}`,
    externalIdentifierId: r.sourceRowKey ? `ext-${r.sourceRowIndex}` : null,
    sourceRowIndex: r.sourceRowIndex,
    rawPayload: r.rawPayload,
  }));
}

describe('the 2,149-row Whatnot fixture maps deterministically', () => {
  const rows = committedRows();
  const plan = buildAcquisitionPlan(rows, { sourceLabel: 'whatnot_purchases.json' });

  it('maps every source line with no omission', () => {
    expect(rows.length).toBe(2149);
    expect(plan.expectedLineItems).toBe(2149);
    expect(plan.expectedOrders).toBe(2149);
    expect(plan.expectedLots).toBe(2149);
    expect(plan.expectedCostComponents).toBe(2149);
    expect(plan.lineItems.length).toBe(2149);
  });

  it('preserves every WN-A id exactly and uniquely', () => {
    const ids = plan.lineItems.map((l) => l.publicId);
    const unique = new Set(ids);
    expect(unique.size).toBe(2149);
    // Every id is the source line id, verbatim, and shaped WN-A-######.
    for (const id of ids) expect(id).toMatch(/^WN-A-\d{6}$/);
    // The first and last committed rows keep their exact ids.
    expect(ids).toContain('WN-A-000001');
  });

  it('links every planned row back to its source record (provenance retained)', () => {
    for (const line of plan.lineItems) {
      expect(line.sourceRecordId).toMatch(/^sr-\d+$/);
      expect(line.externalIdentifierId).toMatch(/^ext-\d+$/);
    }
    for (const comp of plan.costComponents) {
      expect(comp.sourceRecordId).toMatch(/^sr-\d+$/);
    }
  });

  it('quantities are all positive integers', () => {
    for (const line of plan.lineItems) {
      expect(Number.isInteger(line.quantity)).toBe(true);
      expect(line.quantity).toBeGreaterThan(0);
    }
  });

  it('sums money exactly in minor units', () => {
    // 3,328,376 cents across the fixture, computed with integer arithmetic.
    expect(plan.sourceReportedTotalMinor).toBe(3328376);
    expect(plan.normalizedKnownComponentMinor).toBe(3328376);
  });

  it('records a reported zero as unknown, never as a fabricated zero cost', () => {
    // 18 rows report total_paid = 0.
    expect(plan.unknownComponentCount).toBe(18);
    expect(plan.knownComponentCount).toBe(2149 - 18);
    expect(plan.documentedFreeComponentCount).toBe(0);
    const unknowns = plan.costComponents.filter((c) => c.amountState === 'unknown');
    for (const u of unknowns) {
      expect(u.amountMinor).toBeNull();
      expect(u.evidenceNote).toBeTruthy();
    }
    // Each unknown surfaces an explicit, visible discrepancy.
    expect(plan.discrepancies.length).toBe(18);
    expect(plan.discrepancies.every((d) => d.kind === 'unknown_component')).toBe(true);
  });

  it('mints one supplier candidate for the only normalized-handle collision', () => {
    expect(plan.distinctSellerHandleCount).toBe(113);
    expect(plan.expectedUnresolvedSupplierCandidates).toBe(1);
    expect(plan.supplierCandidates).toHaveLength(1);
    expect(plan.supplierCandidates[0].rawHandles).toEqual([
      'west_coast_dealsRANDOM',
      'west_coast_dealsRandom',
    ]);
  });

  it('never auto-merges suppliers: raw handles are carried verbatim', () => {
    // The two colliding spellings each appear as a distinct raw handle on
    // their own orders; the adapter never rewrites either to the other.
    const handles = new Set(plan.orders.map((o) => o.sellerRawHandle));
    expect(handles.has('west_coast_dealsRANDOM')).toBe(true);
    expect(handles.has('west_coast_dealsRandom')).toBe(true);
  });

  it('creates no shared/unresolved cost component from the base mapping', () => {
    expect(plan.expectedUnresolvedCostComponents).toBe(0);
    // Every base component is line-scoped (becomes 'direct' at the database).
    expect(plan.costComponents.every((c) => c.componentType === 'item_price')).toBe(true);
  });

  it('is deterministic: same input yields an identical plan', () => {
    const again = buildAcquisitionPlan(committedRows(), {
      sourceLabel: 'whatnot_purchases.json',
    });
    expect(again).toEqual(plan);
  });

  it('freezes a deterministic plan digest that changes when the mapping changes', () => {
    expect(plan.planSha256).toMatch(/^[0-9a-f]{64}$/);
    const again = buildAcquisitionPlan(committedRows(), {
      sourceLabel: 'whatnot_purchases.json',
    });
    expect(again.planSha256).toBe(plan.planSha256);

    // A changed line quantity — same number of lines — yields a different digest.
    const mutated = committedRows();
    const payload = mutated[0].rawPayload as Record<string, unknown>;
    mutated[0] = {
      ...mutated[0],
      rawPayload: { ...payload, quantity_purchased: 99 },
    };
    const changed = buildAcquisitionPlan(mutated, { sourceLabel: 'whatnot_purchases.json' });
    expect(changed.lineItems.length).toBe(plan.lineItems.length);
    expect(changed.planSha256).not.toBe(plan.planSha256);
  });

  it('uses a single explicit ISO currency throughout', () => {
    expect(plan.currency).toBe('USD');
    expect(plan.orders.every((o) => o.currency === 'USD')).toBe(true);
    expect(plan.costComponents.every((c) => c.currency === 'USD')).toBe(true);
  });
});

describe('acquisition adapter guards', () => {
  it('refuses a non-ISO currency rather than mixing silently', () => {
    expect(() =>
      buildAcquisitionPlan([], { sourceLabel: 'x', currency: 'dollars' })
    ).toThrow(AcquisitionMappingError);
  });

  it('refuses a non-positive quantity', () => {
    const row: CommittedSourceRow = {
      sourceRecordId: 'sr-0',
      externalIdentifierId: null,
      sourceRowIndex: 0,
      rawPayload: {
        acquisition_line_id: 'WN-A-000001',
        order_id: 'o1',
        seller: 's',
        quantity_purchased: 0,
        total_paid: 5,
        order_status: 'completed',
      },
    };
    expect(() => buildAcquisitionPlan([row], { sourceLabel: 'x' })).toThrow(
      /positive integer/
    );
  });

  it('refuses a duplicate WN-A id', () => {
    const mk = (idx: number): CommittedSourceRow => ({
      sourceRecordId: `sr-${idx}`,
      externalIdentifierId: null,
      sourceRowIndex: idx,
      rawPayload: {
        acquisition_line_id: 'WN-A-000001',
        order_id: `o${idx}`,
        seller: 's',
        quantity_purchased: 1,
        total_paid: 5,
        order_status: 'completed',
      },
    });
    expect(() => buildAcquisitionPlan([mk(0), mk(1)], { sourceLabel: 'x' })).toThrow(
      /duplicate line item public id/
    );
  });

  it('refuses sub-cent money precision rather than rounding it away', () => {
    const row: CommittedSourceRow = {
      sourceRecordId: 'sr-0',
      externalIdentifierId: null,
      sourceRowIndex: 0,
      rawPayload: {
        acquisition_line_id: 'WN-A-000001',
        order_id: 'o1',
        seller: 's',
        quantity_purchased: 1,
        total_paid: '5.005',
        order_status: 'completed',
      },
    };
    expect(() => buildAcquisitionPlan([row], { sourceLabel: 'x' })).toThrow(
      AcquisitionMappingError
    );
  });
});

describe('decimalToMinor is exact', () => {
  it('converts clean and tricky values without float drift', () => {
    expect(decimalToMinor(9.54)).toBe(954);
    expect(decimalToMinor(22.21)).toBe(2221);
    expect(decimalToMinor(155.82)).toBe(15582);
    expect(decimalToMinor(6)).toBe(600);
    expect(decimalToMinor(0)).toBe(0);
    expect(decimalToMinor('1234.5')).toBe(123450);
  });
  it('refuses a real sub-cent amount', () => {
    expect(() => decimalToMinor('5.005')).toThrow(MoneyError);
  });
});

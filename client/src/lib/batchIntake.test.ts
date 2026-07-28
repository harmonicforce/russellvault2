// Batch grid behaviour: paste parsing, row isolation, retry safety, and the
// summary the operator sees at the end.
import { describe, expect, it } from 'vitest';
import { categoryByKey } from './intakeCategories';
import {
  MAX_BATCH_ROWS, appendRows, applyShared, batchSummary, deserializeDraft, duplicateRow,
  fillDown, gridColumns, isRowEmpty, newRow, parsePastedRows, pasteHeaderLine, pendingRows,
  removeRow, rowBlockers, serializeDraft, totalUnitsPlanned, updateRowValue,
  type BatchRow,
} from './batchIntake';

const raw = categoryByKey('raw_card');
const graded = categoryByKey('graded_card');

function rowWith(def: typeof raw, over: Record<string, string>): BatchRow {
  return newRow(def, { ...newRow(def).values, ...over });
}

describe('grid columns', () => {
  it('excludes the batch-wide source fields so they are not repeated per row', () => {
    const keys = gridColumns(raw).map((c) => c.key);
    expect(keys).not.toContain('source_kind');
    expect(keys).not.toContain('source_reference');
    expect(keys).toContain('card_name');
  });

  it('publishes a header line matching the column order', () => {
    expect(pasteHeaderLine(raw).split('\t')).toEqual(gridColumns(raw).map((c) => c.label));
  });
});

describe('paste parsing', () => {
  it('maps tab-separated cells positionally onto the columns', () => {
    const parsed = parsePastedRows(raw, 'Pikachu\tPokémon\tJungle\t60');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card_name).toBe('Pikachu');
    expect(parsed[0].set_name).toBe('Jungle');
    expect(parsed[0].card_number).toBe('60');
  });

  it('ignores a repeated header row so a copied block just works', () => {
    const text = `${pasteHeaderLine(raw)}\nPikachu\tPokémon\tJungle\t60`;
    const parsed = parsePastedRows(raw, text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card_name).toBe('Pikachu');
  });

  it('handles CRLF line endings and skips blank lines', () => {
    const parsed = parsePastedRows(raw, 'Pikachu\r\n\r\nCharizard\r\n');
    expect(parsed.map((p) => p.card_name)).toEqual(['Pikachu', 'Charizard']);
  });

  it('drops extra columns rather than landing them in the wrong field', () => {
    const many = Array.from({ length: gridColumns(raw).length + 4 }, (_, i) => `v${i}`).join('\t');
    const parsed = parsePastedRows(raw, many);
    expect(Object.keys(parsed[0])).toEqual(expect.arrayContaining(['card_name']));
    expect(parsed[0].card_name).toBe('v0');
  });

  it('returns nothing for empty input', () => {
    expect(parsePastedRows(raw, '   \n  ')).toEqual([]);
  });
});

describe('row ceiling', () => {
  it('refuses to grow a batch past the maximum and reports what it skipped', () => {
    const existing = Array.from({ length: MAX_BATCH_ROWS - 2 }, () => newRow(raw));
    const incoming = Array.from({ length: 5 }, () => newRow(raw).values);
    const { rows, skipped } = appendRows(raw, existing, incoming);
    expect(rows).toHaveLength(MAX_BATCH_ROWS);
    expect(skipped).toBe(3);
  });
});

describe('grid edits', () => {
  it('fills a value down into later rows only', () => {
    const rows = [
      rowWith(raw, { set_name: 'Jungle' }),
      rowWith(raw, { set_name: '' }),
      rowWith(raw, { set_name: '' }),
    ];
    const filled = fillDown(rows, 0, 'set_name');
    expect(filled.map((r) => r.values.set_name)).toEqual(['Jungle', 'Jungle', 'Jungle']);
  });

  it('never rewrites a row that was already added', () => {
    const rows: BatchRow[] = [
      rowWith(raw, { set_name: 'Jungle' }),
      { ...rowWith(raw, { set_name: 'Base Set' }), status: 'committed' },
    ];
    const filled = fillDown(rows, 0, 'set_name');
    expect(filled[1].values.set_name).toBe('Base Set');
  });

  it('duplicating a row gives it a fresh identity and no server draft', () => {
    const rows: BatchRow[] = [{ ...rowWith(raw, { card_name: 'Pikachu' }), groupId: 'g-1' }];
    const next = duplicateRow(rows, 0);
    expect(next).toHaveLength(2);
    expect(next[1].values.card_name).toBe('Pikachu');
    expect(next[1].id).not.toBe(next[0].id);
    // Critical: a copy must not reuse the original's draft or key, or
    // committing it would replay the original instead of creating a new record.
    expect(next[1].idempotencyKey).not.toBe(next[0].idempotencyKey);
    expect(next[1].groupId).toBeUndefined();
  });

  it('editing a failed row clears its outcome so it can be retried', () => {
    const rows: BatchRow[] = [{ ...rowWith(raw, {}), status: 'failed', messages: ['boom'] }];
    const next = updateRowValue(rows, 0, 'card_name', 'Pikachu');
    expect(next[0].status).toBe('draft');
    expect(next[0].messages).toEqual([]);
  });

  it('a committed row cannot be edited', () => {
    const rows: BatchRow[] = [{ ...rowWith(raw, { card_name: 'Pikachu' }), status: 'committed' }];
    const next = updateRowValue(rows, 0, 'card_name', 'Charizard');
    expect(next[0].values.card_name).toBe('Pikachu');
  });

  it('removes the intended row', () => {
    const rows = [rowWith(raw, { card_name: 'A' }), rowWith(raw, { card_name: 'B' })];
    expect(removeRow(rows, 0).map((r) => r.values.card_name)).toEqual(['B']);
  });
});

describe('shared batch settings', () => {
  it('applies location and source to every row that will still be sent', () => {
    const rows: BatchRow[] = [
      rowWith(raw, {}),
      { ...rowWith(raw, {}), status: 'committed' },
    ];
    const next = applyShared(rows, {
      locationCode: 'BIN-2', sourceKind: 'retail_purchase', sourceReference: 'INV-9',
    });
    expect(next[0].values.location_code).toBe('BIN-2');
    expect(next[0].values.source_kind).toBe('retail_purchase');
    // The committed row keeps exactly what it was committed with.
    expect(next[1].values.location_code).toBe('');
  });
});

describe('what gets sent', () => {
  it('skips already-committed rows and untouched blank rows', () => {
    const rows: BatchRow[] = [
      rowWith(raw, { card_name: 'Pikachu' }),
      { ...rowWith(raw, { card_name: 'Done' }), status: 'committed' },
      newRow(raw),
    ];
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(1);
    expect(pending[0].values.card_name).toBe('Pikachu');
  });

  it('treats a row with only defaults as empty', () => {
    expect(isRowEmpty(newRow(raw))).toBe(true);
    expect(isRowEmpty(rowWith(raw, { card_name: 'Pikachu' }))).toBe(false);
  });

  it('counts planned units from quantities, not row count', () => {
    const rows = [
      rowWith(raw, { card_name: 'A', quantity: '3' }),
      rowWith(raw, { card_name: 'B', quantity: '2' }),
    ];
    expect(totalUnitsPlanned(rows)).toBe(5);
  });
});

describe('row validation', () => {
  it('requires a certificate number on a graded card', () => {
    const row = rowWith(graded, { card_name: 'Blastoise' });
    expect(rowBlockers(graded, row).join(' ')).toMatch(/certificate number is required/i);
  });

  it('accepts a graded row once the certificate is present', () => {
    const row = rowWith(graded, { card_name: 'Blastoise', certificate_number: 'PSA-1' });
    expect(rowBlockers(graded, row)).toEqual([]);
  });
});

describe('batch summary', () => {
  it('counts each outcome independently so one bad row does not hide the good ones', () => {
    const rows: BatchRow[] = [
      { ...rowWith(raw, { card_name: 'A' }), status: 'committed', result: { unitsCreated: 3, lotPublicId: 'RV-C-1' } },
      { ...rowWith(raw, { card_name: 'B' }), status: 'committed', result: { unitsCreated: 1, lotPublicId: 'RV-C-2' } },
      { ...rowWith(raw, { card_name: 'C' }), status: 'duplicate' },
      { ...rowWith(raw, { card_name: 'D' }), status: 'blocked' },
      { ...rowWith(raw, { card_name: 'E' }), status: 'failed' },
      rowWith(raw, { quantity: 'x' }),
      newRow(raw),
    ];
    const summary = batchSummary(raw, rows);
    expect(summary.committed).toBe(2);
    expect(summary.unitsCreated).toBe(4);
    expect(summary.duplicates).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.incomplete).toBe(1);
    expect(summary.labelsAvailable).toBe(2);
    // The untouched blank row is ignored entirely.
    expect(summary.totalRows).toBe(6);
  });
});

describe('draft persistence and retry safety', () => {
  it('round-trips a draft, preserving idempotency keys and draft ids', () => {
    const rows: BatchRow[] = [{ ...rowWith(raw, { card_name: 'Pikachu' }), groupId: 'g-7' }];
    const restored = deserializeDraft(serializeDraft({
      categoryKey: 'raw_card', rows,
      sharedLocationCode: 'BIN-2', sharedSourceKind: 'trade', sharedSourceReference: '',
    }));
    expect(restored).not.toBeNull();
    expect(restored!.rows[0].idempotencyKey).toBe(rows[0].idempotencyKey);
    expect(restored!.rows[0].groupId).toBe('g-7');
    expect(restored!.sharedLocationCode).toBe('BIN-2');
  });

  it('restores an interrupted in-flight row as retryable, never as a success', () => {
    const rows: BatchRow[] = [{ ...rowWith(raw, { card_name: 'Pikachu' }), status: 'committing' }];
    const restored = deserializeDraft(serializeDraft({
      categoryKey: 'raw_card', rows, sharedLocationCode: '', sharedSourceKind: '', sharedSourceReference: '',
    }));
    expect(restored!.rows[0].status).toBe('failed');
    expect(restored!.rows[0].messages.join(' ')).toMatch(/will not create a duplicate/i);
    // The key survives, which is what makes that retry safe.
    expect(restored!.rows[0].idempotencyKey).toBe(rows[0].idempotencyKey);
  });

  it('returns null for missing or corrupt storage rather than throwing', () => {
    expect(deserializeDraft(null)).toBeNull();
    expect(deserializeDraft('not json')).toBeNull();
    expect(deserializeDraft('{"nope":true}')).toBeNull();
  });
});

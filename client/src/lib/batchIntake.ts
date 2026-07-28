// Batch intake — grid state, paste parsing, per-row validation and the
// commit-outcome model.
//
// This is an operator-facing rapid-entry tool, not an import platform. Each
// row commits INDEPENDENTLY through the existing intake kernel, so one bad
// row never rolls back the good ones, and each row carries a stable
// idempotency key so a retry after a network interruption replays its receipt
// instead of creating a second copy.
//
// Pure logic only: no React, no network, no rule engine. The server still
// decides readiness, identity and duplicates.

import {
  buildGroupPayload, emptyValues, localBlockers, parseQuantity,
  type CategoryDef, type CategoryFieldDef, type CategoryValues,
} from './intakeCategories';

/** A deliberate ceiling: this is a rapid-entry grid, not a bulk importer. */
export const MAX_BATCH_ROWS = 100;

export type RowStatus =
  | 'draft'        // still being edited
  | 'committing'   // in flight
  | 'committed'    // created (or replayed) successfully
  | 'blocked'      // the server refused it as not ready
  | 'duplicate'    // identity already exists
  | 'failed';      // anything else, including an unknown network outcome

export interface RowResult {
  readonly itemPublicId?: string;
  readonly itemId?: string;
  readonly scanSku?: string;
  readonly lotPublicId?: string;
  readonly lotId?: string;
  readonly unitsCreated: number;
}

export interface BatchRow {
  readonly id: string;
  readonly values: CategoryValues;
  readonly status: RowStatus;
  readonly messages: readonly string[];
  readonly result: RowResult | null;
  /**
   * Stable for the life of the row, including across retries and page
   * reloads. This is what makes a retry idempotent rather than duplicating.
   */
  readonly idempotencyKey: string;
  /**
   * The server draft this row already created, if any. A retry REUSES it
   * rather than minting a second group, so the idempotency key and the group
   * it belongs to always stay paired.
   */
  readonly groupId?: string;
}

export interface BatchDraft {
  readonly categoryKey: string;
  readonly rows: readonly BatchRow[];
  readonly sharedLocationCode: string;
  readonly sharedSourceKind: string;
  readonly sharedSourceReference: string;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function newRow(def: CategoryDef, values?: CategoryValues): BatchRow {
  return {
    id: newId(),
    values: { ...emptyValues(def), ...(values ?? {}) },
    status: 'draft',
    messages: [],
    result: null,
    idempotencyKey: newId(),
  };
}

/**
 * The columns shown in the grid, in order. Location and source live above the
 * grid as batch-wide settings, so they are not repeated per column.
 */
export function gridColumns(def: CategoryDef): readonly CategoryFieldDef[] {
  return def.fields.filter(
    (f) => f.key !== 'source_kind' && f.key !== 'source_reference'
  );
}

/** A header line the operator can paste into a spreadsheet to build a batch. */
export function pasteHeaderLine(def: CategoryDef): string {
  return gridColumns(def).map((f) => f.label).join('\t');
}

/**
 * Parse tab-separated rows copied from Excel or Google Sheets. Columns map
 * positionally onto gridColumns(). A leading row that repeats the headers is
 * ignored, so pasting a copied block including its header just works. Extra
 * columns are dropped rather than silently landing in the wrong field.
 */
export function parsePastedRows(def: CategoryDef, text: string): CategoryValues[] {
  const columns = gridColumns(def);
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headerLabels = columns.map((c) => c.label.toLowerCase());
  const firstCells = lines[0].split('\t').map((c) => c.trim().toLowerCase());
  const looksLikeHeader =
    firstCells.length > 1 && firstCells.every((cell, i) => cell === (headerLabels[i] ?? cell));
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = line.split('\t');
    const values: CategoryValues = { ...emptyValues(def) };
    columns.forEach((column, index) => {
      const cell = (cells[index] ?? '').trim();
      if (cell !== '') values[column.key] = cell;
    });
    return values;
  });
}

/** Append parsed rows, refusing to exceed the batch ceiling. */
export function appendRows(
  def: CategoryDef,
  existing: readonly BatchRow[],
  incoming: readonly CategoryValues[]
): { rows: BatchRow[]; skipped: number } {
  const room = Math.max(0, MAX_BATCH_ROWS - existing.length);
  const accepted = incoming.slice(0, room);
  return {
    rows: [...existing, ...accepted.map((v) => newRow(def, v))],
    skipped: incoming.length - accepted.length,
  };
}

/** Copy one row's value for a field down into every later editable row. */
export function fillDown(
  rows: readonly BatchRow[],
  fromIndex: number,
  fieldKey: string
): BatchRow[] {
  const source = rows[fromIndex];
  if (!source) return [...rows];
  const value = source.values[fieldKey] ?? '';
  return rows.map((row, index) => {
    // A committed row is a permanent record; never rewrite it.
    if (index <= fromIndex || row.status === 'committed') return row;
    return { ...row, values: { ...row.values, [fieldKey]: value } };
  });
}

export function duplicateRow(rows: readonly BatchRow[], index: number): BatchRow[] {
  const source = rows[index];
  if (!source || rows.length >= MAX_BATCH_ROWS) return [...rows];
  // A copy is a NEW row: fresh id and fresh idempotency key, cleared outcome.
  const copy: BatchRow = {
    id: newId(),
    values: { ...source.values },
    status: 'draft',
    messages: [],
    result: null,
    idempotencyKey: newId(),
    // Deliberately NOT the source's groupId: a copy is a new record, not a
    // second commit of the same draft.
  };
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}

export function removeRow(rows: readonly BatchRow[], index: number): BatchRow[] {
  return rows.filter((_, i) => i !== index);
}

export function updateRowValue(
  rows: readonly BatchRow[],
  index: number,
  fieldKey: string,
  value: string
): BatchRow[] {
  return rows.map((row, i) => {
    if (i !== index) return row;
    // Editing a row that previously failed clears its outcome so it can be
    // retried cleanly; a committed row is immutable.
    if (row.status === 'committed') return row;
    return {
      ...row,
      values: { ...row.values, [fieldKey]: value },
      status: 'draft',
      messages: [],
    };
  });
}

/**
 * Apply the batch-wide location and source to every row that will be sent.
 * Committed rows keep exactly what they were committed with.
 */
export function applyShared(
  rows: readonly BatchRow[],
  shared: { locationCode: string; sourceKind: string; sourceReference: string }
): BatchRow[] {
  return rows.map((row) => {
    if (row.status === 'committed') return row;
    return {
      ...row,
      values: {
        ...row.values,
        location_code: shared.locationCode,
        source_kind: shared.sourceKind,
        source_reference: shared.sourceReference,
      },
    };
  });
}

/** Rows that still need to be sent: never re-send something already created. */
export function pendingRows(rows: readonly BatchRow[]): BatchRow[] {
  return rows.filter((r) => r.status !== 'committed' && !isRowEmpty(r));
}

/** A row the operator started and abandoned — ignored rather than reported. */
export function isRowEmpty(row: BatchRow): boolean {
  return Object.entries(row.values).every(([key, value]) => {
    if (key === 'quantity') return value === '' || value === '1';
    if (key === 'tracking_choice') return true;
    if (key === 'location_code' || key === 'source_kind' || key === 'source_reference') return true;
    return (value ?? '').trim() === '';
  });
}

/** Local, obvious problems only. The server owns real readiness. */
export function rowBlockers(def: CategoryDef, row: BatchRow): string[] {
  const problems = localBlockers(def, row.values);
  // A graded slab without a certificate cannot be de-duplicated, and the
  // kernel will refuse it anyway — say so before the round trip.
  if (def.key === 'graded_card' && (row.values.certificate_number ?? '').trim() === '') {
    problems.push('A certificate number is required for a graded card.');
  }
  return problems;
}

export interface BatchSummary {
  readonly totalRows: number;
  readonly committed: number;
  readonly unitsCreated: number;
  readonly blocked: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly incomplete: number;
  readonly labelsAvailable: number;
}

export function batchSummary(def: CategoryDef, rows: readonly BatchRow[]): BatchSummary {
  const live = rows.filter((r) => !isRowEmpty(r));
  let committed = 0;
  let unitsCreated = 0;
  let blocked = 0;
  let duplicates = 0;
  let failed = 0;
  let incomplete = 0;

  for (const row of live) {
    switch (row.status) {
      case 'committed':
        committed += 1;
        unitsCreated += row.result?.unitsCreated ?? 0;
        break;
      case 'duplicate': duplicates += 1; break;
      case 'blocked': blocked += 1; break;
      case 'failed': failed += 1; break;
      default:
        if (rowBlockers(def, row).length > 0) incomplete += 1;
        break;
    }
  }

  return {
    totalRows: live.length,
    committed,
    unitsCreated,
    blocked,
    duplicates,
    failed,
    incomplete,
    labelsAvailable: live.filter((r) => r.status === 'committed' && r.result).length,
  };
}

/** How many inventory units a row will create, for the pre-commit review. */
export function unitsForRow(def: CategoryDef, row: BatchRow): number {
  const payload = buildGroupPayload(def, row.values);
  return payload.quantity;
}

export function totalUnitsPlanned(rows: readonly BatchRow[]): number {
  return pendingRows(rows).reduce((sum, row) => {
    const qty = parseQuantity(row.values.quantity);
    return sum + (qty ?? 0);
  }, 0);
}

// ---- draft persistence -----------------------------------------------------
export function draftStorageKey(workspaceId: string): string {
  return `rv.batchDraft.${workspaceId}`;
}

export function serializeDraft(draft: BatchDraft): string {
  return JSON.stringify(draft);
}

/**
 * Restore a saved draft, keeping each row's idempotency key so a retry after
 * a refresh still cannot create a second copy. Returns null on anything
 * unrecognizable rather than throwing into the page.
 */
export function deserializeDraft(raw: string | null): BatchDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BatchDraft;
    if (typeof parsed?.categoryKey !== 'string' || !Array.isArray(parsed.rows)) return null;
    const rows: BatchRow[] = parsed.rows
      .filter((r) => r && typeof r.id === 'string' && typeof r.values === 'object')
      .slice(0, MAX_BATCH_ROWS)
      .map((r) => ({
        id: r.id,
        values: r.values,
        // An in-flight row from a previous page load has an unknown outcome:
        // restore it as a retryable failure, never as a success.
        status: r.status === 'committing' ? 'failed' : (r.status ?? 'draft'),
        messages: r.status === 'committing'
          ? ['The last attempt did not finish. Retry is safe — it will not create a duplicate.']
          : (r.messages ?? []),
        result: r.result ?? null,
        idempotencyKey: typeof r.idempotencyKey === 'string' ? r.idempotencyKey : newId(),
        groupId: typeof r.groupId === 'string' ? r.groupId : undefined,
      }));
    return {
      categoryKey: parsed.categoryKey,
      rows,
      sharedLocationCode: parsed.sharedLocationCode ?? '',
      sharedSourceKind: parsed.sharedSourceKind ?? '',
      sharedSourceReference: parsed.sharedSourceReference ?? '',
    };
  } catch {
    return null;
  }
}

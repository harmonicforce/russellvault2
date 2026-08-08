import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { hasValue, isIndeterminate, type TruthState } from '../foundations/truthState';
import { IconButton } from '../controls/IconButton';
import { DependencyState, EmptyState, LoadingState, PartialState, StaleState } from '../feedback/TruthStates';

/**
 * The governed data table.
 *
 * OWNERSHIP
 *
 * DataTable owns PRESENTATION: semantic table markup, accessible headers, the
 * announced sort direction, pagination controls, keyboard-reachable row
 * activation, selection wiring, and — the part that matters most — rendering
 * each truth state as the distinct thing it is.
 *
 * It owns no business meaning. It does not sort, page, filter, or search; every
 * one of those is a callback the domain answers, because the domain is the only
 * layer that knows whether sorting happens in the database or in memory and
 * what a page of governed records costs. It never computes a status, a total,
 * or a provenance.
 *
 * THE LOAD-BEARING RULE
 *
 * A failed request never renders the same UI as zero results. `state` is a
 * `TruthState`, so a caller cannot express "no rows" without choosing between
 * `empty` (an authoritative zero) and one of the indeterminate states (we could
 * not find out). There is no `rows: T[]` prop that would let a failed fetch
 * arrive here as `[]`.
 *
 * LAYOUT OF THE STATES
 *
 * | state           | notice above the table | table rendered            |
 * | --------------- | ---------------------- | ------------------------- |
 * | loading         | —                      | headers + loading region  |
 * | ready           | —                      | headers + rows            |
 * | empty           | —                      | headers + empty region    |
 * | partial         | coverage notice        | headers + rows            |
 * | stale           | stale notice           | headers + rows            |
 * | unavailable     | dependency notice      | no                        |
 * | unauthorized    | dependency notice      | no                        |
 * | notConfigured   | dependency notice      | no                        |
 * | error           | dependency notice      | no                        |
 *
 * The indeterminate states render no table at all. A header row with no body
 * reads as a table that merely happens to be short, which is the confusion this
 * whole contract exists to prevent.
 */

export interface DataColumn<T> {
  readonly key: string;
  readonly header: string;
  /** Cell content. Falls back to nothing — this component invents no values. */
  readonly render?: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'right' | 'center';
  readonly width?: string;
  /** Money, counts, quantities and aligned identifiers get tabular figures. */
  readonly numeric?: boolean;
}

export type SortDirection = 'ascending' | 'descending';

export interface DataTableSort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface DataTablePagination {
  readonly page: number;
  readonly pageSize: number;
  /**
   * The authoritative total, or `null` when the caller does not know it.
   * `null` is rendered as an unknown total — never as 0, and never as a
   * fabricated page count.
   */
  readonly total: number | null;
  readonly onPageChange: (page: number) => void;
  /** Required when `total` is null: only the caller can know if more exist. */
  readonly hasNextPage?: boolean;
}

export interface DataTableSelection<T> {
  readonly selectedKeys: readonly string[];
  readonly onChange: (keys: readonly string[]) => void;
  /** Accessible name for one row's checkbox. The domain names its records. */
  readonly rowLabel: (row: T) => string;
}

export interface DataTableSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The accessible name. A placeholder is not a label. */
  readonly label: string;
  readonly placeholder?: string;
}

export interface DataTableEmpty {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

export interface DataTableProps<T> {
  /**
   * The table's accessible name, rendered as a real `<caption>`. Required: an
   * unnamed table in a page of several is unnavigable with a screen reader.
   */
  readonly caption: string;
  /** Visually hide the caption where the surrounding heading already says it. */
  readonly captionVisibility?: 'visible' | 'assistive';
  readonly columns: readonly DataColumn<T>[];
  readonly state: TruthState<readonly T[]>;
  readonly rowKey: (row: T) => string;
  readonly sort?: DataTableSort | null;
  readonly onSortChange?: (key: string) => void;
  readonly pagination?: DataTablePagination;
  readonly search?: DataTableSearch;
  /** Caller-supplied filter controls, rendered beside the search field. */
  readonly filters?: ReactNode;
  /** Opening a record. Reachable by keyboard through a real button. */
  readonly onRowActivate?: (row: T) => void;
  /** Accessible name for the activation control, e.g. "Open lot RV-LOT-8821". */
  readonly rowActivationLabel?: (row: T) => string;
  readonly selection?: DataTableSelection<T>;
  /** Controls acting on the current selection. Rendered only when non-empty. */
  readonly bulkActions?: ReactNode;
  readonly empty?: DataTableEmpty;
  /** A safe retry for an indeterminate state, when the caller has one. */
  readonly onRetry?: () => void;
  /** A safe refresh for a stale value, when the caller has one. */
  readonly onRefresh?: () => void;
  /**
   * Narrow-viewport presentation, typically a `ResponsiveRecordList`. When
   * supplied, the table is hidden below `md` and this is shown instead.
   */
  readonly responsive?: ReactNode;
  readonly className?: string;
}

const ALIGN = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

export function DataTable<T>({
  caption,
  captionVisibility = 'assistive',
  columns,
  state,
  rowKey,
  sort,
  onSortChange,
  pagination,
  search,
  filters,
  onRowActivate,
  rowActivationLabel,
  selection,
  bulkActions,
  empty,
  onRetry,
  onRefresh,
  responsive,
  className = '',
}: DataTableProps<T>) {
  const searchId = useId();
  const rows = hasValue(state) ? state.value : [];
  const indeterminate = isIndeterminate(state);
  const columnCount = columns.length + (selection ? 1 : 0);

  const selected = new Set(selection?.selectedKeys ?? []);
  const pageKeys = rows.map(rowKey);
  const allOnPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));

  const toggleRow = (key: string) => {
    if (!selection) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange([...next]);
  };

  const toggleAllOnPage = () => {
    if (!selection) return;
    const next = new Set(selected);
    if (allOnPageSelected) pageKeys.forEach((key) => next.delete(key));
    else pageKeys.forEach((key) => next.add(key));
    selection.onChange([...next]);
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {(search || filters) && (
        <div className="flex flex-wrap items-end gap-2">
          {search && (
            <div className="min-w-[220px] flex-1">
              <label htmlFor={searchId} className="sr-only">
                {search.label}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input
                  id={searchId}
                  type="search"
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder}
                  className="min-h-11 w-full rounded-control border border-subtle bg-surface-base py-2 pl-8 pr-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                />
              </div>
            </div>
          )}
          {filters}
        </div>
      )}

      {/* Notices sit ABOVE the data, so an operator reads the boundary of what
          they are looking at before they read the figures inside it. */}
      {state.kind === 'partial' && <PartialState coverage={state.coverage} />}
      {state.kind === 'stale' && (
        <StaleState
          label={state.label}
          lastRefreshedAt={state.lastRefreshedAt}
          canRefresh={state.canRefresh}
          onRefresh={onRefresh}
        />
      )}
      {isIndeterminate(state) && <DependencyState state={state} onRetry={onRetry} />}

      {selection && selected.size > 0 && bulkActions && (
        <div
          role="group"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
        >
          <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
          {bulkActions}
        </div>
      )}

      {!indeterminate && (
        <>
          <div className={responsive ? 'hidden md:block' : undefined}>
            <div className="overflow-x-auto rounded-instrument border border-subtle bg-surface-base">
              <table className="w-full border-collapse text-sm">
                <caption className={captionVisibility === 'assistive' ? 'sr-only' : 'px-3 py-2 text-left text-sm font-semibold text-ink'}>
                  {caption}
                </caption>
                <thead>
                  <tr className="border-b border-subtle bg-surface-raised">
                    {selection && (
                      <th scope="col" className="w-10 px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                          aria-label="Select all rows on this page"
                          className="h-4 w-4 accent-[var(--brand-accent)]"
                        />
                      </th>
                    )}
                    {columns.map((col) => {
                      const active = sort?.key === col.key;
                      const ariaSort = col.sortable ? (active ? sort!.direction : 'none') : undefined;
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          aria-sort={ariaSort}
                          style={{ width: col.width }}
                          className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${ALIGN[col.align ?? 'left']}`}
                        >
                          {col.sortable && onSortChange ? (
                            <button
                              type="button"
                              onClick={() => onSortChange(col.key)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-control px-1 font-semibold uppercase tracking-wide hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                            >
                              {col.header}
                              {/* The direction reaches assistive technology as
                                  words, not only as a glyph and an aria-sort
                                  attribute the operator may never hear. */}
                              <span className="sr-only">
                                {active ? `, sorted ${sort!.direction}` : ', not sorted'}
                              </span>
                              {active ? (
                                sort!.direction === 'ascending' ? (
                                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                                )
                              ) : null}
                            </button>
                          ) : (
                            col.header
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {state.kind === 'loading' && (
                    <tr>
                      <td colSpan={columnCount}>
                        <LoadingState />
                      </td>
                    </tr>
                  )}

                  {state.kind === 'empty' && (
                    <tr>
                      <td colSpan={columnCount}>
                        <EmptyState
                          title={empty?.title ?? 'No records'}
                          description={empty?.description}
                          action={empty?.action}
                        />
                      </td>
                    </tr>
                  )}

                  {rows.map((row) => {
                    const key = rowKey(row);
                    return (
                      <tr
                        key={key}
                        data-row-key={key}
                        // Pointer convenience only. Anything that is itself
                        // interactive handles its own click, so activating a
                        // nested action never also opens the record.
                        onClick={
                          onRowActivate
                            ? (event) => {
                                const target = event.target as HTMLElement;
                                if (target.closest('button, a, input, select, textarea, label')) return;
                                onRowActivate(row);
                              }
                            : undefined
                        }
                        className={`border-b border-subtle last:border-0 ${
                          onRowActivate ? 'cursor-pointer hover:bg-surface-inset' : ''
                        }`}
                      >
                        {selection && (
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() => toggleRow(key)}
                              aria-label={selection.rowLabel(row)}
                              className="h-4 w-4 accent-[var(--brand-accent)]"
                            />
                          </td>
                        )}
                        {columns.map((col, columnIndex) => {
                          const content = col.render ? col.render(row) : null;
                          const cellClass = `px-3 py-2 align-middle ${ALIGN[col.align ?? 'left']} ${
                            col.numeric ? 'tabular-nums' : ''
                          }`;
                          // Activation lives on a real button in the first
                          // cell. That is what makes it keyboard-reachable, and
                          // keeping it in its own cell is what keeps a row
                          // action from ending up nested inside another
                          // control — a button inside a button is invalid
                          // markup and unreachable for keyboard operators.
                          const isActivationCell = columnIndex === 0 && Boolean(onRowActivate);
                          return (
                            <td key={col.key} className={cellClass}>
                              {isActivationCell ? (
                                <button
                                  type="button"
                                  aria-label={rowActivationLabel?.(row)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onRowActivate!(row);
                                  }}
                                  // Deliberately imposes no typography of its
                                  // own. The cell's content keeps whatever the
                                  // column renderer gave it, so making a cell
                                  // activatable never restyles it.
                                  className="rounded-control text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                                >
                                  {content}
                                </button>
                              ) : (
                                content
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {responsive && <div className="md:hidden">{responsive}</div>}
        </>
      )}

      {pagination && !indeterminate && <Pagination {...pagination} shown={rows.length} />}
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  hasNextPage,
  shown,
}: DataTablePagination & { readonly shown: number }) {
  // A null total is genuinely unknown. It is not 0, and there is no page count
  // to compute from it, so neither is invented here.
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === null ? start + shown - 1 : Math.min(total, page * pageSize);
  const canGoNext = totalPages === null ? Boolean(hasNextPage) : page < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary">
      <span className="tabular-nums">
        {total === null
          ? shown === 0
            ? 'Total not known'
            : `${start.toLocaleString()}–${end.toLocaleString()} of an unknown total`
          : total === 0
            ? '0 results'
            : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-2">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="tabular-nums">{totalPages === null ? `Page ${page}` : `${page} / ${totalPages}`}</span>
        <IconButton label="Next page" disabled={!canGoNext} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}


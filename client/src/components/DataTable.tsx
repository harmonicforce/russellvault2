import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  rowKey,
  loading,
  total,
  page,
  pageSize,
  onPageChange,
  sortKey,
  sortOrder,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  onRowClick,
  filters,
  emptyLabel = 'No records found.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  filters?: ReactNode;
  emptyLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <input
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-hairline bg-surface-1 pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        )}
        {filters}
      </div>

      <div className="overflow-auto rounded-xl border border-hairline bg-surface-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-hairline bg-surface-2 sticky top-0 z-10">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.sortable ? 'cursor-pointer select-none hover:text-ink-secondary' : ''}`}
                  onClick={() => col.sortable && onSortChange?.(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-ink-muted">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-ink-muted">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-hairline last:border-0 ${
                    onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 align-middle ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-secondary">
        <span>
          {total === 0 ? '0 results' : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-hairline p-1.5 disabled:opacity-30 hover:bg-surface-2"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-hairline p-1.5 disabled:opacity-30 hover:bg-surface-2"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

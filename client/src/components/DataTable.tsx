import type { ReactNode } from 'react';
import {
  DataTable as GovernedDataTable,
  empty,
  loading,
  ready,
  type DataColumn,
} from '../design-system';

/**
 * COMPATIBILITY WRAPPER for the pre-S1.6 DataTable.
 *
 * The six legacy pages that use this component (Sales, Inventory, Purchases,
 * CostLinks, Listings) keep their exact call signature and behaviour while the
 * markup underneath becomes the governed design-system table — semantic
 * `<caption>`, `<th scope>`, announced sort direction, keyboard-reachable row
 * activation and accessible pagination controls. They are not migrated here;
 * they are carried.
 *
 * THE LIMIT OF WHAT THIS WRAPPER CAN PROMISE
 *
 * The old contract is `rows: T[]` plus `loading: boolean`. That shape cannot
 * distinguish "the query returned nothing" from "the query failed", because by
 * the time a failure reaches this component it has already been flattened to
 * `[]`. So this wrapper maps an empty array to `empty` — which is what these
 * pages already displayed — and it CANNOT do better, since the missing fact
 * never arrived.
 *
 * That is precisely why the governed contract takes a `TruthState` instead. A
 * surface that needs to tell a failure from a zero must call
 * `design-system/DataTable` directly and say which one it means. Nothing here
 * upgrades a legacy page's honesty; it upgrades its markup, and the honesty
 * gets fixed when the page itself is migrated.
 */

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
};

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  rowKey,
  loading: isLoading,
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
  caption = 'Records',
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
  caption?: string;
}) {
  const governedColumns: DataColumn<T>[] = columns.map((col) => ({
    key: col.key,
    header: col.header,
    // The legacy contract falls back to the raw row property when no renderer
    // is supplied, and several pages rely on it.
    render: col.render ?? ((row: T) => row[col.key] as ReactNode),
    sortable: col.sortable,
    align: col.align,
    width: col.width,
  }));

  return (
    <GovernedDataTable<T>
      caption={caption}
      columns={governedColumns}
      state={isLoading ? loading() : rows.length > 0 ? ready(rows) : empty()}
      rowKey={rowKey}
      sort={
        sortKey && sortOrder
          ? { key: sortKey, direction: sortOrder === 'asc' ? 'ascending' : 'descending' }
          : null
      }
      onSortChange={onSortChange}
      pagination={{ page, pageSize, total, onPageChange }}
      search={
        onSearchChange
          ? { value: search ?? '', onChange: onSearchChange, label: 'Search records', placeholder: searchPlaceholder }
          : undefined
      }
      filters={filters}
      onRowActivate={onRowClick}
      empty={{ title: emptyLabel }}
    />
  );
}

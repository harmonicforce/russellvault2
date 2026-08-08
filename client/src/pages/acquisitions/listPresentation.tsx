import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, type DataColumn, type ResponsiveRecord } from '../../design-system';
import type { AcquisitionLine } from '../../lib/acquisitionLinesApi';
import { METHOD_LABELS, SORT_LABELS, type ClassificationMethod } from './listState';

/**
 * The acquisition domain adapter.
 *
 * THE DESIGN SYSTEM MUST NOT LEARN WHAT AN ACQUISITION IS.
 *
 * `DataTable` and `ResponsiveRecordList` render typed facts. Everything that
 * requires knowing what a classification means, when a line counts as excluded,
 * how a detail URL is addressed, or what an absent seller should read as, is
 * decided here — in the page's own layer — and handed over as values.
 *
 * That boundary is why a design change to the table can never quietly become a
 * change to what an acquisition means.
 */

/** Where a line lives. Source-qualified, always. */
export function lineDetailPath(line: AcquisitionLine): string {
  // BOTH identifiers, both encoded. An acquisition line public id is unique
  // only WITHIN its source system, so a single-segment path addresses the wrong
  // record the moment a second source exists. No internal UUID is ever exposed.
  return `/acquisitions/${encodeURIComponent(line.source_system_public_id)}/${encodeURIComponent(
    line.acquisition_line_public_id,
  )}`;
}

export function lineKey(line: AcquisitionLine): string {
  return `${line.source_system_public_id}:${line.acquisition_line_public_id}`;
}

/**
 * Bounded unknowns.
 *
 * A blank cell is ambiguous — the operator cannot tell "this line has no
 * seller recorded" from "this column failed to render". A word can only mean
 * one of those.
 */
const UNKNOWN_SELLER = 'Unknown seller';
const UNKNOWN_VERTICAL = 'Unknown vertical';
const UNTITLED = 'Untitled';
const NO_ORDER = 'No source order';
const NO_METHOD = 'No classification method';

export function classificationText(line: AcquisitionLine): string {
  // "Unclassified" in words. An empty classification cell reads as a rendering
  // gap; the word reads as the operator's next piece of work.
  return line.classification_label ?? 'Unclassified';
}

export function methodText(line: AcquisitionLine): string {
  const method = line.classification_method;
  if (!method) return NO_METHOD;
  return METHOD_LABELS[method as ClassificationMethod] ?? method;
}

export function sellerText(line: AcquisitionLine): string {
  return line.seller_normalized ?? UNKNOWN_SELLER;
}

export function verticalText(line: AcquisitionLine): string {
  return line.business_vertical ?? UNKNOWN_VERTICAL;
}

export function titleText(line: AcquisitionLine): string {
  return line.full_title ?? line.delivered_item_title ?? UNTITLED;
}

export function orderText(line: AcquisitionLine): string {
  return line.source_order_reference ?? NO_ORDER;
}

export function dateText(line: AcquisitionLine): string {
  return new Date(line.occurred_at ?? line.created_at).toLocaleDateString();
}

/**
 * The eligibility marker.
 *
 * Excluded is a governed DECISION, not a deletion — the line stays visible,
 * searchable and linkable. The marker is a word, never colour alone, because an
 * amber row is invisible to a colour-blind operator and to a greyscale print.
 */
export function ExclusionMarker({ line }: { readonly line: AcquisitionLine }) {
  if (line.exclusion_state !== 'excluded') return null;
  return (
    <StatusPill tone="warning" className="ml-2 align-middle">
      Excluded
    </StatusPill>
  );
}

/** The link to a line's detail, carrying the list URL so Detail can return. */
export function LineLink({
  line,
  returnTo,
  children,
  className = '',
}: {
  readonly line: AcquisitionLine;
  /** The CURRENT list URL, query string included, so the exact page returns. */
  readonly returnTo: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Link to={lineDetailPath(line)} state={{ from: returnTo }} className={className}>
      {children}
    </Link>
  );
}

/**
 * The desktop columns.
 *
 * Only the six server sort keys are marked sortable. A column that cannot map
 * truthfully onto one of them — source line identity, eligibility, method — is
 * not given a control that would silently do nothing or, worse, re-sort the
 * page locally and disagree with the server's ordering.
 */
export function acquisitionColumns(returnTo: string): DataColumn<AcquisitionLine>[] {
  return [
    {
      key: 'classification',
      header: SORT_LABELS.classification,
      sortable: true,
      render: (line) => (
        <span className="inline-flex flex-wrap items-center">
          <span className="font-medium text-ink">{classificationText(line)}</span>
          <ExclusionMarker line={line} />
        </span>
      ),
    },
    { key: 'occurred_at', header: SORT_LABELS.occurred_at, sortable: true, render: dateText },
    {
      // The sixth server sort key. It gets its own column rather than being
      // reachable only by hand-editing the URL — and showing `created_at` here
      // keeps the mapping honest, since the Date column falls back to it for
      // display but still sorts by `occurred_at`.
      key: 'created_at',
      header: SORT_LABELS.created_at,
      sortable: true,
      render: (line) => new Date(line.created_at).toLocaleDateString(),
    },
    { key: 'seller', header: SORT_LABELS.seller, sortable: true, render: sellerText },
    {
      key: 'title',
      header: SORT_LABELS.title,
      sortable: true,
      render: (line) => (
        <LineLink line={line} returnTo={returnTo} className="text-accent-strong underline underline-offset-2">
          {titleText(line)}
        </LineLink>
      ),
    },
    { key: 'quantity', header: SORT_LABELS.quantity, sortable: true, align: 'right', numeric: true, render: (line) => line.quantity },
    { key: 'business_vertical', header: 'Vertical', render: verticalText },
    {
      key: 'line_identity',
      header: 'Line / order',
      render: (line) => (
        // Source identity stays on screen. Hiding it would make the table
        // prettier and make two lines from two sources indistinguishable.
        <span className="grid gap-0.5">
          <LineLink line={line} returnTo={returnTo} className="font-mono text-xs text-accent-strong underline underline-offset-2">
            {line.acquisition_line_public_id}
          </LineLink>
          <span className="text-xs text-ink-muted">{orderText(line)}</span>
        </span>
      ),
    },
    { key: 'classification_method', header: 'Method', render: methodText },
  ];
}

/**
 * The narrow-viewport records.
 *
 * Every fact that governs a decision travels with the record: classification,
 * eligibility, quantity, seller, date, vertical and the source-qualified
 * identity are all primary. Only the order reference and the classification
 * method are secondary, and neither of them is hidden — they are simply read
 * after the rest.
 */
export function acquisitionRecords(
  lines: readonly AcquisitionLine[],
  returnTo: string,
): readonly ResponsiveRecord[] {
  return lines.map((line) => ({
    key: lineKey(line),
    identity: (
      <LineLink line={line} returnTo={returnTo} className="text-accent-strong underline underline-offset-2">
        {titleText(line)}
      </LineLink>
    ),
    subheading: (
      <LineLink line={line} returnTo={returnTo} className="font-mono underline underline-offset-2">
        {line.acquisition_line_public_id}
      </LineLink>
    ),
    // Classification is the record's status here — it is what the operator is
    // triaging by — and eligibility rides beside it as its own worded pill.
    status: { tone: 'neutral', label: classificationText(line) },
    primaryFields: [
      ...(line.exclusion_state === 'excluded'
        ? [{ label: 'Eligibility', value: 'Excluded' as ReactNode }]
        : [{ label: 'Eligibility', value: 'Included' as ReactNode }]),
      { label: 'Quantity', value: line.quantity, numeric: true },
      { label: 'Seller', value: sellerText(line) },
      { label: 'Date', value: dateText(line) },
      { label: 'Vertical', value: verticalText(line) },
    ],
    secondaryFields: [
      { label: 'Source order', value: orderText(line) },
      { label: 'Method', value: methodText(line) },
    ],
  }));
}

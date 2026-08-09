import type { ReactNode } from 'react';
import { StatusPill, type StatusTone } from '../../design-system';
import type { ShipmentStatus } from '../../lib/acquisitionDetailApi';

/**
 * The acquisition-detail domain adapter.
 *
 * THE DESIGN SYSTEM MUST NOT LEARN WHAT AN ACQUISITION IS.
 *
 * `StatusPill` renders a tone and a word; it does not know that a lost shipment
 * is worse than an expected one. Everything requiring that knowledge — which
 * statuses are serious, what an absent carrier should read as, how money is
 * written — is decided here, in the page's own layer, and handed over as
 * values. That boundary is why a design change can never quietly become a
 * change to what an acquisition means.
 *
 * Nothing in this file fetches, computes a total, or decides a business rule.
 */

// --- money ------------------------------------------------------------------

/**
 * Currency-qualified money.
 *
 * There is no bare amount anywhere on this page. Money arrives from the domain
 * boundary as integer minor units and is only ever DISPLAYED as decimal — the
 * conversion happens here, at the last possible moment, and never travels back
 * into a payload.
 *
 * `tabular-nums` so a column of amounts aligns on the decimal point; a
 * financial figure that shifts horizontally between rows is harder to scan and
 * easier to misread.
 */
export function Money({ minor, currency }: { readonly minor: number; readonly currency: string }) {
  return (
    <span className="whitespace-nowrap font-medium tabular-nums">
      {currency} {(minor / 100).toFixed(2)}
    </span>
  );
}

/** A count that belongs in the same visual rhythm as the money beside it. */
export function Count({ value }: { readonly value: number }) {
  return <span className="tabular-nums">{value}</span>;
}

// --- time -------------------------------------------------------------------

/**
 * An instant, or a word saying there is none.
 *
 * A blank cell is ambiguous: the operator cannot tell "no date was recorded"
 * from "the date failed to render". A word can only mean one of those.
 */
export function instant(iso: string | null | undefined, absent = 'Not recorded'): string {
  if (!iso) return absent;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : absent;
}

// --- identity ---------------------------------------------------------------

/**
 * A governed public identity.
 *
 * Monospaced and breakable: an RV public ID is long, and on a phone it must
 * wrap rather than push the whole panel sideways. `break-all` is correct here
 * precisely because these strings have no word boundaries to break on.
 */
export function PublicId({ children }: { readonly children: ReactNode }) {
  return <span className="break-all font-mono text-xs text-ink-secondary">{children}</span>;
}

/**
 * A raw value that came from a source system and is NOT an RV identity.
 *
 * Rendered deliberately differently from `PublicId`. A source row key that
 * looks like a governed public ID invites an operator to paste it where a
 * governed ID belongs.
 */
export function SourceValue({ children }: { readonly children: ReactNode }) {
  return <span className="break-all font-mono text-xs text-ink-muted">{children}</span>;
}

// --- status vocabularies ----------------------------------------------------

const SHIPMENT_TONE: Record<ShipmentStatus, StatusTone> = {
  expected: 'neutral',
  in_transit: 'information',
  delivered: 'success',
  lost: 'critical',
  cancelled: 'serious',
};

/** The operator-facing word for a shipment status. Never colour alone. */
export function shipmentStatusLabel(status: ShipmentStatus): string {
  return status.replace('_', ' ');
}

export function ShipmentStatusPill({ status }: { readonly status: ShipmentStatus }) {
  return <StatusPill tone={SHIPMENT_TONE[status]}>{shipmentStatusLabel(status)}</StatusPill>;
}

// --- layout -----------------------------------------------------------------

/**
 * One panel of the fixed transactional surface.
 *
 * Every panel is a real `<section>` with a real heading, so the page has a
 * navigable outline rather than a stack of identically bordered divs. The
 * heading is `h2`; the page owns the single `h1`.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-instrument border border-subtle bg-surface-raised ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
          {description && <div className="mt-1 text-xs text-ink-secondary">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="grid gap-3 px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * A labelled fact grid.
 *
 * A real `<dl>`: the label/value relationship is structural rather than
 * implied by two adjacent spans, which is what lets a screen reader read
 * "Quantity, 2" instead of "2".
 *
 * One column on a phone, two from `sm`, so related facts share width on a
 * desktop instead of stretching a two-word value across a giant canvas.
 */
export function FactGrid({ children, columns = 2 }: { readonly children: ReactNode; readonly columns?: 1 | 2 | 3 }) {
  const responsive = columns === 1 ? '' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3';
  return <dl className={`grid gap-x-4 gap-y-3 ${responsive}`}>{children}</dl>;
}

export function Fact({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
      {hint && <dd className="mt-0.5 text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}

/**
 * Append-only history.
 *
 * Visually subordinate but fully present — an ordered list, never collapsed
 * away on a phone. Governed history is the evidence that a decision was made
 * by someone for a reason, and hiding it on a small screen is hiding the
 * evidence.
 */
export function History({
  title,
  emptyLabel,
  children,
  count,
}: {
  readonly title: string;
  readonly emptyLabel: string;
  readonly children?: ReactNode;
  readonly count: number;
}) {
  return (
    <div className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{title}</h3>
      {count === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{emptyLabel}</p>
      ) : (
        <ol className="mt-1 grid gap-1">{children}</ol>
      )}
    </div>
  );
}

/** One append-only history entry. Kept as a single text flow so it reads as a sentence. */
export function HistoryEntry({ children }: { readonly children: ReactNode }) {
  return <li className="text-sm leading-snug text-ink-secondary">{children}</li>;
}

/**
 * The strongest identity this line has.
 *
 * Shared so the page heading and every panel that needs to name the record
 * agree on one answer. Two places deriving "the title" independently is how a
 * confirmation dialog ends up naming a different record from the heading above
 * it.
 */
export function headlineTitle(line: {
  readonly fullTitle: string | null;
  readonly deliveredItemTitle: string | null;
}): string {
  return line.fullTitle ?? line.deliveredItemTitle ?? UNKNOWN.title;
}

/** Bounded unknowns, so an absent value is never a blank. */
export const UNKNOWN = {
  carrier: 'No carrier recorded',
  tracking: 'No tracking number recorded',
  vertical: 'No business vertical recorded',
  seller: 'No seller recorded',
  reference: 'No line reference recorded',
  title: 'Untitled acquisition',
} as const;

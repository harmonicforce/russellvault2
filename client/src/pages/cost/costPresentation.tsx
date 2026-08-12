import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, type DataColumn, type ResponsiveRecord, type StatusTone } from '../../design-system';
import type {
  AllocationMethod,
  AllocationWorkflowState,
  Amount,
  CostAllocationState,
  CostComponentSummary,
  CostComponentType,
} from '../../lib/costApi';
import { describeAmount, formatMinor, toMinor } from './costMoney';

/**
 * The cost domain adapter.
 *
 * THE DESIGN SYSTEM MUST NOT LEARN WHAT A COST COMPONENT IS.
 *
 * `StatusPill` renders a tone and a word; it does not know that an unresolved
 * shared cost is different from a directly-attributed one, or that an amount
 * nobody reported is not an amount of zero. Everything requiring that knowledge
 * is decided here and handed over as values.
 *
 * Nothing in this file fetches, mutates, or decides an allocation rule.
 */

export function componentPath(componentPublicId: string): string {
  return `/cost/${encodeURIComponent(componentPublicId)}`;
}

/** Bounded unknowns, so an absent value is never an ambiguous blank cell. */
export const UNKNOWN = {
  order: 'No acquisition order recorded',
  reference: 'No source order reference',
  lot: 'No lot recorded',
  line: 'No acquisition line recorded',
  title: 'Untitled acquisition line',
  note: 'No evidence note recorded',
  occurred: 'No acquisition date recorded',
} as const;

// --- component type ----------------------------------------------------------

export const COMPONENT_TYPE_LABEL: Record<CostComponentType, string> = {
  item_price: 'Item price',
  shipping: 'Shipping',
  tax: 'Tax',
  fee: 'Fee',
  discount: 'Discount',
  other: 'Other',
};

export function ComponentTypePill({ type }: { readonly type: CostComponentType }) {
  return <StatusPill tone="neutral">{COMPONENT_TYPE_LABEL[type]}</StatusPill>;
}

// --- workflow state ----------------------------------------------------------

/**
 * The allocation workflow vocabulary, in the owner's words.
 *
 * Each label states a fact the database proved. None of them says a cost is
 * "overdue", "missing", or "needs attention": nothing in the governed contract
 * establishes when a cost SHOULD have been allocated, and a label that implied
 * a deadline would be an opinion rendered in the same typeface as a fact.
 */
export const WORKFLOW_LABEL: Record<AllocationWorkflowState, string> = {
  directly_attributed: 'Directly attributed',
  awaiting_proposal: 'Shared, not yet split',
  proposed_awaiting_confirmation: 'Split proposed, not confirmed',
  allocated: 'Allocated',
  amount_not_known: 'Amount not known',
  component_reversed: 'Reversed',
};

/** What each state actually asserts, so a pill is never a bare phrase. */
export const WORKFLOW_DESCRIPTION: Record<AllocationWorkflowState, string> = {
  directly_attributed:
    'This cost belongs wholly to one acquisition line. It is already a cost basis and there is nothing '
    + 'to split.',
  awaiting_proposal:
    'This cost is shared across a lot or an order and has no proposed split yet. It is NOT a cost basis '
    + 'for any line.',
  proposed_awaiting_confirmation:
    'A split has been proposed and is pending. Proposed amounts are durable but they are NOT yet a cost '
    + 'basis — only confirmation makes them one.',
  allocated:
    'A confirmed, conserving split exists. These amounts ARE the cost basis for the lines they name.',
  amount_not_known:
    'The source never reported an amount for this cost. That is not zero, and nothing here treats it as '
    + 'zero. It cannot be split until the amount is established.',
  component_reversed:
    'This component was superseded by a governed correction. It remains on record as history.',
};

const WORKFLOW_TONE: Record<AllocationWorkflowState, StatusTone> = {
  directly_attributed: 'success',
  awaiting_proposal: 'information',
  proposed_awaiting_confirmation: 'warning',
  allocated: 'success',
  amount_not_known: 'warning',
  component_reversed: 'neutral',
};

export function WorkflowPill({ state }: { readonly state: AllocationWorkflowState }) {
  return <StatusPill tone={WORKFLOW_TONE[state]}>{WORKFLOW_LABEL[state]}</StatusPill>;
}

// --- allocation state --------------------------------------------------------

export const ALLOCATION_STATE_LABEL: Record<CostAllocationState, string> = {
  candidate: 'Proposed',
  confirmed: 'Confirmed',
  reversed: 'Reversed',
};

export const ALLOCATION_STATE_DESCRIPTION: Record<CostAllocationState, string> = {
  candidate: 'Durably recorded, but NOT a cost basis. It becomes one only when confirmed.',
  confirmed: 'A cost basis for this acquisition line.',
  reversed: 'Retracted. Preserved as history with its original review attribution intact.',
};

const ALLOCATION_STATE_TONE: Record<CostAllocationState, StatusTone> = {
  candidate: 'warning',
  confirmed: 'success',
  reversed: 'neutral',
};

export function AllocationStatePill({ state }: { readonly state: CostAllocationState }) {
  return <StatusPill tone={ALLOCATION_STATE_TONE[state]}>{ALLOCATION_STATE_LABEL[state]}</StatusPill>;
}

// --- method ------------------------------------------------------------------

export const METHOD_LABEL: Record<AllocationMethod, string> = {
  manual_equal: 'Even split',
  manual_quantity: 'By quantity',
  manual_value: 'By known value',
  manual_custom: 'Entered by hand',
};

/**
 * A method label for a value the server sent that this build does not know.
 *
 * The database column accepts any lowercase identifier, so a record written by
 * an older or newer build can legitimately carry a method this vocabulary has
 * no entry for. It is shown verbatim rather than hidden or relabelled: the
 * record says what it says, and inventing a friendly name for an unknown method
 * would misdescribe how a real cost basis was decided.
 */
export function methodLabel(method: string): string {
  return (METHOD_LABEL as Record<string, string | undefined>)[method] ?? method;
}

// --- amounts -----------------------------------------------------------------

/**
 * A governed amount, rendered with its meaning attached.
 *
 * An amount the source never reported renders as WORDS, never as a figure and
 * never as a blank cell that reads like nothing was owed. The distinction
 * between "free, with evidence" and "we do not know" is the single most
 * consequential one on this surface, so it is carried in text and not by
 * colour, position, or absence.
 */
export function AmountValue({ amount }: { readonly amount: Amount }) {
  const described = describeAmount(amount);
  return (
    <span
      className={described.hasFigure ? 'tabular-nums text-ink' : 'text-ink-secondary'}
      data-amount-state={amount.state}
      title={described.detail}
    >
      {described.text}
    </span>
  );
}

/** A minor-unit figure that is known to exist, e.g. a proposed share. */
export function MinorAmount({
  minor, currency,
}: { readonly minor: string; readonly currency: string }) {
  const parsed = toMinor(minor);
  if (parsed === null) {
    return <span className="text-ink-secondary">Amount unreadable</span>;
  }
  return <span className="tabular-nums">{formatMinor(parsed, currency)} {currency}</span>;
}

/**
 * A line's already-known direct cost, or the words for having none.
 *
 * `null` is NOT rendered as `0`. A line with no direct cost component recorded
 * has no known cost — which is exactly why the value-weighted split refuses
 * when every line looks like this, rather than splitting them evenly and
 * calling it value.
 */
export function KnownDirectCost({
  minor, currency,
}: { readonly minor: string | null; readonly currency: string }) {
  if (minor === null) {
    return (
      <span className="text-ink-secondary" title="No direct cost component is recorded for this line. That is not a cost of zero.">
        None recorded
      </span>
    );
  }
  return <MinorAmount minor={minor} currency={currency} />;
}

// --- small shared pieces -----------------------------------------------------

/** An instant, or a word saying there is none. Never a blank. */
export function instant(iso: string | null | undefined, absent = 'Not recorded'): string {
  if (!iso) return absent;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : absent;
}

/** A governed public identity. Monospaced and breakable so it wraps on a phone. */
export function PublicId({ children }: { readonly children: ReactNode }) {
  return <span className="break-all font-mono text-xs text-ink-secondary">{children}</span>;
}

export function Count({ value }: { readonly value: number }) {
  return <span className="tabular-nums">{value}</span>;
}

/**
 * What a component is scoped to, in words.
 *
 * Never just an identifier: "RV-ALOT-AAA111" tells an owner nothing about
 * whether splitting this cost will touch one lot or twelve.
 */
export function scopeText(row: CostComponentSummary): string {
  if (row.scopeKind === 'line_item') {
    return `One acquisition line — ${row.directLinePublicId ?? UNKNOWN.line}`;
  }
  if (row.scopeKind === 'lot') {
    return `One acquisition lot — ${row.lotPublicId ?? UNKNOWN.lot}`;
  }
  return `Every lot under acquisition order ${row.orderPublicId ?? UNKNOWN.order}`;
}

// --- the queue table ---------------------------------------------------------

export function costColumns(): DataColumn<CostComponentSummary>[] {
  return [
    {
      key: 'component',
      header: 'Cost component',
      render: (row) => (
        <div className="grid gap-0.5">
          <Link className="underline" to={componentPath(row.componentPublicId)}>
            {COMPONENT_TYPE_LABEL[row.componentType]}
          </Link>
          <PublicId>{row.componentPublicId}</PublicId>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => <AmountValue amount={row.amount} />,
    },
    { key: 'scope', header: 'Applies to', render: (row) => scopeText(row) },
    {
      key: 'workflow',
      header: 'Attribution',
      render: (row) => <WorkflowPill state={row.workflowState} />,
    },
    {
      key: 'allocations',
      header: 'Allocation rows',
      render: (row) => (
        <span className="whitespace-nowrap">
          <Count value={row.candidateCount} /> proposed, <Count value={row.confirmedCount} /> confirmed
        </span>
      ),
    },
    {
      key: 'order',
      header: 'Acquisition order',
      render: (row) =>
        row.orderPublicId
          ? <PublicId>{row.orderPublicId}</PublicId>
          : <span className="text-ink-muted">{UNKNOWN.order}</span>,
    },
  ];
}

/**
 * The same rows as records, for narrow screens.
 *
 * ONE model, TWO renderings — never two independently maintained lists. The
 * columns above and the records here are built from the same
 * `CostComponentSummary` so a phone and a desktop cannot disagree about what a
 * row says, including about whether an amount is known.
 */
export function costRecords(
  rows: readonly CostComponentSummary[],
  renderActions?: (row: CostComponentSummary) => ReactNode,
): ResponsiveRecord[] {
  return rows.map((row) => ({
    key: row.componentPublicId,
    identity: COMPONENT_TYPE_LABEL[row.componentType],
    subheading: <PublicId>{row.componentPublicId}</PublicId>,
    status: { label: WORKFLOW_LABEL[row.workflowState], tone: WORKFLOW_TONE[row.workflowState] },
    primaryFields: [
      { label: 'Amount', value: <AmountValue amount={row.amount} />, numeric: true },
      { label: 'Applies to', value: scopeText(row) },
    ],
    secondaryFields: [
      {
        label: 'Allocation rows',
        value: `${row.candidateCount} proposed, ${row.confirmedCount} confirmed`,
      },
      { label: 'Acquisition order', value: row.orderPublicId ?? UNKNOWN.order },
    ],
    actions: renderActions?.(row),
  }));
}

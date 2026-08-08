import type { ReactNode } from 'react';
import { hasValue, isIndeterminate, type TruthState } from '../foundations/truthState';
import { ProvenanceLabel, type ProvenanceKind } from '../feedback/ProvenanceLabel';
import { StatusPill, type StatusTone } from '../feedback/StatusPill';
import { DependencyState, EmptyState, LoadingState, PartialState, StaleState } from '../feedback/TruthStates';

/**
 * Records as stacked records, for viewports a table cannot honestly serve.
 *
 * A desktop table on a phone becomes a horizontally scrolling strip in which
 * the operator sees one column at a time and the columns that carry the
 * warnings — status, provenance, the flag saying a figure is not authoritative
 * — are the ones off the right-hand edge. The critical truth is not lost by
 * accident in that layout; it is lost systematically, because it lives in the
 * columns nobody scrolls to.
 *
 * So this component stacks. Identity, status and provenance are rendered first
 * and unconditionally, primary fields next, secondary fields after them, and
 * actions last. Nothing the caller marks as critical is placed behind a
 * disclosure or dropped at a breakpoint.
 *
 * DOMAIN BOUNDARY
 *
 * The page supplies the record's key, its identity, its status TONE and WORDS,
 * its provenance KIND, and which fields are primary. This component invents
 * none of them. It does not know what a lot is, which status is bad, or where a
 * figure came from — asking it to decide any of that would put business meaning
 * in the layout layer.
 */

export interface RecordField {
  readonly label: string;
  readonly value: ReactNode;
  /** Money, counts and aligned identifiers get tabular figures. */
  readonly numeric?: boolean;
}

export interface RecordStatus {
  readonly tone: StatusTone;
  /** The words. A status is never a colour alone. */
  readonly label: string;
}

export interface ResponsiveRecord {
  readonly key: string;
  /** The operator-facing name of this record. Never a raw internal id. */
  readonly identity: ReactNode;
  /** A short qualifier under the identity, e.g. a public id or location. */
  readonly subheading?: ReactNode;
  readonly status?: RecordStatus;
  readonly provenance?: { readonly kind: ProvenanceKind; readonly detail?: string };
  /** Always visible, in order. */
  readonly primaryFields?: readonly RecordField[];
  /** Visible beneath the primary fields, in a quieter treatment. */
  readonly secondaryFields?: readonly RecordField[];
  /** Controls for this record. Rendered as supplied. */
  readonly actions?: ReactNode;
}

export interface ResponsiveRecordListProps {
  /** The list's accessible name. Required, as for any named region. */
  readonly label: string;
  readonly state: TruthState<readonly ResponsiveRecord[]>;
  readonly empty?: { readonly title: string; readonly description?: string; readonly action?: ReactNode };
  readonly onRetry?: () => void;
  readonly onRefresh?: () => void;
  readonly className?: string;
}

export function ResponsiveRecordList({
  label,
  state,
  empty,
  onRetry,
  onRefresh,
  className = '',
}: ResponsiveRecordListProps) {
  const records = hasValue(state) ? state.value : [];

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
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

      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'empty' && (
        <EmptyState
          title={empty?.title ?? 'No records'}
          description={empty?.description}
          action={empty?.action}
        />
      )}

      {records.length > 0 && (
        // A list, not a stack of divs: assistive technology announces how many
        // records there are and where the operator is within them.
        <ul aria-label={label} className="grid gap-2 list-none p-0 m-0">
          {records.map((record) => (
            <li
              key={record.key}
              data-record-key={record.key}
              className="rounded-instrument border border-subtle bg-surface-base p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink break-words">{record.identity}</p>
                  {record.subheading && (
                    <p className="text-xs text-ink-muted break-words">{record.subheading}</p>
                  )}
                </div>
                {/* Status and provenance travel WITH the identity. They are the
                    first things read, never the last things scrolled to. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {record.status && <StatusPill tone={record.status.tone}>{record.status.label}</StatusPill>}
                  {record.provenance && (
                    <ProvenanceLabel kind={record.provenance.kind} detail={record.provenance.detail} />
                  )}
                </div>
              </div>

              {record.primaryFields && record.primaryFields.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {record.primaryFields.map((field) => (
                    <div key={field.label} className="min-w-0">
                      <dt className="text-xs text-ink-muted">{field.label}</dt>
                      <dd className={`break-words text-ink ${field.numeric ? 'tabular-nums' : ''}`}>
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {record.secondaryFields && record.secondaryFields.length > 0 && (
                <dl className="mt-2 grid gap-1 border-t border-subtle pt-2 text-xs">
                  {record.secondaryFields.map((field) => (
                    <div key={field.label} className="flex flex-wrap gap-x-2">
                      <dt className="text-ink-muted">{field.label}</dt>
                      <dd className={`break-words text-ink-secondary ${field.numeric ? 'tabular-nums' : ''}`}>
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {record.actions && <div className="mt-3 flex flex-wrap gap-2">{record.actions}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

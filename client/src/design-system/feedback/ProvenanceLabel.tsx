import { StatusPill } from './StatusPill';
import type { StatusTone } from './StatusPill';

/**
 * A marker for WHERE a fact came from and HOW MUCH AUTHORITY it carries.
 *
 * This exists for the places where authority actually matters — a legacy row
 * beside a governed one, an imported figure the operator did not enter, a
 * marketplace number nobody in this business controls. It is deliberately not
 * a decoration for ordinary rows: stamping "Governed" onto every line in a
 * governed table teaches the operator that the word means nothing, and then the
 * one row that is NOT governed reads the same as the rest.
 *
 * The label never infers provenance. A caller that does not know where a fact
 * came from must not render this component rather than guessing, because a
 * wrong authority claim is worse than an absent one.
 *
 * Meaning is carried by the words. `ProvenanceLabel` renders a `StatusPill`,
 * whose label is required, and every kind below has a distinct phrase — the
 * tone is a second channel, never the only one.
 */
export type ProvenanceKind =
  /** From the governed backend: authoritative for this workspace. */
  | 'governed'
  /** From the retained legacy store: readable, NOT authoritative. */
  | 'legacy'
  /** Read from an uploaded/imported source document, not keyed by the operator. */
  | 'imported'
  /** Supplied by an external marketplace; outside this business's control. */
  | 'marketplace'
  /** Describes the present state of the record. */
  | 'current'
  /** Describes a point in the past and is not being kept up to date. */
  | 'historical';

interface ProvenanceMeaning {
  readonly label: string;
  readonly tone: StatusTone;
  /** The longer sentence, available to every operator, not only on hover. */
  readonly meaning: string;
}

const MEANING: Record<ProvenanceKind, ProvenanceMeaning> = {
  governed: {
    label: 'Governed',
    tone: 'success',
    meaning: 'From the governed record. Authoritative for this workspace.',
  },
  legacy: {
    label: 'Legacy, non-authoritative',
    tone: 'warning',
    meaning: 'From the retained legacy store. Not authoritative and not governed.',
  },
  imported: {
    label: 'Imported source evidence',
    tone: 'information',
    meaning: 'Read from imported source evidence rather than entered in this workspace.',
  },
  marketplace: {
    label: 'Marketplace source',
    tone: 'information',
    meaning: 'Supplied by an external marketplace. Not controlled or verified here.',
  },
  current: {
    label: 'Current',
    tone: 'neutral',
    meaning: 'Describes the present state of the record.',
  },
  historical: {
    label: 'Historical',
    tone: 'neutral',
    meaning: 'Describes a point in the past and is not kept up to date.',
  },
};

export interface ProvenanceLabelProps {
  readonly kind: ProvenanceKind;
  /**
   * Caller-supplied detail appended to the meaning, e.g. the name of the
   * marketplace or the import batch. Never invented by this component.
   */
  readonly detail?: string;
  /**
   * By default the longer meaning is available to assistive technology only,
   * so a dense table is not flooded with sentences. `full` puts it on screen
   * for the surfaces where the distinction is the point.
   */
  readonly meaningVisibility?: 'assistive' | 'full';
  readonly className?: string;
}

export function ProvenanceLabel({
  kind,
  detail,
  meaningVisibility = 'assistive',
  className = '',
}: ProvenanceLabelProps) {
  const { label, tone, meaning } = MEANING[kind];
  const sentence = detail ? `${meaning} ${detail}` : meaning;

  return (
    <span data-provenance={kind} className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <StatusPill tone={tone}>
        {label}
        {/* The sentence always reaches assistive technology. A pill reading
            "Legacy, non-authoritative" is honest but terse; the meaning is what
            tells an operator what to do about it. */}
        {meaningVisibility === 'assistive' && <span className="sr-only"> — {sentence}</span>}
      </StatusPill>
      {meaningVisibility === 'full' && <span className="text-xs text-ink-secondary">{sentence}</span>}
    </span>
  );
}

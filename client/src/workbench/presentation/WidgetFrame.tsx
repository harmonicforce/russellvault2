import type { ReactNode } from 'react';
import { GripVertical, ChevronUp, ChevronDown, X } from 'lucide-react';
import { IconButton, Button, ProvenanceLabel } from '../../design-system';
import {
  WIDGET_SIZE_LABELS,
  type PresentationFamily,
  type WidgetDefinition,
  type WidgetSize,
} from '../registry/widgetDefinition';

/**
 * The frame every widget renders inside.
 *
 * PRESENTATION FAMILY IS NOT TRUTH STATE
 *
 * The frame decides how much visual weight a widget carries — a Metric is a
 * bare figure, an Instrument is a bounded module, a Workspace is a larger tool
 * surface. It decides NOTHING about what the widget knows. A Metric that could
 * not load is still a Metric; it does not become an "error widget". The truth
 * state lives in the body, rendered by the S1.6.3 presentation components, and
 * the two axes never collapse into one.
 *
 * The frame also owns the edit-mode furniture, which is why it is generic:
 * drag handle, move controls, size control and remove all behave identically
 * for every widget, so an operator learns them once.
 */

export type WidgetFrameFamily = PresentationFamily;

const FAMILY_FRAME: Record<WidgetFrameFamily, string> = {
  // A Metric is a figure, not a card pile: the lightest frame that still
  // separates it from its neighbour.
  metric: 'rounded-instrument border border-subtle bg-surface-base p-3',
  // An Instrument is a bounded operational module.
  instrument: 'rounded-instrument border border-subtle bg-surface-base p-4',
  // A Workspace separates more strongly because it holds more.
  workspace: 'rounded-dialog border border-strong bg-surface-raised p-4 shadow-raised',
};

export interface WidgetFrameProps {
  readonly definition: WidgetDefinition;
  readonly size: WidgetSize;
  readonly children: ReactNode;
  /** Rendered in the header, e.g. a count pill the widget owns. */
  readonly headerAccessory?: ReactNode;

  // --- edit mode. All absent in normal mode, which is what keeps the frame
  // free of furniture when the operator is trying to read it. ---
  readonly editing?: boolean;
  readonly position?: { readonly index: number; readonly total: number };
  readonly onMoveEarlier?: () => void;
  readonly onMoveLater?: () => void;
  readonly onResize?: (size: WidgetSize) => void;
  readonly onRemove?: () => void;
  /** Props the interaction adapter attaches to the drag handle, if any. */
  readonly dragHandleProps?: Record<string, unknown>;
  readonly dragHandleRef?: (element: HTMLElement | null) => void;
}

export function WidgetFrame({
  definition,
  size,
  children,
  headerAccessory,
  editing = false,
  position,
  onMoveEarlier,
  onMoveLater,
  onResize,
  onRemove,
  dragHandleProps,
  dragHandleRef,
}: WidgetFrameProps) {
  const family = definition.presentation.family;
  const isFirst = position ? position.index === 0 : false;
  const isLast = position ? position.index === position.total - 1 : false;

  return (
    <section
      data-widget-id={definition.id}
      data-widget-family={family}
      data-widget-size={size}
      data-editing={editing ? 'true' : undefined}
      aria-label={definition.title}
      className={`flex h-full flex-col ${FAMILY_FRAME[family]}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* The handle exists ONLY in edit mode, and drag starts only here.
              A whole-widget drag target turns every attempt to scroll a queue
              on a tablet into an accidental reorder. */}
          {editing && (
            <span
              ref={dragHandleRef}
              data-drag-handle=""
              aria-hidden="true"
              className="-ml-1 cursor-grab touch-none rounded-control p-1 text-ink-muted"
              {...dragHandleProps}
            >
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <h3 className={`truncate font-semibold ${family === 'metric' ? 'text-xs text-ink-muted' : 'text-sm text-ink'}`}>
            {definition.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">{headerAccessory}</div>
      </div>

      <div className="min-w-0 flex-1">{children}</div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-2">
          {/* Buttons, not only drag. An operator on a keyboard, a screen reader,
              or a trackpad they cannot drag precisely with gets the same
              capability — and it drives the same order model drag does. */}
          {onMoveEarlier && (
            <Button
              size="small"
              onClick={onMoveEarlier}
              disabled={isFirst}
              aria-label={`Move ${definition.title} earlier`}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> Earlier
            </Button>
          )}
          {onMoveLater && (
            <Button size="small" onClick={onMoveLater} disabled={isLast} aria-label={`Move ${definition.title} later`}>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> Later
            </Button>
          )}

          {onResize && definition.presentation.supportedSizes.length > 1 && (
            <label className="flex items-center gap-1 text-xs text-ink-secondary">
              <span className="sr-only">{`Size for ${definition.title}`}</span>
              <select
                aria-label={`Size for ${definition.title}`}
                value={size}
                onChange={(event) => onResize(event.target.value as WidgetSize)}
                className="min-h-9 rounded-control border border-subtle bg-surface-base px-2 py-1 text-xs"
              >
                {/* Only the sizes this widget declares. An unsupported size is
                    not offered, so it can never be chosen and later repaired. */}
                {definition.presentation.supportedSizes.map((supported) => (
                  <option key={supported} value={supported}>
                    {WIDGET_SIZE_LABELS[supported]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {onRemove && (
            <IconButton label={`Remove ${definition.title}`} onClick={onRemove} className="ml-auto">
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The provenance marker for a widget, shown only where authority is genuinely
 * in question. Governed widgets carry nothing — a badge on everything is a
 * badge that means nothing.
 */
export function WidgetProvenance({ definition }: { readonly definition: WidgetDefinition }) {
  if (definition.data.provenance === 'governed') return null;
  return <ProvenanceLabel kind={definition.data.provenance} />;
}

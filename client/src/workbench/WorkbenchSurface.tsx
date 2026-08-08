import { useMemo, useState, type ReactNode } from 'react';
import { LayoutGrid, Pencil, RotateCcw, Check } from 'lucide-react';
import { Alert, Button } from '../design-system';
import type { WidgetAvailabilityContext, WidgetSize, WorkbenchSurface as Surface } from './registry/widgetDefinition';
import { isAvailableIn } from './registry/widgetDefinition';
import { findDefinition } from './registry/widgetRegistry';
import { WidgetFrame } from './presentation/WidgetFrame';
import { WORKBENCH_GRID_CLASS, gridSpanClass } from './presentation/grid';
import { WidgetCatalog } from './WidgetCatalog';
import { WorkbenchDragContext, useWorkbenchSortable } from './interaction/WorkbenchInteractionAdapter';
import { DEVICE_LOCAL_NOTICE } from './layout/browserLayoutStore';
import type { WorkbenchLayoutController } from './useWorkbenchLayout';
import type { WidgetInstance } from './layout/layoutModel';

/**
 * A customizable Workbench surface.
 *
 * TWO MODES, AND THE DIFFERENCE MATTERS
 *
 * NORMAL is the mode an operator spends their day in. There is no drag handle,
 * no size control, no remove button and no drag context mounted at all — links
 * and queue rows behave exactly as they would on any page, and scrolling a
 * queue on a tablet cannot reorder anything because nothing is listening.
 *
 * EDIT is entered deliberately through Customize and left through Done. Only
 * then does the furniture appear.
 *
 * REORDERING IS NEVER DRAG-ONLY
 *
 * Every widget in edit mode carries Move earlier / Move later buttons naming
 * the widget they move. They drive the same `reorder`/`move` model a drag does.
 * This is not a fallback for when dnd-kit fails — it is the primary accessible
 * path, and it would still be here if the package were removed tomorrow.
 */

export interface WorkbenchSurfaceProps {
  readonly surface: Surface;
  readonly controller: WorkbenchLayoutController;
  readonly context: WidgetAvailabilityContext;
  /** Renders one widget's body. Supplied by the page that owns the data. */
  readonly renderBody: (definitionId: string, size: WidgetSize) => ReactNode;
  /** Renders the header accessory, typically a count. */
  readonly renderAccessory?: (definitionId: string) => ReactNode;
  /** Heading for the region. */
  readonly label: string;
  readonly description?: string;
}

export function WorkbenchSurfaceRegion({
  surface,
  controller,
  context,
  renderBody,
  renderAccessory,
  label,
  description,
}: WorkbenchSurfaceProps) {
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const { layout } = controller;

  // A widget whose requirements stopped being satisfied (the workspace changed
  // role, a transport was disabled) is not rendered — but it is NOT deleted
  // from the layout either. Removing it would silently discard the operator's
  // arrangement over a condition that may be temporary.
  const renderable = useMemo(
    () =>
      layout.instances
        .map((instance) => ({ instance, definition: findDefinition(instance.definitionId) }))
        .filter(
          (entry): entry is { instance: WidgetInstance; definition: NonNullable<typeof entry.definition> } =>
            entry.definition !== null && isAvailableIn(entry.definition, context),
        ),
    [layout.instances, context],
  );

  const orderedIds = useMemo(() => renderable.map((entry) => entry.instance.instanceId), [renderable]);

  const move = (instanceId: string, direction: -1 | 1, title: string) => {
    const index = orderedIds.indexOf(instanceId);
    controller.move(instanceId, direction);
    // Announced, because a widget silently changing position is a change a
    // screen-reader operator has no way to perceive.
    const target = index + direction;
    setAnnouncement(
      target < 0 || target >= orderedIds.length
        ? `${title} is already ${direction === -1 ? 'first' : 'last'}.`
        : `${title} moved to position ${target + 1} of ${orderedIds.length}.`,
    );
  };

  const grid = (
    <div className={WORKBENCH_GRID_CLASS} data-workbench-grid={surface}>
      {renderable.map((entry, index) => (
        <WorkbenchWidget
          key={entry.instance.instanceId}
          index={index}
          total={renderable.length}
          editing={editing}
          instance={entry.instance}
          definition={entry.definition}
          renderBody={renderBody}
          renderAccessory={renderAccessory}
          onMoveEarlier={() => move(entry.instance.instanceId, -1, entry.definition.title)}
          onMoveLater={() => move(entry.instance.instanceId, 1, entry.definition.title)}
          onResize={(size) => controller.resize(entry.instance.instanceId, size)}
          onRemove={() => {
            controller.removeInstanceById(entry.instance.instanceId);
            setAnnouncement(`${entry.definition.title} removed.`);
          }}
        />
      ))}
    </div>
  );

  return (
    <section aria-label={label} data-workbench-surface={surface} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <LayoutGrid className="h-4 w-4 text-accent" aria-hidden="true" /> {label}
          </h2>
          {description && <p className="text-xs text-ink-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="small" onClick={() => setCatalogOpen(true)}>
                Widget catalog
              </Button>
              <Button
                size="small"
                onClick={() => {
                  controller.reset();
                  setAnnouncement('Layout reset to its default arrangement.');
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset layout
              </Button>
              <Button size="small" variant="primary" onClick={() => setEditing(false)}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Done
              </Button>
            </>
          ) : (
            <Button size="small" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Customize
            </Button>
          )}
        </div>
      </div>

      {editing && <p className="text-xs text-ink-muted">{DEVICE_LOCAL_NOTICE}</p>}

      {controller.repairs.length > 0 && (
        <Alert tone="information" title="Your saved layout was repaired">
          <ul className="list-disc pl-4">
            {controller.repairs.map((repair) => (
              <li key={repair}>{repair}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* A polite live region, so movement is perceivable without sight. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {renderable.length === 0 ? (
        <p className="rounded-instrument border border-subtle bg-surface-base p-6 text-center text-sm text-ink-secondary">
          No widgets on this surface. Open the widget catalog to add one.
        </p>
      ) : editing ? (
        // The drag context exists ONLY in edit mode.
        <WorkbenchDragContext items={orderedIds} onReorder={controller.reorder}>
          {grid}
        </WorkbenchDragContext>
      ) : (
        grid
      )}

      <WidgetCatalog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        context={context}
        layout={layout}
        onAdd={controller.add}
        onRemove={controller.removeDefinition}
      />
    </section>
  );
}

function WorkbenchWidget({
  instance,
  definition,
  index,
  total,
  editing,
  renderBody,
  renderAccessory,
  onMoveEarlier,
  onMoveLater,
  onResize,
  onRemove,
}: {
  readonly instance: WidgetInstance;
  readonly definition: NonNullable<ReturnType<typeof findDefinition>>;
  readonly index: number;
  readonly total: number;
  readonly editing: boolean;
  readonly renderBody: (definitionId: string, size: WidgetSize) => ReactNode;
  readonly renderAccessory?: (definitionId: string) => ReactNode;
  readonly onMoveEarlier: () => void;
  readonly onMoveLater: () => void;
  readonly onResize: (size: WidgetSize) => void;
  readonly onRemove: () => void;
}) {
  // `disabled` when not editing means the package registers nothing at all,
  // which is what keeps normal mode entirely free of drag behaviour.
  const { ref, handleRef, isDragging } = useWorkbenchSortable(instance.instanceId, index, !editing);

  return (
    <div
      ref={ref}
      className={`${gridSpanClass(instance.size)} ${isDragging ? 'opacity-60' : ''}`}
      data-instance-id={instance.instanceId}
    >
      <WidgetFrame
        definition={definition}
        size={instance.size}
        editing={editing}
        position={{ index, total }}
        dragHandleRef={handleRef}
        headerAccessory={renderAccessory?.(definition.id)}
        onMoveEarlier={onMoveEarlier}
        onMoveLater={onMoveLater}
        onResize={onResize}
        onRemove={onRemove}
      >
        {renderBody(definition.id, instance.size)}
      </WidgetFrame>
    </div>
  );
}

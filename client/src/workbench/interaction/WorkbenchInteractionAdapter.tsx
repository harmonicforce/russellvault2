import { useCallback, useRef, type ReactNode } from 'react';
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react';
import { PointerActivationConstraints } from '@dnd-kit/dom';
import { useSortable } from '@dnd-kit/react/sortable';

/**
 * THE ONLY FILE IN THE APPLICATION THAT IMPORTS @dnd-kit/react.
 *
 * Pinned to `@dnd-kit/react@0.5.0` — the package's `latest` dist-tag and its
 * newest STABLE release. The registry also publishes a stream of
 * `0.5.1-beta-*` builds; a prerelease is not adopted merely for being newest,
 * because a beta drag library is a beta reorder for the operator.
 *
 * WHY A CONTAINMENT BOUNDARY
 *
 * Drag-and-drop libraries churn. If `useSortable` appeared in nine widget files
 * and two pages, replacing the package would be a rewrite of the Workbench
 * rather than a rewrite of this file. So: no widget, no page, and no widget
 * definition imports the package. They speak the vocabulary below —
 * `items`, `onReorder`, indices — and this adapter translates.
 *
 * The vocabulary is deliberately reduced to what the Workbench actually needs:
 * an ordered list of ids, and a callback saying "the item at index `from`
 * belongs at index `to`". That is the same operation the Move earlier / Move
 * later buttons perform, which is what makes the two paths share one order
 * model rather than each maintaining its own.
 *
 * WHAT THIS ADAPTER DOES NOT PROMISE
 *
 * jsdom has no layout, no pointer geometry and no touch. Nothing in the test
 * suite proves a real drag gesture works; what is proved is that a reorder
 * REPORTED by this adapter drives the canonical order exactly as a button
 * press does. Real pointer/touch proof is S1.6.7's.
 */

/** Activation constraints, in one place so both sensors stay explained. */
const SENSORS = [
  // A touch drag must not start the instant a finger lands on the handle: on an
  // iPad, that turns every attempt to scroll a queue into a reorder. A short
  // hold distinguishes "I am moving this" from "I am scrolling past it".
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Delay({ value: 200, tolerance: 8 }),
      new PointerActivationConstraints.Distance({ value: 6 }),
    ],
  }),
  // Present so the package's own keyboard path works where it can. It is NOT
  // the accessible reorder story — the explicit Move earlier/later buttons are,
  // and they keep working if this sensor ever regresses.
  KeyboardSensor,
];

export interface WorkbenchDragContextProps {
  /** Ordered instance ids. Index in this array IS the widget's priority. */
  readonly items: readonly string[];
  /** Reported when a drag settles. Indices into `items`. */
  readonly onReorder: (from: number, to: number) => void;
  readonly children: ReactNode;
}

/**
 * The drag context.
 *
 * Mounted only in edit mode. In normal mode no provider exists at all, so no
 * sensor is listening and content interactions cannot be intercepted.
 */
export function WorkbenchDragContext({ items, onReorder, children }: WorkbenchDragContextProps) {
  // Read through a ref so a drag that started before a re-render still resolves
  // against the order that is actually on screen.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const handleDragEnd = useCallback(
    (event: { operation: { source: { id: unknown } | null; target: { id: unknown } | null }; canceled: boolean }) => {
      // A cancelled drag — Escape, or a drop outside — must change nothing.
      if (event.canceled) return;
      const sourceId = event.operation.source?.id;
      const targetId = event.operation.target?.id;
      if (typeof sourceId !== 'string' || typeof targetId !== 'string') return;
      if (sourceId === targetId) return;
      const from = itemsRef.current.indexOf(sourceId);
      const to = itemsRef.current.indexOf(targetId);
      if (from < 0 || to < 0) return;
      onReorder(from, to);
    },
    [onReorder],
  );

  return (
    <DragDropProvider sensors={SENSORS} onDragEnd={handleDragEnd as never}>
      {children}
    </DragDropProvider>
  );
}

export interface SortableHandles {
  /** Attach to the widget's outer element. */
  readonly ref: (element: HTMLElement | null) => void;
  /** Attach to the visible drag handle — and nowhere else. */
  readonly handleRef: (element: HTMLElement | null) => void;
  readonly isDragging: boolean;
}

/**
 * Make one widget sortable.
 *
 * `handleRef` is separate from `ref` on purpose: the package is told that the
 * grip is the only drag origin, so pressing anywhere else in the widget —
 * a link, a select, a queue row — behaves normally.
 */
export function useWorkbenchSortable(id: string, index: number, disabled: boolean): SortableHandles {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled });
  return { ref: ref as (element: HTMLElement | null) => void, handleRef: handleRef as (element: HTMLElement | null) => void, isDragging };
}

/**
 * The reorder operation, expressed without the package.
 *
 * Exported so the adapter's contract can be tested — and so the button path and
 * the drag path demonstrably compute the same result — without a test having to
 * simulate pointer events jsdom cannot produce.
 */
export function applyReorder<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The pinned version, surfaced so documentation and tests cannot drift. */
export const DND_KIT_REACT_VERSION = '0.5.0';

// The Workbench grid.
//
// CSS Grid, not react-grid-layout, and not free-pixel geometry. A widget
// declares a SEMANTIC size; the grid decides what that means at each viewport.
//
// PRIORITY IS PRESERVED, GEOMETRY IS NOT
//
// Exactly one order is persisted. On a narrow screen the columns collapse and
// widgets stack, but the sequence the operator arranged is the sequence they
// read — there is no second per-breakpoint arrangement to drift out of step
// with the first. What changes across breakpoints is how much horizontal space
// a size buys; what never changes is which widget comes first.
//
// | Viewport            | Logical columns | Behaviour                        |
// | ------------------- | --------------- | -------------------------------- |
// | Phone   <640        | 2               | ordered, effectively full-width  |
// | Tablet portrait     | 6               | 2–3 widgets per row              |
// | Tablet landscape lg | 12              | full 12-column reading           |
// | Desktop xl          | 12              | same, more breathing room        |
// | Wide 2xl            | 12              | same, wider gutters              |

import type { WidgetSize } from '../registry/widgetDefinition';

/** The grid container. Column COUNT changes; the order never does. */
export const WORKBENCH_GRID_CLASS = [
  'grid gap-4',
  'grid-cols-2', // phone
  'sm:grid-cols-6', // tablet portrait
  'lg:grid-cols-12', // tablet landscape and up
  '2xl:gap-5', // wide: breathing room, not more columns
].join(' ');

/**
 * How many logical columns each semantic size occupies.
 *
 * On a phone every size spans the full two columns: a "compact" widget squeezed
 * into half a 390px screen is not compact, it is unreadable.
 */
const SPAN: Record<WidgetSize, string> = {
  compact: 'col-span-2 sm:col-span-2 lg:col-span-3',
  standard: 'col-span-2 sm:col-span-3 lg:col-span-4',
  expanded: 'col-span-2 sm:col-span-6 lg:col-span-6',
  wide: 'col-span-2 sm:col-span-6 lg:col-span-8',
  full: 'col-span-2 sm:col-span-6 lg:col-span-12',
};

export function gridSpanClass(size: WidgetSize): string {
  return SPAN[size];
}

/** The logical column count a size occupies at the widest breakpoint. */
export const LOGICAL_COLUMNS: Record<WidgetSize, number> = {
  compact: 3,
  standard: 4,
  expanded: 6,
  wide: 8,
  full: 12,
};

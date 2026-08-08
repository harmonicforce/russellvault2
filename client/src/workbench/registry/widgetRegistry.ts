// Registry lookup.
//
// A pure index over the definitions. It answers "what exists", "what may be
// offered here", and "what is this id" — and nothing else. No fetching, no
// state, no React.

import { WIDGET_DEFINITIONS } from './definitions';
import {
  isAvailableIn,
  isOfferable,
  type WidgetAvailabilityContext,
  type WidgetDefinition,
} from './widgetDefinition';

const BY_ID = new Map<string, WidgetDefinition>(WIDGET_DEFINITIONS.map((d) => [d.id, d]));

// A duplicate id would mean two definitions fighting over the same persisted
// layout entries, and the loser would be whichever happened to be registered
// second. Caught at module load rather than at runtime in front of an operator.
if (BY_ID.size !== WIDGET_DEFINITIONS.length) {
  const seen = new Set<string>();
  const duplicates = WIDGET_DEFINITIONS.map((d) => d.id).filter((id) => !seen.add(id));
  throw new Error(`Duplicate widget definition id(s): ${[...new Set(duplicates)].join(', ')}`);
}

/** Every definition, including `planned` and `retired`. For documentation. */
export function allDefinitions(): readonly WidgetDefinition[] {
  return WIDGET_DEFINITIONS;
}

export function findDefinition(id: string): WidgetDefinition | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The definitions that may be OFFERED in this environment.
 *
 * This is what the catalogue renders. Anything filtered out here is absent, not
 * greyed out and not advertised: a widget the operator cannot use is noise, and
 * a `planned` one shown as "coming soon" is a promise the interface has no
 * business making.
 */
export function availableDefinitions(context: WidgetAvailabilityContext): readonly WidgetDefinition[] {
  return WIDGET_DEFINITIONS.filter((definition) => isAvailableIn(definition, context));
}

export { isAvailableIn, isOfferable };

// The persisted layout model.
//
// A layout records PRESENTATION PREFERENCE and nothing else: which widgets the
// operator wants, in what order, at what size. It holds no counts, no money, no
// API responses, no authorization facts and no provenance — server truth is
// read fresh every time, so a stale cache can never become a displayed fact.
//
// The doctrine this implements:
//
//     The operator may customize perspective, but never truth.
//
// Everything in a `WidgetInstance` is perspective. There is deliberately no
// field a business value could be written into, which is what makes the rule
// enforceable rather than merely stated.

import {
  allowsMultiple,
  supportsSize,
  WIDGET_SIZES,
  type WidgetSize,
  type WorkbenchSurface,
} from '../registry/widgetDefinition';
import { findDefinition } from '../registry/widgetRegistry';

/** Bump when the persisted SHAPE changes. A mismatch resets to defaults. */
export const LAYOUT_SCHEMA_VERSION = 1;

export interface WidgetInstance {
  /** Which definition this instance renders. */
  readonly definitionId: string;
  /** Stable per instance, so React keys and move controls stay attached. */
  readonly instanceId: string;
  /** The operator's chosen size. Always one the definition supports. */
  readonly size: WidgetSize;
  /**
   * Widget-declared presentation settings, when a definition has any. Values
   * are opaque strings/booleans/numbers — never a business value. Nothing in
   * this slice writes it; it exists so a later widget need not change the
   * persisted shape.
   */
  readonly settings?: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkbenchLayout {
  readonly schemaVersion: number;
  readonly surface: WorkbenchSurface;
  /** Order IS priority. Index 0 is what the operator wants to see first. */
  readonly instances: readonly WidgetInstance[];
}

// --- defaults ---------------------------------------------------------------

/**
 * The default layouts.
 *
 * Daily Workbench reproduces the order the page has always shown, so an
 * operator who never customizes anything sees what they saw before. Home gets a
 * shorter awareness set, because Home also carries the fixed governed dashboard
 * panels and the legacy region beneath it.
 */
const DEFAULT_ORDER: Record<WorkbenchSurface, readonly string[]> = {
  'daily-workbench': [
    'inventory.needs-location',
    'inventory.needs-photos',
    'inventory.unclassified-category',
    'inventory.needs-condition-details',
    'governance.open-corrections',
    'sell.listing-prep-backlog',
    'intake.open-sessions',
    'utility.quick-actions',
    'inventory.record-count',
  ],
  home: ['inventory.record-count', 'governance.open-corrections', 'inventory.needs-location', 'utility.quick-actions'],
};

let instanceCounter = 0;

/** A stable-enough id. Layouts are device-local, so this need not be a UUID. */
export function newInstanceId(definitionId: string): string {
  instanceCounter += 1;
  return `${definitionId}#${Date.now().toString(36)}${instanceCounter.toString(36)}`;
}

export function defaultLayout(surface: WorkbenchSurface): WorkbenchLayout {
  const instances: WidgetInstance[] = [];
  for (const definitionId of DEFAULT_ORDER[surface]) {
    const definition = findDefinition(definitionId);
    // A default naming a definition that no longer exists is a repository bug,
    // not an operator problem: skip it rather than rendering a hole.
    if (!definition) continue;
    instances.push({
      definitionId,
      instanceId: newInstanceId(definitionId),
      size: definition.presentation.defaultSize,
    });
  }
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, surface, instances };
}

// --- repair -----------------------------------------------------------------

export interface RepairResult {
  readonly layout: WorkbenchLayout;
  /** What had to be corrected. Empty when the stored layout was already sound. */
  readonly repairs: readonly string[];
}

function isSize(value: unknown): value is WidgetSize {
  return typeof value === 'string' && (WIDGET_SIZES as readonly string[]).includes(value);
}

/**
 * Make an untrusted layout safe to render.
 *
 * Stored layouts are device-local JSON an operator (or a broken older build, or
 * a browser extension) can have written anything into. Every rule below repairs
 * rather than rejects where repairing preserves the operator's intent, and
 * discards only what cannot be honoured:
 *
 *   - unknown definition id  → dropped (the widget no longer exists)
 *   - retired/unofferable    → dropped
 *   - unsupported size       → repaired to the definition's default
 *   - duplicate single-instance → first occurrence kept, deterministically
 *   - missing/duplicate instance id → regenerated
 *
 * A repair is never silent to the caller: `repairs` says what happened, so a
 * test can prove the difference between "nothing was wrong" and "we quietly
 * threw the operator's layout away".
 */
export function repairLayout(candidate: unknown, surface: WorkbenchSurface): RepairResult {
  const repairs: string[] = [];

  if (candidate === null || typeof candidate !== 'object') {
    return { layout: defaultLayout(surface), repairs: ['The stored layout was not an object.'] };
  }

  const record = candidate as Record<string, unknown>;

  if (record.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    // A different schema version is not corruption — it is an older build's
    // honest output. It still cannot be interpreted, so it resets rather than
    // being guessed at field by field.
    return {
      layout: defaultLayout(surface),
      repairs: [`The stored layout used schema version ${String(record.schemaVersion)}; defaults were restored.`],
    };
  }

  if (record.surface !== surface) {
    return {
      layout: defaultLayout(surface),
      repairs: [`The stored layout belonged to the ${String(record.surface)} surface.`],
    };
  }

  if (!Array.isArray(record.instances)) {
    return { layout: defaultLayout(surface), repairs: ['The stored layout held no widget list.'] };
  }

  const instances: WidgetInstance[] = [];
  const seenDefinitions = new Set<string>();
  const seenInstanceIds = new Set<string>();

  for (const raw of record.instances) {
    if (raw === null || typeof raw !== 'object') {
      repairs.push('A stored widget entry was not an object and was removed.');
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const definitionId = typeof entry.definitionId === 'string' ? entry.definitionId : null;
    if (!definitionId) {
      repairs.push('A stored widget entry named no widget and was removed.');
      continue;
    }

    const definition = findDefinition(definitionId);
    if (!definition) {
      repairs.push(`"${definitionId}" is not a widget in this build and was removed.`);
      continue;
    }
    if (definition.lifecycle === 'retired') {
      repairs.push(`"${definition.title}" has been retired and was removed.`);
      continue;
    }

    if (seenDefinitions.has(definitionId) && !allowsMultiple(definition)) {
      // Deterministic: the FIRST occurrence wins, so repairing the same broken
      // layout twice produces the same result.
      repairs.push(`"${definition.title}" appeared more than once; the first was kept.`);
      continue;
    }
    seenDefinitions.add(definitionId);

    let size = entry.size;
    if (!isSize(size) || !supportsSize(definition, size)) {
      repairs.push(`"${definition.title}" had an unsupported size and was reset to its default.`);
      size = definition.presentation.defaultSize;
    }

    let instanceId = typeof entry.instanceId === 'string' && entry.instanceId !== '' ? entry.instanceId : null;
    if (!instanceId || seenInstanceIds.has(instanceId)) {
      if (instanceId) repairs.push(`"${definition.title}" reused another widget's instance id.`);
      instanceId = newInstanceId(definitionId);
    }
    seenInstanceIds.add(instanceId);

    const settings =
      entry.settings !== null && typeof entry.settings === 'object' && !Array.isArray(entry.settings)
        ? sanitizeSettings(entry.settings as Record<string, unknown>)
        : undefined;

    instances.push({ definitionId, instanceId, size: size as WidgetSize, settings });
  }

  return { layout: { schemaVersion: LAYOUT_SCHEMA_VERSION, surface, instances }, repairs };
}

/**
 * Keep only scalar settings.
 *
 * An object or array here is the shape a cached API response would arrive in,
 * and this is the one place a layout could otherwise grow business data. Scalars
 * only, always.
 */
function sanitizeSettings(input: Record<string, unknown>): Readonly<Record<string, string | number | boolean>> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

// --- mutations --------------------------------------------------------------
// All pure. The caller owns persistence.

export function moveInstance(layout: WorkbenchLayout, instanceId: string, direction: -1 | 1): WorkbenchLayout {
  const index = layout.instances.findIndex((i) => i.instanceId === instanceId);
  if (index < 0) return layout;
  const target = index + direction;
  if (target < 0 || target >= layout.instances.length) return layout;
  const instances = [...layout.instances];
  const [moved] = instances.splice(index, 1);
  instances.splice(target, 0, moved);
  return { ...layout, instances };
}

/** Move by absolute position — what a drag reports. Shares the order model. */
export function reorderInstances(layout: WorkbenchLayout, from: number, to: number): WorkbenchLayout {
  if (from === to) return layout;
  if (from < 0 || from >= layout.instances.length) return layout;
  if (to < 0 || to >= layout.instances.length) return layout;
  const instances = [...layout.instances];
  const [moved] = instances.splice(from, 1);
  instances.splice(to, 0, moved);
  return { ...layout, instances };
}

export function removeInstance(layout: WorkbenchLayout, instanceId: string): WorkbenchLayout {
  return { ...layout, instances: layout.instances.filter((i) => i.instanceId !== instanceId) };
}

export function resizeInstance(layout: WorkbenchLayout, instanceId: string, size: WidgetSize): WorkbenchLayout {
  return {
    ...layout,
    instances: layout.instances.map((instance) => {
      if (instance.instanceId !== instanceId) return instance;
      const definition = findDefinition(instance.definitionId);
      // An unsupported size is refused rather than stored and repaired later:
      // the layout on screen and the layout on disk stay the same thing.
      if (!definition || !supportsSize(definition, size)) return instance;
      return { ...instance, size };
    }),
  };
}

export function addInstance(layout: WorkbenchLayout, definitionId: string): WorkbenchLayout {
  const definition = findDefinition(definitionId);
  if (!definition) return layout;
  if (!allowsMultiple(definition) && layout.instances.some((i) => i.definitionId === definitionId)) return layout;
  return {
    ...layout,
    instances: [
      ...layout.instances,
      { definitionId, instanceId: newInstanceId(definitionId), size: definition.presentation.defaultSize },
    ],
  };
}

export function containsDefinition(layout: WorkbenchLayout, definitionId: string): boolean {
  return layout.instances.some((instance) => instance.definitionId === definitionId);
}

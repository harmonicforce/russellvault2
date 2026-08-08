// The WidgetDefinition contract.
//
// A definition DESCRIBES a widget. It does not fetch, compute, aggregate, or
// authorize anything. That separation is the whole point: the registry is a
// catalogue of what exists and under what conditions it may be offered, and the
// domain/query layer supplies typed facts to whatever gets rendered.
//
// The rule this file exists to enforce:
//
//     REGISTRY METADATA NEVER TOUCHES BUSINESS DATA.
//
// There is deliberately no `load()`, no `query`, no `count`, and no transport
// on a definition. A definition that could fetch would be a place where a
// business rule could hide inside presentation metadata, and the layout layer
// would end up owning truth it has no right to own.

import type { ProvenanceKind } from '../../design-system';

/** Where a widget may be mounted. */
export type WorkbenchSurface = 'home' | 'daily-workbench';

export const WORKBENCH_SURFACES = ['home', 'daily-workbench'] as const satisfies readonly WorkbenchSurface[];

/**
 * How available a widget is.
 *
 * `planned` and `retired` are METADATA ONLY. They are recorded so the roadmap
 * has somewhere honest to live, and they are never offered in the active
 * catalogue — a "coming soon" card is an advertisement, not a feature, and the
 * operator cannot tell the difference from a broken one.
 */
export type WidgetLifecycle = 'available' | 'experimental' | 'planned' | 'retired';

/** Which visual family a widget belongs to. Orthogonal to its truth state. */
export type PresentationFamily = 'metric' | 'instrument' | 'workspace';

/** The operator-facing size vocabulary. Never pixels. */
export type WidgetSize = 'compact' | 'standard' | 'expanded' | 'wide' | 'full';

export const WIDGET_SIZES = ['compact', 'standard', 'expanded', 'wide', 'full'] as const satisfies readonly WidgetSize[];

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  compact: 'Compact',
  standard: 'Standard',
  expanded: 'Expanded',
  wide: 'Wide',
  full: 'Full',
};

/** The governed domain a widget belongs to, for catalogue grouping. */
export type WidgetDomain = 'inventory' | 'intake' | 'sell' | 'governance' | 'utility';

export const WIDGET_DOMAIN_LABELS: Record<WidgetDomain, string> = {
  inventory: 'Inventory',
  intake: 'Intake',
  sell: 'Sell',
  governance: 'Governance',
  utility: 'Utility',
};

/**
 * A named dependency the deployment must satisfy before a widget can be
 * offered. Resolved by the host, never by the definition itself.
 */
export type WidgetRequirement =
  /** The governed Supabase surfaces are configured in this build. */
  | 'governed-backend'
  /** The intake transport is configured (it has its own feature flag). */
  | 'intake-transport'
  /** A workspace is currently selected. */
  | 'active-workspace';

/** What the caller can tell us about the environment a widget would run in. */
export interface WidgetAvailabilityContext {
  readonly surface: WorkbenchSurface;
  readonly satisfiedRequirements: readonly WidgetRequirement[];
  /** The caller's role in the active workspace, when one is selected. */
  readonly role: 'owner' | 'operator' | 'viewer' | null;
}

export interface WidgetDataContract {
  /**
   * The governed source this widget's facts come from, named so a reader can
   * check the claim. Descriptive only — the registry does not call it.
   */
  readonly source: string;
  /** How authoritative that source is. Declared, never inferred at runtime. */
  readonly provenance: ProvenanceKind;
  /** What the widget's numbers do and do not cover, in the operator's words. */
  readonly coverage: string;
  /** When the facts are re-read. `manual` means only on an explicit refresh. */
  readonly refresh: 'on-mount' | 'manual';
  /**
   * What a genuine zero MEANS for this widget, so `empty` can never be
   * confused with "the request failed". Every definition must answer this.
   */
  readonly genuineEmpty: string;
  /**
   * Whether the widget may keep showing a previous value while a refresh is in
   * flight. False means it must fall back to `loading`.
   */
  readonly allowStaleWhileRefreshing: boolean;
}

export interface WidgetSizeBehaviour {
  readonly size: WidgetSize;
  /** What this size adds over the smaller one, in the operator's words. */
  readonly shows: string;
}

export interface WidgetPresentationContract {
  readonly family: PresentationFamily;
  readonly supportedSizes: readonly WidgetSize[];
  readonly defaultSize: WidgetSize;
  /** What information each supported size carries. One entry per size. */
  readonly sizeBehaviour: readonly WidgetSizeBehaviour[];
  /** How the widget behaves on a narrow viewport. */
  readonly responsive: 'stacks-full-width' | 'keeps-compact';
}

export interface WidgetInteractionContract {
  /** `read-only` widgets never mutate. `action-capable` may navigate/act. */
  readonly mode: 'read-only' | 'action-capable';
  /** Where the full workflow lives, when this widget only points at it. */
  readonly destination?: string;
  /** Whether the widget exposes local presentation settings of its own. */
  readonly hasLocalPresentationSettings: boolean;
  /** Whether the widget may refresh itself without an operator asking. */
  readonly allowBackgroundRefresh: boolean;
}

export interface WidgetDefinition {
  // --- identity ---
  /** Stable across releases. Persisted in layouts, so it may never change. */
  readonly id: string;
  /** Bumped when the definition's own shape changes meaningfully. */
  readonly definitionVersion: number;
  readonly title: string;
  /** One sentence. Shown in the catalogue. */
  readonly description: string;
  readonly domain: WidgetDomain;

  // --- availability ---
  readonly lifecycle: WidgetLifecycle;
  /** Minimum role. `null` means any member may see it. */
  readonly requiredRole: 'owner' | 'operator' | null;
  readonly requirements: readonly WidgetRequirement[];
  readonly surfaces: readonly WorkbenchSurface[];

  // --- contracts ---
  readonly data: WidgetDataContract;
  readonly presentation: WidgetPresentationContract;
  readonly interaction: WidgetInteractionContract;

  /**
   * Whether a layout may hold more than one instance.
   *
   * Defaults to FALSE everywhere it is not stated, and a definition that wants
   * `true` has to say why in `allowMultipleReason`. Two identical widgets
   * showing the same number is clutter, not customization.
   */
  readonly allowMultiple?: boolean;
  readonly allowMultipleReason?: string;
}

/** Single instance unless the definition explicitly justifies otherwise. */
export function allowsMultiple(definition: WidgetDefinition): boolean {
  return definition.allowMultiple === true;
}

/** Whether a widget may ever appear in the active catalogue. */
export function isOfferable(definition: WidgetDefinition): boolean {
  return definition.lifecycle === 'available' || definition.lifecycle === 'experimental';
}

const ROLE_RANK: Record<'viewer' | 'operator' | 'owner', number> = { viewer: 0, operator: 1, owner: 2 };

/**
 * Whether this environment can offer the widget.
 *
 * Every clause is a fact the HOST supplied. Nothing here asks a server, and a
 * definition that is filtered out is simply not offered — no placeholder, no
 * "unavailable" card, no advertisement for something the operator cannot use.
 */
export function isAvailableIn(definition: WidgetDefinition, context: WidgetAvailabilityContext): boolean {
  if (!isOfferable(definition)) return false;
  if (!definition.surfaces.includes(context.surface)) return false;
  if (definition.requiredRole !== null) {
    if (context.role === null) return false;
    if (ROLE_RANK[context.role] < ROLE_RANK[definition.requiredRole]) return false;
  }
  return definition.requirements.every((requirement) => context.satisfiedRequirements.includes(requirement));
}

/** Whether a size is one this definition actually supports. */
export function supportsSize(definition: WidgetDefinition, size: WidgetSize): boolean {
  return definition.presentation.supportedSizes.includes(size);
}

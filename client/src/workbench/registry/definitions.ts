// The Russell Vault widget registry.
//
// EVERY DEFINITION HERE DESCRIBES A FACT THE APPLICATION ALREADY READS.
//
// Each `data.source` names a transport method that exists today in
// `lib/inventoryData`, `lib/listingPrepApi`, or `lib/intakeApi`, and every one
// of them is already rendered by the Daily Workbench. Nothing was added to the
// server, and no query was invented in order to manufacture another widget.
//
// What is deliberately NOT here is as important as what is:
//
//   - no valuation, pricing, or market-value widget — no such governed source
//     exists, and a number nobody can defend is worse than a missing panel;
//   - no AI or recommendation widget;
//   - no S2 receiving, landed-cost or cost-basis widget — S2.1 shipped the
//     schema, not an owner-facing read model, and a widget over an unfinished
//     surface would be an advertisement;
//   - no orders/returns/fulfilment widget;
//   - no legacy SQLite dashboard widget. The legacy panel is non-authoritative
//     and stays fixed on Home, outside the governed catalogue entirely.
//
// A `planned` entry is metadata. It is never offered, never rendered, and never
// appears in the catalogue — see `isOfferable`.

import type { WidgetDefinition } from './widgetDefinition';

/** The queue widgets share a shape, so their contracts are built once. */
function inventoryQueue(spec: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly coverage: string;
  readonly genuineEmpty: string;
  readonly destination: string;
}): WidgetDefinition {
  return {
    id: spec.id,
    definitionVersion: 1,
    title: spec.title,
    description: spec.description,
    domain: 'inventory',
    lifecycle: 'available',
    requiredRole: null,
    requirements: ['governed-backend', 'active-workspace'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: spec.source,
      provenance: 'governed',
      coverage: spec.coverage,
      refresh: 'on-mount',
      genuineEmpty: spec.genuineEmpty,
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'instrument',
      supportedSizes: ['compact', 'standard', 'expanded'],
      defaultSize: 'standard',
      sizeBehaviour: [
        { size: 'compact', shows: 'The count alone.' },
        { size: 'standard', shows: 'The count, what it means, and a link into the filtered queue.' },
        { size: 'expanded', shows: 'Everything in Standard plus the waiting records themselves.' },
      ],
      responsive: 'stacks-full-width',
    },
    interaction: {
      mode: 'action-capable',
      destination: spec.destination,
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  };
}

export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  inventoryQueue({
    id: 'inventory.needs-location',
    title: 'Needs location',
    description: 'Inventory with no active storage location, or whose location was retired.',
    source: 'inventoryData.workQueue("needs_location") + workQueueCounts()',
    coverage: 'Governed inventory records in the active workspace. Legacy records are not included.',
    genuineEmpty: 'Every governed record in this workspace has an active storage location.',
    destination: '/inventory/current?needsLocation=1',
  }),
  inventoryQueue({
    id: 'inventory.needs-photos',
    title: 'Needs photos',
    description:
      'Inventory with no recorded photos yet. Required-angle readiness and photo issues are tracked separately in Photo Issues.',
    source: 'inventoryData.workQueue("needs_photos") + workQueueCounts()',
    coverage:
      'Records with no photo at all. It does NOT cover records that hold some photos but still owe a required angle.',
    genuineEmpty: 'Every governed record in this workspace has at least one recorded photo.',
    destination: '/inventory/current?needsPhotos=1',
  }),
  inventoryQueue({
    id: 'inventory.unclassified-category',
    title: 'Unclassified category',
    description:
      'Records whose stored facts do not identify an exact category. Nothing was guessed — these need an operator to say what they are.',
    source: 'inventoryData.operationsQueueRows("unclassified") + operationsQueueCounts()',
    coverage: 'Governed records whose stored subtype is exactly "unclassified".',
    genuineEmpty: 'Every governed record in this workspace carries an identified category.',
    destination: '/inventory/current?subtype=unclassified',
  }),
  inventoryQueue({
    id: 'inventory.needs-condition-details',
    title: 'Needs condition details',
    description: 'No condition or grade recorded. These cannot be listed honestly until someone assesses them.',
    source: 'inventoryData.operationsQueueRows("needs_condition_details") + operationsQueueCounts()',
    coverage: 'Governed records flagged as missing condition detail.',
    genuineEmpty: 'Every governed record in this workspace has condition detail recorded.',
    destination: '/inventory/current?needsConditionDetails=1',
  }),

  {
    id: 'governance.open-corrections',
    definitionVersion: 1,
    title: 'Open corrections',
    description:
      'Problems reported against committed records, waiting on a decision or on a corrected record to replace them.',
    domain: 'governance',
    lifecycle: 'available',
    requiredRole: null,
    requirements: ['governed-backend', 'active-workspace'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: 'inventoryData.openCorrectionCount()',
      provenance: 'governed',
      coverage: 'Correction requests in the open or approved state for the active workspace.',
      refresh: 'on-mount',
      genuineEmpty: 'No correction request is currently open or awaiting a replacement record.',
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'metric',
      supportedSizes: ['compact', 'standard'],
      defaultSize: 'compact',
      sizeBehaviour: [
        { size: 'compact', shows: 'The open count alone.' },
        { size: 'standard', shows: 'The count, what it covers, and a link to the corrections queue.' },
      ],
      responsive: 'keeps-compact',
    },
    interaction: {
      mode: 'action-capable',
      destination: '/corrections',
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  },

  {
    id: 'inventory.record-count',
    definitionVersion: 1,
    title: 'Inventory records',
    description: 'How many governed inventory records this workspace holds.',
    domain: 'inventory',
    lifecycle: 'available',
    requiredRole: null,
    requirements: ['governed-backend', 'active-workspace'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: 'inventoryData.workQueueCounts().total',
      provenance: 'governed',
      coverage:
        'Governed inventory work-queue records in the active workspace. This is not a unit count and not a value.',
      refresh: 'on-mount',
      genuineEmpty: 'This workspace holds no governed inventory records yet.',
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'metric',
      supportedSizes: ['compact', 'standard'],
      defaultSize: 'compact',
      sizeBehaviour: [
        { size: 'compact', shows: 'The record count alone.' },
        { size: 'standard', shows: 'The count, what it counts, and a link into Current Inventory.' },
      ],
      responsive: 'keeps-compact',
    },
    interaction: {
      mode: 'action-capable',
      destination: '/inventory/current',
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  },

  {
    id: 'sell.listing-prep-backlog',
    definitionVersion: 1,
    title: 'Listing preparation',
    description: 'Where listing preparation currently stands, by readiness.',
    domain: 'sell',
    lifecycle: 'available',
    requiredRole: null,
    requirements: ['governed-backend', 'active-workspace'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: 'listingPrepApi.summary()',
      provenance: 'governed',
      coverage: 'Listing preparation records for the active workspace, grouped by readiness and status.',
      refresh: 'on-mount',
      genuineEmpty: 'No record is currently in listing preparation.',
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'instrument',
      supportedSizes: ['standard', 'expanded', 'wide'],
      defaultSize: 'expanded',
      sizeBehaviour: [
        { size: 'standard', shows: 'The ready-to-list count and a link into Listing Prep.' },
        { size: 'expanded', shows: 'The full readiness breakdown, each line linking to its own filter.' },
        { size: 'wide', shows: 'The same breakdown with room to read the labels on a dense screen.' },
      ],
      responsive: 'stacks-full-width',
    },
    interaction: {
      mode: 'action-capable',
      destination: '/listing-prep',
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  },

  {
    id: 'intake.open-sessions',
    definitionVersion: 1,
    title: 'Open intake sessions',
    description: 'Intake sessions you started but have not finished.',
    domain: 'intake',
    lifecycle: 'available',
    requiredRole: null,
    // The intake transport is behind its own configuration flag. Without it the
    // widget is not offered at all — an unconfigured source is not zero
    // sessions, and a widget that cannot read must not appear to have read.
    requirements: ['governed-backend', 'active-workspace', 'intake-transport'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: 'intakeApi.listSessions(workspaceId, 10, 0, "open")',
      provenance: 'governed',
      coverage: 'Open intake sessions for the active workspace. Closed sessions are not counted.',
      refresh: 'on-mount',
      genuineEmpty: 'No intake session is currently open in this workspace.',
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'instrument',
      supportedSizes: ['compact', 'standard', 'expanded'],
      defaultSize: 'standard',
      sizeBehaviour: [
        { size: 'compact', shows: 'The open-session count alone.' },
        { size: 'standard', shows: 'The count and a link into Intake Sessions.' },
        { size: 'expanded', shows: 'The open sessions themselves, each resumable in place.' },
      ],
      responsive: 'stacks-full-width',
    },
    interaction: {
      mode: 'action-capable',
      destination: '/intake-sessions',
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  },

  {
    id: 'utility.quick-actions',
    definitionVersion: 1,
    title: 'Quick actions',
    description: 'The four things an operator starts most often.',
    domain: 'utility',
    lifecycle: 'available',
    requiredRole: null,
    // No governed read at all: these are navigation destinations, so the widget
    // stays usable even when every data source is unavailable.
    requirements: ['active-workspace'],
    surfaces: ['home', 'daily-workbench'],
    data: {
      source: 'none — navigation only',
      provenance: 'governed',
      coverage: 'This widget reads nothing. It navigates to existing routes.',
      refresh: 'manual',
      genuineEmpty: 'Not applicable: the widget holds no data and can never be empty.',
      allowStaleWhileRefreshing: false,
    },
    presentation: {
      family: 'instrument',
      supportedSizes: ['standard', 'wide', 'full'],
      defaultSize: 'standard',
      sizeBehaviour: [
        { size: 'standard', shows: 'The four primary actions.' },
        { size: 'wide', shows: 'The same actions on one row where the screen allows.' },
        { size: 'full', shows: 'The actions across the full width, for a wall-mounted or tablet console.' },
      ],
      responsive: 'stacks-full-width',
    },
    interaction: {
      mode: 'action-capable',
      hasLocalPresentationSettings: false,
      allowBackgroundRefresh: false,
    },
  },
];

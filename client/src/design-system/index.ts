// The Russell Vault design system.
//
// OWNERSHIP BOUNDARY
//
// This module owns presentation, accessible semantics, and the vocabulary for
// expressing what is known. It owns NO business meaning:
//
//   - Field wires labels and errors; it does not validate.
//   - Alert renders a severity; it does not decide one.
//   - StatusPill renders a tone; it does not compute status.
//   - truthState types what a surface knows; it does not fetch.
//   - DataTable renders a truth state; it does not sort, page, or fetch.
//   - CoverageNotice renders a coverage gap; it does not infer coverage.
//   - ProvenanceLabel renders an authority claim; it does not invent one.
//   - MutationConfirmation composes a confirmation; it encodes no rule.
//
// Anything that would require knowing what an acquisition, exclusion, payment,
// or shipment MEANS belongs in the domain, not here. This boundary is the
// reason a design change can never quietly become a business-rule change.
//
// Nothing in this directory imports Supabase, calls a transport, knows a
// workspace id, computes a status, or aggregates money.

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './controls/Button';
export { IconButton, type IconButtonProps } from './controls/IconButton';
export { Field, type FieldProps } from './controls/Field';
export { ReasonField, type ReasonFieldProps } from './controls/ReasonField';

export { StatusPill, type StatusPillProps, type StatusTone } from './feedback/StatusPill';
export { Alert, type AlertProps, type AlertTone } from './feedback/Alert';
export { RootErrorBoundary } from './feedback/RootErrorBoundary';
export { CoverageNotice, type CoverageNoticeProps } from './feedback/CoverageNotice';
export { ProvenanceLabel, type ProvenanceLabelProps, type ProvenanceKind } from './feedback/ProvenanceLabel';
export {
  LoadingState,
  EmptyState,
  DependencyState,
  PartialState,
  StaleState,
  type LoadingStateProps,
  type EmptyStateProps,
  type DependencyStateProps,
  type PartialStateProps,
  type StaleStateProps,
} from './feedback/TruthStates';

export {
  DataTable,
  type DataTableProps,
  type DataColumn,
  type DataTableSort,
  type DataTablePagination,
  type DataTableSelection,
  type DataTableSearch,
  type DataTableEmpty,
  type SortDirection,
} from './data/DataTable';
export {
  ResponsiveRecordList,
  type ResponsiveRecordListProps,
  type ResponsiveRecord,
  type RecordField,
  type RecordStatus,
} from './data/ResponsiveRecordList';

export { Dialog, type DialogProps, type DialogSize } from './overlays/Dialog';
export { Drawer, type DrawerProps, type DrawerSize } from './overlays/Drawer';
export { MutationConfirmation, type MutationConfirmationProps } from './overlays/MutationConfirmation';
export { useOverlayBehavior, supportsModalDialog } from './overlays/useOverlayBehavior';

export {
  TRUTH_STATE_KINDS,
  loading,
  ready,
  empty,
  partial,
  stale,
  unavailable,
  unauthorized,
  notConfigured,
  failed,
  hasValue,
  isIndeterminate,
  isAggregationSafe,
  sumSameCurrency,
  type TruthState,
  type TruthStateKind,
  type TruthStateOf,
  type IndeterminateTruthState,
  type CoverageGap,
  type Money,
} from './foundations/truthState';

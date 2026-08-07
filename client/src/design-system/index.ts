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
//
// Anything that would require knowing what an acquisition, exclusion, payment,
// or shipment MEANS belongs in the domain, not here. This boundary is the
// reason a design change can never quietly become a business-rule change.

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './controls/Button';
export { IconButton, type IconButtonProps } from './controls/IconButton';
export { Field, type FieldProps } from './controls/Field';
export { StatusPill, type StatusPillProps, type StatusTone } from './feedback/StatusPill';
export { Alert, type AlertProps, type AlertTone } from './feedback/Alert';
export { RootErrorBoundary } from './feedback/RootErrorBoundary';

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
  type CoverageGap,
  type Money,
} from './foundations/truthState';

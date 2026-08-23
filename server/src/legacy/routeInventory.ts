// The authoritative list of legacy SQLite HTTP surfaces.
//
// This exists so that "every legacy router is behind the guard" is a structural
// fact rather than a habit. index.ts mounts these prefixes by iterating this
// list and attaching the guard to each one, so a router cannot be added to the
// application without also being added here — and routeInventory.test.ts fails
// if index.ts ever mounts one of these prefixes directly instead.
//
// Adding a new legacy surface means adding it here. Nothing else in index.ts
// should mount a legacy path.

/** Path prefixes served by the legacy SQLite database. */
export const LEGACY_ROUTE_PREFIXES = [
  '/api/inventory',
  '/api/purchases',
  '/api/cost-links',
  '/api/listings',
  '/api/sales',
  '/api/dashboard',
  '/api/checks',
  '/api/lookups',
] as const;

export type LegacyRoutePrefix = (typeof LEGACY_ROUTE_PREFIXES)[number];

/** Router module basenames under server/src/routes, one per prefix above. */
export const LEGACY_ROUTER_MODULES = [
  'inventory',
  'purchases',
  'costLinks',
  'listings',
  'sales',
  'dashboard',
  'checks',
  'lookups',
] as const;

/**
 * Paths that must stay reachable without authentication.
 *
 * `/api/health` is what Railway health-checks, so authenticating it would make
 * a healthy deployment look unhealthy and block promotion. `/api/version`
 * reports a commit SHA and Node version and nothing else. Health SEMANTICS are
 * explicitly out of scope here — that is Work Order 3.
 */
export const PUBLIC_API_PATHS = ['/api/health', '/api/version'] as const;

/**
 * Governed prefixes. Listed only so the inventory test can assert they are NOT
 * treated as legacy: they carry their own per-request caller-token gates and
 * must never depend on the legacy quarantine or on ALLOW_LEGACY_WRITES.
 */
export const GOVERNED_ROUTE_PREFIXES = [
  '/api/provenance',
  '/api/acquisition',
  '/api/inventory-identity',
  '/api/intake',
  '/api/locations',
  '/api/cycle-counts',
  '/api/media',
  '/api/listing-prep',
  '/api/operations-dashboard',
  '/api/receiving',
  '/api/cost',
] as const;

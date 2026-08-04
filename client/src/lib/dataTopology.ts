// Which system owns which business fact.
//
// This file replaces `dataAdapter.ts`, which asserted — as of Phase 2, and
// wrongly ever since — that the legacy SQLite REST path was "the ONLY read and
// write path for business data" and that Supabase was touched "solely for
// authentication and workspace-membership checks". Both statements were false
// by the time governed intake, movement, media, corrections, cycle counts and
// Listing Prep shipped, and two tests were pinning the false version in place.
//
// There are TWO business-data backends. Authority is a property of a DOMAIN,
// not of the application, so there is deliberately no zero-argument function
// that names one global active backend — no honest answer to that question
// exists. Ask `backendForDomain(domain)` instead.
//
// Routing between the two is a property of this application. It is not a third
// backend, and nothing here is named "hybrid" or "domain-routed" and pretended
// to be a storage system.

export const DATA_BACKENDS = ['governed-supabase', 'legacy-sqlite-rest'] as const;

export type DataBackend = (typeof DATA_BACKENDS)[number];

/** Governed domains are authoritative. Legacy domains are not. */
export type GovernedDomain =
  | 'inventory-identity'
  | 'intake'
  | 'current-inventory'
  | 'locations'
  | 'movement'
  | 'media'
  | 'corrections'
  | 'cycle-counts'
  | 'listing-prep'
  | 'readiness'
  | 'operations-dashboard';

export type LegacyDomain =
  | 'legacy-inventory'
  | 'legacy-purchases'
  | 'legacy-cost-links'
  | 'legacy-listings'
  | 'legacy-sales'
  | 'legacy-checks'
  | 'legacy-dashboard';

export type BusinessDomain = GovernedDomain | LegacyDomain;

export interface DomainTopology {
  readonly domain: BusinessDomain;
  /** The single system that stores this domain's records. */
  readonly backend: DataBackend;
  /**
   * Whether that system is the system of record. Exactly one backend is
   * authoritative per domain, and legacy is authoritative for none of them.
   */
  readonly authoritative: boolean;
  /** Whether this application implements writes against that backend. */
  readonly writesImplemented: boolean;
  readonly note: string;
}

/**
 * The map. Static by design: it describes what the systems ARE, so toggling a
 * UI feature flag must not change a single entry. Runtime reachability is a
 * separate question — see `backendAvailability`.
 */
export const DOMAIN_TOPOLOGY: readonly DomainTopology[] = [
  // Governed Supabase: caller JWT, workspace membership, RLS, governed
  // SECURITY DEFINER functions, no service-role key in the browser.
  g('inventory-identity', 'Product to SKU to Lot to Item, governed public ids'),
  g('intake', 'single and batch intake, intake sessions, commit kernel'),
  g('current-inventory', 'current stock, paging, filtering, detail routes'),
  g('locations', 'workspace-scoped storage locations'),
  g('movement', 'governed movement and immutable movement history'),
  g('media', 'private inventory photographs and signed display URLs'),
  g('corrections', 'correction requests, review, supersession, duplicate voiding'),
  g('cycle-counts', 'sessions, rounds, observations, discrepancies, resolution'),
  g('listing-prep', 'preparation records, checks, readiness, package presets'),
  g('readiness', 'media and listing readiness read models'),
  g('operations-dashboard', 'Today’s Work, inventory health, workflow backlogs'),

  // Legacy SQLite REST: reached over /api through the Express server. No
  // workspace scoping, no per-caller authorization, read-only by production
  // default, retained only until each domain is replaced and reconciled.
  l('legacy-inventory', 'the 1,487 spreadsheet-imported lots'),
  l('legacy-purchases', 'imported Whatnot acquisition lines'),
  l('legacy-cost-links', 'legacy cost allocations between purchases and lots'),
  l('legacy-listings', 'legacy eBay listing rows, hand-maintained'),
  l('legacy-sales', 'legacy sale rows, fees and snapshot profit'),
  l('legacy-checks', 'legacy stored and live integrity checks'),
  l('legacy-dashboard', 'the legacy aggregate panel on the dashboard'),
];

function g(domain: GovernedDomain, note: string): DomainTopology {
  return { domain, backend: 'governed-supabase', authoritative: true, writesImplemented: true, note };
}

function l(domain: LegacyDomain, note: string): DomainTopology {
  return { domain, backend: 'legacy-sqlite-rest', authoritative: false, writesImplemented: true, note };
}

const BY_DOMAIN = new Map<BusinessDomain, DomainTopology>(
  DOMAIN_TOPOLOGY.map((entry) => [entry.domain, entry]),
);

export function topologyForDomain(domain: BusinessDomain): DomainTopology {
  const entry = BY_DOMAIN.get(domain);
  if (!entry) throw new Error(`unknown business domain: ${domain}`);
  return entry;
}

/** The only honest form of the old `activeDataBackend()`: it requires a domain. */
export function backendForDomain(domain: BusinessDomain): DataBackend {
  return topologyForDomain(domain).backend;
}

export function isAuthoritative(domain: BusinessDomain): boolean {
  return topologyForDomain(domain).authoritative;
}

export function domainsFor(backend: DataBackend): BusinessDomain[] {
  return DOMAIN_TOPOLOGY.filter((entry) => entry.backend === backend).map((entry) => entry.domain);
}

/**
 * Governed Supabase writes exist. The old `SHADOW_WRITES_ENABLED = false`
 * described a system that stopped being real several releases ago; it is
 * replaced by two separate facts rather than flipped to `true`, because
 * "shadow writes" conflated "does the client write to Supabase" (it does) with
 * "does the client write the same fact to both systems" (it does not).
 */
export const GOVERNED_WRITES_IMPLEMENTED = true as const;

/**
 * No fact is written to both systems. There is no synchronization layer, no
 * mirrored write, no fallback write and no "write both" adapter anywhere in the
 * client, and adding one is prohibited by the program charter's no-dual-write
 * rule rather than merely absent by accident.
 */
export const DUAL_WRITES_ENABLED = false as const;

/**
 * The invariant, computed rather than asserted: every domain resolves to
 * exactly one backend, so no domain can have two authoritative writers. A test
 * requires this to be empty.
 */
export function domainsWithMultipleAuthoritativeWriters(): BusinessDomain[] {
  const seen = new Map<BusinessDomain, number>();
  for (const entry of DOMAIN_TOPOLOGY) {
    if (!entry.authoritative) continue;
    seen.set(entry.domain, (seen.get(entry.domain) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([domain]) => domain);
}

/**
 * Runtime reachability, which DOES depend on configuration — unlike authority,
 * which does not. In legacy-only mode the governed backend is unreachable, but
 * that does not make legacy authoritative for anything; it means the governed
 * domains are simply unavailable.
 */
export function backendAvailability(mode: 'governed' | 'legacy-only' | 'misconfigured'): Record<DataBackend, boolean> {
  switch (mode) {
    case 'governed':
      return { 'governed-supabase': true, 'legacy-sqlite-rest': true };
    case 'legacy-only':
      return { 'governed-supabase': false, 'legacy-sqlite-rest': true };
    case 'misconfigured':
      // Nothing is reached at all: the shell fails closed before any request.
      return { 'governed-supabase': false, 'legacy-sqlite-rest': false };
  }
}

/**
 * Permission coupling, in both directions, stated so a test can pin it:
 * a governed Supabase write never requires or implies ALLOW_LEGACY_WRITES, and
 * a legacy HTTP write never requires or implies a governed write. The two are
 * enforced by different systems — RLS and governed functions on one side,
 * `server/src/legacyWriteGuard.ts` on the other.
 */
export const PERMISSIONS_ARE_COUPLED = false as const;

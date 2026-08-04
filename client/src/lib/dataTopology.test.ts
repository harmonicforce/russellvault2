// The client used to assert, and CI used to enforce, that legacy SQLite was
// the only business-data backend and that no Supabase write path existed.
// Both claims were false. These tests pin the true model instead, and are
// written so that reintroducing a single global "active backend" or a
// dual-write path fails here.

import { describe, expect, it } from 'vitest';
import * as topology from './dataTopology';
import {
  DATA_BACKENDS,
  DOMAIN_TOPOLOGY,
  DUAL_WRITES_ENABLED,
  GOVERNED_WRITES_IMPLEMENTED,
  PERMISSIONS_ARE_COUPLED,
  backendAvailability,
  backendForDomain,
  domainsFor,
  domainsWithMultipleAuthoritativeWriters,
  isAuthoritative,
  topologyForDomain,
  type BusinessDomain,
} from './dataTopology';

const GOVERNED_DOMAINS: BusinessDomain[] = [
  'inventory-identity', 'intake', 'current-inventory', 'locations', 'movement',
  'media', 'corrections', 'cycle-counts', 'listing-prep', 'readiness',
  'operations-dashboard',
];

const LEGACY_DOMAINS: BusinessDomain[] = [
  'legacy-inventory', 'legacy-purchases', 'legacy-cost-links', 'legacy-listings',
  'legacy-sales', 'legacy-checks', 'legacy-dashboard',
];

describe('both real backends are represented', () => {
  it('names governed Supabase and legacy SQLite REST, and nothing else', () => {
    expect([...DATA_BACKENDS].sort()).toEqual(['governed-supabase', 'legacy-sqlite-rest']);
  });

  it('does not invent a third backend for the routing between them', () => {
    // Routing is a property of the application. "hybrid", "both" and
    // "domain-routed" are not storage systems and must never appear here.
    for (const backend of DATA_BACKENDS) {
      expect(backend).not.toMatch(/hybrid|both|routed|mixed/i);
    }
  });

  it('assigns every declared domain to exactly one backend', () => {
    const domains = DOMAIN_TOPOLOGY.map((e) => e.domain);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains.length).toBe(GOVERNED_DOMAINS.length + LEGACY_DOMAINS.length);
  });
});

describe('authority is domain-specific', () => {
  it.each(GOVERNED_DOMAINS)('governed Supabase owns and is authoritative for %s', (domain) => {
    expect(backendForDomain(domain)).toBe('governed-supabase');
    expect(isAuthoritative(domain)).toBe(true);
  });

  it.each(LEGACY_DOMAINS)('legacy SQLite REST owns %s but is authoritative for nothing', (domain) => {
    expect(backendForDomain(domain)).toBe('legacy-sqlite-rest');
    expect(isAuthoritative(domain)).toBe(false);
  });

  it('answers the specific questions a reviewer would ask', () => {
    expect(backendForDomain('current-inventory')).toBe('governed-supabase');
    expect(backendForDomain('legacy-purchases')).toBe('legacy-sqlite-rest');
    expect(domainsFor('legacy-sqlite-rest').every((d) => !isAuthoritative(d))).toBe(true);
  });

  it('rejects an unknown domain rather than guessing a backend', () => {
    expect(() => topologyForDomain('not-a-domain' as BusinessDomain)).toThrow(/unknown business domain/);
  });
});

describe('writes', () => {
  it('records governed Supabase writes as implemented', () => {
    expect(GOVERNED_WRITES_IMPLEMENTED).toBe(true);
    for (const domain of GOVERNED_DOMAINS) {
      expect(topologyForDomain(domain).writesImplemented).toBe(true);
    }
  });

  it('records dual writes as disabled', () => {
    expect(DUAL_WRITES_ENABLED).toBe(false);
  });

  it('has no domain with two authoritative writers', () => {
    expect(domainsWithMultipleAuthoritativeWriters()).toEqual([]);
  });

  it('states that the two write permissions are not coupled in either direction', () => {
    // A governed Supabase write never requires ALLOW_LEGACY_WRITES, and a
    // legacy HTTP write never implies a governed write.
    expect(PERMISSIONS_ARE_COUPLED).toBe(false);
  });
});

describe('authority does not depend on configuration', () => {
  it('is a static map, unchanged by any UI flag', () => {
    const snapshot = DOMAIN_TOPOLOGY.map((e) => `${e.domain}:${e.backend}:${e.authoritative}`);
    // Resolve availability for every mode; none of it may touch the map.
    backendAvailability('governed');
    backendAvailability('legacy-only');
    backendAvailability('misconfigured');
    expect(DOMAIN_TOPOLOGY.map((e) => `${e.domain}:${e.backend}:${e.authoritative}`)).toEqual(snapshot);
  });

  it('separates runtime availability from authority', () => {
    expect(backendAvailability('governed')).toEqual({
      'governed-supabase': true, 'legacy-sqlite-rest': true,
    });
    // Legacy-only makes the governed backend unreachable. It does NOT make
    // legacy authoritative for anything.
    expect(backendAvailability('legacy-only')).toEqual({
      'governed-supabase': false, 'legacy-sqlite-rest': true,
    });
    expect(isAuthoritative('legacy-inventory')).toBe(false);
    // Misconfigured reaches nothing: the shell fails closed first.
    expect(backendAvailability('misconfigured')).toEqual({
      'governed-supabase': false, 'legacy-sqlite-rest': false,
    });
  });
});

describe('the misleading global-backend API is gone', () => {
  it('exports no zero-argument function claiming one active backend', () => {
    expect('activeDataBackend' in topology).toBe(false);
    expect('SHADOW_WRITES_ENABLED' in topology).toBe(false);
  });

  it('requires a domain to answer which backend owns a fact', () => {
    // There is no honest answer without one, so the signature demands it.
    expect(backendForDomain.length).toBe(1);
  });
});

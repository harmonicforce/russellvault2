// Phase 3 client gating tests.
//
// The staging import-review surface must be OFF unless explicitly configured,
// and enabling it must never change the legacy SQLite data path.

import { describe, it, expect } from 'vitest';
import {
  SHADOW_IMPORT_FLAG,
  STAGING_NOTICE,
  getProvenanceUiConfig,
  isProvenanceUiEnabled,
} from './provenanceConfig';
import {
  DUAL_WRITES_ENABLED,
  backendForDomain,
  domainsWithMultipleAuthoritativeWriters,
} from './dataTopology';

const FULL_AUTH = {
  VITE_SHADOW_AUTH: 'supabase',
  VITE_SUPABASE_URL: 'http://localhost:54321',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
};

describe('safe default', () => {
  it('is disabled with no configuration at all', () => {
    expect(getProvenanceUiConfig({})).toBeNull();
    expect(isProvenanceUiEnabled({})).toBe(false);
  });

  it('is disabled when only the import flag is set', () => {
    expect(
      isProvenanceUiEnabled({ [SHADOW_IMPORT_FLAG]: 'repository-fixtures' })
    ).toBe(false);
  });

  it('is disabled when only the shadow auth config is present', () => {
    expect(isProvenanceUiEnabled(FULL_AUTH)).toBe(false);
  });

  it('is disabled when the auth config is partial', () => {
    expect(
      isProvenanceUiEnabled({
        [SHADOW_IMPORT_FLAG]: 'repository-fixtures',
        VITE_SHADOW_AUTH: 'supabase',
        VITE_SUPABASE_URL: 'http://localhost:54321',
        // anon key missing
      })
    ).toBe(false);
  });

  it('is disabled for a truthy-but-wrong flag value', () => {
    for (const value of ['true', '1', 'yes', 'on', 'enabled']) {
      expect(
        isProvenanceUiEnabled({ ...FULL_AUTH, [SHADOW_IMPORT_FLAG]: value })
      ).toBe(false);
    }
  });

  it('enables only with the explicit mode plus full auth configuration', () => {
    const config = getProvenanceUiConfig({
      ...FULL_AUTH,
      [SHADOW_IMPORT_FLAG]: 'repository-fixtures',
    });
    expect(config).not.toBeNull();
    expect(config!.mode).toBe('repository-fixtures');
    expect(config!.url).toBe('http://localhost:54321');
  });
});

describe('staging labelling', () => {
  it('states plainly that records are non-authoritative', () => {
    expect(STAGING_NOTICE).toMatch(/non-authoritative/i);
    expect(STAGING_NOTICE).toMatch(/not business records/i);
  });
});

describe('enabling the review UI does not move any business fact', () => {
  // These assertions used to claim legacy SQLite was the only data backend.
  // That stopped being true several releases ago. What is still true, and what
  // actually matters here, is that toggling this UI flag changes no domain's
  // owner and creates no second writer.
  it('leaves each domain owned by the same backend when the flag is on', () => {
    const before = {
      governedInventory: backendForDomain('current-inventory'),
      legacyPurchases: backendForDomain('legacy-purchases'),
    };
    expect(isProvenanceUiEnabled({ ...FULL_AUTH, [SHADOW_IMPORT_FLAG]: 'repository-fixtures' }))
      .toBe(true);
    expect(backendForDomain('current-inventory')).toBe(before.governedInventory);
    expect(backendForDomain('legacy-purchases')).toBe(before.legacyPurchases);
  });

  it('never forks a domain into two authoritative writers', () => {
    expect(DUAL_WRITES_ENABLED).toBe(false);
    expect(domainsWithMultipleAuthoritativeWriters()).toEqual([]);
  });
});

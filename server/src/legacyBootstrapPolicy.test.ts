import { describe, it, expect } from 'vitest';
import {
  LEGACY_BOOTSTRAP_FLAG,
  describeBootstrapPolicy,
  legacyBootWritesEnabled,
} from './legacyBootstrapPolicy.js';
import { resolveLegacyWritesEnabled } from './legacyWriteGuard.js';

const PROD = { NODE_ENV: 'production' } as const;

describe('legacy bootstrap policy is fail-closed', () => {
  it('is disabled in production when the flag is unset', () => {
    expect(legacyBootWritesEnabled({ ...PROD })).toBe(false);
  });

  it('is disabled in production when the flag is empty', () => {
    expect(legacyBootWritesEnabled({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: '' })).toBe(false);
  });

  it("is disabled in production when the flag is 'false'", () => {
    expect(legacyBootWritesEnabled({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: 'false' })).toBe(false);
  });

  it("is enabled in production only for the exact string 'true'", () => {
    expect(legacyBootWritesEnabled({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: 'true' })).toBe(true);
  });

  // The repository's existing boolean convention is exact-match on 'true'
  // (ALLOW_LEGACY_WRITES). Anything looser here would be a second, weaker rule.
  it.each(['1', 'TRUE', 'True', 'yes', 'on', 'enabled', ' true', 'true '])(
    'rejects the near-miss value %j',
    (value) => {
      expect(legacyBootWritesEnabled({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: value })).toBe(false);
    },
  );

  // Each of these would have authorized exactly the accident this flag exists
  // to prevent, so none of them may imply permission.
  it('never infers permission from NODE_ENV, DATA_DIR or DATABASE_PATH', () => {
    expect(legacyBootWritesEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(legacyBootWritesEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(legacyBootWritesEnabled({ ...PROD, DATA_DIR: '/data' })).toBe(false);
    expect(legacyBootWritesEnabled({ ...PROD, DATABASE_PATH: '/data/vault.db' })).toBe(false);
  });
});

describe('the two permissions are independent', () => {
  it('ALLOW_LEGACY_WRITES=true does not by itself enable boot seeding', () => {
    const env = { ...PROD, ALLOW_LEGACY_WRITES: 'true' };
    expect(resolveLegacyWritesEnabled(env)).toBe(true);
    expect(legacyBootWritesEnabled(env)).toBe(false);
  });

  it('SEED_LEGACY_ON_EMPTY=true does not by itself enable HTTP legacy writes', () => {
    const env = { ...PROD, [LEGACY_BOOTSTRAP_FLAG]: 'true' };
    expect(legacyBootWritesEnabled(env)).toBe(true);
    expect(resolveLegacyWritesEnabled(env)).toBe(false);
  });

  it('leaves the existing ALLOW_LEGACY_WRITES semantics untouched', () => {
    expect(resolveLegacyWritesEnabled({ ...PROD })).toBe(false);
    expect(resolveLegacyWritesEnabled({ ...PROD, ALLOW_LEGACY_WRITES: 'true' })).toBe(true);
    expect(resolveLegacyWritesEnabled({ ...PROD, ALLOW_LEGACY_WRITES: '1' })).toBe(false);
    expect(resolveLegacyWritesEnabled({ NODE_ENV: 'test' })).toBe(true);
  });
});

describe('the startup policy line', () => {
  it('names the flag in both states and leaks no path', () => {
    const off = describeBootstrapPolicy({ ...PROD });
    const on = describeBootstrapPolicy({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: 'true' });
    expect(off).toContain(LEGACY_BOOTSTRAP_FLAG);
    expect(off).toMatch(/DISABLED/);
    expect(on).toMatch(/AUTHORIZED/);
    for (const line of [off, on]) {
      expect(line).not.toMatch(/\/data|vault\.db|\.db\b/);
    }
  });

  it('says plainly that repository fixtures are not a restoration source', () => {
    const on = describeBootstrapPolicy({ ...PROD, [LEGACY_BOOTSTRAP_FLAG]: 'true' });
    expect(on).toMatch(/not a valid production restoration source/i);
  });
});

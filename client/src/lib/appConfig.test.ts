// A partial governed configuration used to resolve to `null` and silently
// serve the unauthenticated legacy application. These tests pin the three
// distinct states, and in particular that every one-variable-missing
// permutation is an error rather than a downgrade.

import { describe, expect, it } from 'vitest';
import {
  GOVERNED_CONFIG_FIELDS,
  describeMisconfiguration,
  resolveAppConfig,
  type EnvLike,
} from './appConfig';

const URL_VALUE = 'https://project.supabase.test';
const KEY_VALUE = 'anon-key-value-that-must-never-be-rendered';

const FULL: EnvLike = {
  VITE_SHADOW_AUTH: 'supabase',
  VITE_SHADOW_IMPORT: 'repository-fixtures',
  VITE_SUPABASE_URL: URL_VALUE,
  VITE_SUPABASE_ANON_KEY: KEY_VALUE,
};

function without(field: string): EnvLike {
  const env = { ...FULL };
  delete env[field];
  return env;
}

describe('legacy-only', () => {
  it('resolves when no governed variable is present at all', () => {
    expect(resolveAppConfig({})).toEqual({ mode: 'legacy-only' });
  });

  it('is unaffected by unrelated variables', () => {
    expect(resolveAppConfig({ NODE_ENV: 'production', VITE_SOMETHING_ELSE: 'x' }))
      .toEqual({ mode: 'legacy-only' });
  });

  it('treats empty strings as absent rather than as a broken configuration', () => {
    expect(resolveAppConfig({
      VITE_SHADOW_AUTH: '', VITE_SHADOW_IMPORT: '',
      VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '',
    })).toEqual({ mode: 'legacy-only' });
  });
});

describe('governed', () => {
  it('resolves only with all four exact values', () => {
    expect(resolveAppConfig(FULL)).toEqual({ mode: 'governed', url: URL_VALUE, anonKey: KEY_VALUE });
  });
});

describe('misconfigured fails closed', () => {
  it.each([...GOVERNED_CONFIG_FIELDS])('is misconfigured when %s alone is missing', (field) => {
    const state = resolveAppConfig(without(field));
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    expect(state.missing).toEqual([field]);
    expect(state.invalid).toEqual([]);
  });

  it('rejects a wrong auth flag value', () => {
    const state = resolveAppConfig({ ...FULL, VITE_SHADOW_AUTH: 'postgres' });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    expect(state.invalid).toEqual(['VITE_SHADOW_AUTH']);
  });

  it('rejects a wrong import flag value', () => {
    const state = resolveAppConfig({ ...FULL, VITE_SHADOW_IMPORT: 'true' });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    expect(state.invalid).toEqual(['VITE_SHADOW_IMPORT']);
  });

  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const)(
    'rejects a whitespace-only %s',
    (field) => {
      const state = resolveAppConfig({ ...FULL, [field]: '   ' });
      expect(state.mode).toBe('misconfigured');
      if (state.mode !== 'misconfigured') return;
      expect(state.invalid).toEqual([field]);
    },
  );

  it('rejects URL and key present without either flag', () => {
    const state = resolveAppConfig({ VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: KEY_VALUE });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    expect([...state.missing].sort()).toEqual(['VITE_SHADOW_AUTH', 'VITE_SHADOW_IMPORT']);
  });

  it('rejects flags present without URL and key', () => {
    const state = resolveAppConfig({
      VITE_SHADOW_AUTH: 'supabase', VITE_SHADOW_IMPORT: 'repository-fixtures',
    });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    expect([...state.missing].sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  });

  it('rejects complete auth configuration that is missing only the governed-surface flag', () => {
    // The exact shape that used to fall through and construct a Supabase
    // client while serving the legacy application.
    const state = resolveAppConfig(without('VITE_SHADOW_IMPORT'));
    expect(state.mode).toBe('misconfigured');
  });
});

describe('misconfiguration never leaks a value', () => {
  it('reports field names only', () => {
    const state = resolveAppConfig({ ...FULL, VITE_SUPABASE_ANON_KEY: undefined });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    const serialized = JSON.stringify(state) + describeMisconfiguration(state);
    expect(serialized).toContain('VITE_SUPABASE_ANON_KEY');
    expect(serialized).not.toContain(URL_VALUE);
    expect(serialized).not.toContain(KEY_VALUE);
  });

  it('does not echo an invalid value back', () => {
    const state = resolveAppConfig({ ...FULL, VITE_SHADOW_AUTH: 'sekrit-value' });
    expect(state.mode).toBe('misconfigured');
    if (state.mode !== 'misconfigured') return;
    const serialized = JSON.stringify(state) + describeMisconfiguration(state);
    expect(serialized).not.toContain('sekrit-value');
    expect(serialized).not.toContain(URL_VALUE);
    expect(serialized).not.toContain(KEY_VALUE);
  });
});

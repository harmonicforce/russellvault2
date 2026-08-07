// @vitest-environment jsdom
// The browser ThemeStore adapter.
//
// The property throughout: a storage problem is never allowed to become an
// application problem. Every failure mode resolves to a usable shell running
// the System theme.

import { describe, expect, it, vi } from 'vitest';
import { readThemePreference } from '../../lib/theme';
import { THEME_STORAGE_KEY, createBrowserThemeStore, themeStorageKey } from './browserThemeStore';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe('storage key', () => {
  it('is namespaced and versioned', () => {
    expect(THEME_STORAGE_KEY).toBe('rv.theme.v1');
    // `rv.` matches the existing rv.activeWorkspaceId convention, and the
    // version suffix means a future shape change never has to interpret a
    // value written by an older build.
    expect(THEME_STORAGE_KEY.startsWith('rv.')).toBe(true);
    expect(THEME_STORAGE_KEY).toMatch(/\.v\d+$/);
  });

  it('scopes to a user when one is supplied, so a shared device does not leak a preference', () => {
    expect(themeStorageKey('user-a')).not.toBe(themeStorageKey('user-b'));
    expect(themeStorageKey(null)).toBe(THEME_STORAGE_KEY);
  });
});

describe('round trip', () => {
  it('reads back what it wrote', () => {
    const store = createBrowserThemeStore(memoryStorage());
    store.write('dark');
    expect(readThemePreference(store.read())).toBe('dark');
    store.write('light');
    expect(readThemePreference(store.read())).toBe('light');
  });

  it('writes only the preference string, never anything business-shaped', () => {
    const storage = memoryStorage();
    createBrowserThemeStore(storage, 'user-a').write('dark');
    expect(storage.getItem(themeStorageKey('user-a'))).toBe('dark');
    expect(storage.length).toBe(1);
  });

  it('resolves an absent value to System', () => {
    const store = createBrowserThemeStore(memoryStorage());
    expect(readThemePreference(store.read())).toBe('system');
  });
});

describe('corrupt and hostile stored values', () => {
  it.each([
    ['an unknown word', 'banana'],
    ['an empty string', ''],
    ['JSON', '{"preference":"dark"}'],
    ['the wrong case', 'DARK'],
    ['whitespace', '  dark  '],
  ])('resolves %s to System rather than trusting it', (_label, stored) => {
    const store = createBrowserThemeStore(memoryStorage({ [THEME_STORAGE_KEY]: stored }));
    expect(readThemePreference(store.read())).toBe('system');
  });
});

describe('storage failure never breaks the shell', () => {
  it('survives storage being absent entirely', () => {
    const store = createBrowserThemeStore(null);
    expect(readThemePreference(store.read())).toBe('system');
    expect(() => store.write('dark')).not.toThrow();
  });

  it('survives a throwing read, as in a locked-down or private-mode browser', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    const store = createBrowserThemeStore(storage);
    expect(readThemePreference(store.read())).toBe('system');
  });

  // A full quota must cost the operator durability, not the application.
  it('survives a throwing write and does not propagate the failure', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const store = createBrowserThemeStore(storage);
    expect(() => store.write('dark')).not.toThrow();
  });
});

describe('the guard does not depend on the adapter being careful', () => {
  // useThemePreference guards store.write itself, so the invariant holds for
  // ANY ThemeStore rather than only the browser one. Asserted directly here
  // because a React event handler swallows the throw, which made an earlier
  // shell-level assertion pass while the error still escaped as an unhandled
  // exception.
  it('applies the theme and swallows the failure when a hostile store throws', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useThemePreference } = await import('./useThemePreference');
    const root = document.createElement('html');
    const hostile = {
      read: () => 'system',
      write: () => { throw new Error('quota'); },
    };
    const { result } = renderHook(() => useThemePreference(hostile, root));
    act(() => result.current[1]('dark'));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(result.current[0]).toBe('dark');
  });
});

// The browser adapter behind the S1.6.1 ThemeStore port.
//
// The foundation (`lib/theme.ts`) deliberately never touches web storage — it
// defines the port and nothing else. This is the shell's implementation of it,
// and it is the ONLY module in the application permitted to reach for
// localStorage on the theme's behalf. Shell components talk to a ThemeStore;
// they do not know that storage exists.
//
// SCOPE DISCLOSURE
//
// This preference is DEVICE-LOCAL. It lives in this browser profile on this
// machine and does not travel with the operator's account. Signing in on a
// different device gets that device's preference, or System if it has none.
// The shell must never describe it as a synchronized account setting, because
// it is not one. Cross-device governed preference persistence would need a
// server-side model, and that is deliberately not part of this slice.
//
// NOTHING BUSINESS-SHAPED IS STORED HERE. The value written is one of exactly
// three strings. No workspace id, no role, no email, no token, no record
// identifier — a presentation preference must not become a place where
// business or auth state leaks into device storage.

import { isThemePreference, type ThemePreference, type ThemeStore } from '../../lib/theme';

/**
 * Versioned, namespaced key.
 *
 * `rv.` matches the existing convention (`rv.activeWorkspaceId`). The `.v1`
 * suffix means a future change to the stored shape can be introduced without
 * having to interpret, migrate, or trust values written by an older build:
 * a new version simply reads a different key and an unknown one resolves to
 * System.
 */
export const THEME_STORAGE_KEY = 'rv.theme.v1';

/**
 * Scope a key to a signed-in user.
 *
 * Two operators sharing one device should not silently inherit each other's
 * appearance. The identifier is used ONLY to namespace the key — it is never
 * stored as a value, and the theme system holds no reference to the user
 * beyond building this string, so nothing here couples presentation to
 * business or auth state.
 */
export function themeStorageKey(userId?: string | null): string {
  return userId ? `${THEME_STORAGE_KEY}.${userId}` : THEME_STORAGE_KEY;
}

/**
 * A ThemeStore backed by a Storage implementation.
 *
 * Every access is guarded. Storage throws in more situations than people
 * expect — Safari private mode, disabled cookies, exhausted quota, embedded
 * webviews — and NONE of them is a reason for the operator to lose the
 * application. A failed read resolves to System; a failed write is dropped
 * and the chosen theme still applies for this session. The shell degrades to
 * "your choice will not be remembered", never to a blank screen.
 */
export function createBrowserThemeStore(
  storage: Storage | null | undefined,
  userId?: string | null,
): ThemeStore {
  const key = themeStorageKey(userId);
  return {
    read(): unknown {
      if (!storage) return null;
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    write(preference: ThemePreference): void {
      if (!storage) return;
      try {
        storage.setItem(key, preference);
      } catch {
        /* Unavailable storage: the preference applies now but is not durable. */
      }
    },
  };
}

/**
 * The store the running application uses.
 *
 * `window` is looked up defensively so importing the shell in a non-DOM
 * environment cannot throw at module load.
 */
export function createDefaultThemeStore(userId?: string | null): ThemeStore {
  let storage: Storage | null = null;
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    storage = null;
  }
  return createBrowserThemeStore(storage, userId);
}

/** Re-exported so callers need not reach past the adapter for the guard. */
export { isThemePreference };

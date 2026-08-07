// Theme preference: presentation only.
//
// A theme changes how the vault LOOKS and nothing else. It never affects data,
// authorization, provenance, or any business preference — an operator may
// customize perspective, never truth. Nothing business-shaped is stored
// alongside it, and no governed request varies by it.
//
// This module deliberately does NOT touch localStorage. It defines the port; a
// shell adapter supplies the storage. Baking web storage into the foundation
// would make the theme untestable without a DOM and would couple a design
// concern to a browser API that server rendering and tests do not have.

/** Stored preference. Closed union, unchanged from the existing contract. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The theme actually applied once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * User-facing modes. The stored identifier and the presentation label are
 * separate concerns: storage stays a stable short union while the label is
 * free to carry the Russell Vault names.
 */
export const THEME_MODES: ReadonlyArray<{ value: ThemePreference; label: string; description: string }> = [
  { value: 'system', label: 'System', description: 'Follow the operating system appearance.' },
  { value: 'light', label: 'Light Vault Ledger', description: 'Parchment ledger surfaces with deep gold structure.' },
  { value: 'dark', label: 'Dark Vault', description: 'Graphite vault surfaces with bright gold structure.' },
];

const PREFERENCES: ReadonlySet<string> = new Set<ThemePreference>(['system', 'light', 'dark']);

/** Narrows unknown stored input; anything unrecognized is not a preference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && PREFERENCES.has(value);
}

/** Unrecognized or absent stored input falls back to following the system. */
export function readThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

/**
 * Resolve the preference against the OS setting.
 *
 * An explicit choice always wins: explicit light overrides an OS dark
 * preference, and explicit dark overrides an OS light preference. Only
 * `system` defers.
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/**
 * Apply a preference to a root element.
 *
 * `system` removes the attribute entirely rather than writing a resolved
 * value, so the stylesheet's `prefers-color-scheme` block stays live and the
 * theme follows the OS as it changes — writing a snapshot would freeze it.
 */
export function applyThemePreference(root: Element, preference: ThemePreference): void {
  if (preference === 'system') {
    root.removeAttribute('data-theme');
    return;
  }
  root.setAttribute('data-theme', preference);
}

/**
 * Storage port. The shell supplies an adapter (S1.6.2 owns that wiring); the
 * foundation only states the shape it needs.
 */
export interface ThemeStore {
  read(): unknown;
  write(preference: ThemePreference): void;
}

/** An in-memory store — the default when no durable storage is available. */
export function createMemoryThemeStore(initial: ThemePreference = 'system'): ThemeStore {
  let current: ThemePreference = initial;
  return {
    read: () => current,
    write: (preference) => {
      current = preference;
    },
  };
}

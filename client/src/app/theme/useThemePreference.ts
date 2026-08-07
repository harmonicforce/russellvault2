// Wiring between the ThemeStore port and the document root.
//
// The whole of the theme's runtime behaviour is: read a stored value, apply it
// to <html>, and write it back when the operator chooses differently. There is
// no OS media-query listener here on purpose — see below.

import { useCallback, useState } from 'react';
import { applyThemePreference, readThemePreference, type ThemePreference, type ThemeStore } from '../../lib/theme';

/**
 * Read the stored preference and apply it, returning the current value and a
 * setter.
 *
 * WHY THERE IS NO `prefers-color-scheme` LISTENER
 *
 * `applyThemePreference('system')` REMOVES the data-theme attribute rather than
 * writing a resolved snapshot, which leaves the stylesheet's
 * `prefers-color-scheme` block live. The OS change is therefore handled by CSS,
 * already, correctly, with no JavaScript involved. Adding a matchMedia listener
 * to re-apply a resolved value would not add behaviour — it would replace
 * working CSS with a snapshot that is stale between renders. The absence of
 * that listener is the feature.
 */
export function useThemePreference(
  store: ThemeStore,
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): readonly [ThemePreference, (next: ThemePreference) => void] {
  // Resolved once, during the initializer, so the stored theme is applied
  // before first paint rather than flashing the default and correcting it.
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const initial = readThemePreference(store.read());
    if (root) applyThemePreference(root, initial);
    return initial;
  });

  const choose = useCallback(
    (next: ThemePreference) => {
      // Apply first: a storage failure must not stop the theme from changing.
      if (root) applyThemePreference(root, next);
      setPreference(next);
      // Guarded HERE, not only inside the browser adapter. This is the single
      // choke point every store passes through, so the invariant — a storage
      // problem costs durability, never the application — holds for any
      // implementation rather than depending on each one to be careful.
      // Without this, a throwing store escapes through React's event system
      // as an unhandled exception.
      try {
        store.write(next);
      } catch {
        /* Preference applies for this session but will not be remembered. */
      }
    },
    [root, store],
  );

  return [preference, choose] as const;
}

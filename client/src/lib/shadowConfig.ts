// Supabase connection configuration for the governed application.
//
// Resolves only when BOTH the explicit flag and the full Supabase
// configuration are present; anything else returns null. Note that null here
// means "cannot construct a client", not "run the legacy app instead" —
// `appConfig.ts` decides which application runs, and a partial configuration
// fails closed there. No URL, key, or secret is ever committed; values come
// from the environment.
//
// The variable names retain the historical "shadow" prefix because the
// deployed service already sets them. Renaming them is a separate change.

export interface ShadowAuthConfig {
  url: string;
  anonKey: string;
}

/**
 * An environment bag, as it actually arrives.
 *
 * This used to be `Record<string, string | undefined>`, which `import.meta.env`
 * is not: Vite types DEV, PROD and SSR as booleans. Every call site therefore
 * carried `import.meta.env` —
 * a double cast asserting something untrue about an external input. Declaring
 * the real shape and reading the values with a type check removes seven of
 * those casts and validates the boundary instead of asserting past it.
 */
export type EnvLike = Record<string, unknown>;

/** One environment value, only if it is actually a non-empty string. */
function readString(env: EnvLike, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const SHADOW_AUTH_FLAG = 'VITE_SHADOW_AUTH';

export function getShadowAuthConfig(env: EnvLike): ShadowAuthConfig | null {
  if (readString(env, SHADOW_AUTH_FLAG) !== 'supabase') return null;
  const url = readString(env, 'VITE_SUPABASE_URL');
  const anonKey = readString(env, 'VITE_SUPABASE_ANON_KEY');
  if (url === null || anonKey === null) return null;
  return { url, anonKey };
}

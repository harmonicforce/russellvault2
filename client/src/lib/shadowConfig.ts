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

export type EnvLike = Record<string, string | undefined>;

export const SHADOW_AUTH_FLAG = 'VITE_SHADOW_AUTH';

export function getShadowAuthConfig(env: EnvLike): ShadowAuthConfig | null {
  if (env[SHADOW_AUTH_FLAG] !== 'supabase') return null;
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// Feature-flag resolution for the Phase 2 Supabase shadow auth shell.
//
// The shadow integration is OFF unless BOTH the explicit flag and the full
// Supabase configuration are present. Missing or partial configuration always
// resolves to null, which keeps the deployed legacy SQLite behavior untouched.
// No URL, key, or secret is ever committed; values come from the environment.

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

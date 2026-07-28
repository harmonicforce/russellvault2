// Supabase client factory for the shadow auth shell.
//
// Returns null unless the explicit feature flag AND full configuration are
// present (see shadowConfig.ts), so the deployed default remains the legacy
// SQLite app with no Supabase traffic at all.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { AuthShellClient } from './authShell';
import { getShadowAuthConfig, type EnvLike } from './shadowConfig';

export function createShadowClient(env: EnvLike): AuthShellClient | null {
  const config = getShadowAuthConfig(env);
  if (!config) return null;
  return createClient<Database>(config.url, config.anonKey) as unknown as AuthShellClient;
}

// The full Supabase client, for surfaces (workspace context, first-run setup)
// that need more than the restricted AuthShellClient surface — e.g. reading
// workspace rows directly. RLS still applies to every call under the caller's
// own session; there is no service-role key here either.
export function createShadowSupabaseClient(env: EnvLike): SupabaseClient<Database> | null {
  const config = getShadowAuthConfig(env);
  if (!config) return null;
  return createClient<Database>(config.url, config.anonKey);
}

// Supabase client factory for the governed application.
//
// Returns null unless the explicit feature flag AND full configuration are
// present (see shadowConfig.ts). Callers must not read null as "fall back to
// legacy": AuthShell resolves the application mode first and refuses to render
// anything at all when the governed configuration is partial, so no client is
// ever constructed in that case.

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

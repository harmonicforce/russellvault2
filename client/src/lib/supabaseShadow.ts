// Supabase client factory for the shadow auth shell.
//
// Returns null unless the explicit feature flag AND full configuration are
// present (see shadowConfig.ts), so the deployed default remains the legacy
// SQLite app with no Supabase traffic at all.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { AuthShellClient } from './authShell';
import { getShadowAuthConfig, type EnvLike } from './shadowConfig';

export function createShadowClient(env: EnvLike): AuthShellClient | null {
  const config = getShadowAuthConfig(env);
  if (!config) return null;
  return createClient<Database>(config.url, config.anonKey) as unknown as AuthShellClient;
}

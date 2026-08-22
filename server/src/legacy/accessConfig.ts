// Quarantine configuration for the legacy SQLite HTTP surface.
//
// WHAT THIS IS NOT: this file does not make legacy rows authoritative, and
// LEGACY_WORKSPACE_ID does not make them workspace-scoped. The legacy SQLite
// dataset is global — one flat database with no workspace column. Binding it to
// a workspace is a QUARANTINE mechanism: it names the single governed workspace
// whose members are permitted to see the legacy data at all. It is an access
// boundary, not a claim of ownership or authority.
//
// Because the binding is an access boundary rather than a data fact, it must be
// stated explicitly by an operator. There is deliberately no "first workspace"
// fallback and no inference from the governed tables: guessing wrong would hand
// one workspace's members another workspace's legacy records, and the guess
// would look exactly like a correct configuration.
//
// With LEGACY_WORKSPACE_ID absent — the deployed default until an owner sets it
// — this module reports the surface unconfigured and every legacy route fails
// closed. That is the intended production posture, not a degraded one.

export type EnvLike = Record<string, string | undefined>;

export const LEGACY_WORKSPACE_ID_VAR = 'LEGACY_WORKSPACE_ID';
export const ALLOW_LEGACY_WRITES_VAR = 'ALLOW_LEGACY_WRITES';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LegacyAccessConfig {
  /** Governed project whose Auth verifies the caller's bearer token. */
  readonly supabaseUrl: string;
  /** PUBLIC client identifier. Grants only what RLS allows; never a secret. */
  readonly supabaseAnonKey: string;
  /** The single governed workspace whose members may reach legacy routes. */
  readonly legacyWorkspaceId: string;
}

/**
 * Returns the configuration only when every part of it is present and
 * well-formed. A partially configured surface is treated as unconfigured: half
 * a quarantine is not a quarantine.
 */
export function getLegacyAccessConfig(env: EnvLike): LegacyAccessConfig | null {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  const legacyWorkspaceId = env[LEGACY_WORKSPACE_ID_VAR];
  if (!supabaseUrl || !supabaseAnonKey || !legacyWorkspaceId) return null;
  // Shape check only. Whether this workspace exists, and whether the caller
  // belongs to it, is answered by the database under the caller's own JWT.
  if (!UUID_RE.test(legacyWorkspaceId)) return null;
  return { supabaseUrl, supabaseAnonKey, legacyWorkspaceId };
}

export function isLegacyAccessConfigured(env: EnvLike): boolean {
  return getLegacyAccessConfig(env) !== null;
}

/**
 * Legacy writes are OFF in every environment unless explicitly enabled.
 *
 * This replaces the previous rule, which read `!isProduction || flag === 'true'`
 * and therefore left development and test writable by default. "Only production
 * is protected" is the wrong default for an unauthoritative store: it means the
 * dangerous behaviour is the one you get without thinking about it, and it means
 * local and CI runs exercise a code path production never takes.
 */
export function resolveLegacyWritesEnabled(env: EnvLike = process.env): boolean {
  return env[ALLOW_LEGACY_WRITES_VAR] === 'true';
}

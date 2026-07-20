// Feature gating for the Phase 3 provenance import surface.
//
// TWO INDEPENDENT GATES, both required:
//   1. SHADOW_IMPORT=repository-fixtures — explicit demo/import mode. This is
//      an AVAILABILITY gate only. It decides whether the routes exist at all;
//      it grants nobody any permission.
//   2. SUPABASE_URL + SUPABASE_ANON_KEY — the local/shadow project the caller's
//      own JWT is verified against. Without them there is no way to
//      authenticate anyone, so the surface stays closed rather than falling
//      back to something weaker.
//
// AUTHORIZATION is separate and always enforced per request: see auth.ts. Every
// route requires a valid caller bearer token and an explicit workspace id, and
// membership is resolved through the shadow Supabase client running under that
// same caller JWT. There is deliberately no service-role key here and no
// second, hard-coded authorization model that could drift from the database's.
//
// With the flags absent — the deployed default — this module reports the
// surface unavailable, the routes 404, no fixture is read, and the legacy
// SQLite application is completely unaffected.
//
// The anon key is a PUBLIC client identifier, not a secret: it grants only what
// RLS allows for an unauthenticated caller, which for every provenance table is
// nothing at all.

export const SHADOW_IMPORT_FLAG = 'SHADOW_IMPORT';

export type EnvLike = Record<string, string | undefined>;

export interface ProvenanceConfig {
  /** Explicit demo/import mode. There is no implicit or automatic mode. */
  readonly mode: 'repository-fixtures';
  /** Shadow project the caller's JWT is verified against. */
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

export function getProvenanceConfig(env: EnvLike): ProvenanceConfig | null {
  if (env[SHADOW_IMPORT_FLAG] !== 'repository-fixtures') return null;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return { mode: 'repository-fixtures', supabaseUrl, supabaseAnonKey };
}

export function isProvenanceEnabled(env: EnvLike): boolean {
  return getProvenanceConfig(env) !== null;
}

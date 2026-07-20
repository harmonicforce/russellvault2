// Feature-flag resolution for the Phase 3 import-review interface.
//
// The review UI requires BOTH:
//   * a working shadow auth configuration (Phase 2), because every stored
//     provenance row is read under the caller's own JWT with RLS applied; and
//   * the explicit Phase 3 review flag.
//
// Missing or partial configuration always resolves to null, which keeps the
// deployed legacy SQLite experience completely untouched: no nav entry, no
// route, no query, no Supabase traffic. There is no default-on path.

import { getShadowAuthConfig, type EnvLike } from './shadowConfig';

export const SHADOW_IMPORT_FLAG = 'VITE_SHADOW_IMPORT';

export interface ProvenanceUiConfig {
  /** Explicit demo/import mode. Never inferred. */
  readonly mode: 'repository-fixtures';
  readonly url: string;
  readonly anonKey: string;
}

export function getProvenanceUiConfig(env: EnvLike): ProvenanceUiConfig | null {
  if (env[SHADOW_IMPORT_FLAG] !== 'repository-fixtures') return null;
  // The review surface is useless — and unsafe to imply — without the
  // authenticated shadow session that RLS depends on.
  const auth = getShadowAuthConfig(env);
  if (!auth) return null;
  return { mode: 'repository-fixtures', url: auth.url, anonKey: auth.anonKey };
}

export function isProvenanceUiEnabled(env: EnvLike): boolean {
  return getProvenanceUiConfig(env) !== null;
}

// Every record surfaced by this interface is staging evidence, never a
// business fact. The UI renders this verbatim.
export const STAGING_NOTICE =
  'Staging / non-authoritative. These records are imported source evidence for ' +
  'review only. They are not business records, and nothing here feeds the ' +
  'live Russell Vault application.';

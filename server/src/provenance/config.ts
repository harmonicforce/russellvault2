// Feature gating for the Phase 3 provenance import adapter.
//
// The adapter is OFF unless the operator explicitly turns it on. With the flag
// absent — which is the deployed default — every provenance route reports
// itself unavailable and the adapter never reads a fixture, never computes a
// hash, and never produces an import plan. The legacy SQLite application is
// completely unaffected either way.
//
// This flag enables a READ-ONLY, deterministic transformation of files that are
// already committed to this repository. It grants no database access, no
// network access, and no ability to reach a live file, a production export, or
// any remote system.

export const SHADOW_IMPORT_FLAG = 'SHADOW_IMPORT';

export type EnvLike = Record<string, string | undefined>;

export interface ProvenanceConfig {
  /** Explicit demo/import mode. There is no implicit or automatic mode. */
  mode: 'repository-fixtures';
}

export function getProvenanceConfig(env: EnvLike): ProvenanceConfig | null {
  if (env[SHADOW_IMPORT_FLAG] !== 'repository-fixtures') return null;
  return { mode: 'repository-fixtures' };
}

export function isProvenanceEnabled(env: EnvLike): boolean {
  return getProvenanceConfig(env) !== null;
}

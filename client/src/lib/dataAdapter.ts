// Data-path registry for Phase 2.
//
// The legacy SQLite REST adapter (lib/api.ts → /api → server/src) is the ONLY
// read and write path for business data. The Supabase shadow database is
// non-authoritative: the client touches it solely for authentication and
// workspace-membership checks inside the auth shell. There is deliberately no
// shadow data adapter and no dual-write path; adding one is a later
// owner-reviewed activation gate.

export const DATA_BACKENDS = ['legacy-sqlite-rest'] as const;

export type DataBackend = (typeof DATA_BACKENDS)[number];

export function activeDataBackend(): DataBackend {
  return 'legacy-sqlite-rest';
}

// Compile-time and runtime statement that no shadow write path exists.
export const SHADOW_WRITES_ENABLED = false as const;

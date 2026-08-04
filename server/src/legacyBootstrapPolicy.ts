// Two DIFFERENT permissions, deliberately kept apart.
//
//   ALLOW_LEGACY_WRITES   governs legacy HTTP mutation routes. See
//                         legacyWriteGuard.ts. This module does not change it.
//
//   SEED_LEGACY_ON_EMPTY  governs whether this process may CREATE, MIGRATE or
//                         SEED the legacy SQLite database during startup.
//
// They are separate because the HTTP guard is Express middleware, and
// middleware cannot govern anything that happens while modules are being
// imported. Startup previously ran `seedIfEmpty()` and `migrateProductType()`
// at module scope, before the guard existed, so `ALLOW_LEGACY_WRITES=false`
// never stopped them: a container that booted against a missing or empty
// volume rebuilt the schema and repopulated five tables from the repository
// fixtures. Those fixtures are the ORIGINAL IMPORT, not a backup — and the
// `sales` table has no fixture at all, so the result looked like a recovered
// production database while the sales history was simply gone. That is the
// failure this flag exists to prevent.
//
// Neither flag implies the other. Enabling HTTP writes does not authorize
// bootstrap; authorizing bootstrap does not enable HTTP writes.

export type EnvLike = Record<string, string | undefined>;

/** The environment variable that authorizes legacy boot/bootstrap writes. */
export const LEGACY_BOOTSTRAP_FLAG = 'SEED_LEGACY_ON_EMPTY';

/** The only value that enables it. Everything else is disabled. */
export const LEGACY_BOOTSTRAP_ENABLED_VALUE = 'true';

/**
 * Fail closed. Only the exact string `'true'` authorizes bootstrap: missing,
 * empty, `'false'`, `'1'`, `'TRUE'`, `'yes'` and every other value are
 * disabled. This is the same exact-match rule `ALLOW_LEGACY_WRITES` already
 * uses, so the repository has one boolean convention rather than two.
 *
 * Permission is never inferred from anything else. `NODE_ENV`, `DATA_DIR`,
 * `DATABASE_PATH`, a writable filesystem and `ALLOW_LEGACY_WRITES` are all
 * irrelevant here by design — each of them would have authorized exactly the
 * accident this flag prevents.
 */
export function legacyBootWritesEnabled(env: EnvLike = process.env): boolean {
  return env[LEGACY_BOOTSTRAP_FLAG] === LEGACY_BOOTSTRAP_ENABLED_VALUE;
}

/**
 * One line for the startup log. Names the flag so an operator reading container
 * output can see which policy applied, and never prints a path or a secret.
 */
export function describeBootstrapPolicy(env: EnvLike = process.env): string {
  return legacyBootWritesEnabled(env)
    ? `legacy bootstrap AUTHORIZED by ${LEGACY_BOOTSTRAP_FLAG}=${LEGACY_BOOTSTRAP_ENABLED_VALUE} — ` +
      'schema creation and repository-fixture seeding of EMPTY tables may run. ' +
      'Repository fixtures are the original import, not a backup, and are not a ' +
      'valid production restoration source.'
    : `legacy bootstrap DISABLED (${LEGACY_BOOTSTRAP_FLAG} is not '${LEGACY_BOOTSTRAP_ENABLED_VALUE}') — ` +
      'no schema will be created or altered and no fixture rows will be inserted. ' +
      'A missing or empty legacy database will be reported by GET /api/health, not rebuilt.';
}

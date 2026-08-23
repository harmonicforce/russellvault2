// Governed application readiness — the state Railway's probe should actually
// care about.
//
// The defect this addresses (R-003): `GET /api/health` returned 503 whenever the
// legacy SQLite database was missing, unreadable, structurally incomplete or
// empty. Railway health-checks that path, so a non-authoritative legacy file
// could veto a governed deployment — a store that is authoritative for no
// current business fact could stop the governed application from shipping.
//
// Readiness here is a pure function of CONFIGURATION. It performs no network
// call and never touches Supabase.
//
// That is deliberate, and it is the point of "do not create an outage
// amplifier": if the probe reached out to Supabase on every request, a Supabase
// blip would fail the health check, Railway would restart or refuse to promote,
// and a transient dependency wobble would become a self-inflicted outage. What
// this process can honestly answer about itself is whether it was GIVEN a
// coherent governed configuration. Whether Supabase is currently reachable is a
// question for the request that needs it, which already fails closed on its own.

export type EnvLike = Record<string, string | undefined>;

/**
 * Which application this deployment actually is. Named explicitly so a
 * legacy-only deployment can never be silently counted as governed.
 */
export type ApplicationMode =
  /** Governed configuration is present and coherent. */
  | 'governed'
  /** No governed configuration at all: legacy SQLite surfaces only. */
  | 'legacy_only'
  /** Governed configuration is present but incomplete or malformed. */
  | 'misconfigured';

/** Bounded, non-secret codes. Never carries a URL, key, path, or provider text. */
export type GovernedReadinessReason =
  | 'governed_configuration_absent'
  | 'governed_configuration_incomplete';

export interface GovernedReadiness {
  readonly mode: ApplicationMode;
  readonly governedReady: boolean;
  readonly reason?: GovernedReadinessReason;
}

/**
 * A shape check only. It exists to catch an operator pasting a project ref, a
 * bare host, or a truncated value into SUPABASE_URL — a configuration mistake
 * this process CAN detect without talking to anyone. It deliberately does not
 * check which project the URL points at: that is deployment identity, and per
 * CLAUDE.md the deployed runtime is the only authority for it.
 */
export function isWellFormedSupabaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return parsed.hostname.length > 0;
}

/**
 * Fail closed on a half-configured deployment.
 *
 * "Both absent" and "one absent" are deliberately DIFFERENT states. Absent
 * means nobody intended governed operation here; incomplete means somebody did
 * and got it wrong, which is an operator error that must be surfaced loudly
 * rather than degraded into legacy-only.
 */
export function resolveGovernedReadiness(env: EnvLike = process.env): GovernedReadiness {
  const url = env.SUPABASE_URL?.trim() ?? '';
  const key = env.SUPABASE_ANON_KEY?.trim() ?? '';

  if (url === '' && key === '') {
    return { mode: 'legacy_only', governedReady: false, reason: 'governed_configuration_absent' };
  }
  if (url === '' || key === '' || !isWellFormedSupabaseUrl(url)) {
    return { mode: 'misconfigured', governedReady: false, reason: 'governed_configuration_incomplete' };
  }
  return { mode: 'governed', governedReady: true };
}

/**
 * The HTTP status Railway's probe should see.
 *
 * 503 for `misconfigured` only. A partially configured deployment is broken and
 * must not be promoted. `legacy_only` returns 200 because the process is live
 * and serving exactly what it was configured to serve — but it reports
 * `governedReady: false` and `mode: 'legacy_only'`, so nothing reads it as a
 * governed deployment.
 *
 * Legacy state never appears in this decision. That is the whole repair.
 */
export function readinessStatus(readiness: GovernedReadiness): number {
  return readiness.mode === 'misconfigured' ? 503 : 200;
}

export function describeGovernedReadiness(readiness: GovernedReadiness): string {
  switch (readiness.mode) {
    case 'governed':
      return 'governed configuration present — governed surfaces may serve';
    case 'legacy_only':
      return 'LEGACY-ONLY deployment — no governed configuration; governed surfaces are unavailable';
    case 'misconfigured':
      return 'governed configuration INCOMPLETE — readiness fails closed until it is corrected';
  }
}

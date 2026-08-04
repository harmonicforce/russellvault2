// Dedicated transport for GET /api/health.
//
// The generic `request()` helper in api.ts turns every non-2xx into
// `new Error(...)`. That is correct for ordinary endpoints, but wrong here:
// S0.1 made 503 a DEFINED state whose body is structured diagnostic data
// describing why the legacy database is unusable. Routing it through the
// generic helper discarded that body and made the banner disappear at exactly
// the moment it had something important to say.
//
// This module parses 200 and the defined 503 as two successful outcomes, and
// keeps everything else — a malformed body, an unexpected status, a network
// failure — as a transport error. Generic `get()` is untouched, so no other
// endpoint gains permission to return 503.

/** The closed set the server emits. The server contract is authoritative; the client never invents a code. */
export const LEGACY_HEALTH_REASONS = [
  'legacy_database_missing',
  'legacy_database_unreadable',
  'legacy_schema_missing',
  'legacy_baseline_empty',
  'legacy_health_check_failed',
] as const;

export type LegacyHealthReason = (typeof LEGACY_HEALTH_REASONS)[number];

export interface SystemHealth {
  readonly ok: boolean;
  readonly readOnly: boolean;
  readonly legacyDatabaseAvailable: boolean;
  readonly legacySchemaPresent: boolean;
  readonly legacySeeded: boolean;
  readonly legacyBootWritesEnabled: boolean;
  /**
   * Absent when healthy. Absent ALSO when the server sent a code this client
   * does not recognize — an unknown code is dropped rather than passed through,
   * so no unvalidated server string can ever reach the screen as an
   * explanation. The unhealthy state itself is still reported.
   */
  readonly reason?: LegacyHealthReason;
}

export type SystemHealthResult =
  | { readonly status: 'healthy'; readonly health: SystemHealth }
  | { readonly status: 'unhealthy'; readonly health: SystemHealth };

/**
 * A response we could not trust: an unexpected status, a body that is not the
 * documented shape, or a network failure. Deliberately carries no server text,
 * so raw HTML, a proxy error page, a stack trace, a path or SQL can never be
 * rendered from it.
 */
export class HealthTransportError extends Error {
  readonly kind: 'network' | 'protocol';
  constructor(kind: 'network' | 'protocol') {
    super(kind === 'network' ? 'health request failed' : 'health response was not the expected shape');
    this.name = 'HealthTransportError';
    this.kind = kind;
  }
}

const BOOLEAN_FIELDS = [
  'ok',
  'readOnly',
  'legacyDatabaseAvailable',
  'legacySchemaPresent',
  'legacySeeded',
  'legacyBootWritesEnabled',
] as const;

function isKnownReason(value: unknown): value is LegacyHealthReason {
  return typeof value === 'string' && (LEGACY_HEALTH_REASONS as readonly string[]).includes(value);
}

/**
 * Narrows an unknown payload to `SystemHealth`, or returns null. Every declared
 * boolean must actually be a boolean — a 503 that is really an HTML proxy page
 * or a `{ error: "..." }` envelope fails here and becomes a protocol error
 * rather than trusted diagnostic data.
 */
export function parseSystemHealth(payload: unknown): SystemHealth | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const field of BOOLEAN_FIELDS) {
    if (typeof record[field] !== 'boolean') return null;
  }
  const reason = record.reason;
  if (reason !== undefined && typeof reason !== 'string') return null;
  return {
    ok: record.ok as boolean,
    readOnly: record.readOnly as boolean,
    legacyDatabaseAvailable: record.legacyDatabaseAvailable as boolean,
    legacySchemaPresent: record.legacySchemaPresent as boolean,
    legacySeeded: record.legacySeeded as boolean,
    legacyBootWritesEnabled: record.legacyBootWritesEnabled as boolean,
    ...(isKnownReason(reason) ? { reason } : {}),
  };
}

export const SYSTEM_HEALTH_PATH = '/api/health';

/** One shared query key, so several components never issue duplicate requests. */
export const SYSTEM_HEALTH_QUERY_KEY = ['system-health'] as const;

/**
 * Fetches and classifies system health.
 *
 * @throws {HealthTransportError} on a network failure, an unexpected status, or
 * a body that is not the documented shape.
 */
export async function fetchSystemHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<SystemHealthResult> {
  let response: Response;
  try {
    response = await fetchImpl(SYSTEM_HEALTH_PATH, { headers: { Accept: 'application/json' } });
  } catch {
    throw new HealthTransportError('network');
  }

  // 200 and 503 are the two documented outcomes. Anything else — a 404 from a
  // stale build, a 502 from a proxy — is not a health answer.
  if (response.status !== 200 && response.status !== 503) {
    throw new HealthTransportError('protocol');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HealthTransportError('protocol');
  }

  const health = parseSystemHealth(payload);
  if (!health) throw new HealthTransportError('protocol');

  // The status code decides, not the body's own `ok`: a body claiming ok while
  // the server said 503 is a contradiction we resolve in the safe direction.
  return response.status === 200 && health.ok
    ? { status: 'healthy', health }
    : { status: 'unhealthy', health };
}

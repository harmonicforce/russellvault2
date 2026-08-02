// Operations dashboard failure contract.
//
// A dashboard panel that cannot load must say so in words the operator can act
// on, and must never substitute a zero. It must also never hand the browser the
// database's own sentence: production was showing
//
//   Could not find the function public.get_operations_inventory_health(
//     p_workspace_id) in the schema cache
//
// which names an internal function, an internal argument, and the fact that
// PostgREST sits behind the API. The operator cannot act on any of that, and it
// tells an attacker the shape of the schema. The original is logged
// server-side; the browser gets a stable code and a sentence about what to do.

/** Stable, machine-readable reasons a panel can be unavailable. */
export type PanelErrorCode =
  | 'unauthenticated'
  | 'unauthorized_workspace'
  | 'feature_unavailable'
  | 'dashboard_contract_missing'
  | 'dependency_failed'
  | 'invalid_status';

/**
 * The readiness vocabulary the database actually stores. A status outside this
 * set matches no rows, so passing one through would answer "nothing is
 * outstanding" for a query that was never valid — a fabricated zero arriving by
 * a different door. Unknown values are refused instead.
 */
export const MEDIA_READINESS_STATUSES: readonly string[] = [
  'complete', 'missing_required_angle', 'missing_defect_photo',
  'media_review_needed', 'upload_incomplete',
];

/**
 * Parse the comma-separated `status` filter. Returns `null` for "no filter",
 * or the rejected values so the caller can refuse rather than guess.
 */
export function parseReadinessStatuses(
  raw: unknown,
): { statuses: string[] | null; invalid: string[] } {
  if (typeof raw !== 'string' || raw.length === 0) return { statuses: null, invalid: [] };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { statuses: null, invalid: [] };
  const invalid = parts.filter((p) => !MEDIA_READINESS_STATUSES.includes(p));
  return { statuses: invalid.length === 0 ? parts : null, invalid };
}

/** Bound a page window. Anything unparseable falls back to the default. */
export function parsePageWindow(
  rawLimit: unknown, rawOffset: unknown,
): { limit: number; offset: number } {
  const limit = Number.parseInt(String(rawLimit ?? ''), 10);
  const offset = Number.parseInt(String(rawOffset ?? ''), 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  };
}

export interface PanelFailure {
  readonly status: number;
  readonly body: {
    readonly error: 'panel_unavailable';
    readonly code: PanelErrorCode;
    readonly message: string;
  };
}

const MESSAGES: Record<PanelErrorCode, string> = {
  unauthenticated: 'Sign in again to load this panel.',
  unauthorized_workspace: 'You do not have access to this workspace.',
  feature_unavailable: 'This dashboard is not enabled on this deployment.',
  dashboard_contract_missing:
    'This dashboard panel is not available because the required database update has not been applied.',
  dependency_failed:
    'This dashboard panel could not be loaded because a dependency failed. The value is unknown, not zero.',
  invalid_status:
    'That photo readiness filter is not one this system recognises, so no backlog was reported for it.',
};

/**
 * A missing governed function is the one dependency failure with a specific
 * remedy — apply the migration — so it is worth telling apart from a database
 * that is merely unwell. PostgREST reports it as PGRST202 and as a "schema
 * cache" miss; PostgreSQL reports the same absence as "does not exist".
 */
function isMissingContract(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('pgrst202')
    || m.includes('schema cache')
    || m.includes('could not find the function')
    || m.includes('does not exist')
    || m.includes('undefined function');
}

/**
 * The governed functions raise 42501 with this sentence when the caller is not
 * a member. That is an authorization answer, not a broken dependency, and the
 * operator needs to be told which it is.
 */
function isAuthorizationFailure(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('not a member of this workspace')
    || m.includes('permission denied')
    || m.includes('row-level security')
    || m.includes('insufficient privilege');
}

/** Classify a raw database/PostgREST message into the public contract. */
export function classifyDependencyFailure(rawMessage: string): PanelFailure {
  const code: PanelErrorCode = isAuthorizationFailure(rawMessage)
    ? 'unauthorized_workspace'
    : isMissingContract(rawMessage)
      ? 'dashboard_contract_missing'
      : 'dependency_failed';
  return {
    status: code === 'unauthorized_workspace' ? 403 : 503,
    body: { error: 'panel_unavailable', code, message: MESSAGES[code] },
  };
}

export function panelFailure(code: PanelErrorCode, status: number): PanelFailure {
  return { status, body: { error: 'panel_unavailable', code, message: MESSAGES[code] } };
}

/**
 * Everything an operator must never receive from a panel failure. Exported so
 * the tests assert against one list rather than restating it, and so adding a
 * new leak-prone token is a one-line change.
 */
export const FORBIDDEN_IN_CLIENT_PAYLOAD: readonly string[] = [
  'get_operations_inventory_health',
  'get_media_readiness_summary',
  'get_listing_prep_summary',
  'inventory_work_queue',
  'inventory_movements',
  'p_workspace_id',
  'schema cache',
  'PGRST',
];

import type { TokenProvider } from './inventoryIdentityApi';

export interface HealthPanel { asOf: string; serializedUnits: number; lotManagedRecords: number; lotManagedUnits: number; withoutLocation: number }
export interface WorkTask { taskType: string; subjectKind: string; subjectId: string; publicId: string; displayName: string; reason: string; ageDays: number; severity: string; score: number; scoreExplanation: string; destination: string }
export interface WorkPanel { asOf: string; definition: string; tasks: WorkTask[] }
export interface ActivityPanel { asOf: string; source: string; events: Array<{ id: string; public_id: string; eventType: string; moved_at: string; destination: string }> }
/**
 * The readiness vocabulary, named once. Anything arriving from a URL, a saved
 * link or a hand-edited query string is checked against this before it reaches
 * a lookup table or the database — an unrecognised status that is passed
 * through matches no rows and reports an empty backlog, which is the same lie
 * as substituting a zero.
 */
export const MEDIA_READINESS_STATUSES = [
  'complete', 'missing_required_angle', 'missing_defect_photo',
  'media_review_needed', 'upload_incomplete',
] as const;

export type MediaReadinessStatus = (typeof MEDIA_READINESS_STATUSES)[number];

export function isMediaReadinessStatus(value: string | null | undefined): value is MediaReadinessStatus {
  return !!value && (MEDIA_READINESS_STATUSES as readonly string[]).includes(value);
}

export interface MediaReadinessRow {
  subject_kind: 'item' | 'lot';
  subject_id: string;
  public_id: string;
  display_name: string | null;
  detail_line: string | null;
  subtype: string | null;
  readiness_status: MediaReadinessStatus;
  active_count: number;
  reserved_count: number;
  open_issue_count: number;
  missing_required_angles: string[];
  missing_required_defect_photos: string[];
}

export interface MediaReadinessPage {
  asOf: string; total: number; limit: number; offset: number; rows: MediaReadinessRow[];
}

export interface WorkflowPanel {
  asOf: string;
  media: {
    /** Exact count of current stock with no live photograph at all. */
    no_active_photo: number;
    /** Current-stock readiness breakdown; a record here may already have photos. */
    by_readiness: Partial<Record<MediaReadinessStatus, number>>;
    open_issue_count: number;
  };
  listingPrep: {
    /** Raw lifecycle tally, unchanged. */
    by_status: Partial<Record<'not_started' | 'in_preparation' | 'blocked' | 'needs_review' | 'ready_to_list' | 'listed' | 'cancelled', number>>;
    by_readiness: Partial<Record<'ready' | 'needs_photos' | 'needs_condition_review' | 'needs_owner_review' | 'blocked', number>>;
    /** Current stock with no LIVE preparation. A record whose earlier
     * preparation was listed or cancelled counts here, so this is deliberately
     * not called "never started". */
    no_active_preparation: number;
    /** Status says ready AND live readiness agrees. */
    ready_now: number;
    /** Status still says ready, but a blocker has appeared since. */
    regressed_ready: number;
  };
}

/**
 * A panel failure carries the stable reason so the UI can act on it, not just
 * a sentence. `code` is absent when the failure came from shared middleware
 * (auth, feature flag) rather than from this feature's own contract.
 */
export class PanelError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PanelError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  tokenProvider: TokenProvider, workspaceId: string, panel: string,
  query: Record<string, string | undefined> = {},
): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new PanelError('Sign in to load this panel.', 401, 'unauthenticated');
  const search = new URLSearchParams({ workspaceId });
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const res = await fetch(`/api/operations-dashboard/${panel}?${search.toString()}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({})) as { message?: string; detail?: string; error?: string; code?: string };
  if (!res.ok) {
    // The route's own contract sends `message` + `code`. Shared middleware
    // (revoked membership, rejected token, feature disabled) sends only
    // `error`, and reading `detail` alone reduced all of those to
    // "Panel failed (403)" — which tells the operator nothing about whether to
    // sign in, switch workspace, or wait for a deployment.
    const message = body.message
      ?? body.detail
      ?? body.error
      ?? `This panel could not be loaded (${res.status}).`;
    throw new PanelError(message, res.status, body.code);
  }
  return body as T;
}
export const createOperationsDashboardTransport = (token: TokenProvider) => ({
  health: (workspaceId: string) => request<HealthPanel>(token, workspaceId, 'health'),
  work: (workspaceId: string) => request<WorkPanel>(token, workspaceId, 'work'),
  workflows: (workspaceId: string) => request<WorkflowPanel>(token, workspaceId, 'workflows'),
  /**
   * One page of the readiness backlog. `total` is the exact governed count, so
   * a backlog larger than one page is reachable rather than silently truncated
   * at the default 50.
   */
  mediaReadiness: (
    workspaceId: string,
    status?: readonly MediaReadinessStatus[],
    limit?: number,
    offset?: number,
  ) =>
    request<MediaReadinessPage>(token, workspaceId, 'media-readiness', {
      status: status?.length ? status.join(',') : undefined,
      limit: limit === undefined ? undefined : String(limit),
      offset: offset === undefined || offset === 0 ? undefined : String(offset),
    }),
  activity: (workspaceId: string) => request<ActivityPanel>(token, workspaceId, 'activity'),
});

import type { TokenProvider } from './inventoryIdentityApi';

export interface HealthPanel { asOf: string; serializedUnits: number; lotManagedRecords: number; lotManagedUnits: number; withoutLocation: number }
export interface WorkTask { taskType: string; subjectKind: string; subjectId: string; publicId: string; displayName: string; reason: string; ageDays: number; severity: string; score: number; scoreExplanation: string; destination: string }
export interface WorkPanel { asOf: string; definition: string; tasks: WorkTask[] }
export interface ActivityPanel { asOf: string; source: string; events: Array<{ id: string; public_id: string; eventType: string; moved_at: string; destination: string }> }
export interface WorkflowPanel {
  asOf: string;
  media: { counts: Partial<Record<'complete' | 'missing_required_angle' | 'missing_defect_photo' | 'media_review_needed' | 'upload_incomplete', number>>; open_issue_count: number };
  listingPrep: { by_status: Partial<Record<'not_started' | 'in_preparation' | 'blocked' | 'needs_review' | 'ready_to_list' | 'listed' | 'cancelled', number>>; by_readiness: Partial<Record<'ready' | 'needs_photos' | 'needs_condition_review' | 'needs_owner_review' | 'blocked', number>>; never_started: number };
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

async function request<T>(tokenProvider: TokenProvider, workspaceId: string, panel: string): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new PanelError('Sign in to load this panel.', 401, 'unauthenticated');
  const res = await fetch(`/api/operations-dashboard/${panel}?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: { authorization: `Bearer ${token}` } });
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
  activity: (workspaceId: string) => request<ActivityPanel>(token, workspaceId, 'activity'),
});

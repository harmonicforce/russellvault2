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

async function request<T>(tokenProvider: TokenProvider, workspaceId: string, panel: string): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new Error('Sign in to load this panel.');
  const res = await fetch(`/api/operations-dashboard/${panel}?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({})) as { detail?: string };
  if (!res.ok) throw new Error(body.detail ?? `Panel failed (${res.status}).`);
  return body as T;
}
export const createOperationsDashboardTransport = (token: TokenProvider) => ({
  health: (workspaceId: string) => request<HealthPanel>(token, workspaceId, 'health'),
  work: (workspaceId: string) => request<WorkPanel>(token, workspaceId, 'work'),
  workflows: (workspaceId: string) => request<WorkflowPanel>(token, workspaceId, 'workflows'),
  activity: (workspaceId: string) => request<ActivityPanel>(token, workspaceId, 'activity'),
});

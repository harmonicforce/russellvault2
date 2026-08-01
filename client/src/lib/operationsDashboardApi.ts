import type { TokenProvider } from './inventoryIdentityApi';

export interface HealthPanel { asOf: string; serializedUnits: number; lotManagedRecords: number; lotManagedUnits: number; withoutLocation: number }
export interface WorkTask { taskType: string; subjectKind: string; subjectId: string; publicId: string; displayName: string; reason: string; ageDays: number; severity: string; score: number; scoreExplanation: string; destination: string }
export interface WorkPanel { asOf: string; definition: string; tasks: WorkTask[] }
export interface ActivityPanel { asOf: string; source: string; events: Array<{ id: string; public_id: string; eventType: string; moved_at: string; destination: string }> }

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
  workflows: (workspaceId: string) => request<Record<string, unknown>>(token, workspaceId, 'workflows'),
  activity: (workspaceId: string) => request<ActivityPanel>(token, workspaceId, 'activity'),
});

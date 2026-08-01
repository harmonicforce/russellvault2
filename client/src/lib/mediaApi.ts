// Inventory media transport.
//
// Metadata goes through /api/media, which calls the governed SECURITY DEFINER
// functions under the caller's own token. Image bytes never go through the
// server: reserve returns a short-lived signed upload URL and the browser PUTs
// straight into the private bucket.

export type SubjectKind = 'item' | 'lot';
export type MediaLifecycle = 'reserved' | 'active' | 'deleted';

export interface MediaRecord {
  readonly id: string;
  readonly lifecycle: MediaLifecycle;
  readonly storage_path: string;
  readonly slot_key: string | null;
  readonly slot_label: string | null;
  readonly sort_order: number;
  readonly is_primary: boolean;
  readonly content_type: string;
  readonly byte_size: number;
  readonly rotation_degrees: number;
  readonly original_filename: string | null;
  readonly created_at: string;
  readonly deleted_at: string | null;
  readonly purge_after: string | null;
  readonly purged_at: string | null;
}

export type ReadinessStatus =
  | 'complete' | 'missing_required_angle' | 'missing_defect_photo'
  | 'media_review_needed' | 'upload_incomplete';

export interface MediaSlot {
  readonly slot_key: string;
  readonly slot_label: string;
  readonly slot_kind: 'angle' | 'label' | 'defect' | 'accessory' | 'seal' | 'measurement';
  readonly is_required: boolean;
  readonly covered: boolean;
}

export interface MediaReadiness {
  readonly readiness_status: ReadinessStatus;
  readonly subtype: string;
  readonly active_count: number;
  readonly reserved_count: number;
  readonly recoverable_count: number;
  readonly open_issue_count: number;
  readonly missing_required_angles: readonly string[];
  readonly missing_required_defect_photos: readonly string[];
  readonly slots: readonly MediaSlot[];
}

export interface MediaIssue {
  readonly id: string;
  readonly issue_kind: string;
  readonly state: 'open' | 'resolved' | 'dismissed';
  readonly media_id: string | null;
  readonly storage_path: string | null;
  readonly detail: Record<string, unknown>;
  readonly detected_at: string;
  readonly resolution_note: string | null;
  readonly subject_kind: SubjectKind | null;
  readonly subject_id: string | null;
  readonly media_lifecycle: MediaLifecycle | null;
}

export interface ReserveInput {
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly idempotencyKey: string;
  readonly originalFilename?: string | null;
  readonly contentHash?: string | null;
  readonly slotKey?: string | null;
  readonly slotLabel?: string | null;
}

export interface Reservation {
  readonly outcome: 'reserved' | 'replay';
  readonly media_id: string;
  readonly storage_path: string;
  readonly lifecycle: MediaLifecycle;
  readonly duplicate_of?: string | null;
  /** Null when the bytes for this reservation already landed. */
  readonly upload: { readonly signedUrl: string | null; readonly token: string | null; readonly path: string } | null;
}

export interface MediaTransport {
  list(kind: SubjectKind, subjectId: string, includeDeleted?: boolean): Promise<readonly MediaRecord[]>;
  readiness(kind: SubjectKind, subjectId: string): Promise<MediaReadiness>;
  signedUrls(paths: readonly string[]): Promise<Record<string, string>>;
  reserve(input: ReserveInput): Promise<Reservation>;
  commit(mediaId: string): Promise<Record<string, unknown>>;
  abandon(mediaId: string, reason: string): Promise<Record<string, unknown>>;
  reorder(kind: SubjectKind, subjectId: string, mediaIds: readonly string[]): Promise<Record<string, unknown>>;
  setPrimary(mediaId: string): Promise<Record<string, unknown>>;
  rotate(mediaId: string, deltaDegrees: number): Promise<Record<string, unknown>>;
  remove(mediaId: string, reason: string | null): Promise<Record<string, unknown>>;
  restore(mediaId: string): Promise<Record<string, unknown>>;
  purge(mediaId: string, storagePath: string): Promise<Record<string, unknown>>;
  issues(state?: 'open' | 'resolved' | 'dismissed' | 'all'): Promise<readonly MediaIssue[]>;
  reconcile(): Promise<Record<string, unknown>>;
  resolveIssue(issueId: string, state: 'resolved' | 'dismissed', note: string | null): Promise<Record<string, unknown>>;
}

export type TokenProvider = () => Promise<string | null>;

/**
 * The governed functions raise plain Postgres messages and the routes reduce
 * them to codes. Translate the ones an operator can actually cause; anything
 * else passes through rather than being guessed at.
 */
const MESSAGES: Record<string, string> = {
  not_found: 'That photo is no longer in this workspace.',
  forbidden: 'You do not have permission to change photos here.',
  lifecycle_conflict: 'That photo has already moved on; refresh and try again.',
  invalid_request: 'That photo could not be accepted.',
};

export function createMediaTransport(
  token: TokenProvider,
  workspaceId: () => string | null,
): MediaTransport {
  const ws = () => {
    const id = workspaceId();
    if (!id) throw new Error('No workspace selected.');
    return id;
  };

  async function request<T>(method: string, path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
    const jwt = await token();
    if (!jwt) throw new Error('Sign in again to work with photos.');
    const search = new URLSearchParams({ workspaceId: ws(), ...(query ?? {}) });
    const response = await fetch(`/api/media${path}?${search.toString()}`, {
      method,
      headers: {
        authorization: `Bearer ${jwt}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify({ workspaceId: ws(), ...body }) : undefined,
    });
    if (!response.ok) {
      let code = 'governed_operation_failed';
      try { code = ((await response.json()) as { error?: string }).error ?? code; } catch { /* non-JSON error */ }
      if (response.status === 404 && code === 'not found') {
        throw new Error('Photo management is not enabled on this deployment.');
      }
      throw new Error(MESSAGES[code] ?? `Photo operation failed (${response.status}).`);
    }
    return (await response.json()) as T;
  }

  return {
    list: (kind, subjectId, includeDeleted = false) =>
      request<readonly MediaRecord[]>('GET', '', undefined, {
        subjectKind: kind, subjectId, includeDeleted: String(includeDeleted),
      }),
    readiness: (kind, subjectId) =>
      request<MediaReadiness>('GET', '/readiness', undefined, { subjectKind: kind, subjectId }),
    async signedUrls(paths) {
      if (paths.length === 0) return {};
      const payload = await request<{ urls: { path: string | null; signedUrl: string | null }[] }>(
        'POST', '/signed-urls', { paths: [...paths] });
      const map: Record<string, string> = {};
      for (const entry of payload.urls) {
        if (entry.path && entry.signedUrl) map[entry.path] = entry.signedUrl;
      }
      return map;
    },
    reserve: (input) => request<Reservation>('POST', '/uploads/reserve', { ...input }),
    commit: (mediaId) => request('POST', `/uploads/${mediaId}/commit`, {}),
    abandon: (mediaId, reason) => request('POST', `/uploads/${mediaId}/abandon`, { reason }),
    reorder: (kind, subjectId, mediaIds) =>
      request('POST', '/reorder', { subjectKind: kind, subjectId, mediaIds: [...mediaIds] }),
    setPrimary: (mediaId) => request('POST', `/${mediaId}/primary`, {}),
    rotate: (mediaId, deltaDegrees) => request('POST', `/${mediaId}/rotate`, { deltaDegrees }),
    remove: (mediaId, reason) => request('DELETE', `/${mediaId}`, { reason }),
    restore: (mediaId) => request('POST', `/${mediaId}/restore`, {}),
    purge: (mediaId, storagePath) => request('POST', `/${mediaId}/purge`, { storagePath }),
    issues: (state = 'open') => request<readonly MediaIssue[]>('GET', '/issues', undefined, { state }),
    reconcile: () => request('POST', '/issues/reconcile', {}),
    resolveIssue: (issueId, state, note) => request('POST', `/issues/${issueId}/resolve`, { state, note }),
  };
}

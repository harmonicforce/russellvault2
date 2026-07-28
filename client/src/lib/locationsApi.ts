// HTTP transport for storage location management (/api/locations).
//
// Every call carries the caller's own Supabase access token; the server
// resolves workspace membership/role from the database under that same JWT.
// Mutations call governed SECURITY DEFINER functions — there is no client-side
// rule engine and no service-role key anywhere in this path.

export type TokenProvider = () => Promise<string | null>;

export interface StorageLocation {
  readonly id: string;
  readonly public_id: string;
  readonly location_code: string;
  readonly parent_id: string | null;
  readonly display_name: string | null;
  readonly retired_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LocationsTransport {
  list(includeRetired?: boolean): Promise<readonly StorageLocation[]>;
  referenceCounts(): Promise<Record<string, number>>;
  create(locationCode: string, displayName: string | null, parentCode: string | null): Promise<StorageLocation>;
  retire(locationCode: string): Promise<void>;
}

async function request<T>(getToken: TokenProvider, method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('you are signed out; sign in to manage locations');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/locations${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404) throw new Error('location management is not available');
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function createLocationsTransport(
  getToken: TokenProvider,
  workspaceId: () => string | null
): LocationsTransport {
  const ws = () => {
    const id = workspaceId();
    if (!id) throw new Error('no workspace selected');
    return `workspaceId=${encodeURIComponent(id)}`;
  };
  return {
    async list(includeRetired = false) {
      const suffix = includeRetired ? '&includeRetired=1' : '';
      const body = await request<{ locations: StorageLocation[] }>(getToken, 'GET', `/?${ws()}${suffix}`);
      return body.locations;
    },
    async referenceCounts() {
      const body = await request<{ counts: Record<string, number> }>(getToken, 'GET', `/reference-counts?${ws()}`);
      return body.counts;
    },
    async create(locationCode, displayName, parentCode) {
      const body = await request<{ location: { id: string; public_id: string; created: boolean } }>(
        getToken,
        'POST',
        `/?${ws()}`,
        {
          workspaceId: workspaceId(),
          locationCode,
          displayName,
          parentCode,
        }
      );
      return {
        id: body.location.id,
        public_id: body.location.public_id,
        location_code: locationCode,
        parent_id: null,
        display_name: displayName,
        retired_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    async retire(locationCode) {
      await request(getToken, 'POST', `/${encodeURIComponent(locationCode)}/retire?${ws()}`, {
        workspaceId: workspaceId(),
      });
    },
  };
}

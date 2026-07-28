// Storage locations, read and written through the caller's own Supabase
// session.
//
// This used to go through /api/locations, which is gated on SERVER-side
// SHADOW_IMPORT / SUPABASE_URL / SUPABASE_ANON_KEY. Those are separate from
// the VITE_* variables that make the UI appear, so a deployment with only the
// client vars set would render the location forms and then 404 every write —
// which is exactly how first-run setup became impossible to finish.
//
// register_storage_location and retire_storage_location are SECURITY DEFINER
// functions granted to `authenticated` that authorize internally, and reads
// are RLS-protected, so calling them directly is no weaker: the database is
// still the authorization boundary, and there is no service-role key here.
// It simply removes a second configuration surface that could disagree.

import type { SupabaseClient } from '@supabase/supabase-js';

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

/**
 * The governed functions raise plain Postgres messages. Translate the ones an
 * operator can actually cause into plain language; anything else passes
 * through as-is rather than being guessed at.
 */
export function friendlyLocationError(message: string): string {
  if (/parent location .* not found/i.test(message)) {
    return 'That parent location does not exist. Choose an existing location, or leave it blank for a top-level location.';
  }
  if (/retry conflicts with stored hierarchy or label/i.test(message)) {
    return 'That location code is already used with a different parent or name. Choose a different code.';
  }
  if (/location .* not found/i.test(message)) {
    return 'That location does not exist.';
  }
  if (/row-level security|permission denied/i.test(message)) {
    return 'You do not have permission to change locations in this workspace.';
  }
  return message;
}

const LOCATION_COLUMNS =
  'id, public_id, location_code, parent_id, display_name, retired_at, created_at, updated_at';

export function createLocationsTransport(
  client: SupabaseClient<never, never, never>,
  workspaceId: () => string | null
): LocationsTransport {
  const db = client as unknown as {
    from(t: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown; error: { message: string } | null;
    }>;
  };

  const requireWorkspace = (): string => {
    const id = workspaceId();
    if (!id) throw new Error('No workspace selected.');
    return id;
  };

  return {
    async list(includeRetired = false) {
      let q = db
        .from('storage_locations')
        .select(LOCATION_COLUMNS)
        .eq('workspace_id', requireWorkspace());
      if (!includeRetired) q = q.is('retired_at', null);
      const { data, error } = await q.order('location_code', { ascending: true });
      if (error) throw new Error(friendlyLocationError(error.message));
      return (data ?? []) as StorageLocation[];
    },

    async referenceCounts() {
      const { data, error } = await db
        .from('inventory_lots')
        .select('location_id')
        .eq('workspace_id', requireWorkspace())
        .not('location_id', 'is', null);
      if (error) throw new Error(friendlyLocationError(error.message));
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { location_id: string }[]) {
        counts[row.location_id] = (counts[row.location_id] ?? 0) + 1;
      }
      return counts;
    },

    async create(locationCode, displayName, parentCode) {
      const code = locationCode.trim();
      if (!code) throw new Error('A location code is required.');
      const { data, error } = await db.rpc('register_storage_location', {
        p_workspace_id: requireWorkspace(),
        p_location_code: code,
        p_parent_code: parentCode?.trim() || null,
        p_display_name: displayName?.trim() || null,
      });
      if (error) throw new Error(friendlyLocationError(error.message));
      const result = (data ?? {}) as { id?: string; public_id?: string };
      return {
        id: result.id ?? '',
        public_id: result.public_id ?? '',
        location_code: code,
        parent_id: null,
        display_name: displayName?.trim() || null,
        retired_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },

    async retire(locationCode) {
      const { error } = await db.rpc('retire_storage_location', {
        p_workspace_id: requireWorkspace(),
        p_location_code: locationCode,
      });
      if (error) throw new Error(friendlyLocationError(error.message));
    },
  };
}

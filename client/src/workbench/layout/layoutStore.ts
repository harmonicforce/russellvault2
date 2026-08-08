// The LayoutStore port.
//
// One interface, so no Workbench component ever touches `localStorage` — the
// same boundary S1.6.2 drew for the theme preference, for the same reason: a
// storage problem must cost durability, never the application.
//
// IDENTITY
//
// A layout belongs to a user, in a workspace, on a surface, under a schema
// version. All four are part of the key, so:
//
//   - two operators sharing a tablet do not inherit each other's layout;
//   - the same operator's two workspaces keep separate arrangements;
//   - Home and Daily Workbench are separate surfaces, not one shared blob;
//   - a future shape change never has to interpret an older build's payload.
//
// This is deliberately NOT one global `layout-dashboard` key. That key would be
// wrong in all four dimensions at once.

import type { WorkbenchSurface } from '../registry/widgetDefinition';
import type { WorkbenchLayout } from './layoutModel';
import { LAYOUT_SCHEMA_VERSION } from './layoutModel';

export interface LayoutIdentity {
  /**
   * The authenticated user's stable id. `null` only when no user is resolved
   * yet — never a display name and never an email, both of which change while
   * the person does not.
   */
  readonly userId: string | null;
  readonly workspaceId: string | null;
  readonly surface: WorkbenchSurface;
}

export interface LayoutStore {
  /** Raw stored text, or null. Interpretation belongs to `repairLayout`. */
  read(identity: LayoutIdentity): string | null;
  write(identity: LayoutIdentity, layout: WorkbenchLayout): void;
  clear(identity: LayoutIdentity): void;
}

export const LAYOUT_KEY_PREFIX = 'rv.workbench';

/**
 * The storage key.
 *
 * `rv.` matches the existing `rv.activeWorkspaceId` / `rv.theme.v1` convention.
 * An unresolved user or workspace gets an explicit `anonymous`/`no-workspace`
 * segment rather than being omitted — omitting a segment would silently collapse
 * two different identities onto one key, which is exactly the leak the scoping
 * exists to prevent.
 */
export function layoutStorageKey(identity: LayoutIdentity): string {
  const user = identity.userId ?? 'anonymous';
  const workspace = identity.workspaceId ?? 'no-workspace';
  return `${LAYOUT_KEY_PREFIX}.v${LAYOUT_SCHEMA_VERSION}.${user}.${workspace}.${identity.surface}`;
}

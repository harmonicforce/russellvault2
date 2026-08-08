// The browser LayoutStore adapter — DEVICE-LOCAL INTERIM PERSISTENCE.
//
// This is the only file in the Workbench that knows `localStorage` exists.
//
// WHAT THIS IS NOT
//
// It is not cross-device sync. A layout saved here stays on this browser, on
// this device, and the UI says so in words rather than letting the operator
// assume their arrangement follows them to the iPad. Governed cross-device
// preference persistence needs a server-side model and is deliberately not part
// of this slice.
//
// Every failure mode — absent storage, quota exceeded, a Safari private-mode
// throw, a hostile value — costs the operator their saved arrangement and
// nothing more. The Workbench keeps rendering.

import type { WorkbenchLayout } from './layoutModel';
import { layoutStorageKey, type LayoutIdentity, type LayoutStore } from './layoutStore';

/** Resolve the browser's storage without throwing where it is unavailable. */
export function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Accessing `localStorage` itself throws under some privacy settings.
    return null;
  }
}

export function createBrowserLayoutStore(storage: Storage | null = defaultStorage()): LayoutStore {
  return {
    read(identity: LayoutIdentity): string | null {
      if (!storage) return null;
      try {
        return storage.getItem(layoutStorageKey(identity));
      } catch {
        return null;
      }
    },

    write(identity: LayoutIdentity, layout: WorkbenchLayout): void {
      if (!storage) return;
      try {
        // Serialised explicitly, field by field, rather than by handing the
        // whole object to JSON.stringify and hoping. Nothing a caller attaches
        // to a layout object can reach storage through this function, so a
        // cached count or an API response can never end up persisted.
        storage.setItem(
          layoutStorageKey(identity),
          JSON.stringify({
            schemaVersion: layout.schemaVersion,
            surface: layout.surface,
            instances: layout.instances.map((instance) => ({
              definitionId: instance.definitionId,
              instanceId: instance.instanceId,
              size: instance.size,
              ...(instance.settings ? { settings: instance.settings } : {}),
            })),
          }),
        );
      } catch {
        // Quota, private mode, a disabled store. The arrangement is lost; the
        // Workbench is not.
      }
    },

    clear(identity: LayoutIdentity): void {
      if (!storage) return;
      try {
        storage.removeItem(layoutStorageKey(identity));
      } catch {
        /* nothing to do — the value simply stays */
      }
    },
  };
}

/** Shown to the operator wherever a layout is saved. It must not overclaim. */
export const DEVICE_LOCAL_NOTICE = 'Saved on this device only. Your layout does not follow you to other devices.';

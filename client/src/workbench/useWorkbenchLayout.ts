// The layout hook.
//
// Owns the canonical order and writes it through the LayoutStore port. Every
// mutation — drag, button, resize, add, remove, reset — goes through here, so
// there is exactly one order model and the two reorder paths cannot disagree.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkbenchSurface, WidgetSize } from './registry/widgetDefinition';
import {
  addInstance,
  defaultLayout,
  moveInstance,
  removeInstance,
  reorderInstances,
  repairLayout,
  resizeInstance,
  type WorkbenchLayout,
} from './layout/layoutModel';
import type { LayoutIdentity, LayoutStore } from './layout/layoutStore';

export interface WorkbenchLayoutController {
  readonly layout: WorkbenchLayout;
  /** What had to be corrected when the stored layout was last read. */
  readonly repairs: readonly string[];
  move(instanceId: string, direction: -1 | 1): void;
  reorder(from: number, to: number): void;
  resize(instanceId: string, size: WidgetSize): void;
  add(definitionId: string): void;
  removeInstanceById(instanceId: string): void;
  removeDefinition(definitionId: string): void;
  reset(): void;
}

function load(store: LayoutStore, identity: LayoutIdentity): { layout: WorkbenchLayout; repairs: readonly string[] } {
  const raw = store.read(identity);
  // Nothing stored is not a repair — it is a first visit.
  if (raw === null) return { layout: defaultLayout(identity.surface), repairs: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON resets to defaults rather than blanking the surface. The
    // operator loses an arrangement, never the Workbench.
    return { layout: defaultLayout(identity.surface), repairs: ['The saved layout could not be read.'] };
  }
  return repairLayout(parsed, identity.surface);
}

export function useWorkbenchLayout(
  store: LayoutStore,
  surface: WorkbenchSurface,
  userId: string | null,
  workspaceId: string | null,
): WorkbenchLayoutController {
  const identity = useMemo<LayoutIdentity>(
    () => ({ userId, workspaceId, surface }),
    [userId, workspaceId, surface],
  );

  const [state, setState] = useState(() => load(store, identity));

  // Re-read whenever the identity changes: switching workspace must load THAT
  // workspace's arrangement, not carry the previous one across.
  useEffect(() => {
    setState(load(store, identity));
  }, [store, identity]);

  const move = useCallback(
    (instanceId: string, direction: -1 | 1) => setState((previous) => {
      const next = moveInstance(previous.layout, instanceId, direction);
      if (next !== previous.layout) store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const reorder = useCallback(
    (from: number, to: number) => setState((previous) => {
      // The same model the buttons drive. A drag is just another way to say
      // "this widget belongs at that position".
      const next = reorderInstances(previous.layout, from, to);
      if (next !== previous.layout) store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const resize = useCallback(
    (instanceId: string, size: WidgetSize) => setState((previous) => {
      const next = resizeInstance(previous.layout, instanceId, size);
      if (next !== previous.layout) store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const add = useCallback(
    (definitionId: string) => setState((previous) => {
      const next = addInstance(previous.layout, definitionId);
      if (next !== previous.layout) store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const removeInstanceById = useCallback(
    (instanceId: string) => setState((previous) => {
      const next = removeInstance(previous.layout, instanceId);
      if (next !== previous.layout) store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const removeDefinition = useCallback(
    (definitionId: string) => setState((previous) => {
      const next: WorkbenchLayout = {
        ...previous.layout,
        instances: previous.layout.instances.filter((instance) => instance.definitionId !== definitionId),
      };
      store.write(identity, next);
      return { layout: next, repairs: previous.repairs };
    }),
    [store, identity],
  );

  const reset = useCallback(() => {
    const next = defaultLayout(surface);
    store.write(identity, next);
    // A reset also clears any repair notices: they described a layout that no
    // longer exists.
    setState({ layout: next, repairs: [] });
  }, [store, identity, surface]);

  return useMemo(
    () => ({
      layout: state.layout,
      repairs: state.repairs,
      move,
      reorder,
      resize,
      add,
      removeInstanceById,
      removeDefinition,
      reset,
    }),
    [state, move, reorder, resize, add, removeInstanceById, removeDefinition, reset],
  );
}

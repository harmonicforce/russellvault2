// Wiring the Workbench to the application's existing transports and session.
//
// This is the seam between the generic Workbench architecture and the concrete
// Russell Vault deployment: it resolves which requirements are satisfied, builds
// the transports the data layer reads, and supplies the LayoutStore identity.
//
// It creates no query of its own. Every transport below already existed and is
// already used by the pages this slice migrates.

import { useMemo } from 'react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData } from '../lib/inventoryData';
import { createListingPrepTransport } from '../lib/listingPrepApi';
import { createIntakeTransport } from '../lib/intakeApi';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import type { WidgetAvailabilityContext, WidgetRequirement, WorkbenchSurface } from './registry/widgetDefinition';
import type { WorkbenchDataSources } from './data/workbenchFacts';

export interface WorkbenchWiring {
  readonly context: WidgetAvailabilityContext;
  readonly sources: WorkbenchDataSources;
  /** The stable authenticated user id — the LayoutStore's user scope. */
  readonly userId: string | null;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
}

export function useWorkbenchWiring(surface: WorkbenchSurface): WorkbenchWiring {
  const { workspace, client, userId } = useWorkspace();
  const workspaceId = workspace?.id ?? null;

  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    [],
  );

  const inventory = useMemo(
    () => (workspaceId ? createInventoryData(client as never, workspaceId) : null),
    [client, workspaceId],
  );

  const listingPrep = useMemo(
    () => createListingPrepTransport(tokenProviderFromClient(client), () => workspaceId),
    [client, workspaceId],
  );

  const intake = useMemo(() => {
    // The intake surface has its own configuration flag. Absent means the
    // transport does not exist — which the data layer reports as
    // `notConfigured`, never as zero open sessions.
    if (!config) return null;
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(shadow));
  }, [config]);

  const context = useMemo<WidgetAvailabilityContext>(() => {
    const satisfied: WidgetRequirement[] = [];
    if (config) satisfied.push('governed-backend');
    if (workspaceId) satisfied.push('active-workspace');
    if (intake) satisfied.push('intake-transport');
    return { surface, satisfiedRequirements: satisfied, role: workspace?.role ?? null };
  }, [config, workspaceId, intake, workspace?.role, surface]);

  const sources = useMemo<WorkbenchDataSources>(
    () => ({ inventory, listingPrep, intake, workspaceId }),
    [inventory, listingPrep, intake, workspaceId],
  );

  return { context, sources, userId, workspaceId, workspaceName: workspace?.name ?? null };
}

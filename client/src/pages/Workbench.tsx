// Daily Workbench — "what inventory work needs attention now?"
//
// Every queue is derived from real stored facts (current location, media
// records, open intake sessions), never from a guess about what the operator
// probably meant to do.
//
// S1.6.4 MIGRATION
//
// The page kept its data sources and lost its layout. `workQueueCounts`,
// `workQueue`, `operationsQueueCounts`, `operationsQueueRows`,
// `openCorrectionCount`, the listing-prep summary and the intake session list
// are the same calls against the same transports; what changed is that the
// page no longer owns cards, ordering or presentation. It owns data, and the
// Workbench architecture owns arrangement.
//
// THE TRUTH DEFECT THIS FIXES
//
// The page used to initialise every count to `0` and load them together under
// one shared `catch`. Between mount and response — and after any failure — it
// displayed a confident zero for facts it had not established, and one failing
// query blanked seven working ones. Each source now carries its own TruthState
// (see `workbench/data/workbenchFacts`), so a failure reads as a failure, an
// unconfigured transport reads as unconfigured, a proven zero reads as a proven
// zero, and none of them can take the others down.

import { ListChecks } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { WorkbenchSurfaceRegion } from '../workbench/WorkbenchSurface';
import { useWorkbenchLayout } from '../workbench/useWorkbenchLayout';
import { useWorkbenchWiring } from '../workbench/useWorkbenchContext';
import { useWorkbenchFacts } from '../workbench/data/workbenchFacts';
import { createBrowserLayoutStore } from '../workbench/layout/browserLayoutStore';
import { findDefinition } from '../workbench/registry/widgetRegistry';
import { renderWidgetAccessory, renderWidgetBody } from '../workbench/widgets/widgetRenderers';
import type { WidgetSize } from '../workbench/registry/widgetDefinition';

// One store instance for the module: it holds no state of its own, and a new
// object on every render would re-read the layout on every render.
const layoutStore = createBrowserLayoutStore();

export default function Workbench() {
  const { workspace } = useWorkspace();
  const { context, sources, userId, workspaceId } = useWorkbenchWiring('daily-workbench');
  const { facts } = useWorkbenchFacts(sources);
  const controller = useWorkbenchLayout(layoutStore, 'daily-workbench', userId, workspaceId);

  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to see today's work.</div>;
  }

  return (
    <div className="max-w-6xl space-y-5 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" /> Daily Workbench
        </h1>
        <p className="mt-1 text-xs text-ink-muted">What needs attention in {workspace.name} right now.</p>
      </header>

      <WorkbenchSurfaceRegion
        surface="daily-workbench"
        controller={controller}
        context={context}
        label="Today's work"
        description="Arrange what you want to see first. Each panel reads its own governed source."
        renderBody={(definitionId: string, size: WidgetSize) => {
          const definition = findDefinition(definitionId);
          return definition ? renderWidgetBody(definition, size, facts) : null;
        }}
        renderAccessory={(definitionId: string) => {
          const definition = findDefinition(definitionId);
          return definition ? renderWidgetAccessory(definition, facts) : null;
        }}
      />
    </div>
  );
}

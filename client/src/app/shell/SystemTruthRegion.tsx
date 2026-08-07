// Shell-level system truth.
//
// WHAT THIS IS
//
// A permanent region of the shell, above route content, where the application
// states things that are true about the SYSTEM rather than about the record on
// screen. It is not a page element and no route owns it.
//
// WHY IT WRAPS RATHER THAN REPLACES
//
// The precedence logic lives in SystemStatusBanner, which has twenty
// behavioural tests pinning semantics that were themselves a fix for a real
// defect: the old banner rendered `null` whenever the health request failed,
// so the app went quiet at exactly the moment the legacy database was
// unreadable. Rewriting that logic to give it a new name would put those
// semantics at risk for no gain. So this region OWNS PLACEMENT AND
// PERMANENCE, and delegates the health verdict unchanged.
//
// No new health semantics are introduced here. No state is invented to fill
// out a precedence list, and no "all clear" is asserted — the ready state
// renders nothing, because "we have nothing to report" and "we have verified
// everything is fine" are different claims and only the first is true.
//
// THE PRECEDENCE BOUNDARY
//
// The two highest-ranking conditions are handled BEFORE this region exists,
// and that architecture is preserved rather than duplicated:
//
//   1. application misconfiguration — AuthShell renders the configuration
//      error panel and fails closed; the shell never mounts;
//   2. authorization/session failure — AuthShell renders the auth screen; the
//      shell never mounts.
//
// Duplicating either here would mean writing shell messaging for a state in
// which the shell does not render, which could only ever contradict the screen
// the operator is actually looking at.
//
// Ranks 3 onward are this region's, via the delegated banner:
//   3. governed critical dependency failure  → structured legacy-health failure
//   4. structured legacy-health failure      → `status: unhealthy`, critical
//   5. unverifiable dependency state         → health request failed, warning
//   6. partial/stale coverage warning        → not established today; absent
//   7. legacy-only mode                      → warning notice
//   8. legacy read-only notice               → critical on legacy write paths
//   9. ready                                 → renders nothing

import SystemStatusBanner from '../../components/SystemStatusBanner';
import type { AppConfigMode } from '../../lib/appConfig';

export interface SystemTruthRegionProps {
  readonly provenanceEnabled: boolean;
  readonly appMode: AppConfigMode;
}

/**
 * Rendered once by AppShell, outside <main>.
 *
 * Because it sits outside the routed subtree it is not remounted by
 * navigation: a critical dependency warning cannot be escaped by clicking a
 * different destination. It is also structurally outside anything an operator
 * can arrange, so no future Workbench customization or widget API can remove
 * it — a layout preference may rearrange perspective, never suppress truth.
 */
export function SystemTruthRegion({ provenanceEnabled, appMode }: SystemTruthRegionProps) {
  return (
    <div data-system-truth-region="" className="shrink-0">
      <SystemStatusBanner provenanceEnabled={provenanceEnabled} appMode={appMode} />
    </div>
  );
}

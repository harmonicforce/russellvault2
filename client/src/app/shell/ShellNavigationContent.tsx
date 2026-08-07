// The full contents of the navigation surface: brand, workspace, destinations,
// and the operator's own controls.
//
// Rendered by both the desktop sidebar and the mobile/tablet drawer so the two
// carry the same affordances. Only the container differs.

import type { ThemePreference } from '../../lib/theme';
import type { NavigationModel } from '../navigation/navigationModel';
import { NavigationPanel } from '../navigation/NavigationPanel';
import { BrandMark } from './BrandMark';
import { ThemeControl } from './ThemeControl';
import { WorkspaceArea } from './WorkspaceArea';

export interface ShellNavigationContentProps {
  readonly model: NavigationModel;
  /** Workspace context only exists in governed mode. */
  readonly showWorkspace: boolean;
  readonly preference: ThemePreference;
  readonly onThemeChange: (next: ThemePreference) => void;
  readonly themeIdPrefix: string;
  readonly onNavigate?: () => void;
}

export function ShellNavigationContent({
  model,
  showWorkspace,
  preference,
  onThemeChange,
  themeIdPrefix,
  onNavigate,
}: ShellNavigationContentProps) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-4">
        <BrandMark />
      </div>
      {showWorkspace && <WorkspaceArea />}
      <div className="flex-1 overflow-y-auto">
        <NavigationPanel model={model} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-hairline">
        <ThemeControl preference={preference} onChange={onThemeChange} idPrefix={themeIdPrefix} />
      </div>
    </>
  );
}

// The navigation body, rendered identically in the desktop sidebar and in the
// mobile/tablet drawer. One component reading one model, so the two surfaces
// cannot drift.

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { NavDestination, NavGroup, NavigationModel } from './navigationModel';

/**
 * Active state is carried by background, weight, and a gold rail — never by
 * colour alone, and never by gold as a status signal. The rail is structural
 * brand: it marks position in a hierarchy, which is what gold is for here.
 */
function destinationClass({ isActive }: { isActive: boolean }): string {
  return `relative flex min-h-11 items-center gap-2.5 rounded-control py-2 pl-3 pr-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-accent/12 font-semibold text-accent-strong before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:content-[""]'
      : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
  }`;
}

function Destination({ item, onNavigate }: { item: NavDestination; onNavigate?: () => void }) {
  return (
    <NavLink to={item.to} end={item.end} className={destinationClass} onClick={onNavigate}>
      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{item.label}</span>
      {/*
        The legacy marking is words, not a colour. An operator who cannot
        distinguish the palette still reads "Non-authoritative", and a screen
        reader announces it as part of the link's accessible name.
      */}
      {item.authority === 'legacy' && (
        <span className="ml-auto shrink-0 rounded-pill border border-hairline px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Non-authoritative
        </span>
      )}
    </NavLink>
  );
}

function PrimaryGroup({ group, onNavigate }: { group: NavGroup; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-3 pb-0.5 pt-3 font-display text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {group.label}
      </div>
      {group.destinations.map((item) => (
        <Destination key={item.to} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/**
 * Tools, diagnostics, and the legacy application, behind one disclosure and
 * below a rule.
 *
 * Collapsed by default and visually separated on purpose: these are not daily
 * governed workflow, and presenting them at the same level as governed
 * operations is how a non-authoritative number ends up being read as a real
 * one.
 */
function SecondaryArea({
  groups,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;

  return (
    <div className="mt-3 border-t border-hairline pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between rounded-control px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        Tools &amp; legacy
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pb-1">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.label}
              </div>
              {group.destinations.map((item) => (
                <Destination key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface NavigationPanelProps {
  readonly model: NavigationModel;
  /**
   * Called when a DESTINATION is activated — the drawer closes on navigation.
   *
   * It is deliberately not wired to the <nav> element: the "Tools & legacy"
   * toggle, the workspace switcher, and the theme radios all live inside this
   * panel, and a handler on the container would close the drawer the instant
   * the operator touched any of them. That regression is what this prop's
   * placement prevents.
   */
  readonly onNavigate?: () => void;
}

export function NavigationPanel({ model, onNavigate }: NavigationPanelProps) {
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-2 py-2">
      {model.primary.map((group) => (
        <PrimaryGroup key={group.id} group={group} onNavigate={onNavigate} />
      ))}
      <SecondaryArea groups={model.secondary} onNavigate={onNavigate} />
    </nav>
  );
}

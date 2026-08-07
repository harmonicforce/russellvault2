// The one source of truth for navigation metadata.
//
// Before this module the shell kept four independent arrays — primary, legacy,
// tools, and a separate legacy-only list — and the desktop sidebar and the
// tablet drawer each walked them by hand. Two lists that must agree but are
// maintained separately are a drift bug waiting to happen: a destination added
// to one and forgotten in the other is invisible on exactly one viewport.
//
// So there is now ONE model, and both surfaces render from it.
//
// WHAT THIS MODEL IS NOT
//
// It is not the router. `AppRoutes` mounts routes; this decides what is
// ADVERTISED. The two overlap but are not the same set, and the difference is
// deliberate:
//
//   - detail routes (`/inventory/current/:itemId`, `/acquisitions/:a/:b`) are
//     reachable and mounted, but are reached from a record, not a menu;
//   - `/batch-intake` and `/inventory/move` are action routes entered from a
//     workflow, and were not advertised before this slice either.
//
// A destination appears here only if the route actually exists today. Nothing
// planned, and nothing named only by a design document, is listed — advertising
// a destination that cannot be reached is a lie told by a menu.

import {
  Boxes, ClipboardCheck, ClipboardList, DollarSign, FileSearch, FileWarning, Layers,
  LayoutDashboard, Link2, ListChecks, MapPin, Package, PackagePlus, ScanLine,
  ShieldCheck, ShoppingBag, Tag, Tags,
  type LucideIcon,
} from 'lucide-react';
import type { AppConfigMode } from '../../lib/appConfig';

/**
 * How much a destination's data can be trusted.
 *
 * This is a truth claim, not decoration. `legacy` means the SQLite system,
 * which is non-authoritative — the shell marks it so the operator can never
 * mistake a legacy number for a governed one.
 */
export type NavAuthority = 'governed' | 'legacy' | 'tool';

export interface NavDestination {
  /** Router path. Must match a route AppRoutes actually mounts. */
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly authority: NavAuthority;
  /** Exact-match only. `/` and legacy `/inventory` both need it. */
  readonly end?: boolean;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly destinations: readonly NavDestination[];
}

export interface NavigationModel {
  /**
   * Governed operational domains, always visible. These are the daily
   * workflows.
   */
  readonly primary: readonly NavGroup[];
  /**
   * Tools, diagnostics, and the non-authoritative legacy application. Kept
   * behind its own disclosure so it cannot be mistaken for daily governed
   * operation.
   */
  readonly secondary: readonly NavGroup[];
}

// ---------------------------------------------------------------------------
// Governed domains
// ---------------------------------------------------------------------------

const HOME: NavGroup = {
  id: 'home',
  label: 'Home',
  destinations: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, authority: 'governed', end: true },
    { to: '/workbench', label: 'Daily Workbench', icon: ListChecks, authority: 'governed' },
  ],
};

// Intake Sessions lives here and ONLY here. Intake touches acquisition and
// inventory both, but a destination listed under two domains teaches the
// operator that the grouping means nothing.
const INVENTORY: NavGroup = {
  id: 'inventory',
  label: 'Inventory',
  destinations: [
    { to: '/inventory/current', label: 'Current Inventory', icon: Boxes, authority: 'governed' },
    { to: '/scan', label: 'Scan or Find', icon: ScanLine, authority: 'governed' },
    { to: '/intake-sessions', label: 'Intake Sessions', icon: ClipboardList, authority: 'governed' },
    { to: '/locations', label: 'Locations', icon: MapPin, authority: 'governed' },
    { to: '/cycle-counts', label: 'Cycle Counts', icon: ClipboardCheck, authority: 'governed' },
    { to: '/corrections', label: 'Corrections', icon: FileWarning, authority: 'governed' },
    { to: '/photo-issues', label: 'Photo Issues', icon: FileWarning, authority: 'governed' },
  ],
};

const ACQUIRE: NavGroup = {
  id: 'acquire',
  label: 'Acquire',
  destinations: [
    { to: '/acquisitions', label: 'Acquisitions', icon: ShoppingBag, authority: 'governed' },
    { to: '/quick-add', label: 'Add Inventory', icon: PackagePlus, authority: 'governed' },
  ],
};

const SELL: NavGroup = {
  id: 'sell',
  label: 'Sell',
  destinations: [
    { to: '/listing-prep', label: 'Listing Prep', icon: Tags, authority: 'governed' },
  ],
};

// There is deliberately no INTELLIGENCE group and no SETTINGS group.
//
// The approved domain architecture names both, but a group is rendered only
// when a real destination belongs in it, and today none does: no valuation,
// pricing, analytics, or AI route exists, and there is no `/settings` route.
// Creating either as an empty shell — or worse, with placeholder links — would
// advertise capability the application does not have. Theme control therefore
// lives in the shell's user area rather than behind a manufactured settings
// page.

const GOVERNED_DOMAINS: readonly NavGroup[] = [HOME, INVENTORY, ACQUIRE, SELL];

// ---------------------------------------------------------------------------
// Tools and the legacy application
// ---------------------------------------------------------------------------

// Legacy `/inventory` belongs HERE, not in the Inventory domain.
//
// It sat in the primary governed list before this slice, directly above the
// governed inventory destinations, labelled only "Legacy Inventory". That put a
// non-authoritative SQLite surface inside the governed operational flow. The
// route is unchanged and still reachable; only its placement and its marking
// are corrected.
const LEGACY: NavGroup = {
  id: 'legacy',
  label: 'Legacy application',
  destinations: [
    { to: '/inventory', label: 'Legacy Inventory', icon: Package, authority: 'legacy', end: true },
    { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag, authority: 'legacy' },
    { to: '/cost-links', label: 'Cost Basis Links', icon: Link2, authority: 'legacy' },
    { to: '/listings', label: 'eBay Listings', icon: Tag, authority: 'legacy' },
    { to: '/sales', label: 'Sales', icon: DollarSign, authority: 'legacy' },
  ],
};

const TOOLS: NavGroup = {
  id: 'tools',
  label: 'Tools and diagnostics',
  destinations: [
    { to: '/import-review', label: 'Import Review', icon: FileSearch, authority: 'tool' },
    { to: '/acquisition-review', label: 'Acquisition Review', icon: Layers, authority: 'tool' },
    { to: '/inventory-identity', label: 'Identity Diagnostics', icon: Boxes, authority: 'tool' },
    { to: '/checks', label: 'Health Checks', icon: ShieldCheck, authority: 'tool' },
  ],
};

// ---------------------------------------------------------------------------
// Legacy-only deployment
// ---------------------------------------------------------------------------

// When no governed configuration exists, the governed routes are not mounted,
// so none of them may be advertised. This is the original legacy navigation,
// with the same destinations in the same order.
//
// Per-destination legacy badges are deliberately NOT applied here. In this mode
// the entire deployment is legacy and SystemTruthRegion says so permanently and
// unmissably; repeating it on every row would be noise that dilutes the marking
// where it actually discriminates — the governed-mode sidebar, where legacy and
// governed sit on the same screen.
const LEGACY_ONLY: NavGroup = {
  id: 'legacy-only',
  label: 'Operations',
  destinations: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, authority: 'legacy', end: true },
    { to: '/inventory', label: 'Inventory', icon: Package, authority: 'legacy', end: true },
    { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag, authority: 'legacy' },
    { to: '/cost-links', label: 'Cost Basis Links', icon: Link2, authority: 'legacy' },
    { to: '/listings', label: 'eBay Listings', icon: Tag, authority: 'legacy' },
    { to: '/sales', label: 'Sales', icon: DollarSign, authority: 'legacy' },
    { to: '/checks', label: 'Health Checks', icon: ShieldCheck, authority: 'tool' },
  ],
};

/**
 * Build the navigation for a deployment mode.
 *
 * `misconfigured` never reaches here — AuthShell fails closed before the shell
 * mounts — but it is handled rather than assumed away, and it advertises
 * nothing, because a deployment whose configuration is not trustworthy has no
 * destination it can honestly offer.
 */
export function buildNavigation(mode: AppConfigMode): NavigationModel {
  if (mode === 'governed') {
    return { primary: GOVERNED_DOMAINS, secondary: [LEGACY, TOOLS] };
  }
  if (mode === 'legacy-only') {
    return { primary: [LEGACY_ONLY], secondary: [] };
  }
  return { primary: [], secondary: [] };
}

/** Every advertised destination, in render order. Used by tests and audits. */
export function allDestinations(model: NavigationModel): readonly NavDestination[] {
  return [...model.primary, ...model.secondary].flatMap((group) => group.destinations);
}

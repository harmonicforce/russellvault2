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
  LayoutDashboard, Link2, ListChecks, MapPin, Package, PackageCheck, PackagePlus, ScanLine,
  ShieldCheck, ShoppingBag, Tag, Tags,
  type LucideIcon,
} from 'lucide-react';
import type { AppConfigMode } from '../../lib/appConfig';
import { DOMAIN_TOPOLOGY, isAuthoritative, type DataBackend } from '../../lib/dataTopology';

// WHY THIS MODEL DOES NOT HAVE AN "AUTHORITY" FIELD ANY MORE
//
// It used to. `NavAuthority = 'governed' | 'legacy' | 'tool'` was described as
// "how much a destination's data can be trusted" — but `tool` is not an answer
// to that question at all. It is a statement about where a destination sits in
// the menu. Folding a navigational role into a truth claim produced two false
// classifications that shipped:
//
//   - `/checks` was `tool`, so it rendered with no marker. It reads
//     `/api/checks`, which is `getDb()` — SQLite. A NON-AUTHORITATIVE legacy
//     surface was being presented as an ordinary diagnostic.
//   - `/` was `governed`. Dashboard renders the governed operations sections
//     AND the legacy `/dashboard` panel it labels "Legacy spreadsheet-imported
//     inventory". No single authority value is true of that page.
//
// A test then made the defect durable by requiring every primary destination
// to be `governed` — green, and proving something false.
//
// The two questions are now separate. GROUPING says what a destination is for;
// this says what it reads.

/**
 * What a ROUTE SURFACE renders, in terms of source composition.
 *
 * `mixed` describes a rendered page that draws on both systems. It is NOT a
 * third backend — there are exactly two, `dataTopology` names them, and
 * inventing a third here would repeat the mistake `dataAdapter.ts` made when it
 * claimed one global backend for the whole application.
 */
export type NavDataComposition = 'governed-only' | 'legacy-only' | 'mixed';

export interface NavDestination {
  /** Router path. Must match a route AppRoutes actually mounts. */
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /**
   * Which backends this route surface actually reads, verified from the page's
   * own transports rather than inferred from its path or its menu group.
   *
   * This records BACKENDS, not authority. Whether a backend is authoritative is
   * `dataTopology`'s answer, and it is asked rather than copied — see the
   * boundary note on `backendIsNonAuthoritative`.
   */
  readonly reads: readonly DataBackend[];
  /** Exact-match only. `/` and legacy `/inventory` both need it. */
  readonly end?: boolean;
}

const READS_GOVERNED: readonly DataBackend[] = ['governed-supabase'];
const READS_LEGACY: readonly DataBackend[] = ['legacy-sqlite-rest'];
const READS_BOTH: readonly DataBackend[] = ['governed-supabase', 'legacy-sqlite-rest'];

/**
 * Is every domain stored on this backend non-authoritative?
 *
 * THE BOUNDARY WITH `dataTopology`. That module owns backend and domain
 * authority; this module owns what a route surface renders. They answer
 * different questions and neither proves the other. Navigation therefore keeps
 * no authority table of its own — it asks. If `dataTopology` ever reclassified
 * a backend, the shell's markers would follow rather than silently disagree.
 */
function backendIsNonAuthoritative(backend: DataBackend): boolean {
  const domains = DOMAIN_TOPOLOGY.filter((entry) => entry.backend === backend);
  return domains.length > 0 && domains.every((entry) => !isAuthoritative(entry.domain));
}

/**
 * Derived, never hand-written, so a destination's marker cannot drift from the
 * backends it was recorded as reading.
 */
export function compositionOf(destination: NavDestination): NavDataComposition {
  const nonAuthoritative = destination.reads.filter(backendIsNonAuthoritative);
  if (nonAuthoritative.length === 0) return 'governed-only';
  if (nonAuthoritative.length === destination.reads.length) return 'legacy-only';
  return 'mixed';
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
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, reads: READS_BOTH, end: true },
    { to: '/workbench', label: 'Daily Workbench', icon: ListChecks, reads: READS_GOVERNED },
  ],
};

// Intake Sessions lives here and ONLY here. Intake touches acquisition and
// inventory both, but a destination listed under two domains teaches the
// operator that the grouping means nothing.
const INVENTORY: NavGroup = {
  id: 'inventory',
  label: 'Inventory',
  destinations: [
    { to: '/inventory/current', label: 'Current Inventory', icon: Boxes, reads: READS_GOVERNED },
    { to: '/scan', label: 'Scan or Find', icon: ScanLine, reads: READS_GOVERNED },
    { to: '/intake-sessions', label: 'Intake Sessions', icon: ClipboardList, reads: READS_GOVERNED },
    { to: '/locations', label: 'Locations', icon: MapPin, reads: READS_GOVERNED },
    { to: '/cycle-counts', label: 'Cycle Counts', icon: ClipboardCheck, reads: READS_GOVERNED },
    { to: '/corrections', label: 'Corrections', icon: FileWarning, reads: READS_GOVERNED },
    { to: '/photo-issues', label: 'Photo Issues', icon: FileWarning, reads: READS_GOVERNED },
  ],
};

// Receiving is advertised here, beside Acquisitions, because it operates on
// governed acquisition orders. The receipt workspace at
// `/receiving/:receiptPublicId` is deliberately NOT advertised: it is reached
// from a queue row, exactly as Acquisition Detail is reached from a line.
const ACQUIRE: NavGroup = {
  id: 'acquire',
  label: 'Acquire',
  destinations: [
    { to: '/acquisitions', label: 'Acquisitions', icon: ShoppingBag, reads: READS_GOVERNED },
    { to: '/receiving', label: 'Receiving', icon: PackageCheck, reads: READS_GOVERNED },
    { to: '/quick-add', label: 'Add Inventory', icon: PackagePlus, reads: READS_GOVERNED },
  ],
};

const SELL: NavGroup = {
  id: 'sell',
  label: 'Sell',
  destinations: [
    { to: '/listing-prep', label: 'Listing Prep', icon: Tags, reads: READS_GOVERNED },
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
    { to: '/inventory', label: 'Legacy Inventory', icon: Package, reads: READS_LEGACY, end: true },
    { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag, reads: READS_LEGACY },
    { to: '/cost-links', label: 'Cost Basis Links', icon: Link2, reads: READS_LEGACY },
    { to: '/listings', label: 'eBay Listings', icon: Tag, reads: READS_LEGACY },
    { to: '/sales', label: 'Sales', icon: DollarSign, reads: READS_LEGACY },
  ],
};

// A group is a NAVIGATIONAL role, not a source claim, and this group proves it:
// three of these diagnostics read the governed backend and Health Checks reads
// SQLite. Grouping cannot determine authority — encoding "tool" AS an authority
// is exactly what let /checks go unmarked.
const TOOLS: NavGroup = {
  id: 'tools',
  label: 'Tools and diagnostics',
  destinations: [
    { to: '/import-review', label: 'Import Review', icon: FileSearch, reads: READS_GOVERNED },
    { to: '/acquisition-review', label: 'Acquisition Review', icon: Layers, reads: READS_GOVERNED },
    { to: '/inventory-identity', label: 'Identity Diagnostics', icon: Boxes, reads: READS_GOVERNED },
    { to: '/checks', label: 'Health Checks', icon: ShieldCheck, reads: READS_LEGACY },
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
// Dashboard reads LEGACY ONLY here, not both.
//
// In governed mode it renders the governed operations sections alongside the
// legacy panel. In this mode `getProvenanceUiConfig()` returns null, so
// `WorkspaceSummarySection` never mounts and the legacy aggregate is the whole
// page. Recording it as mixed would claim a governed section this deployment
// cannot render.
const LEGACY_ONLY: NavGroup = {
  id: 'legacy-only',
  label: 'Operations',
  destinations: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, reads: READS_LEGACY, end: true },
    { to: '/inventory', label: 'Inventory', icon: Package, reads: READS_LEGACY, end: true },
    { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag, reads: READS_LEGACY },
    { to: '/cost-links', label: 'Cost Basis Links', icon: Link2, reads: READS_LEGACY },
    { to: '/listings', label: 'eBay Listings', icon: Tag, reads: READS_LEGACY },
    { to: '/sales', label: 'Sales', icon: DollarSign, reads: READS_LEGACY },
    { to: '/checks', label: 'Health Checks', icon: ShieldCheck, reads: READS_LEGACY },
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

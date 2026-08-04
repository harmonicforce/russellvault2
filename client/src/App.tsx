import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingBag, Link2, Tag, DollarSign, ShieldCheck, Vault,
  FileSearch, Layers, Boxes, PackagePlus, MapPin, ClipboardList, ChevronDown, LogOut,
  ListChecks, ScanLine, FileWarning, ClipboardCheck, Tags, Menu,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Purchases from './pages/Purchases';
import CostLinks from './pages/CostLinks';
import Listings from './pages/Listings';
import Sales from './pages/Sales';
import Checks from './pages/Checks';
import SystemStatusBanner from './components/SystemStatusBanner';
import AuthShell from './components/AuthShell';
import ImportReview from './pages/ImportReview';
import AcquisitionReview from './pages/AcquisitionReview';
import InventoryIdentity from './pages/InventoryIdentity';
import IntakeHub from './pages/IntakeHub';
import BatchIntake from './pages/BatchIntake';
import LotDetail from './pages/LotDetail';
import ScanFind from './pages/ScanFind';
import Workbench from './pages/Workbench';
import CurrentInventory from './pages/CurrentInventory';
import BulkMove from './pages/BulkMove';
import Corrections from './pages/Corrections';
import ItemDetail from './pages/ItemDetail';
import IntakeSessions from './pages/IntakeSessions';
import Locations from './pages/Locations';
import CycleCounts from './pages/CycleCounts';
import MediaIssues from './pages/MediaIssues';
import ListingPrep from './pages/ListingPrep';
import ListingPrepDetail from './pages/ListingPrepDetail';
import FirstRunSetup from './components/FirstRunSetup';
import { resolveAppConfig, type EnvLike } from './lib/appConfig';
import { useWorkspace } from './lib/workspaceContext';

// One source of configuration truth for the whole shell.
//
// `governed` mounts the governed routes and navigation. `legacy-only` mounts
// the legacy application, which SystemStatusBanner labels as non-authoritative
// so it is never mistaken for governed operation. `misconfigured` never gets
// this far: AuthShell fails closed before any route renders, rather than
// quietly serving the unauthenticated legacy app because one variable was
// dropped.
const APP_CONFIG = resolveAppConfig(import.meta.env as unknown as EnvLike);
const PROVENANCE_ENABLED = APP_CONFIG.mode === 'governed';

const PRIMARY_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/workbench', label: 'Daily Workbench', icon: ListChecks, end: false },
  { to: '/quick-add', label: 'Add Inventory', icon: PackagePlus, end: false },
  { to: '/scan', label: 'Scan or Find', icon: ScanLine, end: false },
  { to: '/inventory/current', label: 'Current Inventory', icon: Boxes, end: false },
  { to: '/inventory', label: 'Legacy Inventory', icon: Package, end: true },
  { to: '/intake-sessions', label: 'Intake Sessions', icon: ClipboardList, end: false },
  { to: '/locations', label: 'Locations', icon: MapPin, end: false },
  { to: '/cycle-counts', label: 'Cycle Counts', icon: ClipboardCheck, end: false },
  { to: '/listing-prep', label: 'Listing Prep', icon: Tags, end: false },
  { to: '/photo-issues', label: 'Photo Issues', icon: FileWarning, end: false },
  { to: '/corrections', label: 'Corrections', icon: FileWarning, end: false },
];

const LEGACY_NAV = [
  { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag },
  { to: '/cost-links', label: 'Cost Basis Links', icon: Link2 },
  { to: '/listings', label: 'eBay Listings', icon: Tag },
  { to: '/sales', label: 'Sales', icon: DollarSign },
];

const TOOLS_NAV = [
  { to: '/import-review', label: 'Import Review', icon: FileSearch },
  { to: '/acquisition-review', label: 'Acquisition Review', icon: Layers },
  { to: '/inventory-identity', label: 'Identity Diagnostics', icon: Boxes },
  { to: '/checks', label: 'Health Checks', icon: ShieldCheck },
];

// The deployed default when the shadow surfaces are off: byte-for-byte the
// original legacy SQLite navigation, unchanged.
const LEGACY_ONLY_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag },
  { to: '/cost-links', label: 'Cost Basis Links', icon: Link2 },
  { to: '/listings', label: 'eBay Listings', icon: Tag },
  { to: '/sales', label: 'Sales', icon: DollarSign },
  { to: '/checks', label: 'Health Checks', icon: ShieldCheck },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
  }`;
}

/** Active workspace name/role + switcher + sign out. Only mounted when the
 * shadow surfaces are enabled and the caller is inside a WorkspaceProvider. */
function WorkspaceHeader() {
  const { workspace, workspaces, selectWorkspace, signOut, email } = useWorkspace();
  const [switching, setSwitching] = useState(false);

  if (!workspace) return null;

  return (
    <div className="border-b border-hairline px-4 py-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {workspaces.length > 1 && switching ? (
            <select
              autoFocus
              className="w-full rounded border border-hairline bg-surface-0 px-1.5 py-1 text-xs"
              value={workspace.id}
              onChange={(e) => {
                selectWorkspace(e.target.value);
                setSwitching(false);
              }}
              onBlur={() => setSwitching(false)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => workspaces.length > 1 && setSwitching(true)}
              className="flex items-center gap-1 truncate font-semibold text-ink"
              title={workspaces.length > 1 ? 'Switch workspace' : undefined}
            >
              <span className="truncate">{workspace.name}</span>
              {workspaces.length > 1 && <ChevronDown className="h-3 w-3 shrink-0" />}
            </button>
          )}
          <div className="mt-0.5 text-ink-muted capitalize">{workspace.role}{email ? ` · ${email}` : ''}</div>
        </div>
        <button
          type="button"
          onClick={signOut}
          title="Sign out"
          className="shrink-0 rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Blocks routed content behind first-run setup until the active workspace
 * has completed it. Only mounted when the shadow surfaces are enabled. */
function FirstRunGate({ children }: { children: React.ReactNode }) {
  const { workspace, loading } = useWorkspace();
  if (loading) return <div className="p-6 text-sm text-ink-muted">Loading workspace…</div>;
  if (workspace && workspace.setupCompletedAt === null) return <FirstRunSetup />;
  return <>{children}</>;
}

function ToolsNavGroup({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const items = [...LEGACY_NAV, ...TOOLS_NAV];
  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        Tools &amp; legacy
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={onNavigate}>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The navigation itself, rendered identically in the desktop sidebar and in the
 * tablet drawer. One definition, so the two can never drift apart.
 */
function NavigationPanel({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-4 border-b border-hairline">
        <Vault className="h-5 w-5 text-accent" />
        <div>
          <div className="font-semibold text-sm leading-tight">The Russell Vault</div>
          <div className="text-xs text-ink-muted leading-tight">Operations</div>
        </div>
      </div>
      {PROVENANCE_ENABLED && <WorkspaceHeader />}
      {/* The close handler belongs on each destination, not on the <nav>.
          Anything else inside the panel — the "Tools & legacy" toggle, the
          workspace switcher, the sign-out button — would bubble to the nav and
          shut the drawer before the operator could use what they just opened. */}
      <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5">
        {(PROVENANCE_ENABLED ? PRIMARY_NAV : LEGACY_ONLY_NAV).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
        {PROVENANCE_ENABLED && <ToolsNavGroup onNavigate={onNavigate} />}
      </nav>
      <div className="px-4 py-3 border-t border-hairline text-xs text-ink-muted">
        Add inventory → link cost → list → record sale
      </div>
    </>
  );
}

function AppShell() {
  // The app is used mostly on an iPad. A permanently docked 240px sidebar left
  // roughly 528px for Current Inventory in portrait, which is what clipped the
  // table. Below `lg` the same navigation becomes a drawer instead.
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-ink">
      <SystemStatusBanner provenanceEnabled={PROVENANCE_ENABLED} appMode={APP_CONFIG.mode} />

      {/* Tablet and phone: a slim bar carrying the one control that opens the
          drawer. Hidden once the sidebar is permanently visible. */}
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-1 px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          className="rounded-lg border border-hairline p-2"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Vault className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold">The Russell Vault</span>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onKeyDown={(e) => { if (e.key === 'Escape') setNavOpen(false); }}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-hairline bg-surface-1"
          >
            {/* Closing on navigate is what makes a drawer usable one-handed:
                the operator taps a destination, not a destination and a close. */}
            <NavigationPanel onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden w-60 shrink-0 border-r border-hairline bg-surface-1 lg:flex flex-col overflow-y-auto">
          <NavigationPanel />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <RoutedContent />
        </main>
      </div>
    </div>
  );
}

function RoutedContent() {
  const routes = (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/inventory" element={<Inventory />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/cost-links" element={<CostLinks />} />
      <Route path="/listings" element={<Listings />} />
      <Route path="/sales" element={<Sales />} />
      <Route path="/checks" element={<Checks />} />
      {PROVENANCE_ENABLED && <Route path="/quick-add" element={<IntakeHub />} />}
      {PROVENANCE_ENABLED && <Route path="/batch-intake" element={<BatchIntake />} />}
      {PROVENANCE_ENABLED && <Route path="/workbench" element={<Workbench />} />}
      {PROVENANCE_ENABLED && <Route path="/scan" element={<ScanFind />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/lots/:lotId" element={<LotDetail />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/current" element={<CurrentInventory />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/move" element={<BulkMove />} />}
      {PROVENANCE_ENABLED && <Route path="/corrections" element={<Corrections />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/current/:itemId" element={<ItemDetail />} />}
      {PROVENANCE_ENABLED && <Route path="/intake-sessions" element={<IntakeSessions />} />}
      {PROVENANCE_ENABLED && <Route path="/locations" element={<Locations />} />}
      {PROVENANCE_ENABLED && <Route path="/cycle-counts" element={<CycleCounts />} />}
      {PROVENANCE_ENABLED && <Route path="/photo-issues" element={<MediaIssues />} />}
      {PROVENANCE_ENABLED && <Route path="/listing-prep" element={<ListingPrep />} />}
      {PROVENANCE_ENABLED && <Route path="/listing-prep/:prepId" element={<ListingPrepDetail />} />}
      {PROVENANCE_ENABLED && <Route path="/import-review" element={<ImportReview />} />}
      {PROVENANCE_ENABLED && <Route path="/acquisition-review" element={<AcquisitionReview />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory-identity" element={<InventoryIdentity />} />}
    </Routes>
  );
  return PROVENANCE_ENABLED ? <FirstRunGate>{routes}</FirstRunGate> : routes;
}

export default function App() {
  return (
    <AuthShell>
      <AppShell />
    </AuthShell>
  );
}

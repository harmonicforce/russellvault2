import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingBag, Link2, Tag, DollarSign, ShieldCheck, Vault,
  FileSearch, Layers, Boxes, PackagePlus, MapPin, ClipboardList, ChevronDown, LogOut,
  ListChecks, ScanLine,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Purchases from './pages/Purchases';
import CostLinks from './pages/CostLinks';
import Listings from './pages/Listings';
import Sales from './pages/Sales';
import Checks from './pages/Checks';
import ReadOnlyBanner from './components/ReadOnlyBanner';
import AuthShell from './components/AuthShell';
import ImportReview from './pages/ImportReview';
import AcquisitionReview from './pages/AcquisitionReview';
import InventoryIdentity from './pages/InventoryIdentity';
import IntakeHub from './pages/IntakeHub';
import LotDetail from './pages/LotDetail';
import ScanFind from './pages/ScanFind';
import Workbench from './pages/Workbench';
import CurrentInventory from './pages/CurrentInventory';
import ItemDetail from './pages/ItemDetail';
import IntakeSessions from './pages/IntakeSessions';
import Locations from './pages/Locations';
import FirstRunSetup from './components/FirstRunSetup';
import { isProvenanceUiEnabled } from './lib/provenanceConfig';
import { useWorkspace } from './lib/workspaceContext';

// The staging import-review surface, and every other Supabase-backed page,
// appears only when the shadow flag AND the shadow auth configuration are
// both present. With either absent — the deployed default — there is no nav
// entry and no route, so the legacy SQLite experience is byte-for-byte what
// it was before these surfaces existed.
const PROVENANCE_ENABLED = isProvenanceUiEnabled(
  import.meta.env as unknown as Record<string, string | undefined>
);

const PRIMARY_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/workbench', label: 'Daily Workbench', icon: ListChecks, end: false },
  { to: '/quick-add', label: 'Add Inventory', icon: PackagePlus, end: false },
  { to: '/scan', label: 'Scan or Find', icon: ScanLine, end: false },
  { to: '/inventory/current', label: 'Current Inventory', icon: Boxes, end: false },
  { to: '/inventory', label: 'Legacy Inventory', icon: Package, end: true },
  { to: '/intake-sessions', label: 'Intake Sessions', icon: ClipboardList, end: false },
  { to: '/locations', label: 'Locations', icon: MapPin, end: false },
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

function ToolsNavGroup() {
  const [open, setOpen] = useState(false);
  const items = [...LEGACY_NAV, ...TOOLS_NAV];
  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        Tools &amp; legacy
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function AppShell() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-ink">
      <ReadOnlyBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-60 shrink-0 border-r border-hairline bg-surface-1 flex flex-col overflow-y-auto">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-hairline">
            <Vault className="h-5 w-5 text-accent" />
            <div>
              <div className="font-semibold text-sm leading-tight">The Russell Vault</div>
              <div className="text-xs text-ink-muted leading-tight">Operations</div>
            </div>
          </div>
          {PROVENANCE_ENABLED && <WorkspaceHeader />}
          <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5">
            {(PROVENANCE_ENABLED ? PRIMARY_NAV : LEGACY_ONLY_NAV).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
            {PROVENANCE_ENABLED && <ToolsNavGroup />}
          </nav>
          <div className="px-4 py-3 border-t border-hairline text-xs text-ink-muted">
            Add inventory → link cost → list → record sale
          </div>
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
      {PROVENANCE_ENABLED && <Route path="/workbench" element={<Workbench />} />}
      {PROVENANCE_ENABLED && <Route path="/scan" element={<ScanFind />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/lots/:lotId" element={<LotDetail />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/current" element={<CurrentInventory />} />}
      {PROVENANCE_ENABLED && <Route path="/inventory/current/:itemId" element={<ItemDetail />} />}
      {PROVENANCE_ENABLED && <Route path="/intake-sessions" element={<IntakeSessions />} />}
      {PROVENANCE_ENABLED && <Route path="/locations" element={<Locations />} />}
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

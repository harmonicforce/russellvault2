import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingBag, Link2, Tag, DollarSign, ShieldCheck, Vault,
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

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/purchases', label: 'Whatnot Purchases', icon: ShoppingBag },
  { to: '/cost-links', label: 'Cost Basis Links', icon: Link2 },
  { to: '/listings', label: 'eBay Listings', icon: Tag },
  { to: '/sales', label: 'Sales', icon: DollarSign },
  { to: '/checks', label: 'Health Checks', icon: ShieldCheck },
];

export default function App() {
  return (
    <AuthShell>
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-ink">
      <ReadOnlyBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-60 shrink-0 border-r border-hairline bg-surface-1 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-hairline">
            <Vault className="h-5 w-5 text-accent" />
            <div>
              <div className="font-semibold text-sm leading-tight">The Russell Vault</div>
              <div className="text-xs text-ink-muted leading-tight">Operations</div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent/12 text-accent-strong'
                      : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 py-3 border-t border-hairline text-xs text-ink-muted">
            Add inventory → link cost → list → record sale
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/cost-links" element={<CostLinks />} />
            <Route path="/listings" element={<Listings />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/checks" element={<Checks />} />
          </Routes>
        </main>
      </div>
    </div>
    </AuthShell>
  );
}

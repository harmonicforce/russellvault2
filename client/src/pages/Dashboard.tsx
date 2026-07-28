import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package, ShoppingBag, Link2, Tag, DollarSign, ArrowRight,
  Boxes, ClipboardList, MapPin, PackagePlus, ScanLine,
} from 'lucide-react';
import { get } from '../lib/api';
import { StatTile } from '../components/StatTile';
import { money, num, shortDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createInventoryIdentityTransport, type WorkspaceSummaryStats } from '../lib/inventoryIdentityApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';

/** The Supabase-workspace-scoped section: current-system counts and quick
 * actions. Kept separate from the legacy panel below (clearly labeled) so
 * the two inventory systems are never conflated. Only mounted when the
 * shadow surfaces are enabled and a workspace is selected. */
function WorkspaceSummarySection() {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const transport = useMemo(() => {
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createInventoryIdentityTransport(tokenProviderFromClient(client));
  }, []);
  const [stats, setStats] = useState<WorkspaceSummaryStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    transport
      .summary(workspace.id)
      .then(setStats)
      .catch((e: unknown) => setError((e as Error).message));
  }, [transport, workspace]);

  if (!workspace) return null;

  return (
    <div className="rounded-xl border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Current Inventory — {workspace.name}</h2>
        <span className="rounded bg-accent/12 px-2 py-0.5 text-xs font-medium text-accent-strong">
          New inventory system
        </span>
      </div>
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Inventory lots" value={num(stats.totalLots)} icon={<Package className="h-4 w-4" />} />
          <StatTile label="Serialized items" value={num(stats.serializedItems)} icon={<Boxes className="h-4 w-4" />} />
          <StatTile label="Added last 7 days" value={num(stats.itemsAddedLast7Days)} icon={<ScanLine className="h-4 w-4" />} />
          <StatTile label="Open intake sessions" value={num(stats.openIntakeSessions)} icon={<ClipboardList className="h-4 w-4" />} />
          <StatTile
            label="Without a location"
            value={num(stats.itemsWithoutActiveLocation)}
            icon={<MapPin className="h-4 w-4" />}
            tone={stats.itemsWithoutActiveLocation > 0 ? 'warning' : 'good'}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => navigate('/quick-add')}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
        >
          <PackagePlus className="h-3.5 w-3.5" /> Add graded slab
        </button>
        <button
          onClick={() => navigate('/inventory/current')}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          <Boxes className="h-3.5 w-3.5" /> View inventory
        </button>
        <button
          onClick={() => navigate('/intake-sessions')}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          <ClipboardList className="h-3.5 w-3.5" /> Continue intake
        </button>
        <button
          onClick={() => navigate('/locations')}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          <MapPin className="h-3.5 w-3.5" /> Manage locations
        </button>
      </div>
    </div>
  );
}

interface DashboardData {
  inventory: {
    lotCount: number; totalUnits: number; availableUnits: number; recordedValue: number;
    totalCostBasis: number; uncostedCount: number; costedCount: number; partialCostedCount: number;
  };
  purchases: {
    lineCount: number; totalPaid: number; remainingCost: number;
    unmatchedCount: number; fullyMatchedCount: number; partiallyMatchedCount: number;
  };
  links: { total: number; candidateCount: number; confirmedCount: number; rejectedCount: number };
  listings: { total: number; draftCount: number; activeCount: number; soldCount: number };
  sales: { total: number; totalNetProceeds: number; totalProfit: number; unitsSold: number; unavailableProfitCount: number };
  checks: { status: string; n: number }[];
  recentSales: any[];
  recentPurchases: any[];
  topVerticals: { business_vertical: string; lotCount: number; value: number }[];
}

export default function Dashboard() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardData>('/dashboard'),
  });

  if (isLoading || !data) {
    return <div className="p-6 text-ink-muted">Loading dashboard…</div>;
  }

  const maxVerticalValue = Math.max(1, ...data.topVerticals.map((v) => v.value));
  const failCount = data.checks.find((c) => c.status === 'FAIL')?.n ?? 0;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-semibold">Today at a glance</h1>
        <p className="text-ink-secondary text-sm mt-1">
          One workbook, four steps: add inventory → connect cost → list on eBay → record sale.
        </p>
      </div>

      {config && <WorkspaceSummarySection />}

      <div>
        <h2 className="text-sm font-semibold text-ink-secondary">Legacy spreadsheet-imported inventory</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile
          label="Inventory lots"
          value={num(data.inventory.lotCount)}
          sub={`${num(data.inventory.availableUnits)} units available`}
          icon={<Package className="h-4 w-4" />}
        />
        <StatTile
          label="Recorded value"
          value={money(data.inventory.recordedValue)}
          sub={`${money(data.inventory.totalCostBasis)} confirmed cost basis`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatTile
          label="Uncosted lots"
          value={num(data.inventory.uncostedCount)}
          sub={`${num(data.inventory.costedCount)} fully costed`}
          icon={<Link2 className="h-4 w-4" />}
          tone={data.inventory.uncostedCount > 0 ? 'warning' : 'good'}
        />
        <StatTile
          label="Active listings"
          value={num(data.listings.activeCount)}
          sub={`${num(data.listings.draftCount)} drafts pending`}
          icon={<Tag className="h-4 w-4" />}
        />
        <StatTile
          label="Recorded sales"
          value={num(data.sales.total)}
          sub={
            !data.sales.total
              ? 'None recorded yet'
              : data.sales.unavailableProfitCount > 0
              ? `${money(data.sales.totalProfit)} profit · ${data.sales.unavailableProfitCount} pending cost basis`
              : `${money(data.sales.totalProfit)} profit`
          }
          icon={<ShoppingBag className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-hairline bg-surface-1 p-4">
          <h2 className="text-sm font-semibold mb-3">Inventory value by vertical</h2>
          <div className="flex flex-col gap-2.5">
            {data.topVerticals.map((v) => (
              <div key={v.business_vertical} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm text-ink-secondary truncate">{v.business_vertical}</div>
                <div className="flex-1 h-5 rounded bg-surface-2 relative overflow-hidden">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${Math.max(2, (v.value / maxVerticalValue) * 100)}%` }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right text-sm tabular-nums">{money(v.value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface-1 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Reconciliation health</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">System checks</span>
            <StatusBadge status={failCount > 0 ? 'FAIL' : 'PASS'} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">Purchases unmatched</span>
            <span className="tabular-nums font-medium">{num(data.purchases.unmatchedCount)} / {num(data.purchases.lineCount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">Cost links awaiting review</span>
            <span className="tabular-nums font-medium">{num(data.links.candidateCount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">Remaining unallocated spend</span>
            <span className="tabular-nums font-medium">{money(data.purchases.remainingCost)}</span>
          </div>
          <Link to="/checks" className="mt-auto text-sm text-accent-strong font-medium inline-flex items-center gap-1 hover:underline">
            View full health report <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-hairline bg-surface-1 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent purchases</h2>
            <Link to="/purchases" className="text-xs text-accent-strong hover:underline">View all</Link>
          </div>
          <div className="flex flex-col divide-y divide-hairline">
            {data.recentPurchases.map((p) => (
              <div key={p.acquisition_line_id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{p.product_name}</div>
                  <div className="text-xs text-ink-muted">{p.seller} · {shortDate(p.processed_date)}</div>
                </div>
                <div className="text-sm tabular-nums shrink-0">{money(p.total_paid)}</div>
              </div>
            ))}
            {data.recentPurchases.length === 0 && <div className="py-4 text-sm text-ink-muted">No purchases yet.</div>}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface-1 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent sales</h2>
            <Link to="/sales" className="text-xs text-accent-strong hover:underline">View all</Link>
          </div>
          <div className="flex flex-col divide-y divide-hairline">
            {data.recentSales.map((s) => (
              <div key={s.sale_id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{s.product_name}</div>
                  <div className="text-xs text-ink-muted">{shortDate(s.sold_date)}</div>
                </div>
                <div className="text-sm tabular-nums shrink-0">{money(s.net_proceeds)}</div>
              </div>
            ))}
            {data.recentSales.length === 0 && (
              <div className="py-4 text-sm text-ink-muted">
                No sales recorded yet — record your first sale on the{' '}
                <Link to="/sales" className="text-accent-strong hover:underline">Sales</Link> page.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

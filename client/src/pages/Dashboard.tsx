import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package, ShoppingBag, Link2, Tag, DollarSign, ArrowRight,
  Boxes, ClipboardList, MapPin, PackagePlus, AlertTriangle, Clock, RefreshCw,
} from 'lucide-react';
import { get } from '../lib/api';
import { StatTile } from '../components/StatTile';
import { money, num, shortDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import { createOperationsDashboardTransport } from '../lib/operationsDashboardApi';

/** The Supabase-workspace-scoped section: current-system counts and quick
 * actions. Kept separate from the legacy panel below (clearly labeled) so
 * the two inventory systems are never conflated. Only mounted when the
 * shadow surfaces are enabled and a workspace is selected. */
function WorkspaceSummarySection() {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const operations = useMemo(() => createOperationsDashboardTransport(tokenProviderFromClient(
    createShadowClient(import.meta.env as unknown as Record<string, string | undefined>)
  )), []);
  const enabled = Boolean(workspace);
  const health = useQuery({ queryKey: ['operations-dashboard', workspace?.id, 'health'], queryFn: () => operations.health(workspace!.id), enabled });
  const work = useQuery({ queryKey: ['operations-dashboard', workspace?.id, 'work'], queryFn: () => operations.work(workspace!.id), enabled });
  const workflows = useQuery({ queryKey: ['operations-dashboard', workspace?.id, 'workflows'], queryFn: () => operations.workflows(workspace!.id), enabled });
  const activity = useQuery({ queryKey: ['operations-dashboard', workspace?.id, 'activity'], queryFn: () => operations.activity(workspace!.id), enabled });

  if (!workspace) return null;

  return (
    <div className="space-y-4" aria-label={`Operational dashboard for ${workspace.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold">Today’s Work — {workspace.name}</h2><p className="text-xs text-ink-muted">Deterministic priorities from recorded operational facts.</p></div>
        <button onClick={() => { void health.refetch(); void work.refetch(); void workflows.refetch(); void activity.refetch(); }} className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-1.5 text-sm"><RefreshCw className="h-4 w-4"/> Refresh</button>
      </div>
      <PanelState query={work} label="Today’s Work">
        {work.data && <div className="rounded-xl border border-hairline bg-surface-1 divide-y divide-hairline">
          {work.data.tasks.slice(0, 8).map(task => <Link key={`${task.taskType}-${task.subjectId}`} to={task.destination} className="flex items-start justify-between gap-3 p-3 hover:bg-surface-2">
            <div><div className="font-medium text-sm">{task.displayName} <span className="text-ink-muted">{task.publicId}</span></div><div className="text-xs text-ink-secondary">{task.reason} Recommended: open the filtered queue and resolve the recorded exception.</div><div className="mt-1 text-xs text-ink-muted">Why ranked: {task.scoreExplanation}</div></div>
            <span className="shrink-0 text-xs font-medium"><Clock className="inline h-3 w-3"/> {task.ageDays}d · {task.severity}</span>
          </Link>)}
          {!work.data.tasks.length && <p className="p-4 text-sm text-ink-muted">No work matched the current governed rules as of {shortDate(work.data.asOf)}.</p>}
        </div>}
      </PanelState>
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelState query={health} label="Inventory Health">
          {health.data && <section className="rounded-xl border border-hairline bg-surface-1 p-4"><h3 className="font-semibold">Inventory Health</h3><p className="text-xs text-ink-muted mb-3">As of {new Date(health.data.asOf).toLocaleString()}</p><div className="grid grid-cols-2 gap-2">
            <StatTile label="Serialized units" value={num(health.data.serializedUnits)} icon={<Boxes className="h-4 w-4"/>}/><StatTile label="Lot-managed units" value={num(health.data.lotManagedUnits)} sub={`${num(health.data.lotManagedRecords)} active records`} icon={<Package className="h-4 w-4"/>}/>
            <Link to="/inventory/current?needsLocation=1" className="col-span-2"><StatTile label="Records without location" value={num(health.data.withoutLocation)} icon={<MapPin className="h-4 w-4"/>} tone={health.data.withoutLocation ? 'warning' : 'good'}/></Link>
          </div></section>}
        </PanelState>
        <PanelState query={workflows} label="Workflow Backlogs">{workflows.data && <section className="rounded-xl border border-hairline bg-surface-1 p-4"><h3 className="font-semibold">Workflow Backlogs</h3><p className="text-xs text-ink-muted mb-3">As of {new Date(workflows.data.asOf).toLocaleString()}</p><div className="grid grid-cols-2 gap-2 text-sm">
          {/* Two different populations, two different destinations. A record
              can hold a front photograph and still owe its back, label or
              condition shot, so one tile cannot honestly cover both. */}
          <BacklogLink to="/inventory/current?needsPhotos=1" label="No photo yet" value={workflows.data.media.no_active_photo ?? 0}/>
          <BacklogLink to="/photo-issues?tab=readiness&status=missing_required_angle" label="Missing required angles" value={workflows.data.media.by_readiness.missing_required_angle ?? 0}/>
          <BacklogLink to="/photo-issues" label="Open Photo Issues" value={workflows.data.media.open_issue_count ?? 0}/>
          <BacklogLink to="/listing-prep?tab=ready" label="Ready to list" value={workflows.data.listingPrep.by_status.ready_to_list ?? 0}/>
          <BacklogLink to="/listing-prep?tab=queue&readiness=needs_owner_review" label="Needs owner review" value={workflows.data.listingPrep.by_readiness.needs_owner_review ?? 0}/>
          <BacklogLink to="/listing-prep?tab=queue&readiness=needs_photos" label="Prep needs photos" value={workflows.data.listingPrep.by_readiness.needs_photos ?? 0}/>
          <BacklogLink to="/listing-prep?tab=queue&readiness=blocked" label="Blocked" value={workflows.data.listingPrep.by_readiness.blocked ?? 0}/>
          <BacklogLink to="/listing-prep?tab=queue" label="Never started" value={workflows.data.listingPrep.never_started ?? 0}/>
        </div></section>}</PanelState>
      </div>
      <PanelState query={activity} label="Recent Movements">{activity.data && <section className="rounded-xl border border-hairline bg-surface-1 p-4"><h3 className="font-semibold">Recent Movements</h3><p className="text-xs text-ink-muted">Source: {activity.data.source} · as of {new Date(activity.data.asOf).toLocaleString()}</p><div className="mt-2 divide-y divide-hairline">{activity.data.events.slice(0, 6).map(event => <Link key={event.id} to={event.destination} className="flex justify-between py-2 text-sm hover:underline"><span>Inventory moved · {event.public_id}</span><span>{shortDate(event.moved_at)}</span></Link>)}{!activity.data.events.length && <p className="py-3 text-sm text-ink-muted">No governed movement events yet.</p>}</div></section>}</PanelState>
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

function BacklogLink({ to, label, value }: { to: string; label: string; value: number }) {
  return <Link to={to} className="flex items-center justify-between rounded-lg border border-hairline p-2 hover:bg-surface-2"><span>{label}</span><strong className="tabular-nums">{num(value)}</strong></Link>;
}

function PanelState({ query, label, children }: { query: { isLoading: boolean; error: Error | null }; label: string; children: ReactNode }) {
  if (query.isLoading) return <div className="rounded-xl border border-hairline p-4 text-sm text-ink-muted">Loading {label}…</div>;
  if (query.error) return <div role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-4"><div className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-4 w-4"/>{label} unavailable</div><p className="mt-1 text-sm">{query.error.message}</p><p className="mt-1 text-xs text-ink-muted">No zero has been substituted. Other dashboard panels remain available.</p></div>;
  return <>{children}</>;
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
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardData>('/dashboard'),
  });

  if (isLoading || !data) {
    return <div className="p-6 flex flex-col gap-6 max-w-[1400px]"><div><h1 className="text-2xl font-semibold">Today at a glance</h1></div>{config && <WorkspaceSummarySection />}<section aria-label="Legacy spreadsheet-imported inventory" className="text-sm text-ink-muted">{error ? 'Legacy dashboard unavailable.' : 'Loading legacy spreadsheet-imported inventory…'}</section></div>;
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

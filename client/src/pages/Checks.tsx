import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { get } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';

interface CheckRow {
  check_id: string; test: string; actual: number; expected: number;
  difference: number; status: string; notes: string;
}

export default function Checks() {
  const { data, isLoading } = useQuery({
    queryKey: ['checks'],
    queryFn: () => get<{ stored: CheckRow[]; live: CheckRow[] }>('/checks'),
  });

  if (isLoading || !data) return <div className="p-6 text-ink-muted">Loading…</div>;

  const all = [...data.live, ...data.stored];
  const failCount = all.filter((c) => c.status === 'FAIL').length;
  const warnCount = all.filter((c) => c.status === 'WARN').length;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Health Checks</h1>
        <p className="text-ink-secondary text-sm mt-1">
          System integrity checks across identities, relationships, and reconciliation. Resolve every FAIL before treating cost or availability as reliable.
        </p>
      </div>

      <div className="flex gap-3">
        <SummaryPill icon={CheckCircle2} tone="good" label="Passing" value={all.length - failCount - warnCount} />
        <SummaryPill icon={AlertTriangle} tone="warning" label="Warnings" value={warnCount} />
        <SummaryPill icon={XCircle} tone="critical" label="Failing" value={failCount} />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2 text-ink-secondary uppercase tracking-wide">Live checks</h2>
        <div className="rounded-xl border border-hairline bg-surface-1 divide-y divide-hairline">
          {data.live.map((c) => <CheckItem key={c.check_id} check={c} />)}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2 text-ink-secondary uppercase tracking-wide">Imported baseline checks</h2>
        <div className="rounded-xl border border-hairline bg-surface-1 divide-y divide-hairline">
          {data.stored.map((c) => <CheckItem key={c.check_id} check={c} />)}
        </div>
      </div>
    </div>
  );
}

function CheckItem({ check }: { check: CheckRow }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{check.test}</div>
        <div className="text-xs text-ink-muted mt-0.5">{check.notes}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-ink-muted tabular-nums">
          {check.actual} / {check.expected}
        </span>
        <StatusBadge status={check.status} />
      </div>
    </div>
  );
}

function SummaryPill({ icon: Icon, tone, label, value }: { icon: typeof CheckCircle2; tone: 'good' | 'warning' | 'critical'; label: string; value: number }) {
  const toneClass = { good: 'text-good', warning: 'text-[#8a5a00] dark:text-warning', critical: 'text-critical' }[tone];
  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-4 py-3">
      <Icon className={`h-5 w-5 ${toneClass}`} />
      <div>
        <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
        <div className="text-xs text-ink-muted">{label}</div>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: 'default' | 'good' | 'warning' | 'critical';
}) {
  const toneClass = {
    default: 'text-ink',
    good: 'text-good',
    warning: 'text-[#8a5a00] dark:text-warning',
    critical: 'text-critical',
  }[tone];

  return (
    <div className="rounded-xl border border-hairline bg-surface-1 p-4 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between text-ink-muted">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-semibold tabular-nums truncate ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-ink-secondary truncate">{sub}</div>}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, WifiOff } from 'lucide-react';
import {
  SYSTEM_HEALTH_QUERY_KEY,
  fetchSystemHealth,
  type LegacyHealthReason,
  type SystemHealthResult,
} from '../lib/healthApi';
import type { AppConfigMode } from '../lib/appConfig';

// One banner, several states — replacing the read-only-only banner that
// rendered `null` whenever the health request failed. That was the worst
// possible behaviour: /api/health returns 503 precisely when the legacy
// database is missing, unreadable, structurally incomplete or catastrophically
// empty, and the old component answered by showing nothing at all.
//
// Deliberately one component rather than several stacked ones, so the operator
// never sees two banners contradicting each other.

// The legacy write surfaces. Anything else is either a governed page, whose
// writes are unaffected by the legacy write guard, or a page with no writes.
const LEGACY_WRITE_PATHS: readonly string[] = [
  '/inventory',      // exact only — /inventory/current is the governed surface
  '/purchases',
  '/cost-links',
  '/listings',
  '/sales',
];

export function appliesToPath(pathname: string, provenanceEnabled: boolean): boolean {
  // With the governed surfaces switched off, every page is a legacy page.
  if (!provenanceEnabled) return true;
  return LEGACY_WRITE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  ) && !pathname.startsWith('/inventory/current')
    && !pathname.startsWith('/inventory/lots');
}

/**
 * Safe, fixed copy for each bounded server reason. The server's own text is
 * never rendered; only these strings are. An unrecognized or absent code falls
 * back to the generic sentence rather than surfacing anything unvalidated.
 */
const REASON_COPY: Record<LegacyHealthReason, string> = {
  legacy_database_missing: 'The legacy database could not be found.',
  legacy_database_unreadable: 'The legacy database could not be read.',
  legacy_schema_missing: 'The legacy database is missing tables or columns the app expects.',
  legacy_baseline_empty: 'The legacy database is present but its imported records are missing.',
  legacy_health_check_failed: 'The legacy database health check did not complete.',
};

function reasonCopy(reason?: LegacyHealthReason): string {
  return reason ? REASON_COPY[reason] : 'The legacy database is not usable.';
}

export interface SystemStatusBannerProps {
  provenanceEnabled?: boolean;
  /** Which application is running. Legacy-only must be visible, not implied. */
  appMode?: AppConfigMode;
}

export default function SystemStatusBanner({
  provenanceEnabled = false,
  appMode = 'legacy-only',
}: SystemStatusBannerProps) {
  const { pathname } = useLocation();
  const health = useQuery<SystemHealthResult>({
    queryKey: SYSTEM_HEALTH_QUERY_KEY,
    queryFn: () => fetchSystemHealth(),
    refetchInterval: 60_000,
  });

  const onLegacyPath = appliesToPath(pathname, provenanceEnabled);
  const legacyOnly = appMode === 'legacy-only';

  // 1. A structurally unusable legacy database outranks everything else, and is
  //    shown on every route — hiding it on governed routes would leave an
  //    operator reading legacy numbers elsewhere with no warning.
  if (health.data?.status === 'unhealthy') {
    return (
      <Banner tone="critical" role="alert" icon={<ShieldAlert className="h-4 w-4 shrink-0" />}>
        <strong className="font-semibold">Legacy data unavailable.</strong>{' '}
        {reasonCopy(health.data.health.reason)}{' '}
        {onLegacyPath
          ? 'This page cannot show reliable legacy data — treat anything on it as untrusted, and do not read an empty list or a zero total as a real value.'
          : 'Legacy inventory, purchases, cost links, listings, sales and the legacy dashboard section are unavailable or untrusted. Governed inventory workflows are unaffected and continue to work normally.'}
      </Banner>
    );
  }

  // 2. Health could not be verified at all: a network failure, or a response
  //    that was not the documented shape. Never silently blank, and never
  //    treated as "writes are fine".
  if (health.isError) {
    return (
      <Banner tone="warning" role="alert" icon={<WifiOff className="h-4 w-4 shrink-0" />}>
        <strong className="font-semibold">System health could not be verified.</strong>{' '}
        The app could not confirm whether legacy data is usable or read-only. Anything shown from
        the legacy system may be stale or incomplete.
        <button
          type="button"
          onClick={() => void health.refetch()}
          className="ml-2 rounded border border-current px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </Banner>
    );
  }

  // 3. Legacy-only mode. One coherent notice that also carries the read-only
  //    fact when it applies, rather than a second stacked banner.
  if (legacyOnly) {
    const readOnly = health.data?.health.readOnly === true;
    return (
      <Banner tone="warning" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
        <strong className="font-semibold">Legacy-only mode.</strong>{' '}
        This deployment has no governed configuration, so it is showing legacy SQLite data only.
        That data is non-authoritative, governed inventory workflows are unavailable, and legacy
        totals must never be combined with governed totals.
        {readOnly && ' Legacy writes are also disabled, so changes made here will not be saved.'}
      </Banner>
    );
  }

  // 4. Governed mode with a healthy legacy database. The read-only warning is
  //    true only on legacy write surfaces; governed writes are unaffected.
  if (health.data?.health.readOnly && onLegacyPath) {
    return (
      <Banner tone="critical" icon={<ShieldAlert className="h-4 w-4 shrink-0" />}>
        Read-only mode — legacy writes are disabled in production pending later target-model
        migration work. Changes here will not be saved. Contact the owner if this is unexpected.
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  role,
  icon,
  children,
}: {
  tone: 'critical' | 'warning';
  role?: 'alert';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  // Text carries the meaning; colour only reinforces it. Not dismissible:
  // these are system states, not notices the owner can clear.
  // Both tones use semantic status tokens, which already carry the correct
  // value for each theme. The warning tone previously hard-coded a light-theme
  // hex and relied on a `dark:` override; the token does that flip itself, in
  // one place, for both the OS preference and the explicit Dark Vault choice.
  const toneClass =
    tone === 'critical'
      ? 'bg-critical/15 text-critical border-critical/30'
      : 'bg-warning/15 text-warning border-warning/30';
  return (
    <div role={role} className={`flex items-start gap-2 border-b px-4 py-2 text-sm font-medium shrink-0 ${toneClass}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

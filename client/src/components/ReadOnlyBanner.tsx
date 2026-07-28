import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { get, type HealthStatus } from '../lib/api';

// Read-only mode is a production safety state, not a notice the owner can
// click away — there is no close button and nothing hides it while the server
// reports readOnly on a page it actually applies to.
//
// It applies to the LEGACY SQLite write surfaces only. The Supabase-backed
// pages (adding inventory, locations, photos, movement) write through a
// different path entirely and are unaffected, so showing this above them was
// telling the owner their changes would not be saved when they would. Those
// pages are excluded rather than the banner being softened, because on a
// legacy page the warning is still completely true.
const LEGACY_WRITE_PATHS: readonly string[] = [
  '/inventory',      // exact only — /inventory/current is the Supabase surface
  '/purchases',
  '/cost-links',
  '/listings',
  '/sales',
];

export function appliesToPath(pathname: string, provenanceEnabled: boolean): boolean {
  // With the Supabase surfaces switched off, every page is a legacy page and
  // the banner behaves exactly as it always did.
  if (!provenanceEnabled) return true;
  return LEGACY_WRITE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  ) && !pathname.startsWith('/inventory/current')
    && !pathname.startsWith('/inventory/lots');
}

export default function ReadOnlyBanner({
  provenanceEnabled = false,
}: {
  provenanceEnabled?: boolean;
}) {
  const { pathname } = useLocation();
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => get<HealthStatus>('/health'),
    refetchInterval: 60_000,
  });

  if (!data?.readOnly) return null;
  if (!appliesToPath(pathname, provenanceEnabled)) return null;

  return (
    <div className="flex items-center gap-2 bg-critical/15 text-critical px-4 py-2 text-sm font-medium border-b border-critical/30 shrink-0">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Read-only mode — legacy writes are disabled in production pending later target-model migration work.
        Changes here will not be saved. Contact the owner if this is unexpected.
      </span>
    </div>
  );
}

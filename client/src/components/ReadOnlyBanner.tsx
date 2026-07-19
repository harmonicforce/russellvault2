import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { get, type HealthStatus } from '../lib/api';

// Non-dismissible by design: read-only mode is a production safety state, not
// a notice the owner can click away and forget about. There is no close
// button and no state that hides it once the server reports readOnly.
export default function ReadOnlyBanner() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => get<HealthStatus>('/health'),
    refetchInterval: 60_000,
  });

  if (!data?.readOnly) return null;

  return (
    <div className="flex items-center gap-2 bg-critical/15 text-critical px-4 py-2 text-sm font-medium border-b border-critical/30 shrink-0">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Read-only mode — legacy writes are disabled in production pending the Phase 1 data-model migration.
        Changes here will not be saved. Contact the owner if this is unexpected.
      </span>
    </div>
  );
}

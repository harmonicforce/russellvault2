const STATUS_STYLES: Record<string, string> = {
  // good
  Costed: 'bg-good/15 text-good',
  Confirmed: 'bg-good/15 text-good',
  'Fully Matched': 'bg-good/15 text-good',
  PASS: 'bg-good/15 text-good',
  Active: 'bg-good/15 text-good',
  Paid: 'bg-good/15 text-good',
  Delivered: 'bg-good/15 text-good',
  Shipped: 'bg-good/15 text-good',
  // warning
  'Partially Costed': 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  'Partially Matched': 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  Candidate: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  Draft: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  'Has draft': 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  WARN: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  'Not Paid': 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  Provisional: 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  'Not Packed': 'bg-warning/20 text-[#8a5a00] dark:text-warning',
  // critical
  Uncosted: 'bg-critical/15 text-critical',
  Unmatched: 'bg-critical/15 text-critical',
  Rejected: 'bg-critical/15 text-critical',
  FAIL: 'bg-critical/15 text-critical',
  Ended: 'bg-critical/15 text-critical',
  Unavailable: 'bg-critical/15 text-critical',
  Returned: 'bg-critical/15 text-critical',
  // neutral
  'Not listed': 'bg-ink-muted/15 text-ink-secondary',
  Sold: 'bg-accent/15 text-accent-strong',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-ink-muted text-sm">—</span>;
  const cls = STATUS_STYLES[status] ?? 'bg-ink-muted/15 text-ink-secondary';
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

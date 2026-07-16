export function money(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function num(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US');
}

export function shortDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

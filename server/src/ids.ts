import { db } from './db.js';

export function nextId(table: string, column: string, prefix: string, width = 6): string {
  const row = db
    .prepare(
      `SELECT ${column} as id FROM ${table} WHERE ${column} LIKE @pattern ORDER BY LENGTH(${column}) DESC, ${column} DESC`
    )
    .all({ pattern: `${prefix}%` }) as { id: string }[];

  let max = 0;
  for (const r of row) {
    const suffix = r.id.slice(prefix.length);
    const n = parseInt(suffix, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

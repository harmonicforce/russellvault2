// Narrowing helpers for Express route inputs, checked against the generated
// database contract.
//
// Why these exist
// ---------------
// Two classes of latent defect became visible the moment the Supabase client
// was given its real types:
//
//  1. Express 5 types `req.params.x` as `string | string[]`, because a route
//     can bind a parameter more than once. The code passed those values
//     straight into `.eq('id', …)`. With an untyped client that compiled; a
//     request that produced an array would have reached the database as one.
//  2. Query strings were split into `string[]` and passed to `.in('state', …)`
//     for enum columns without ever checking the values were members of the
//     enum. Again invisible while the client was untyped.
//
// Generated types do not remove the need to parse untrusted input — they reveal
// where the parsing was missing. These helpers do the parsing; the callers
// decide which error to raise, because each router has its own error contract.

import { Constants } from '../../../shared/database.types.js';
import type { Database } from '../../../shared/databaseAliases.js';

type PublicEnums = Database['public']['Enums'];

/**
 * Narrow an Express route parameter to a single non-empty string.
 * Returns null when the value is absent, empty, or repeated — the caller
 * decides what that means for its route.
 */
export function singleParam(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The same narrowing for a query-string value, which may also be parsed objects. */
export function singleQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Is `value` a member of the named database enum?
 *
 * The permitted values come from the GENERATED contract's runtime `Constants`,
 * not from a list written here. A value added to or removed from the enum
 * changes this check on the next regeneration, so the validation cannot drift
 * away from the database the way a hand-copied union would.
 */
export function isEnumValue<N extends keyof PublicEnums & keyof typeof Constants.public.Enums>(
  name: N,
  value: unknown,
): value is PublicEnums[N] {
  const allowed = Constants.public.Enums[name] as readonly unknown[];
  return typeof value === 'string' && allowed.includes(value);
}

/**
 * Keep only the members of a database enum, preserving order and dropping
 * duplicates. Returns null when the input contains anything that is not a
 * member, so a caller can reject the request rather than silently narrowing it
 * — quietly discarding an unrecognised filter value would answer a question the
 * caller did not ask.
 */
export function parseEnumList<N extends keyof PublicEnums & keyof typeof Constants.public.Enums>(
  name: N,
  values: readonly unknown[],
): PublicEnums[N][] | null {
  const parsed: PublicEnums[N][] = [];
  for (const value of values) {
    if (!isEnumValue(name, value)) return null;
    if (!parsed.includes(value)) parsed.push(value);
  }
  return parsed;
}

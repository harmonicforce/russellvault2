// Which application the browser is actually running, resolved once and typed.
//
// The client used to collapse five materially different situations into a
// single `null`: no governed configuration, partially configured Supabase,
// wrong flag values, complete auth configuration without the governed-surface
// flag, and complete governed configuration. Every one of them except the last
// silently produced the unauthenticated legacy SQLite application. A single
// dropped environment variable was therefore enough to downgrade a governed
// deployment into the legacy one, with nothing on screen to say so.
//
// Three states now, and a partial configuration is NOT one of the working ones.

import { SHADOW_AUTH_FLAG, type EnvLike } from './shadowConfig';
import { SHADOW_IMPORT_FLAG } from './provenanceConfig';

export type { EnvLike };

export const GOVERNED_CONFIG_FIELDS = [
  SHADOW_AUTH_FLAG,
  SHADOW_IMPORT_FLAG,
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

export type GovernedConfigField = (typeof GOVERNED_CONFIG_FIELDS)[number];

export type AppConfigState =
  /** All four governed variables present and exactly correct. */
  | { readonly mode: 'governed'; readonly url: string; readonly anonKey: string }
  /**
   * None of the governed variables are present. The legacy application may
   * render, but it is labelled legacy-only and non-authoritative on screen.
   */
  | { readonly mode: 'legacy-only' }
  /**
   * Some governed configuration is present but the contract is not satisfied.
   * Carries FIELD NAMES only — never a value, because two of the four are a
   * project URL and an anon key.
   */
  | {
      readonly mode: 'misconfigured';
      /** Declared but absent. */
      readonly missing: readonly GovernedConfigField[];
      /** Present with a value the contract rejects. */
      readonly invalid: readonly GovernedConfigField[];
    };

export type AppConfigMode = AppConfigState['mode'];

/** Absent means undefined or empty string. Whitespace is present-but-invalid. */
function isAbsent(value: string | undefined): boolean {
  return value === undefined || value === '';
}

type FieldVerdict = 'absent' | 'valid' | 'invalid';

function verdictForExact(value: string | undefined, expected: string): FieldVerdict {
  if (isAbsent(value)) return 'absent';
  return value === expected ? 'valid' : 'invalid';
}

function verdictForNonEmpty(value: string | undefined): FieldVerdict {
  if (isAbsent(value)) return 'absent';
  // A whitespace-only URL or key is a configuration error, not a value.
  return value!.trim() === '' ? 'invalid' : 'valid';
}

/**
 * Resolves the application mode from the environment. Pure: no client is
 * created, no request is made, nothing is cached.
 *
 * The flags keep their existing names and exact values — renaming environment
 * variables is deliberately out of scope here, because the deployed service
 * already sets them.
 */
export function resolveAppConfig(env: EnvLike): AppConfigState {
  const verdicts: Record<GovernedConfigField, FieldVerdict> = {
    [SHADOW_AUTH_FLAG]: verdictForExact(env[SHADOW_AUTH_FLAG], 'supabase'),
    [SHADOW_IMPORT_FLAG]: verdictForExact(env[SHADOW_IMPORT_FLAG], 'repository-fixtures'),
    VITE_SUPABASE_URL: verdictForNonEmpty(env.VITE_SUPABASE_URL),
    VITE_SUPABASE_ANON_KEY: verdictForNonEmpty(env.VITE_SUPABASE_ANON_KEY),
  };

  const entries = GOVERNED_CONFIG_FIELDS.map((field) => [field, verdicts[field]] as const);

  if (entries.every(([, verdict]) => verdict === 'absent')) {
    return { mode: 'legacy-only' };
  }

  if (entries.every(([, verdict]) => verdict === 'valid')) {
    return {
      mode: 'governed',
      url: env.VITE_SUPABASE_URL as string,
      anonKey: env.VITE_SUPABASE_ANON_KEY as string,
    };
  }

  return {
    mode: 'misconfigured',
    missing: entries.filter(([, v]) => v === 'absent').map(([field]) => field),
    invalid: entries.filter(([, v]) => v === 'invalid').map(([field]) => field),
  };
}

/**
 * The one-line explanation shown on the configuration-error screen. Field names
 * only — asserted by test, because two of these fields carry credentials.
 */
export function describeMisconfiguration(state: Extract<AppConfigState, { mode: 'misconfigured' }>): string {
  const parts: string[] = [];
  if (state.missing.length > 0) parts.push(`missing: ${state.missing.join(', ')}`);
  if (state.invalid.length > 0) parts.push(`invalid value: ${state.invalid.join(', ')}`);
  return parts.join(' · ');
}

// Cross-origin policy.
//
// The previous configuration was `app.use(cors())`, which reflects whatever
// Origin the request carries and therefore accepts every origin on the
// internet. Combined with anonymous legacy routes that meant any web page could
// read the legacy dataset from a visitor's browser. The legacy access guard
// closes the anonymous half; this closes the cross-origin half.
//
// Production serves the built client from this same process (see index.ts), so
// the browser never makes a cross-origin request in production and no CORS
// headers are needed. Sending none is strictly safer than sending permissive
// ones, so production runs with NO cors middleware mounted at all.
//
// Development runs Vite on a separate port, which genuinely is cross-origin.
// Those origins are explicit and bounded: a short built-in default for the
// standard Vite ports, overridable by DEV_CORS_ORIGINS for unusual setups.
//
// CORS is not an authentication mechanism and this policy grants no access. An
// allowed origin still has to satisfy the legacy access guard; a rejected origin
// is simply refused earlier. Nothing here can enable anonymous access.

import type { CorsOptions } from 'cors';

export type EnvLike = Record<string, string | undefined>;

export const DEV_CORS_ORIGINS_VAR = 'DEV_CORS_ORIGINS';

/** Standard Vite dev-server origins; matches supabase/config.toml's site_url. */
export const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

export type CorsPolicy =
  | { readonly mode: 'same-origin' }
  | { readonly mode: 'allowlist'; readonly origins: readonly string[] };

function parseOrigins(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return origins;
}

export function resolveCorsPolicy(env: EnvLike = process.env): CorsPolicy {
  if (env.NODE_ENV === 'production') return { mode: 'same-origin' };
  const configured = parseOrigins(env[DEV_CORS_ORIGINS_VAR]);
  // An explicitly empty DEV_CORS_ORIGINS means "no cross-origin access", which
  // is a legitimate choice and must not silently fall back to the defaults.
  if (configured !== null) {
    return configured.length === 0
      ? { mode: 'same-origin' }
      : { mode: 'allowlist', origins: configured };
  }
  return { mode: 'allowlist', origins: [...DEFAULT_DEV_ORIGINS] };
}

/** True when a request carrying this Origin should be permitted. */
export function isOriginAllowed(policy: CorsPolicy, origin: string | undefined): boolean {
  // No Origin header: same-origin navigation, curl, or a server-to-server call.
  // CORS does not apply, and refusing these would break the health check.
  if (origin === undefined) return true;
  if (policy.mode === 'same-origin') return false;
  return policy.origins.includes(origin);
}

/**
 * Returns cors options, or null when no CORS middleware should be mounted at
 * all. Null is the production posture: same-origin only, no headers emitted.
 */
export function buildCorsOptions(policy: CorsPolicy): CorsOptions | null {
  if (policy.mode === 'same-origin') return null;
  return {
    origin(origin, callback) {
      if (isOriginAllowed(policy, origin)) {
        callback(null, true);
        return;
      }
      // Refuse by withholding the header rather than throwing: the browser
      // enforces the block, and the server does not emit a 500 for it.
      callback(null, false);
    },
    credentials: false,
  };
}

export function describeCorsPolicy(policy: CorsPolicy): string {
  return policy.mode === 'same-origin'
    ? 'CORS: same-origin only (no cross-origin headers emitted)'
    : `CORS: allowlist [${policy.origins.join(', ')}]`;
}

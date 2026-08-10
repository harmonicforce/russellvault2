// The deterministic identity the browser gate signs in as.
//
// WHY THIS IS NOT A WEAKENING OF PRODUCTION AUTHENTICATION
//
// Nothing here is a bypass. The application under test is the REAL production
// build, running the REAL `AuthShell`, which resolves its configuration, builds
// a REAL `@supabase/supabase-js` client, and asks that client for a session
// exactly as it does in production. There is no test mode, no injected
// provider, no auth flag, and no branch in application code that this harness
// can reach.
//
// What the harness does is narrower and entirely outside the application: it
// seeds the browser's own `localStorage` with a session object — the same thing
// a real sign-in would have written — and it answers the resulting network
// requests. That is the browser's storage and the browser's network, not the
// app's logic. A production deployment is unaffected because a production
// browser has neither this storage seed nor this network interception, and
// `AuthShell` would resolve `signed-out` and render the sign-in form.
//
// The Supabase origin below deliberately does not exist. Every request to it is
// fulfilled by the harness, so a fixture gap fails loudly as an unroutable
// request instead of silently reaching something real.

export const SUPABASE_URL = 'https://browsergate.supabase.co';
export const SUPABASE_ANON_KEY = 'browser-gate-anon-key-not-a-credential';

/** `sb-${hostname.split('.')[0]}-auth-token`, matching supabase-js. */
export const SUPABASE_STORAGE_KEY = 'sb-browsergate-auth-token';

export const USER_ID = '3f7c1d92-0000-4000-8000-00000000a001';
export const USER_EMAIL = 'operator@russellvault.test';
export const WORKSPACE_ID = '3f7c1d92-0000-4000-8000-00000000b001';
export const WORKSPACE_NAME = 'Russell Vault';
export const SKU_PREFIX = 'RV';

/**
 * A far-future expiry so supabase-js never decides the session needs
 * refreshing mid-test. A refresh is not forbidden — the harness answers it —
 * but a token that expires during a run would make screenshots depend on wall
 * clock time.
 */
export const SESSION_EXPIRES_AT = 4102444800; // 2100-01-01T00:00:00Z

export function storedSession() {
  return {
    access_token: 'browser-gate-access-token',
    token_type: 'bearer',
    expires_in: 315360000,
    expires_at: SESSION_EXPIRES_AT,
    refresh_token: 'browser-gate-refresh-token',
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      phone: '',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      is_anonymous: false,
    },
  };
}

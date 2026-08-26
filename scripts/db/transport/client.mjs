// Transport-boundary client for the governed receiving RPCs.
//
// WHY THIS EXISTS
//
// The pgTAP suite calls governed functions positionally from SQL. That proves
// their SEMANTICS and nothing about their DISPATCHABILITY. ESC-002 was exactly
// that gap: three receiving functions were declared with unnamed parameters, so
// PostgREST — which resolves an RPC by matching a JSON body's keys to parameter
// NAMES — could not call them at all, while 2,673 pgTAP assertions stayed green.
//
// So this module speaks the membrane the server actually speaks: HTTP, to real
// PostgREST, with a named JSON body. Nothing here re-implements or approximates
// PostgREST's resolution rules; the rules are exercised by running the real
// thing and reading what it answers.
//
// AUTHORITY
//
// Callers are authenticated exactly as a browser user is: a JWT signed with the
// stack's JWT secret carrying `role: authenticated` and the user's id in `sub`.
// There is deliberately NO service-role client here. A service-role key would
// bypass RLS and could make an unauthorized call look successful, which would
// defeat the authorization assertions this suite exists to make.
//
// The `apikey` header carries the ANON key. That is the public gateway
// identifier every browser sends; it grants nothing on its own.

import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** Env overrides, so the suite runs against any PostgREST, not just the CLI stack. */
const ENV = {
  apiUrl: 'RV_TRANSPORT_API_URL',
  anonKey: 'RV_TRANSPORT_ANON_KEY',
  jwtSecret: 'RV_TRANSPORT_JWT_SECRET',
  dbUrl: 'RV_TRANSPORT_DB_URL',
  // Explicit REST base, for a PostgREST that is not behind the Supabase
  // gateway and therefore serves /rpc at its own root.
  restBase: 'RV_TRANSPORT_REST_BASE',
};

function fromSupabaseStatus() {
  // `supabase status -o env` is the CLI's own contract for reporting a running
  // local stack. Reading it beats hard-coding the well-known dev key, which
  // would silently rot the day the CLI changes it.
  const pinned = execFileSync('cat', ['supabase/cli-version'], { encoding: 'utf8' }).trim();
  const out = execFileSync('npx', ['--yes', `supabase@${pinned}`, 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const values = {};
  for (const line of out.split('\n')) {
    const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function resolveConfig(env = process.env) {
  const direct = {
    apiUrl: env[ENV.apiUrl],
    anonKey: env[ENV.anonKey],
    jwtSecret: env[ENV.jwtSecret],
    dbUrl: env[ENV.dbUrl],
    restBase: env[ENV.restBase],
  };
  if ((direct.apiUrl || direct.restBase) && direct.jwtSecret) return direct;

  const status = fromSupabaseStatus();
  return {
    apiUrl: direct.apiUrl ?? status.API_URL,
    anonKey: direct.anonKey ?? status.ANON_KEY,
    jwtSecret: direct.jwtSecret ?? status.JWT_SECRET,
    dbUrl: direct.dbUrl ?? status.DB_URL,
    restBase: direct.restBase,
  };
}

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A caller token, minted the same way the auth server mints one.
 *
 * `sub` is the governed user id; `role` is the PostgREST role the token
 * switches into. Nothing here can grant more than that user's memberships,
 * because authorization is resolved inside the governed function against
 * workspace_members under this very identity.
 */
export function mintToken(secret, userId, { role = 'authenticated', ttlSeconds = 3600 } = {}) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    role,
    sub: userId,
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * The REST base.
 *
 * Behind the Supabase gateway PostgREST is mounted at /rest/v1, which is what
 * the CLI's API_URL points at the root of. A standalone PostgREST serves /rpc
 * from its own root instead, so an explicit base wins outright rather than
 * having the gateway path guessed onto it.
 */
export function restBase(config) {
  if (typeof config === 'string') return restBase({ apiUrl: config });
  if (config.restBase) return config.restBase.replace(/\/+$/, '');
  const trimmed = String(config.apiUrl).replace(/\/+$/, '');
  return trimmed.endsWith('/rest/v1') ? trimmed : `${trimmed}/rest/v1`;
}

/**
 * One RPC call over the real transport.
 *
 * Returns the status and parsed body rather than throwing, because the failure
 * SHAPE is the evidence in most of these tests: a PGRST202 at 404 means the
 * function could not be resolved, while a 42501 at 403 means it was resolved
 * and then refused the caller. Collapsing both into an exception would erase
 * the distinction ESC-002 turned on.
 */
export async function rpc(config, { fn, body, token, headers = {} }) {
  const response = await fetch(`${restBase(config)}/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.anonKey ? { apikey: config.anonKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

// Browser-test environment contract.
//
// Every value is required and none has a default. A default here would be a
// URL or key that points *somewhere*, and the one thing these tests must never
// do is run against a real project. Missing configuration fails the run with a
// message naming what is missing, rather than silently falling back.
//
// There is no service-role key in this file, in the fixtures, or anywhere in
// the suite. The harness signs up an ordinary user and does everything through
// the anon key under that user's own session — the same authorization path an
// operator uses — so a browser test cannot pass by way of privileges the real
// application does not have.

export interface E2eEnv {
  /** Local Supabase API root, e.g. http://127.0.0.1:54321 */
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  /** Where the client is served, e.g. http://127.0.0.1:5173 */
  readonly appUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is not set. The browser suite runs only against a local Supabase ` +
      `stack and a locally served client; it has no defaults, because a default ` +
      `would point somewhere. Start the stack and export the four VITE_/E2E_ ` +
      `variables (see e2e/README.md).`
    );
  }
  return value.trim();
}

/**
 * A local stack, and only a local stack. A hosted Supabase URL reaching this
 * suite would mean the tests are about to create users and inventory in a real
 * project, so it is refused outright rather than trusted to behave.
 */
function assertLocal(url: string): string {
  const host = new URL(url).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.localhost');
  if (!isLocal) {
    throw new Error(
      `Refusing to run the browser suite against ${url}. These tests sign up ` +
      `users and create inventory; they are only ever pointed at a local stack.`
    );
  }
  return url;
}

export function e2eEnv(): E2eEnv {
  return {
    supabaseUrl: assertLocal(required('VITE_SUPABASE_URL')),
    supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY'),
    appUrl: assertLocal(process.env.E2E_APP_URL?.trim() || 'http://127.0.0.1:5173'),
  };
}

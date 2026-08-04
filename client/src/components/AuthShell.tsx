import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, Mail, ServerCrash, ShieldX, UserPlus, Vault } from 'lucide-react';
import { createAuthShellController, type AuthShellController, type AuthShellState } from '../lib/authShell';
import { createShadowClient, createShadowSupabaseClient } from '../lib/supabaseShadow';
import { WorkspaceProvider } from '../lib/workspaceContext';
import { describeMisconfiguration, resolveAppConfig, type AppConfigState, type EnvLike } from '../lib/appConfig';

/**
 * The gate in front of the whole application.
 *
 * Three outcomes, resolved from configuration BEFORE any client is constructed
 * or any request is made:
 *
 *   governed       Supabase Auth plus a workspace-membership check, then the
 *                  governed application.
 *   legacy-only    No governed configuration at all. Renders the legacy app,
 *                  which the status banner labels as legacy-only and
 *                  non-authoritative.
 *   misconfigured  Some governed configuration present, contract unsatisfied.
 *                  Fails closed with a configuration-error screen.
 *
 * The last one is the point of this component's rewrite. A partial governed
 * configuration used to resolve to `null` and fall through to the legacy
 * application — so one dropped variable silently downgraded a governed
 * deployment into an unauthenticated legacy one. It no longer can.
 */
export default function AuthShell({
  children,
  env = import.meta.env as unknown as EnvLike,
}: {
  children: ReactNode;
  /** Injectable so tests can drive each configuration state. */
  env?: EnvLike;
}) {
  const config = useMemo(() => resolveAppConfig(env), [env]);

  // Resolved before the governed shell mounts, so a misconfigured deployment
  // constructs no Supabase client and issues no request of any kind.
  if (config.mode === 'misconfigured') {
    return <ConfigurationErrorPanel state={config} />;
  }
  if (config.mode === 'legacy-only') {
    return <>{children}</>;
  }
  return <GovernedAuthShell env={env}>{children}</GovernedAuthShell>;
}

function ConfigurationErrorPanel({
  state,
}: {
  state: Extract<AppConfigState, { mode: 'misconfigured' }>;
}) {
  // Field NAMES only. Two of the four carry a project URL and an anon key, so
  // no value is ever rendered here.
  return (
    <div
      role="alert"
      className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-ink"
    >
      <ServerCrash className="h-8 w-8 text-critical" />
      <p className="text-sm font-semibold">Configuration incomplete</p>
      <p className="max-w-md text-center text-xs text-ink-secondary">
        This deployment has partial governed configuration, so it cannot reach governed inventory
        data. It will not fall back to the legacy application, because that would silently serve
        unauthenticated, non-authoritative data instead.
      </p>
      <p className="max-w-md text-center text-xs text-ink-muted">
        Set the variables below and redeploy. Values are never shown here.
      </p>
      <code className="max-w-md rounded border border-hairline bg-surface-1 px-3 py-2 text-center text-xs">
        {describeMisconfiguration(state)}
      </code>
    </div>
  );
}

function GovernedAuthShell({ children, env }: { children: ReactNode; env: EnvLike }) {
  const [state, setState] = useState<AuthShellState>({ kind: 'loading' });
  const controller = useMemo(
    () => createAuthShellController(createShadowClient(env), setState),
    [env]
  );
  const wideClient = useMemo(() => createShadowSupabaseClient(env), [env]);

  useEffect(() => {
    controller.initialize();
  }, [controller]);

  // Supabase redirects a failed email-confirmation or password-reset link
  // back here with the failure in the URL hash (e.g. an expired link). Read
  // it once and clear it from the URL so it never reappears on refresh.
  const [urlAuthError, setUrlAuthError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.includes('error_description')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const description = params.get('error_description');
    if (description) {
      setUrlAuthError(decodeURIComponent(description.replace(/\+/g, ' ')));
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  // Unreachable in governed mode — the resolver already established that the
  // configuration is complete — but the controller's state machine still models
  // it, so it is handled rather than falling through to a sign-in form.
  if (state.kind === 'config-absent') {
    return <>{children}</>;
  }

  if (state.kind === 'member') {
    if (!wideClient) return <>{children}</>;
    return (
      <WorkspaceProvider
        client={wideClient}
        email={state.email}
        userId={state.userId}
        memberships={state.memberships}
        onSignOut={() => controller.signOut()}
      >
        {children}
      </WorkspaceProvider>
    );
  }

  if (state.kind === 'loading') {
    return (
      <Panel>
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-sm text-ink-secondary">Checking access…</p>
      </Panel>
    );
  }

  if (state.kind === 'awaiting-confirmation') {
    return (
      <Panel>
        <Mail className="h-8 w-8 text-accent" />
        <p className="text-sm font-medium">Confirm your email</p>
        <p className="max-w-xs text-center text-xs text-ink-muted">
          A confirmation link was sent to {state.email}. Click it, then come back and sign in.
        </p>
        <button
          type="button"
          onClick={() => controller.signOut()}
          className="rounded-lg border border-hairline px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Back to sign in
        </button>
      </Panel>
    );
  }

  if (state.kind === 'password-reset-sent') {
    return (
      <Panel>
        <Mail className="h-8 w-8 text-accent" />
        <p className="text-sm font-medium">Check your email</p>
        <p className="max-w-xs text-center text-xs text-ink-muted">
          If an account exists for {state.email}, a password reset link was sent. Click it to choose a new password.
        </p>
        <button
          type="button"
          onClick={() => controller.signOut()}
          className="rounded-lg border border-hairline px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Back to sign in
        </button>
      </Panel>
    );
  }

  if (state.kind === 'no-membership') {
    return <CreateWorkspacePanel email={state.email} error={state.error} controller={controller} />;
  }

  return <AuthForm error={state.error ?? urlAuthError ?? undefined} controller={controller} />;
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface-0 text-ink">
      {children}
    </div>
  );
}

function CreateWorkspacePanel({
  email,
  error,
  controller,
}: {
  email: string | null;
  error?: string;
  controller: AuthShellController;
}) {
  const [name, setName] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    controller.createWorkspace(name);
  };

  return (
    <Panel>
      <ShieldX className="h-8 w-8 text-critical" />
      <p className="text-sm font-medium">No workspace access</p>
      <p className="max-w-xs text-center text-xs text-ink-muted">
        {email ?? 'This account'} is signed in but has no workspace membership. Ask an existing
        workspace owner for access, or create a new workspace below.
      </p>
      <form onSubmit={handleSubmit} className="flex w-72 flex-col gap-2">
        <label className="text-xs text-ink-muted" htmlFor="new-workspace-name">Workspace name</label>
        <input
          id="new-workspace-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-critical">{error}</p>}
        <button
          type="submit"
          className="mt-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Create workspace
        </button>
      </form>
      <button
        type="button"
        onClick={() => controller.signOut()}
        className="rounded-lg border border-hairline px-3 py-1.5 text-sm hover:bg-surface-2"
      >
        Sign out
      </button>
    </Panel>
  );
}

// Supabase's own sign-up error text for a duplicate email varies slightly by
// version ("User already registered" / "already registered"); match loosely
// rather than a single exact string, and never invent a different message
// for anything else.
function friendlyAuthError(mode: 'sign-in' | 'sign-up', error?: string): string | null {
  if (!error) return null;
  if (mode === 'sign-up' && /already registered|already exists/i.test(error)) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  return error;
}

function AuthForm({ error, controller }: { error?: string; controller: AuthShellController }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'forgot-password'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'sign-in') controller.signIn(email, password);
    else if (mode === 'sign-up') controller.signUp(email, password);
    else controller.forgotPassword(email);
  };

  if (mode === 'forgot-password') {
    return (
      <Panel>
        <div className="flex items-center gap-2">
          <Vault className="h-6 w-6 text-accent" />
          <span className="font-semibold">The Russell Vault</span>
        </div>
        <form onSubmit={handleSubmit} className="flex w-72 flex-col gap-2">
          <label className="text-xs text-ink-muted" htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-critical">{error}</p>}
          <button
            type="submit"
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Mail className="h-4 w-4" /> Send reset link
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode('sign-in')}
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Back to sign in
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <Vault className="h-6 w-6 text-accent" />
        <span className="font-semibold">The Russell Vault</span>
      </div>
      <form onSubmit={handleSubmit} className="flex w-72 flex-col gap-2">
        <label className="text-xs text-ink-muted" htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
        />
        <label className="text-xs text-ink-muted" htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          required
          minLength={mode === 'sign-up' ? 6 : undefined}
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
        />
        {mode === 'sign-up' && (
          <p className="text-xs text-ink-muted">At least 6 characters.</p>
        )}
        {mode === 'sign-in' && (
          <button
            type="button"
            onClick={() => setMode('forgot-password')}
            className="self-end text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Forgot password?
          </button>
        )}
        {error && <p className="text-xs text-critical">{friendlyAuthError(mode, error)}</p>}
        <button
          type="submit"
          className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {mode === 'sign-in' ? <Lock className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        {mode === 'sign-in' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </Panel>
  );
}

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, Mail, ShieldX, UserPlus, Vault } from 'lucide-react';
import { createAuthShellController, type AuthShellController, type AuthShellState } from '../lib/authShell';
import { createShadowClient } from '../lib/supabaseShadow';

// Phase 2 shadow auth shell. With no Supabase configuration (the deployed
// default) it renders its children untouched — the legacy SQLite app. With
// VITE_SHADOW_AUTH=supabase plus URL and anon key it gates the UI behind
// Supabase Auth and a workspace-membership check. It never reads or writes
// business data.
export default function AuthShell({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthShellState>({ kind: 'loading' });
  const controller = useMemo(
    () => createAuthShellController(createShadowClient(import.meta.env), setState),
    []
  );

  useEffect(() => {
    controller.initialize();
  }, [controller]);

  if (state.kind === 'config-absent' || state.kind === 'member') {
    return <>{children}</>;
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

  if (state.kind === 'no-membership') {
    return <CreateWorkspacePanel email={state.email} error={state.error} controller={controller} />;
  }

  return <AuthForm error={state.error} controller={controller} />;
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

function AuthForm({ error, controller }: { error?: string; controller: AuthShellController }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'sign-in') controller.signIn(email, password);
    else controller.signUp(email, password);
  };

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
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-critical">{error}</p>}
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

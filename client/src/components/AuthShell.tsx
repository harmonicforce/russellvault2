import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, ShieldX, Vault } from 'lucide-react';
import { createAuthShellController, type AuthShellState } from '../lib/authShell';
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

  if (state.kind === 'no-membership') {
    return (
      <Panel>
        <ShieldX className="h-8 w-8 text-critical" />
        <p className="text-sm font-medium">No workspace access</p>
        <p className="max-w-xs text-center text-xs text-ink-muted">
          {state.email ?? 'This account'} is signed in but has no workspace membership. Ask a
          workspace owner for access.
        </p>
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

  return <LoginForm error={state.error} onSubmit={(email, password) => controller.signIn(email, password)} />;
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface-0 text-ink">
      {children}
    </div>
  );
}

function LoginForm({
  error,
  onSubmit,
}: {
  error?: string;
  onSubmit: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(email, password);
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-critical">{error}</p>}
        <button
          type="submit"
          className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Lock className="h-4 w-4" />
          Sign in
        </button>
      </form>
    </Panel>
  );
}

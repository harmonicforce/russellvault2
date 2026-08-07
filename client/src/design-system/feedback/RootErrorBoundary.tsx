import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last line of defence against a blank screen.
 *
 * This catches ONE thing: a React render exception — a component that threw
 * while rendering. It is deliberately NOT a general error surface:
 *
 *   - a network failure is the transport's to report;
 *   - a governed dependency failure is the domain component's to report;
 *   - an authorization failure is the domain component's to report.
 *
 * Those are answers about the business; this is an answer about the
 * application itself failing to draw. Conflating them would let a routine
 * "dependency unavailable" render as "the app broke", which trains operators
 * to ignore both.
 *
 * A real error boundary must be a class component: there is no hook form of
 * componentDidCatch. That is the only reason this is not a function.
 */
interface Props {
  readonly children: ReactNode;
  /** Test/diagnostic seam. Production passes nothing and gets console. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  /** Recovery action. Defaults to a full reload. */
  readonly onReload?: () => void;
}

interface State {
  readonly failed: boolean;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Reported for diagnosis, never rendered. The operator gets language they
    // can act on; the stack goes where engineers look.
    if (this.props.onError) this.props.onError(error, info);
    else console.error('Russell Vault render failure', error, info);
  }

  private handleReload = (): void => {
    if (this.props.onReload) this.props.onReload();
    else if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
        <div className="max-w-md rounded-instrument border border-critical/50 bg-surface-raised p-5">
          <h1 className="font-display text-xl font-semibold text-ink">Russell Vault could not display this screen</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            The application failed while drawing this page. This is a fault in the interface, not a change to your
            records — nothing has been saved or altered by it.
          </p>
          <p className="mt-2 text-sm text-ink-secondary">
            Reloading usually clears it. If it keeps happening, report it before continuing with this workflow.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Reload Russell Vault
          </button>
        </div>
      </div>
    );
  }
}

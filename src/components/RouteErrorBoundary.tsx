import { Component, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render / lazy-chunk errors anywhere inside the routes so one bad
 * page can never black-screen the whole app. Chunk-load failures usually
 * mean the browser is holding a stale build — reload once automatically.
 * The error message is shown on screen (never silently swallowed) so it can
 * be reported and fixed.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    const msg = String((error && error.message) || error);
    const isChunkError =
      /loading chunk|dynamically imported module|importing a module script failed|failed to fetch/i.test(
        msg
      );
    const KEY = "ug-chunk-reload-v1";
    if (isChunkError && !sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, "1");
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      const msg = String((this.state.error && this.state.error.message) || this.state.error);
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="glass rounded-2xl border border-border p-6 max-w-md w-full text-center space-y-3">
            <p className="text-3xl">⚠️</p>
            <p className="font-display font-semibold">This page could not be loaded</p>
            <p className="text-xs text-muted-foreground break-words">{msg}</p>
            <div className="flex gap-2 justify-center pt-1">
              <button
                onClick={() => window.location.reload()}
                className="text-xs font-medium px-4 py-2 rounded-xl gradient-primary text-primary-foreground"
              >
                Try Again
              </button>
              <a
                href="/"
                className="text-xs font-medium px-4 py-2 rounded-xl border border-border"
              >
                Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;

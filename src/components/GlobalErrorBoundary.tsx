import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/20/solid";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Outermost safety net (wraps the router in main.tsx and the whole app in
 * App.tsx). It renders outside the router, so it uses plain buttons rather
 * than links. Technical details appear only in development builds; the
 * production screen shows no error text, which could contain patient data.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Error messages can embed record data, so production logs carry only
    // the error's name.
    console.error(
      "GlobalErrorBoundary caught error:",
      error instanceof Error ? error.name : error,
    );

    this.setState({ error, errorInfo });

    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, {
        contexts: { react: { componentStack: errorInfo.componentStack } },
        tags: { source: "GlobalErrorBoundary" },
      });
    }

    if (import.meta.env.DEV) {
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    }
  }

  handleRestart = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo } = this.state;

      return (
        <main className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8">
          <div
            className="panel w-full max-w-lg p-6"
            role="alert"
            aria-labelledby="global-error-title"
          >
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className="h-6 w-6 shrink-0 text-danger mt-1"
                aria-hidden
              />
              <div className="min-w-0">
                <h1 id="global-error-title" className="text-h1 text-ink">
                  Something went wrong
                </h1>
                <p className="mt-2 text-body text-ink-secondary">
                  The app hit an unexpected error and stopped this screen.
                  Records that were already saved are still stored on this
                  device. Anything you were typing on this screen may not have
                  been saved.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-line bg-surface-sunken p-4">
              <p className="section-label mb-2">What to do next</p>
              <ol className="list-decimal space-y-1 pl-5 text-body text-ink-secondary">
                <li>Choose Try again to reopen the screen.</li>
                <li>
                  If the error comes back, choose Reload the app. This fixes
                  most problems.
                </li>
                <li>
                  If it keeps happening, tell your site administrator what you
                  were doing when it appeared.
                </li>
              </ol>
            </div>

            {import.meta.env.DEV && error && (
              <details className="mt-4 rounded-md border border-danger-line bg-danger-soft p-3">
                <summary className="cursor-pointer text-label text-danger-fg">
                  Technical details (development build only)
                </summary>
                <p className="mt-2 font-mono text-caption text-danger-fg break-words">
                  {error.name}: {error.message}
                </p>
                {error.stack && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-caption text-danger-fg">
                    {error.stack}
                  </pre>
                )}
                {errorInfo?.componentStack && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-caption text-ink-secondary">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-secondary"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleRestart}
                className="btn-primary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                Reload the app
              </button>
            </div>

            {!import.meta.env.DEV && (
              <p className="mt-4 text-caption text-ink-muted">
                Changes waiting to sync stay on this device and are not lost by
                reloading.
              </p>
            )}
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

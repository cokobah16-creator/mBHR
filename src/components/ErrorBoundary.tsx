import React, { Component, ErrorInfo, ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import * as Sentry from "@sentry/react";
import { can } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { DeviceResetPanel } from "@/components/DeviceResetPanel";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  isClearing: boolean;
  showErase: boolean;
}

function errorName(e: unknown): unknown {
  return e instanceof Error ? e.name : e;
}

/**
 * Removes what a stale deployment leaves behind: service workers that keep
 * serving an old bundle, the Cache Storage they fill, and per-tab session
 * state. Patient records (IndexedDB), the staff sign-in and the queue of
 * changes waiting to sync (localStorage) are left alone: this used to delete
 * them too, which let anyone who hit an error erase unsynced records. Erasing
 * them now needs an administrator PIN, through DeviceResetPanel.
 */
async function clearAppCache(): Promise<void> {
  try {
    sessionStorage.clear();
  } catch (e) {
    console.error("sessionStorage.clear failed:", errorName(e));
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.error("serviceWorker unregister failed:", errorName(e));
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.error("caches.delete failed:", errorName(e));
  }
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isClearing: false,
    showErase: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // logger.captureError would print the whole error to the console, and
    // error messages can embed record data, so log the name only. Sentry
    // reporting is unchanged (see beforeSend in main.tsx).
    console.error("[ErrorBoundary] caught error:", errorName(error));
    try {
      Sentry.captureException(error, {
        tags: { source: "ErrorBoundary" },
        extra: { componentStack: errorInfo.componentStack },
      });
    } catch {
      // Sentry not initialised or its transport failed.
    }
  }

  private handleClearAndReload = async () => {
    this.setState({ isClearing: true });
    await clearAppCache();
    window.location.replace("/");
  };

  public render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const { isClearing, showErase } = this.state;
      // Device reset stays reachable only by a signed-in administrator (as on
      // admin Settings), and DeviceResetPanel asks for their PIN again.
      const user = useAuthStore.getState().currentUser;
      const canResetDevice = !!user && can(user.role, "users");

      return (
        <main className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8">
          <div
            className="panel w-full max-w-lg p-6"
            role="alert"
            aria-labelledby="error-boundary-title"
          >
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className="h-6 w-6 shrink-0 text-danger mt-1"
                aria-hidden
              />
              <div className="min-w-0">
                <h1 id="error-boundary-title" className="text-h1 text-ink">
                  Something went wrong
                </h1>
                <p className="mt-2 text-body text-ink-secondary">
                  This screen stopped because of an error in the app. Records
                  that were already saved are still stored on this device.
                  Anything you were typing on this screen may not have been
                  saved.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-line bg-surface-sunken p-4">
              <p className="section-label mb-2">What to do next</p>
              <ol className="list-decimal space-y-1 pl-5 text-body text-ink-secondary">
                <li>Reload the page. This fixes most problems.</li>
                <li>
                  If the error comes back, clear the app cache. This removes
                  old app files left over from an update. Patient records and
                  changes waiting to sync stay on this device.
                </li>
                <li>
                  If it still happens, tell your site administrator what you
                  were doing when it appeared.
                </li>
              </ol>
            </div>

            {import.meta.env.DEV && err && (
              <details className="mt-4 rounded-md border border-danger-line bg-danger-soft p-3">
                <summary className="cursor-pointer text-label text-danger-fg">
                  Technical details (development build only)
                </summary>
                <p className="mt-2 font-mono text-caption text-danger-fg break-words">
                  {`${err.name || "Error"}: ${err.message || "Unknown error"}`}
                </p>
                {err.stack && (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-caption text-danger-fg">
                    {err.stack}
                  </pre>
                )}
              </details>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={this.handleClearAndReload}
                className="btn-secondary"
                disabled={isClearing}
              >
                {isClearing ? "Clearing app cache…" : "Clear app cache and reload"}
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-primary"
                disabled={isClearing}
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                Reload page
              </button>
            </div>

            {canResetDevice && (
              <div className="mt-6 border-t border-line pt-4">
                <button
                  type="button"
                  className="btn-ghost -ml-3 text-label"
                  aria-expanded={showErase}
                  aria-controls="error-boundary-erase"
                  onClick={() => this.setState({ showErase: !showErase })}
                >
                  {showErase
                    ? "Hide device reset"
                    : "Still broken? Reset this device"}
                </button>
                {showErase && (
                  <div id="error-boundary-erase" className="mt-3">
                    <DeviceResetPanel />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  isClearing: boolean;
}

async function clearAllClientState(): Promise<void> {
  try {
    localStorage.clear();
  } catch (e) {
    console.error("localStorage.clear failed:", e);
  }
  try {
    sessionStorage.clear();
  } catch (e) {
    console.error("sessionStorage.clear failed:", e);
  }

  // Unregister service workers so a stale SW can't keep serving an old bundle.
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.error("serviceWorker unregister failed:", e);
  }

  // Clear Cache Storage (workbox precache, etc.)
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.error("caches.delete failed:", e);
  }

  // Drop all IndexedDB databases (Dexie + others). databases() is unsupported
  // on Safari < 17, so fall back to a known list.
  try {
    const idb = window.indexedDB;
    if (idb) {
      const dbNames: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idbAny = idb as any;
      if (typeof idbAny.databases === "function") {
        const list = await idbAny.databases();
        for (const d of list) if (d?.name) dbNames.push(d.name);
      } else {
        dbNames.push("mbhr_v5", "keyval-store");
      }
      await Promise.all(
        dbNames.map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = idb.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
      );
    }
  } catch (e) {
    console.error("indexedDB delete failed:", e);
  }
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isClearing: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleClearAndReload = async () => {
    this.setState({ isClearing: true });
    await clearAllClientState();
    window.location.replace("/");
  };

  public render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const errorText = err
        ? `${err.name || "Error"}: ${err.message || "Unknown error"}`
        : "Unknown error";

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                Something went wrong
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                An unexpected error occurred. Try refreshing the page. If the
                problem persists, clear cached data to recover from a stale
                deployment.
              </p>

              <p className="mt-3 text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded px-3 py-2 break-words">
                {errorText}
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="btn-primary"
                  disabled={this.state.isClearing}
                >
                  Refresh Page
                </button>
                <button
                  onClick={this.handleClearAndReload}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                  disabled={this.state.isClearing}
                >
                  {this.state.isClearing
                    ? "Clearing…"
                    : "Clear cached data & reload"}
                </button>
              </div>

              {import.meta.env.DEV && err?.stack && (
                <details className="mt-4 text-left">
                  <summary className="text-sm text-gray-600 cursor-pointer">
                    Stack trace
                  </summary>
                  <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto">
                    {err.stack}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

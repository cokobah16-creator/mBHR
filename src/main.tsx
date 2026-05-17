// src/main.tsx
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import * as Sentry from "@sentry/react";
import App from "./App";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
import i18n from "./i18n";
import "./index.css";

import { seed } from "./db/seed";
import { seedGamificationData } from "./db/gamification";
import { db } from "./db/index";
import { safeOpenDb } from "./db/safeOpen";
import { log, error, captureError } from "@/lib/logger";
import { runMigrations } from "@/db/migrations/migration-runner";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: import.meta.env.MODE === "production" ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event, _hint) {
      if (import.meta.env.MODE !== "production") {
        console.log("Sentry event:", event);
      }
      return event;
    },
  });
}

// Safari Private Browsing (and some locked-down WebViews) throw
// "SecurityError: The operation is insecure." from the WebSocket constructor.
// Supabase realtime sometimes surfaces this as an async unhandled error after
// our sync try/catch returns. Swallow it here so the React tree doesn't crash.
function isWebSocketSecurityError(reason: unknown): boolean {
  if (!reason) return false;
  const msg =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String((reason as { message?: unknown })?.message ?? "");
  return (
    msg.includes("WebSocket not available") ||
    msg.includes("The operation is insecure") ||
    (msg.includes("SecurityError") && msg.toLowerCase().includes("websocket"))
  );
}

window.addEventListener("error", (ev) => {
  if (
    isWebSocketSecurityError(ev.error) ||
    isWebSocketSecurityError(ev.message)
  ) {
    console.warn("[realtime] WebSocket unavailable, live updates disabled");
    ev.preventDefault();
    return;
  }
  captureError(ev.error ?? new Error(String(ev.message)), {
    tag: "window.error",
    extra: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
  });
});
window.addEventListener("unhandledrejection", (ev) => {
  if (isWebSocketSecurityError(ev.reason)) {
    console.warn("[realtime] WebSocket unavailable, live updates disabled");
    ev.preventDefault();
    return;
  }
  captureError(ev.reason, { tag: "window.unhandledrejection" });
});

function renderFatal(msg: string) {
  const el = document.getElementById("root");
  if (!el) return;

  const container = document.createElement("div");
  container.style.cssText =
    "font-family:system-ui;padding:24px;max-width:720px;margin:40px auto";

  const h1 = document.createElement("h1");
  h1.style.cssText = "margin:0 0 12px;color:#0A7A3B";
  h1.textContent = "Med Bridge Health Reach";

  const h2 = document.createElement("h2");
  h2.style.cssText = "margin:0 0 16px";
  h2.textContent = "Startup error";

  const p1 = document.createElement("p");
  p1.style.cssText = "margin:0 0 8px";
  p1.textContent = msg;

  const p2 = document.createElement("p");
  p2.style.color = "#555";
  p2.textContent = "Open the browser console for details.";

  container.append(h1, h2, p1, p2);
  el.textContent = "";
  el.appendChild(container);
}

(async () => {
  try {
    log("[db] opening…");
    await safeOpenDb();
    log("[db] opened OK");

    log("[migrations] checking for pending migrations…");
    await runMigrations();
    log("[migrations] complete");

    // Check if database is working
    const patientCount = await db.patients.count();
    const userCount = await db.users.count();
    log("[db] Current counts - Patients:", patientCount, "Users:", userCount);
  } catch (e) {
    error("Failed to initialize database:", e);
    renderFatal("Could not open the local database.");
    return;
  }

  try {
    log("[seed] starting…");
    await seed();
    await seedGamificationData();
    log("[seed] done");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    error("[seed] failed", e);
    // Don't fail the app if seeding fails, just log it
    log("Seeding failed but continuing with app startup");
  }

  log("Application fully initialized and rendered.");
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <GlobalErrorBoundary>
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600 text-lg">Loading mBHR...</p>
                </div>
              </div>
            }
          >
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </Suspense>
        </GlobalErrorBoundary>
      </I18nextProvider>
    </React.StrictMode>,
  );

  // Backup teardown: removes #nldr when React mounts, even if nigeria-loader.js
  // failed to execute. Uses MutationObserver so #nldr is only removed after
  // #root has children — preserving the 20-second failsafe UX if React throws
  // before mounting anything.
  const nldrEl = document.getElementById("nldr");
  const rootEl = document.getElementById("root");
  if (nldrEl && rootEl) {
    const obs = new MutationObserver(() => {
      if (rootEl.children.length) {
        nldrEl.classList.add("nldr-out");
        setTimeout(() => nldrEl.parentNode?.removeChild(nldrEl), 400);
        obs.disconnect();
      }
    });
    obs.observe(rootEl, { childList: true });
  }
})();

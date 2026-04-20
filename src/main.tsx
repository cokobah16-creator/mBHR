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
import { seedDemo } from "./db/seedMbhr";
import { seedGamificationData } from "./db/gamification";
import { db } from "./db/index";
import { safeOpenDb } from "./db/safeOpen";
import { log, error } from "@/lib/logger";
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

// Global error visibility
window.addEventListener("error", (ev) =>
  console.error("[global error]", ev.message, ev.error),
);
window.addEventListener("unhandledrejection", (ev) =>
  console.error("[unhandledrejection]", ev.reason),
);

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
    await seedDemo();
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
})();

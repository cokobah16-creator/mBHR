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
  if (el) {
    el.innerHTML = `
      <div style="font-family: system-ui; padding:24px; max-width:720px; margin:40px auto;">
        <h1 style="margin:0 0 12px;color:#0A7A3B;">Med Bridge Health Reach</h1>
        <h2 style="margin:0 0 16px;">Startup error</h2>
        <p style="margin:0 0 8px;">${msg}</p>
        <p style="color:#555">Open the browser console for details.</p>
      </div>
    `;
  }
}

(async () => {
  try {
    log("[db] opening…");
    await safeOpenDb();
    log("[db] opened OK");

    // Run database migrations (disabled until meta table exists)
    // log('[migrations] checking for pending migrations…')
    // await runMigrations()
    // log('[migrations] complete')

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

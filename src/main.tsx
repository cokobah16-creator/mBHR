// src/main.tsx
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import * as Sentry from "@sentry/react";
import App from "./App";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
import { AppUpdateBanner } from "./components/AppUpdateBanner";
import { DatabaseRecovery } from "./components/DatabaseRecovery";
import { ScreenSkeleton } from "./components/ui/Skeleton";
import i18n from "./i18n";
import "./index.css";

import { seed } from "./db/seed";
import { seedGamificationData } from "./db/gamification";
import { db } from "./db/index";
import { APP_DATABASES } from "./db/appDatabases";
import { closeOnVersionChange } from "./db/versionChange";
import { LocalDatabaseOpenError, safeOpenDb } from "./db/safeOpen";
import { log, error } from "@/lib/logger";
import { scrubUrl, scrubUrlFields } from "@/lib/scrubUrl";
import { registerServiceWorker } from "@/lib/serviceWorker";
import { requestPersistentStorage } from "@/lib/persistentStorage";
import { clearApiCaches } from "@/services/clearApiCaches";
import { runMigrations } from "@/db/migrations/migration-runner";

// Register the server-command handlers and sync participants at start-up,
// so background and reconnect syncs handle them before any page that uses
// them is opened. None of these may import a manual-chunk feature folder
// (src/test/startupChunks.test.ts).
import "@/services/portalAccess"; // set_patient_portal_access answers
import "@/sync/queueSync"; // queue tickets (also needed on a /display-only device)
import "@/sync/pharmacySync"; // "pharmacy" participant and rx_* commands
import "@/sync/staffRosterSync"; // staff directory on every sync

// URLs can carry secrets and patient details: a query string (a sign-in
// code, the contact details in an invitation link, the filters of a server
// request), a fragment (Supabase puts password-recovery access and refresh
// tokens in the hash) and record ids in the path. Error reports keep only
// the shape of the path (src/lib/scrubUrl.ts).
const BREADCRUMB_URL_FIELDS = ["url", "from", "to"];
const SPAN_URL_FIELDS = ["url", "http.url", "url.full"];

function scrubEventUrls(event: {
  request?: { url?: string; headers?: Record<string, unknown> };
  transaction?: string;
}): void {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  scrubUrlFields(event.request?.headers, ["Referer"]);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
}

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
    // Health data must never leave the device through error reporting.
    // Console output can contain patient records (e.g. duplicate-check
    // payloads), so console breadcrumbs are dropped entirely, and URLs are
    // reduced to the shape of their path.
    sendDefaultPii: false,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === "console") return null;
      // Click/input breadcrumbs describe the element with its aria-label or
      // title, which can name a patient or a medicine ("Update Amoxicillin",
      // "Change patient (currently …)"). Keep only the element type.
      if (breadcrumb.category === "ui.click" || breadcrumb.category === "ui.input") {
        if (breadcrumb.message) {
          breadcrumb.message = breadcrumb.message.replace(/\[[^\]]*\]/g, "");
        }
        if (breadcrumb.data) delete breadcrumb.data["ui.component_name"];
      }
      // Server requests (url) and page changes (from, to).
      scrubUrlFields(breadcrumb.data, BREADCRUMB_URL_FIELDS);
      return breadcrumb;
    },
    beforeSendTransaction(event) {
      scrubEventUrls(event);
      scrubUrlFields(event.contexts?.trace?.data, SPAN_URL_FIELDS);
      // Spans do not pass through beforeSend. A request span keeps the full
      // address of its server call, whose query string holds the search
      // filters (names, phone numbers).
      event.spans?.forEach((span) => {
        if (span.description && /^(http|resource)/.test(span.op ?? "")) {
          span.description = scrubUrl(span.description);
        }
        scrubUrlFields(span.data, SPAN_URL_FIELDS);
        if (span.data) {
          delete span.data["http.query"];
          delete span.data["http.fragment"];
        }
      });
      return event;
    },
    beforeSend(event, _hint) {
      scrubEventUrls(event);
      if (event.request) {
        delete event.request.query_string;
        delete event.request.data;
        delete event.request.cookies;
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      // Exception messages and extra context can embed record data (names,
      // phone numbers, notes, raw Supabase errors). Send only the error type
      // and stack; our own DUPLICATES_FOUND signal keeps its code.
      event.exception?.values?.forEach((v) => {
        v.value = v.value?.startsWith("DUPLICATES_FOUND") ? "DUPLICATES_FOUND" : v.type ?? "Error";
      });
      delete event.extra;
      if (event.message) event.message = "Message withheld (may contain patient data)";
      if (import.meta.env.MODE !== "production") {
        console.log("Sentry event:", event);
      }
      return event;
    },
  });
}

// Global error visibility + Sentry capture
window.addEventListener("error", (ev) => {
  // Full detail only in development: messages can carry patient data.
  if (import.meta.env.DEV) console.error("[global error]", ev.message, ev.error);
  else console.error("[global error]", ev.error instanceof Error ? ev.error.name : "Error");
  if (import.meta.env.VITE_SENTRY_DSN && ev.error instanceof Error) {
    Sentry.captureException(ev.error, { tags: { source: "window.error" } });
  }
});
window.addEventListener("unhandledrejection", (ev) => {
  if (import.meta.env.DEV) console.error("[unhandledrejection]", ev.reason);
  else console.error("[unhandledrejection]", ev.reason instanceof Error ? ev.reason.name : typeof ev.reason);
  if (import.meta.env.VITE_SENTRY_DSN) {
    const err =
      ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason));
    Sentry.captureException(err, { tags: { source: "unhandledrejection" } });
  }
});

// Offline start and app updates (src/lib/serviceWorker.ts). Registered
// before the local database opens, so the app's files are cached even if
// that fails.
registerServiceWorker();

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

/**
 * The local database would not open: a recovery screen instead of the app.
 * The stored records are never deleted automatically (src/db/safeOpen.ts).
 */
function renderDatabaseRecovery(upgradeFailed: boolean) {
  const el = document.getElementById("root");
  if (!el) return;
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <DatabaseRecovery upgradeFailed={upgradeFailed} />
    </React.StrictMode>,
  );
}

(async () => {
  // Unsynced records exist only on this device: ask the browser not to
  // clear them when space runs low. Neither call holds up start-up.
  void requestPersistentStorage().then((persistent) =>
    log("[storage] persistent:", persistent),
  );
  // Server answers that earlier versions of the app cached.
  void clearApiCaches();
  // When another window upgrades or erases a local database, this window
  // lets go of it and asks to be reloaded.
  closeOnVersionChange(APP_DATABASES);

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
    if (e instanceof LocalDatabaseOpenError) {
      renderDatabaseRecovery(e.upgradeFailed);
      return;
    }
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
            fallback={<ScreenSkeleton label="Loading mBHR" />}
          >
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </Suspense>
        </GlobalErrorBoundary>
        <AppUpdateBanner />
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

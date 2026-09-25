/**
 * Service worker registration and app updates.
 *
 * A new version of the app downloads in the background and then waits
 * (vite.config.ts turns skipWaiting off). AppUpdateBanner says it is ready,
 * and it takes over only when the person chooses to reload, so a deploy
 * never reloads the app, or swaps its files, while someone is entering a
 * record. Until then the window keeps the version it started with, whose
 * files the current service worker still serves.
 */
import { useAppUpdateStore } from "@/stores/appUpdate";
import * as logger from "@/lib/logger";

/** How often an open app looks for a new version while online. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Calls onReady when a new version is installed and waiting, now or later.
 * A first install is not an update: with no older version active, it takes
 * over by itself.
 */
export function watchForWaitingVersion(
  registration: ServiceWorkerRegistration,
  onReady: () => void,
): void {
  if (registration.waiting) onReady();
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && registration.active) onReady();
    });
  });
}

/**
 * Lets the waiting version take over, then reloads this window into it.
 * If it has taken over already (another window reloaded first), reloads
 * straight away.
 */
export function activateWaitingVersion(
  registration: ServiceWorkerRegistration,
  container: Pick<ServiceWorkerContainer, "addEventListener">,
  reload: () => void,
): void {
  const waiting = registration.waiting;
  if (!waiting) {
    reload();
    return;
  }
  container.addEventListener("controllerchange", () => reload(), {
    once: true,
  });
  // The generated service worker waits for this message (workbox).
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Registers the service worker in production builds. Never throws. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  const base = import.meta.env.BASE_URL;
  const updateReady = (reload: () => void) =>
    useAppUpdateStore.getState().setUpdateReady(reload);

  // Another window switched to the new version. This one still runs the old
  // code, whose files the new version no longer serves, so ask again even if
  // the person put it off. (A first install taking control is not a switch.)
  const controlledAtStart = Boolean(container.controller);
  container.addEventListener("controllerchange", () => {
    if (controlledAtStart) updateReady(() => window.location.reload());
  });

  const register = async () => {
    try {
      const registration = await container.register(`${base}sw.js`, {
        scope: base,
      });
      watchForWaitingVersion(registration, () =>
        updateReady(() =>
          activateWaitingVersion(registration, container, () =>
            window.location.reload(),
          ),
        ),
      );
      // Browsers look for a new version on page loads, which a clinic
      // tablet left open all day rarely makes.
      setInterval(() => {
        if (!navigator.onLine) return;
        registration.update().catch(() => undefined);
      }, UPDATE_CHECK_INTERVAL_MS);
    } catch (error) {
      logger.warn(
        "[pwa] Service worker registration failed:",
        error instanceof Error ? error.name : typeof error,
      );
    }
  };

  // After the page has loaded, so the worker's downloads do not slow the
  // app's start.
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}

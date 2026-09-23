import React, { useState, useEffect, memo } from "react";
import { XMarkIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";
const DISMISS_DAYS = 7;
/** Offer installation only after someone has been using the app a while. */
const SHOW_AFTER_MS = 30_000;

function dismissedRecently(): boolean {
  try {
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (!dismissed) return false;
    const daysSinceDismissed =
      (Date.now() - new Date(dismissed).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceDismissed < DISMISS_DAYS;
  } catch {
    return false;
  }
}

/**
 * Suggests installing the app when the browser says it can be installed.
 * Installing does not change what works offline — the service worker caches
 * the app either way — so the copy only promises what installing adds.
 */
export const PWAInstallPrompt = memo(() => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // matchMedia is missing in some embedded WebViews; guard so the boot
    // path never throws into the ErrorBoundary on those runtimes.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      setIsInstalled(true);
      return;
    }

    // Don't show again for a week after "Not now".
    if (dismissedRecently()) return;

    let showTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        setShowPrompt(true);
      }, SHOW_AFTER_MS);
    };

    const installed = () => {
      setIsInstalled(true);
      setShowPrompt(false);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
      if (showTimer) clearTimeout(showTimer);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setShowPrompt(false);
        setIsInstalled(true);
      }
    } catch (error) {
      console.warn(
        "[pwa] install prompt failed:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      // A prompt event can only be used once.
      setDeferredPrompt(null);
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // Storage unavailable: the suggestion may come back next visit.
    }
  };

  if (isInstalled || !showPrompt || !deferredPrompt) return null;

  return (
    <section
      aria-labelledby="pwa-install-title"
      className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-line bg-surface shadow-xl md:left-auto md:right-4 md:w-96 animate-slide-up"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <ArrowDownTrayIcon
            className="h-6 w-6 shrink-0 text-primary mt-0.5"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 id="pwa-install-title" className="text-h3 text-ink">
              Install mBHR on this device
            </h2>
            <p className="mt-1 text-body text-ink-secondary">
              Open mBHR from the home screen in its own window. It uses the
              same records as this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="btn-ghost -mr-2 -mt-2 min-w-touch-target px-2"
            aria-label="Dismiss install suggestion"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            className="btn-secondary flex-1"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleInstall}
            className="btn-primary flex-1"
            disabled={installing}
          >
            <ArrowDownTrayIcon className="h-5 w-5" aria-hidden />
            Install
          </button>
        </div>
      </div>
    </section>
  );
});

PWAInstallPrompt.displayName = "PWAInstallPrompt";

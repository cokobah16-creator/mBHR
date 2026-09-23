import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Calm frame for the portal's sign-in and registration screens: brand,
 * one bordered card, and links to the portal home, privacy notice and terms.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/patient"
          className="mx-auto mb-6 flex w-fit items-center gap-2.5 rounded-md px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="h-9 w-9 rounded-lg"
          />
          <span className="text-h3 text-ink">MedBridge Patient Portal</span>
        </Link>

        <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
          {children}
        </div>

        <nav
          aria-label="Portal links"
          className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-label"
        >
          <Link
            to="/patient"
            className="inline-flex min-h-touch-target items-center rounded-md px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Portal home
          </Link>
          <span aria-hidden className="text-ink-disabled">
            ·
          </span>
          <Link
            to="/privacy"
            className="inline-flex min-h-touch-target items-center rounded-md px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Privacy notice
          </Link>
          <span aria-hidden className="text-ink-disabled">
            ·
          </span>
          <Link
            to="/terms"
            className="inline-flex min-h-touch-target items-center rounded-md px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Terms of use
          </Link>
        </nav>
        <p className="mt-2 text-center text-caption text-ink-muted">
          Med Bridge Health Reach · Secure patient portal
        </p>
      </div>
    </div>
  );
}

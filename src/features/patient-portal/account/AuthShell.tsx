import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/hooks/useT";
import { LegalLinks } from "@/pages/legal/LegalLinks";

/**
 * Calm frame for the portal's sign-in and registration screens: brand,
 * one bordered card, and links to the portal home, privacy notice and terms.
 * The link row follows the chosen language.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useT();
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

        <LegalLinks
          label={t("legal.links.portalLinks")}
          before={[{ to: "/patient", label: t("legal.links.portalHome") }]}
          className="mt-6"
        />
        <p className="mt-2 text-center text-caption text-ink-muted">
          Med Bridge Health Reach · Secure patient portal
        </p>
      </div>
    </div>
  );
}

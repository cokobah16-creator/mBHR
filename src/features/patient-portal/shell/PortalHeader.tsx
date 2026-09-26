import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftOnRectangleIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useT } from "@/hooks/useT";
import type { ManagedPatient } from "@/services/patientPortalAuth";
import { ProfileOptions } from "./PortalNavigation";

export interface PortalProfileProps {
  name: string;
  displayName: string;
  managedPatients: ManagedPatient[];
  activePatientId: string | null;
  onSelectSelf: () => void;
  onSelectProfile: (patient: ManagedPatient) => void;
}

/**
 * Portal header: logo, language (desktop), whose records are shown,
 * Emergency (always visible) and Sign out (desktop; phones use "More").
 */
export function PortalHeader({
  profile,
  pathname,
  signingOut,
  onSignOut,
  onEmergency,
}: {
  profile: PortalProfileProps;
  pathname: string;
  signingOut: boolean;
  onSignOut: () => void;
  onEmergency: () => void;
}) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasManagedPatients = profile.managedPatients.length > 0;

  // Leaving a page closes the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape or a click outside closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        !menuRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          to="/patient/dashboard"
          className="flex min-h-touch-target items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-label font-semibold text-white"
            aria-hidden
          >
            mB
          </span>
          <span className="sr-only text-h3 text-ink sm:not-sr-only">
            {t("portal.title")}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <LanguageSelector />
          </div>

          {hasManagedPatients ? (
            <div className="relative hidden md:block" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="portal-profile-menu"
                className="btn-ghost"
              >
                <UserCircleIcon className="h-5 w-5" aria-hidden />
                <span className="max-w-[140px] truncate">{profile.displayName}</span>
                <ChevronDownIcon className="h-4 w-4" aria-hidden />
                <span className="sr-only">{t("portal.profile.switchProfile")}</span>
              </button>
              {menuOpen && (
                <div
                  id="portal-profile-menu"
                  className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-lg"
                >
                  <p className="section-label px-3 pb-1 pt-1">
                    {t("portal.profile.switchProfile")}
                  </p>
                  <ProfileOptions
                    name={profile.name}
                    managedPatients={profile.managedPatients}
                    activePatientId={profile.activePatientId}
                    onSelectSelf={profile.onSelectSelf}
                    onSelect={profile.onSelectProfile}
                  />
                  <div className="mt-1 border-t border-line pt-1">
                    <Link
                      to="/patient/caregiver/add"
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-touch-target items-center gap-3 rounded-md px-3 py-2 text-body text-primary-fg hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <UserPlusIcon className="h-5 w-5" aria-hidden />
                      {t("portal.profile.addCaregiver")}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="hidden items-center gap-2 px-2 text-body text-ink-secondary md:flex">
              <UserCircleIcon className="h-5 w-5" aria-hidden />
              <span className="max-w-[140px] truncate">{profile.displayName}</span>
            </span>
          )}

          {/* Emergency help is reachable from every portal page. */}
          <button
            type="button"
            onClick={onEmergency}
            aria-haspopup="dialog"
            className="btn-danger px-3"
          >
            <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />
            {t("portal.nav.emergency")}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="btn-ghost hidden md:inline-flex"
          >
            <ArrowLeftOnRectangleIcon className="h-5 w-5" aria-hidden />
            <span>
              {signingOut ? t("portal.nav.signingOut") : t("portal.nav.logout")}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

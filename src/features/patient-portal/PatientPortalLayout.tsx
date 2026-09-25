import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  BeakerIcon,
  HeartIcon,
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  ArrowDownTrayIcon,
  UserCircleIcon,
  EllipsisHorizontalIcon,
  VideoCameraIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UserGroupIcon,
  ArrowLeftOnRectangleIcon,
  ChevronDownIcon,
  CheckIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useState, useEffect, useRef, useCallback } from "react";
import { EmergencyHelp } from "./EmergencyHelp";
import { LegalLinks } from "@/pages/legal/LegalLinks";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PortalSkeleton } from "@/components/ui/Skeleton";
import { useT } from "@/hooks/useT";
import { supabase } from "@/lib/supabase";
import { supabase as authClient } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { logout as endLocalPortalSession } from "@/services/patientPortalAuth";
import { clearApiCaches } from "@/services/clearApiCaches";
import {
  getPatientProfile,
  getPatientProfileByEmail,
} from "@/services/patientService";
import {
  PORTAL_USER_KEY,
  SESSION_TOKEN_KEY,
  clearPortalSession,
  clearStoredSupabaseAuth,
  readActiveProfile,
  readPortalUser,
} from "./portalSession";

interface PatientPortalLayoutProps {
  children: ReactNode;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  path: string;
  labelKey: string;
  icon: Icon;
  /** Extra path prefixes that count as this section (e.g. a visit's detail page). */
  match?: string[];
}

// Portal sections, in the order patients look for them. Every path is an
// existing route under /patient/* in App.tsx.
const PRIMARY_NAV: NavItem[] = [
  { path: "/patient/dashboard", labelKey: "portal.nav.home", icon: HomeIcon },
  {
    path: "/patient/medical-history",
    labelKey: "portal.nav.visits",
    icon: ClipboardDocumentListIcon,
    match: ["/patient/visit"],
  },
  {
    path: "/patient/lab-results",
    labelKey: "portal.nav.labResults",
    icon: BeakerIcon,
  },
  {
    path: "/patient/conditions",
    labelKey: "portal.nav.conditions",
    icon: HeartIcon,
  },
  {
    path: "/patient/prescriptions",
    labelKey: "portal.nav.medicines",
    icon: ArchiveBoxIcon,
  },
  {
    path: "/patient/appointments",
    labelKey: "portal.nav.appointments",
    icon: CalendarDaysIcon,
  },
  {
    path: "/patient/messages",
    labelKey: "portal.nav.messages",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    path: "/patient/documents",
    labelKey: "portal.nav.documents",
    icon: FolderIcon,
  },
  {
    path: "/patient/export",
    labelKey: "portal.nav.myHealthData",
    icon: ArrowDownTrayIcon,
  },
  {
    path: "/patient/account",
    labelKey: "portal.nav.account",
    icon: UserCircleIcon,
  },
];

const OTHER_NAV: NavItem[] = [
  {
    path: "/patient/telehealth",
    labelKey: "portal.nav.telehealth",
    icon: VideoCameraIcon,
  },
  {
    path: "/patient/outreach",
    labelKey: "portal.action.findOutreach",
    icon: MapPinIcon,
  },
  {
    path: "/patient/data-sharing",
    labelKey: "portal.action.dataSharing",
    icon: ShieldCheckIcon,
  },
  {
    path: "/patient/caregiver/add",
    labelKey: "portal.profile.addCaregiverShort",
    icon: UserPlusIcon,
  },
];

// Mobile bottom bar: the four places patients go most, then "More".
const BOTTOM_PATHS = [
  "/patient/dashboard",
  "/patient/medical-history",
  "/patient/prescriptions",
  "/patient/messages",
];
const BOTTOM_NAV = PRIMARY_NAV.filter((i) => BOTTOM_PATHS.includes(i.path));
const MORE_NAV = PRIMARY_NAV.filter((i) => !BOTTOM_PATHS.includes(i.path));

const SIGN_OUT_TIMEOUT_MS = 5000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isActivePath(pathname: string, item: NavItem): boolean {
  return [item.path, ...(item.match ?? [])].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function hasPortalPatient(): boolean {
  const user = readPortalUser();
  return !!(user && user.patientId && user.id);
}

function NavRow({
  item,
  label,
  active,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const ItemIcon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-touch-target items-center gap-3 rounded-md px-3 py-2 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active
          ? "bg-primary-soft font-semibold text-primary-fg"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <ItemIcon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
    </Link>
  );
}

export function PatientPortalLayout({ children }: PatientPortalLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // portalUserReady gates child rendering until patient_portal_user is populated.
  // Without this gate, MedicalHistory/Messages read empty localStorage and hard-redirect to login.
  const [portalUserReady, setPortalUserReady] = useState(hasPortalPatient);

  useEffect(() => {
    if (portalUserReady) return;
    if (!supabase) {
      setPortalUserReady(true);
      return;
    }
    let cancelled = false;
    const client = supabase;

    const hydrate = async () => {
      try {
        const {
          data: { user },
        } = await client.auth.getUser();
        if (!user) return;

        // Try lookup by auth_uid first, then fall back to email for patients
        // whose records were created by staff (no auth_uid set yet).
        let profile = (await getPatientProfile(user.id)).data;
        if (!profile && user.email) {
          profile = (await getPatientProfileByEmail(user.id, user.email)).data;
        }

        if (profile && !cancelled) {
          const entry = {
            id: user.id,
            patientId: profile.id,
            givenName: profile.givenName,
            familyName: profile.familyName,
            email: user.email ?? profile.email ?? "",
            managedPatients: [],
          };
          localStorage.setItem(PORTAL_USER_KEY, JSON.stringify(entry));
        }
      } catch (err) {
        // Pages show their own "please sign in again" message when the
        // portal user is still missing; never leave the skeleton up forever.
        logger.warn(
          "[PatientPortalLayout] profile lookup failed:",
          err instanceof Error ? err.name : "unknown",
        );
      } finally {
        if (!cancelled) setPortalUserReady(true);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [portalUserReady]);

  // Leaving a page closes any open menu.
  useEffect(() => {
    setMoreOpen(false);
    setProfileMenuOpen(false);
  }, [location.pathname]);

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  }, []);

  // "More" sheet: focus the close button, keep Tab inside the sheet, Escape
  // closes and returns focus to "More".
  useEffect(() => {
    if (!moreOpen) return;
    moreCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMore();
        return;
      }
      if (e.key !== "Tab" || !moreSheetRef.current) return;
      const items = Array.from(
        moreSheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen, closeMore]);

  // Profile menu: Escape or a click outside closes it.
  useEffect(() => {
    if (!profileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileMenuOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (
        profileRef.current &&
        e.target instanceof Node &&
        !profileRef.current.contains(e.target)
      ) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [profileMenuOpen]);

  const portalUser = readPortalUser();
  const name = portalUser?.givenName || "Patient";
  const managedPatients = portalUser?.managedPatients ?? [];
  const activeProfile = readActiveProfile();
  const displayName = activeProfile?.givenName || name;
  const hasManagedPatients = managedPatients.length > 0;

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (token) await endLocalPortalSession(token);
      // End this phone's online session too, so the next person on a shared
      // phone cannot reopen this patient's records. Do not wait forever
      // offline; "local" leaves the patient's other devices signed in.
      if (authClient) {
        await Promise.race([
          authClient.auth.signOut({ scope: "local" }),
          new Promise((resolve) => setTimeout(resolve, SIGN_OUT_TIMEOUT_MS)),
        ]);
      }
    } catch (err) {
      logger.warn(
        "[PatientPortalLayout] sign-out:",
        err instanceof Error ? err.name : "unknown",
      );
    } finally {
      clearPortalSession();
      // signOut() cannot finish offline and then keeps the stored sign-in:
      // remove it from this phone either way.
      if (authClient) clearStoredSupabaseAuth();
      void clearApiCaches();
      navigate("/patient");
    }
  };

  const switchProfile = (
    patientId: string,
    givenName: string,
    familyName: string,
  ) => {
    localStorage.setItem(
      "patient_active_profile",
      JSON.stringify({ patientId, givenName, familyName }),
    );
    setProfileMenuOpen(false);
    window.location.reload();
  };

  const switchToSelf = () => {
    localStorage.removeItem("patient_active_profile");
    setProfileMenuOpen(false);
    window.location.reload();
  };

  const moreIsActive = [...MORE_NAV, ...OTHER_NAV].some((i) =>
    isActivePath(location.pathname, i),
  );

  const profileOptions = (
    <ul className="space-y-0.5">
      <li>
        <button
          type="button"
          onClick={switchToSelf}
          aria-current={!activeProfile ? "true" : undefined}
          className="flex min-h-touch-target w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body text-ink hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <UserCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("portal.profile.yourself")} – {name}
          </span>
          {!activeProfile && (
            <CheckIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          )}
        </button>
      </li>
      {managedPatients.map((mp) => {
        const selected = activeProfile?.patientId === mp.patientId;
        return (
          <li key={mp.patientId}>
            <button
              type="button"
              onClick={() =>
                switchProfile(mp.patientId, mp.givenName, mp.familyName)
              }
              aria-current={selected ? "true" : undefined}
              className="flex min-h-touch-target w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body text-ink hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <UserGroupIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {mp.givenName} {mp.familyName}
                {mp.relationship && (
                  <span className="block text-caption text-ink-muted">
                    {mp.relationship}
                  </span>
                )}
              </span>
              {selected && (
                <CheckIcon
                  className="h-5 w-5 shrink-0 text-primary"
                  aria-hidden
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg"
      >
        {t("portal.nav.skipToContent")}
      </a>

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

            {/* Whose records are shown; caregivers can switch. */}
            {hasManagedPatients ? (
              <div className="relative hidden md:block" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  aria-expanded={profileMenuOpen}
                  aria-controls="portal-profile-menu"
                  className="btn-ghost"
                >
                  <UserCircleIcon className="h-5 w-5" aria-hidden />
                  <span className="max-w-[140px] truncate">{displayName}</span>
                  <ChevronDownIcon className="h-4 w-4" aria-hidden />
                  <span className="sr-only">
                    {t("portal.profile.switchProfile")}
                  </span>
                </button>
                {profileMenuOpen && (
                  <div
                    id="portal-profile-menu"
                    className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-xl"
                  >
                    <p className="section-label px-3 pb-1 pt-1">
                      {t("portal.profile.switchProfile")}
                    </p>
                    {profileOptions}
                    <div className="mt-1 border-t border-line pt-1">
                      <Link
                        to="/patient/caregiver/add"
                        onClick={() => setProfileMenuOpen(false)}
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
                <span className="max-w-[140px] truncate">{displayName}</span>
              </span>
            )}

            {/* Emergency help is reachable from every portal page. */}
            <button
              type="button"
              onClick={() => setEmergencyOpen(true)}
              aria-haspopup="dialog"
              className="btn-danger px-3"
            >
              <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />
              {t("portal.nav.emergency")}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="btn-ghost hidden md:inline-flex"
            >
              <ArrowLeftOnRectangleIcon className="h-5 w-5" aria-hidden />
              <span>
                {signingOut
                  ? t("portal.nav.signingOut")
                  : t("portal.nav.logout")}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="hidden w-60 shrink-0 border-r border-line md:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
            <nav aria-label={t("portal.nav.menuLabel")}>
              <ul className="space-y-0.5">
                {PRIMARY_NAV.map((item) => (
                  <li key={item.path}>
                    <NavRow
                      item={item}
                      label={t(item.labelKey)}
                      active={isActivePath(location.pathname, item)}
                    />
                  </li>
                ))}
              </ul>
              <p className="section-label mb-1 mt-6 px-3">
                {t("portal.nav.otherServices")}
              </p>
              <ul className="space-y-0.5">
                {OTHER_NAV.map((item) => (
                  <li key={item.path}>
                    <NavRow
                      item={item}
                      label={t(item.labelKey)}
                      active={isActivePath(location.pathname, item)}
                    />
                  </li>
                ))}
              </ul>
            </nav>
            <LegalLinks
              align="start"
              className="mt-6 border-t border-line px-1 pt-3"
            />
          </div>
        </aside>

        <main
          id="portal-main"
          tabIndex={-1}
          className="min-w-0 flex-1 pb-24 focus:outline-none md:pb-10"
        >
          {portalUserReady ? children : <PortalSkeleton />}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("portal.nav.menuLabel")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-safe-bottom md:hidden"
      >
        <ul className="flex">
          {BOTTOM_NAV.map((item) => {
            const ItemIcon = item.icon;
            const active = isActivePath(location.pathname, item);
            return (
              <li key={item.path} className="flex-1">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-caption focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                    active
                      ? "font-semibold text-primary-fg"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full ${
                      active ? "bg-primary-soft" : ""
                    }`}
                  >
                    <ItemIcon className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="text-center leading-tight">
                    {t(item.labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-caption focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                moreIsActive
                  ? "font-semibold text-primary-fg"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full ${
                  moreIsActive ? "bg-primary-soft" : ""
                }`}
              >
                <EllipsisHorizontalIcon className="h-6 w-6" aria-hidden />
              </span>
              <span className="leading-tight">{t("portal.nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={closeMore}
            aria-hidden
          />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="portal-more-title"
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-safe-bottom shadow-xl"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-2">
              <h2 id="portal-more-title" className="text-h2 text-ink">
                {t("portal.nav.more")}
              </h2>
              <button
                ref={moreCloseRef}
                type="button"
                onClick={closeMore}
                className="btn-ghost"
                aria-label={t("portal.nav.closeMenu")}
              >
                <XMarkIcon className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <div className="space-y-4 px-2 py-3">
              <nav aria-label={t("portal.nav.more")}>
                <ul className="space-y-0.5">
                  {MORE_NAV.map((item) => (
                    <li key={item.path}>
                      <NavRow
                        item={item}
                        label={t(item.labelKey)}
                        active={isActivePath(location.pathname, item)}
                      />
                    </li>
                  ))}
                </ul>
                <p className="section-label mb-1 mt-4 px-3">
                  {t("portal.nav.otherServices")}
                </p>
                <ul className="space-y-0.5">
                  {OTHER_NAV.map((item) => (
                    <li key={item.path}>
                      <NavRow
                        item={item}
                        label={t(item.labelKey)}
                        active={isActivePath(location.pathname, item)}
                      />
                    </li>
                  ))}
                </ul>
              </nav>

              {hasManagedPatients && (
                <section aria-labelledby="portal-more-profiles">
                  <p
                    id="portal-more-profiles"
                    className="section-label mb-1 px-3"
                  >
                    {t("portal.profile.switchProfile")}
                  </p>
                  {profileOptions}
                </section>
              )}

              <section aria-labelledby="portal-more-language" className="px-3">
                <p id="portal-more-language" className="section-label mb-2">
                  {t("portal.nav.language")}
                </p>
                <LanguageSelector />
              </section>

              <div className="border-t border-line px-1 pt-3">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="btn-secondary w-full"
                >
                  <ArrowLeftOnRectangleIcon className="h-5 w-5" aria-hidden />
                  {signingOut
                    ? t("portal.nav.signingOut")
                    : t("portal.nav.logout")}
                </button>
              </div>

              <LegalLinks />
            </div>
          </div>
        </div>
      )}

      {/* Emergency modal */}
      {emergencyOpen && (
        <EmergencyHelp onClose={() => setEmergencyOpen(false)} />
      )}
    </div>
  );
}

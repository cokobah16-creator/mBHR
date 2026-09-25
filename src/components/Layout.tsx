import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";
import { OfflineBanner } from "@/components/OfflineBanner";
import Toasts from "@/components/Toasts";
import useLowStockWatcher from "@/features/inventory/useLowStockWatcher";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AccessibilityControls } from "@/components/AccessibilityControls";
import { can, getRoleDisplayName, type Role } from "@/auth/roles";
import { pharmacyTasksForRole } from "@/components/shell/pharmacyTasks";
import { ActiveSiteControl } from "@/components/shell/ActiveSiteControl";
import { SyncStatusControl } from "@/components/shell/SyncStatusControl";
import { hasAnyAdminEntry } from "@/features/admin/adminSections";
import { startBackgroundSync, stopBackgroundSync } from "@/sync/adapter";
import { useCriticalLabCount } from "@/hooks/useCriticalLabCount";
import {
  HomeIcon,
  UserGroupIcon,
  QueueListIcon,
  CubeIcon,
  UsersIcon,
  ArrowRightOnRectangleIcon,
  BeakerIcon,
  GiftIcon,
  TicketIcon,
  TrophyIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  CheckCircleIcon,
  XMarkIcon,
  Bars3Icon,
  DocumentDuplicateIcon,
  VideoCameraIcon,
  HeartIcon,
  DocumentMagnifyingGlassIcon,
  DocumentChartBarIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  UserPlusIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";

// Pharmacy menu shown in place of the page content when the nav's
// Pharmacy item is chosen. Tasks are filtered by the same route guards as
// /pharmacy/menu (features/pharmacy/pharmacyTasks).
function PharmacyOverlay({ onClose, role }: { onClose: () => void; role?: Role }) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tasks = pharmacyTasksForRole(role);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-h1 text-ink focus:outline-none">
            Pharmacy
          </h1>
          <p className="mt-1 text-body text-ink-muted">Choose a pharmacy task.</p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost">
          <XMarkIcon className="h-5 w-5" aria-hidden />
          Close
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="panel p-5 text-body text-ink-secondary">
          Dispensing, stock and reports are for pharmacists and administrators. Ask an administrator if you need access.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map(({ to, title, desc, Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={onClose}
                className="flex h-full min-h-touch-target items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover"
              >
                <span className="rounded-md border border-line bg-surface-sunken p-2 text-ink-secondary">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-h3 text-ink">{title}</span>
                  <span className="mt-0.5 block text-body text-ink-muted">{desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COLLAPSE_KEY = "mbhr.nav.collapsed";

interface NavItem {
  key: string;
  name: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Items needing attention (e.g. unreviewed critical lab results). */
  alertCount?: number;
  alertLabel?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout, updateActivity, checkSessionExpiry } =
    useAuthStore();
  const [overlay, setOverlay] = React.useState<null | "pharmacy">(null);
  const closeOverlay = React.useCallback(() => setOverlay(null), []);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // Storage can be unavailable (private mode); the toggle still works.
      }
      return !c;
    });
  };

  // Start low stock monitoring
  useLowStockWatcher();

  // Background sync runs only while a staff member is signed in (the shell
  // is not rendered on the patient portal or the waiting-room display). It
  // skips itself when cloud sync is not configured or the device is offline,
  // backs off after failures, and queues any conflicts it finds for review.
  const userId = currentUser?.id;
  React.useEffect(() => {
    if (!userId) return;
    startBackgroundSync();
    return () => stopBackgroundSync();
  }, [userId]);

  // Close the mobile menu and the pharmacy menu on route change, so a nav
  // link chosen while the pharmacy menu is open shows its page.
  React.useEffect(() => {
    setMobileMenuOpen(false);
    setOverlay(null);
  }, [location.pathname]);

  // Simple session check on mount and periodically
  React.useEffect(() => {
    if (!currentUser) return;

    // Check immediately on mount
    const expired = checkSessionExpiry();
    if (expired) {
      navigate("/login");
      return;
    }

    // Then check every 5 minutes (not every minute to reduce overhead)
    const interval = setInterval(
      () => {
        const expired = checkSessionExpiry();
        if (expired) {
          navigate("/login");
        }
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [currentUser, checkSessionExpiry, navigate]);

  // Update activity on user interaction
  React.useEffect(() => {
    if (!currentUser) return;

    const handleActivity = () => {
      updateActivity();
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [currentUser, updateActivity]);

  const role = currentUser?.role;
  const hasRole = (...roles: string[]) => !!role && roles.includes(role);
  const hasPerm = (p: Parameters<typeof can>[1]) => !!role && can(role, p);

  // Clinical staff who can open /labs (doctors and nurses) see unreviewed
  // critical results in the shell, re-read every minute, without having to
  // open or refresh /labs. A generic administrator does not get the alert
  // (clinician sign-off on change log row 22).
  const criticalLabs = useCriticalLabCount(hasRole("doctor", "nurse")) ?? 0;
  const criticalLabsLabel = `${criticalLabs} critical lab result${criticalLabs === 1 ? "" : "s"} not yet reviewed`;

  // Navigation mirrors the route guards in App.tsx, so staff only see pages
  // they can open. Grouped by the job being done, not by feature age.
  const navGroups: NavGroup[] = [
    {
      label: "Patient care",
      items: [
        { key: "dashboard", name: t("nav.dashboard"), href: "/dashboard", icon: HomeIcon },
        { key: "patients", name: t("nav.patients"), href: "/patients", icon: UserGroupIcon },
        { key: "queue", name: t("nav.queue"), href: "/queue", icon: QueueListIcon },
        ...(hasPerm("register")
          ? [{ key: "register", name: "Registration", href: "/register", icon: UserPlusIcon }]
          : []),
        ...(hasPerm("vitals")
          ? [{ key: "vitals", name: "Vitals", href: "/vitals", icon: HeartIcon }]
          : []),
        ...(hasPerm("consult")
          ? [{ key: "consult", name: "Consultation", href: "/consult", icon: DocumentTextIcon }]
          : []),
        ...(hasPerm("consult")
          ? [
              {
                key: "doctor",
                name: t("nav.doctor_station"),
                href: "/doctor/dashboard",
                icon: ClipboardDocumentListIcon,
              },
            ]
          : []),
        { key: "pharmacy", name: t("nav.pharmacy"), href: "/pharmacy", icon: BeakerIcon },
        ...(hasRole("doctor", "nurse", "admin")
          ? [
              {
                key: "labs",
                name: "Labs",
                href: "/labs",
                icon: DocumentMagnifyingGlassIcon,
                alertCount: criticalLabs,
                alertLabel: criticalLabsLabel,
              },
            ]
          : []),
        ...(hasRole("doctor", "nurse", "volunteer", "registration_lead", "admin")
          ? [{ key: "appointments", name: "Appointments", href: "/appointments", icon: CalendarDaysIcon }]
          : []),
        ...(hasRole("doctor", "nurse", "admin")
          ? [
              { key: "televisits", name: t("nav.televisits"), href: "/televisits", icon: VideoCameraIcon },
            ]
          : []),
      ],
    },
    {
      label: "Outreach operations",
      items: [
        ...(hasRole("volunteer", "registration_lead", "nurse", "doctor", "admin")
          ? [{ key: "tickets", name: t("nav.issue_tickets"), href: "/tickets/issue", icon: TicketIcon }]
          : []),
        { key: "inventory", name: t("nav.inventory"), href: "/inventory", icon: CubeIcon },
        ...(hasRole("admin", "doctor", "nurse")
          ? [{ key: "outreach", name: "Outreach reports", href: "/reports/outreach", icon: DocumentChartBarIcon }]
          : []),
        ...(hasRole("admin")
          ? [{ key: "analytics", name: t("nav.analytics"), href: "/analytics", icon: ChartBarIcon }]
          : []),
      ],
    },
    {
      label: "Games & training",
      items: [
        { key: "games", name: t("nav.games"), href: "/games", icon: TrophyIcon },
        ...(hasPerm("inventory")
          ? [{ key: "restock", name: t("nav.restock_game"), href: "/inv/game", icon: GiftIcon }]
          : []),
      ],
    },
    {
      label: "Administration",
      items: [
        ...(hasAnyAdminEntry(role)
          ? [{ key: "admin", name: "Overview", href: "/admin", icon: Squares2X2Icon }]
          : []),
        ...(hasPerm("users")
          ? [
              { key: "users", name: t("nav.user_management"), href: "/users", icon: UsersIcon },
              { key: "approvals", name: "Training game approvals", href: "/admin/approvals", icon: CheckCircleIcon },
            ]
          : []),
        ...(hasRole("admin", "doctor", "nurse", "lead_clinician", "auditor") && hasPerm("resolve_conflicts")
          ? [{ key: "conflicts", name: "Sync conflicts", href: "/admin/conflicts", icon: DocumentDuplicateIcon }]
          : []),
        ...(hasRole("admin")
          ? [{ key: "settings", name: "Settings", href: "/admin/settings", icon: Cog6ToothIcon }]
          : []),
      ],
    },
  ].filter((g) => g.items.length > 0);

  const isItemActive = (item: NavItem) => {
    // The overview is the parent of every /admin/* page; only highlight it
    // on the overview itself so the specific page's item stays active.
    if (item.key === "admin") return location.pathname === "/admin";
    if (item.key === "pharmacy") {
      return (
        location.pathname.startsWith("/rx/") ||
        location.pathname === "/pharmacy" ||
        location.pathname.startsWith("/pharmacy/")
      );
    }
    return (
      location.pathname === item.href ||
      location.pathname.startsWith(item.href + "/")
    );
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const initials = (currentUser?.fullName ?? "")
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const renderItem = (item: NavItem) => {
    const active = isItemActive(item);
    const cls = `group relative flex w-full items-center gap-3 rounded-md px-3 py-2 min-h-touch-target text-label transition-colors ${
      collapsed ? "md:justify-center md:px-0" : ""
    } ${
      active
        ? "bg-rail-active text-white font-semibold"
        : "text-rail-text hover:bg-rail-hover hover:text-white"
    }`;
    const content = (
      <>
        {active && (
          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
        )}
        <item.icon
          className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-rail-muted group-hover:text-white"}`}
          aria-hidden
        />
        <span className={collapsed ? "md:sr-only" : ""}>{item.name}</span>
        {item.alertCount ? (
          <span
            className={`badge badge-critical ml-auto tabular-nums ${collapsed ? "md:absolute md:right-0.5 md:top-0.5" : ""}`}
            title={item.alertLabel}
          >
            {item.alertCount}
            <span className="sr-only">: {item.alertLabel}</span>
          </span>
        ) : null}
      </>
    );
    return (
      <li key={item.key}>
        {item.key === "pharmacy" ? (
          <button
            type="button"
            onClick={() => {
              setOverlay("pharmacy");
              setMobileMenuOpen(false);
            }}
            className={`${cls} text-left`}
            aria-expanded={overlay === "pharmacy"}
            aria-controls="pharmacy-menu"
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.name : undefined}
          >
            {content}
          </button>
        ) : (
          <Link
            to={item.href}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cls}
            title={collapsed ? item.name : undefined}
          >
            {content}
          </Link>
        )}
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-canvas md:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden
        />
      )}

      {/* Navigation rail: full height on tablet/desktop, drawer on phones */}
      <nav
        role="navigation"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-rail text-rail-text shadow-xl transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:shrink-0 md:shadow-none md:translate-x-0 ${
          collapsed ? "md:w-16" : "md:w-60"
        } ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-rail-line px-4 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <img src="/brand/mbhr-mark.svg" alt="" aria-hidden className="h-8 w-8 shrink-0 rounded-md" />
          <span className={`min-w-0 leading-tight ${collapsed ? "md:sr-only" : ""}`}>
            <span className="block text-h3 text-white">mBHR</span>
            <span className="block text-caption text-rail-muted">Med Bridge Health Reach</span>
          </span>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="ml-auto rounded-md p-2 text-rail-text hover:bg-rail-hover md:hidden"
            aria-label="Close navigation"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p
                className={`px-3 pb-1.5 text-caption font-semibold uppercase tracking-wide text-rail-muted ${collapsed ? "md:sr-only" : ""}`}
              >
                {group.label}
              </p>
              <ul className="space-y-0.5">{group.items.map(renderItem)}</ul>
            </div>
          ))}
        </div>

        {/* Phone drawer: user + preferences */}
        <div className="space-y-2 border-t border-rail-line px-4 py-3 md:hidden">
          <p className="text-label text-white">{currentUser?.fullName}</p>
          <p className="text-caption text-rail-muted">
            {currentUser ? getRoleDisplayName(currentUser.role) : ""}
          </p>
          <LanguageSelector />
          <AccessibilityControls />
          {currentUser && (
            <button onClick={handleLogout} className="btn-secondary w-full">
              <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden />
              {t("auth.logout")}
            </button>
          )}
        </div>

        <div className="hidden border-t border-rail-line p-2 md:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 min-h-touch-target text-caption text-rail-muted hover:bg-rail-hover hover:text-white ${collapsed ? "justify-center px-0" : ""}`}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand navigation" : undefined}
          >
            {collapsed ? (
              <ChevronDoubleRightIcon className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <ChevronDoubleLeftIcon className="h-4 w-4" aria-hidden />
                Collapse
              </>
            )}
          </button>
          <div className={`flex gap-3 px-3 pt-1 text-caption text-rail-muted ${collapsed ? "sr-only" : ""}`}>
            <Link to="/privacy" className="hover:text-white hover:underline">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-white hover:underline">
              Terms
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header
          role="banner"
          className="sticky top-0 z-30 h-16 shrink-0 border-b border-line bg-surface"
        >
          <div className="flex h-full items-center gap-2 px-2 sm:px-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden btn-ghost px-2"
              aria-label="Open navigation"
              aria-expanded={mobileMenuOpen}
            >
              <Bars3Icon className="h-6 w-6" aria-hidden />
            </button>
            <Link
              to="/dashboard"
              className="flex shrink-0 items-center rounded-md md:hidden"
              aria-label={`${t("app.title")} — dashboard`}
            >
              <img src="/brand/mbhr-mark.svg" alt="" aria-hidden className="h-8 w-8 rounded-md" />
            </Link>

            <div className="min-w-0 flex-1">
              <ActiveSiteControl />
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <SyncStatusControl />
              <div className="hidden md:block">
                <LanguageSelector />
              </div>
              <div className="hidden lg:block">
                <AccessibilityControls />
              </div>
              {currentUser && (
                <div className="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-line">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary-fg"
                    aria-hidden
                  >
                    {initials}
                  </span>
                  <span className="hidden xl:block leading-tight">
                    <span className="block text-label text-ink">{currentUser.fullName}</span>
                    <span className="block text-caption text-ink-muted">
                      {getRoleDisplayName(currentUser.role)}
                    </span>
                  </span>
                  <button
                    onClick={handleLogout}
                    className="btn-ghost px-2"
                    title={t("auth.logout")}
                    aria-label={t("auth.logout")}
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          role="main"
          aria-label="Main content"
          className="min-w-0 flex-1 overflow-x-hidden"
        >
          {overlay === "pharmacy" ? (
            <section id="pharmacy-menu" aria-label="Pharmacy menu">
              <PharmacyOverlay onClose={closeOverlay} role={currentUser?.role} />
            </section>
          ) : (
            <div className="mx-auto max-w-7xl p-4 sm:p-6">
              {criticalLabs > 0 && !location.pathname.startsWith("/labs") && (
                <div className="banner banner-danger mb-4" role="status">
                  <span>
                    {criticalLabsLabel}.{" "}
                    <Link to="/labs" className="font-semibold underline">
                      Open Labs
                    </Link>
                  </span>
                </div>
              )}
              {children}
            </div>
          )}
        </main>
      </div>

      <Toasts />
    </div>
  );
}

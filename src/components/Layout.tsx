import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";
import { OfflineBanner } from "@/components/OfflineBanner";
import Toasts from "@/components/Toasts";
import useLowStockWatcher from "@/features/inventory/useLowStockWatcher";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AccessibilityControls } from "@/components/AccessibilityControls";
import { can, getRoleDisplayName } from "@/auth/roles";
import { ActiveSiteControl } from "@/components/shell/ActiveSiteControl";
import { SyncStatusControl } from "@/components/shell/SyncStatusControl";
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
  ArrowLeftIcon,
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
} from "@heroicons/react/24/outline";

// Pharmacy Overlay Component
function PharmacyOverlay({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cards = [
    {
      to: "/rx/dispense",
      title: "Dispense",
      desc: "Record prescriptions & counsel patients",
      Icon: BeakerIcon,
    },
    {
      to: "/rx/stock",
      title: "Inventory",
      desc: "Stock counts, restock & FEFO tracking",
      Icon: CubeIcon,
    },
    {
      to: "/rx/new",
      title: "New Stock",
      desc: "Receive deliveries / add new items",
      Icon: ClipboardDocumentListIcon,
    },
    {
      to: "/pharmacy/reports",
      title: "Reports",
      desc: "Daily summary & controlled log",
      Icon: ClipboardDocumentListIcon,
    },
  ];

  return (
    <main className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to Dashboard
        </button>

        <button
          onClick={onClose}
          aria-label="Close pharmacy menu"
          className="rounded-full p-2 hover:bg-gray-100 focus:outline-none focus:ring"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-2">Pharmacy</h1>
      <p className="text-gray-600 mb-6">Choose what you'd like to do.</p>

      <section
        aria-label="Pharmacy options"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {cards.map(({ to, title, desc, Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={onClose}
            className="group rounded-2xl border border-gray-200 p-5 hover:shadow-md focus:outline-none focus:ring focus:ring-primary/30"
          >
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-gray-100 p-3">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <p className="mt-3 text-sm text-gray-600">{desc}</p>
            <span className="sr-only">Open {title}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}

const COLLAPSE_KEY = "mbhr.nav.collapsed";

interface NavItem {
  key: string;
  name: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
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

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileMenuOpen(false);
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
              { key: "labs", name: "Labs", href: "/labs", icon: DocumentMagnifyingGlassIcon },
            ]
          : []),
        ...(hasRole("doctor", "nurse", "volunteer", "admin")
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
        ...(hasRole("volunteer", "nurse", "doctor", "admin")
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
        ...(hasRole("volunteer", "nurse", "admin")
          ? [{ key: "restock", name: t("nav.restock_game"), href: "/inv/game", icon: GiftIcon }]
          : []),
      ],
    },
    {
      label: "Administration",
      items: [
        ...(hasPerm("users")
          ? [
              { key: "users", name: t("nav.user_management"), href: "/users", icon: UsersIcon },
              { key: "approvals", name: t("nav.approve_games"), href: "/admin/approvals", icon: CheckCircleIcon },
            ]
          : []),
        ...(hasRole("admin", "doctor", "nurse") && hasPerm("resolve_conflicts")
          ? [{ key: "conflicts", name: "Sync conflicts", href: "/admin/conflicts", icon: DocumentDuplicateIcon }]
          : []),
      ],
    },
  ].filter((g) => g.items.length > 0);

  const isItemActive = (item: NavItem) => {
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
    const cls = `group flex w-full items-center gap-3 rounded-md px-3 py-2 min-h-touch-target text-label transition-colors ${
      collapsed ? "md:justify-center md:px-0" : ""
    } ${
      active
        ? "bg-primary-soft text-primary-fg font-semibold"
        : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
    }`;
    const content = (
      <>
        <item.icon
          className={`h-5 w-5 shrink-0 ${active ? "text-primary" : "text-ink-muted group-hover:text-ink-secondary"}`}
          aria-hidden
        />
        <span className={collapsed ? "md:sr-only" : ""}>{item.name}</span>
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
            aria-haspopup="dialog"
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
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <OfflineBanner />
      <header
        role="banner"
        className="sticky top-0 z-30 h-14 border-b border-line bg-surface"
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
            className="flex items-center gap-2 shrink-0 rounded-md pr-1"
            aria-label={`${t("app.title")} — dashboard`}
          >
            <img src="/brand/mbhr-mark.svg" alt="" aria-hidden className="h-8 w-8 rounded-md" />
            <span className="hidden lg:block text-h3 text-ink">mBHR</span>
          </Link>

          <span className="hidden sm:block h-6 w-px bg-line mx-1" aria-hidden />

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
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary-fg"
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

      <div className="relative flex min-h-[calc(100vh-3.5rem)]">
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-ink/40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden
          />
        )}

        <nav
          role="navigation"
          aria-label="Main navigation"
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-surface shadow-xl transition-transform duration-200 md:sticky md:top-14 md:z-auto md:h-[calc(100vh-3.5rem)] md:self-start md:shadow-none md:translate-x-0 ${
            collapsed ? "md:w-16" : "md:w-60"
          } ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          {/* Mobile drawer header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
            <div>
              <p className="text-label font-semibold text-ink">{currentUser?.fullName}</p>
              <p className="text-caption text-ink-muted">
                {currentUser ? getRoleDisplayName(currentUser.role) : ""}
              </p>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="btn-ghost px-2"
              aria-label="Close navigation"
            >
              <XMarkIcon className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            {navGroups.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <p
                  className={`section-label px-3 pb-1.5 ${collapsed ? "md:sr-only" : ""}`}
                >
                  {group.label}
                </p>
                <ul className="space-y-0.5">{group.items.map(renderItem)}</ul>
              </div>
            ))}
          </div>

          {/* Mobile-only controls */}
          <div className="space-y-2 border-t border-line px-4 py-3 md:hidden">
            <LanguageSelector />
            <AccessibilityControls />
            {currentUser && (
              <button onClick={handleLogout} className="btn-secondary w-full">
                <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden />
                {t("auth.logout")}
              </button>
            )}
          </div>

          <div className="hidden border-t border-line p-2 md:block">
            <button
              type="button"
              onClick={toggleCollapsed}
              className={`btn-ghost w-full text-caption ${collapsed ? "px-0" : "justify-start"}`}
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
            <div className={`flex gap-3 px-3 pt-1 text-caption text-ink-muted ${collapsed ? "sr-only" : ""}`}>
              <Link to="/privacy" className="hover:text-ink hover:underline">
                Privacy
              </Link>
              <Link to="/terms" className="hover:text-ink hover:underline">
                Terms
              </Link>
            </div>
          </div>
        </nav>

        <main
          id="main-content"
          role="main"
          aria-label="Main content"
          className="min-h-full w-full min-w-0 flex-1 overflow-x-hidden"
        >
          {overlay === "pharmacy" ? (
            <div id="pharmacy-menu" role="dialog" aria-modal="true" aria-label="Pharmacy">
              <PharmacyOverlay onClose={() => setOverlay(null)} />
            </div>
          ) : (
            <div className="mx-auto min-h-full max-w-7xl p-4 sm:p-6">{children}</div>
          )}
        </main>
      </div>

      <Toasts />
    </div>
  );
}

import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";
import { OfflineBadge } from "@/components/OfflineBadge";
import { OfflineBanner } from "@/components/OfflineBanner";
import Toasts from "@/components/Toasts";
import useLowStockWatcher from "@/features/inventory/useLowStockWatcher";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AccessibilityControls } from "@/components/AccessibilityControls";
import { SyncButton } from "@/components/SyncButton";
import { can } from "@/auth/roles";
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

  const baseNavigation = [
    { name: t("nav.dashboard"), href: "/dashboard", icon: HomeIcon },
    { name: t("nav.patients"), href: "/patients", icon: UserGroupIcon },
    { name: t("nav.queue"), href: "/queue", icon: QueueListIcon },
    { name: t("nav.inventory"), href: "/inventory", icon: CubeIcon },
    { name: t("nav.pharmacy"), href: "/pharmacy", icon: BeakerIcon },
    { name: t("nav.games"), href: "/games", icon: TrophyIcon },
    { name: t("nav.analytics"), href: "/analytics", icon: ChartBarIcon },
    { name: t("nav.issue_tickets"), href: "/tickets/issue", icon: TicketIcon },
    { name: t("nav.restock_game"), href: "/inv/game", icon: GiftIcon },
  ];

  // Add role-specific navigation items
  const canSeeOutreachReports =
    !!currentUser &&
    (currentUser.role === "admin" ||
      currentUser.role === "doctor" ||
      currentUser.role === "nurse");

  const navigation = [
    ...baseNavigation,
    // Doctor-specific items
    ...(currentUser && can(currentUser.role, "consult")
      ? [
          {
            name: t("nav.doctor_station"),
            href: "/doctor/dashboard",
            icon: ClipboardDocumentListIcon,
          },
        ]
      : []),
    // Outreach Summary report — clinical leads + admins
    ...(canSeeOutreachReports
      ? [
          {
            name: "Outreach Reports",
            href: "/reports/outreach",
            icon: ChartBarIcon,
          },
        ]
      : []),
    // Admin-only items
    ...(currentUser && can(currentUser.role, "users")
      ? [
          { name: t("nav.user_management"), href: "/users", icon: UsersIcon },
          {
            name: t("nav.approve_games"),
            href: "/admin/approvals",
            icon: CheckCircleIcon,
          },
          {
            name: "Conflicts",
            href: "/admin/conflicts",
            icon: DocumentDuplicateIcon,
          },
        ]
      : []),
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <OfflineBanner />
      <header
        role="banner"
        className="bg-primary text-white shadow-lg sticky top-0 z-30"
      >
        <div className="px-4 sm:px-6 h-[73px] flex items-center justify-between">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors min-h-touch-target min-w-touch-target"
            aria-label="Toggle menu"
          >
            <Bars3Icon className="h-6 w-6" />
          </button>

          <div className="flex-1 md:flex-initial">
            <h1 className="text-lg font-bold leading-tight">
              {t("app.title")}
            </h1>
            <p className="text-[11px] opacity-90 hidden sm:block">
              {t("app.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Online/Offline Badge */}
            <div className="hidden xs:block">
              <OfflineBadge />
            </div>

            {/* Sync Button */}
            <SyncButton />

            {/* Language Selector - Hidden on mobile */}
            <div className="hidden md:block">
              <LanguageSelector />
            </div>

            {/* Accessibility Controls - Hidden on mobile */}
            <div className="hidden lg:block">
              <AccessibilityControls />
            </div>

            {/* Logout button — user name/role shown in sidebar footer on desktop */}
            {currentUser && (
              <div className="flex items-center gap-2">
                <div className="text-right md:hidden">
                  <p className="text-sm font-medium">{currentUser.fullName}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors min-h-touch-target min-w-touch-target"
                  title={t("auth.logout")}
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex relative min-h-[calc(100vh-73px)]">
        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <nav
          role="navigation"
          aria-label="Main navigation"
          className={`
          fixed md:sticky md:top-0 inset-y-0 left-0 z-50
          w-64 bg-white border-r border-gray-100 shadow-lg md:shadow-sm flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          md:h-[calc(100vh-73px)] md:self-start
        `}
        >
          {/* Logo block — desktop only */}
          <div className="hidden md:flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <img
              src="/brand/mbhr-mark.svg"
              alt=""
              aria-hidden
              className="w-10 h-10 rounded-xl shrink-0"
            />
            <div>
              <div className="text-[15px] font-bold text-gray-900 leading-tight">
                MedBridge
              </div>
              <div className="text-[11px] text-gray-500">Health Reach</div>
            </div>
          </div>

          {/* Mobile header (close button + user) */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 md:hidden shrink-0">
            <div>
              <p className="font-semibold text-gray-900">
                {currentUser?.fullName}
              </p>
              <p className="text-xs text-gray-600 capitalize">
                {currentUser?.role}
              </p>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg hover:bg-gray-100 min-h-touch-target min-w-touch-target"
              aria-label="Close menu"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Mobile-only controls */}
          <div className="px-4 pb-3 space-y-2 md:hidden shrink-0">
            <LanguageSelector />
            <AccessibilityControls />
          </div>

          {/* Nav items — scrollable */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <ul className="space-y-0.5">
              {navigation.map((item) => {
                const isPharmacy = item.name === "Pharmacy";

                let isActive = false;
                if (isPharmacy) {
                  isActive =
                    location.pathname.startsWith("/rx/") ||
                    location.pathname === "/pharmacy" ||
                    location.pathname.startsWith("/pharmacy/");
                } else if (item.href === "/") {
                  isActive = location.pathname === "/";
                } else {
                  isActive =
                    location.pathname === item.href ||
                    location.pathname.startsWith(item.href + "/");
                }

                const Common = (
                  <>
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="font-medium">{item.name}</span>
                  </>
                );

                return (
                  <li key={item.name}>
                    {isPharmacy ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOverlay("pharmacy");
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors min-h-touch-target text-sm text-left ${
                          isActive
                            ? "bg-primary text-white"
                            : "text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                        }`}
                        aria-haspopup="dialog"
                        aria-controls="pharmacy-menu"
                        aria-current={isActive ? "page" : undefined}
                      >
                        {Common}
                      </button>
                    ) : (
                      <Link
                        to={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors min-h-touch-target text-sm ${
                          isActive
                            ? "bg-primary text-white"
                            : "text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                        }`}
                      >
                        {Common}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* User footer — desktop only */}
          {currentUser && (
            <div className="hidden md:block px-3 py-3 border-t border-gray-100 shrink-0">
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-sm shrink-0">
                  {currentUser.fullName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {currentUser.fullName}
                  </div>
                  <div className="text-xs text-gray-500 capitalize">
                    {currentUser.role}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-gray-400 hover:text-gray-700 p-1 rounded transition-colors"
                  title={t("auth.logout")}
                  aria-label={t("auth.logout")}
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
        </nav>

        {/* Main Content */}
        <main
          id="main-content"
          role="main"
          aria-label="Main content"
          className="flex-1 w-full md:w-auto overflow-x-hidden min-h-full"
        >
          {overlay === "pharmacy" ? (
            <div
              id="pharmacy-menu"
              role="dialog"
              aria-modal="true"
              className="p-4 sm:p-6"
            >
              <PharmacyOverlay onClose={() => setOverlay(null)} />
            </div>
          ) : (
            <div className="p-4 sm:p-6 max-w-7xl mx-auto min-h-full">
              {children}
            </div>
          )}
        </main>
      </div>

      {/* Toast notifications */}
      <Toasts />
    </div>
  );
}

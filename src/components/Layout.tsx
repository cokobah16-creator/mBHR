import React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { OfflineBadge } from '@/components/OfflineBadge'
import Toasts from '@/components/Toasts'
import useLowStockWatcher from '@/features/inventory/useLowStockWatcher'
import { LanguageSelector } from '@/components/LanguageSelector'
import { AccessibilityControls } from '@/components/AccessibilityControls'
import { SyncButton } from '@/components/SyncButton'
import { can } from '@/auth/roles'
import type { ElementType } from 'react'
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
  Bars3Icon
} from '@heroicons/react/24/outline'

// Pharmacy Overlay Component
function PharmacyOverlay({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

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
  ]

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
  )
}

// Fallback icon for nav items missing icons
const FallbackIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" />
  </svg>
)

type NavItem = {
  name: string
  href: string
  icon: ElementType
}

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { currentUser, logout, updateActivity, checkSessionExpiry } = useAuthStore()
  const [overlay, setOverlay] = React.useState<null | "pharmacy">(null)
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  // Start low stock monitoring
  useLowStockWatcher()

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Simple session check on mount and periodically
  React.useEffect(() => {
    if (!currentUser) return

    // Check immediately on mount
    const expired = checkSessionExpiry()
    if (expired) {
      navigate('/login')
      return
    }

    // Then check every 5 minutes (not every minute to reduce overhead)
    const interval = setInterval(() => {
      const expired = checkSessionExpiry()
      if (expired) {
        navigate('/login')
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [currentUser, checkSessionExpiry, navigate])

  // Update activity on user interaction
  React.useEffect(() => {
    if (!currentUser) return

    const handleActivity = () => {
      updateActivity()
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true })
    })

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity)
      })
    }
  }, [currentUser, updateActivity])

  const baseNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Patients', href: '/patients', icon: UserGroupIcon },
    { name: 'Queue', href: '/queue', icon: QueueListIcon },
    { name: 'Inventory', href: '/inventory', icon: CubeIcon },
    { name: 'Pharmacy', href: '/pharmacy', icon: BeakerIcon },
    { name: 'Game Hub', href: '/games', icon: TrophyIcon },
    { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
    { name: 'Issue Tickets', href: '/tickets/issue', icon: TicketIcon },
    { name: 'Restock Game', href: '/inv/game', icon: GiftIcon }
  ]

  // Add admin-only navigation items
  const navigation = [
    ...baseNavigation,
    ...(currentUser && can(currentUser.role, 'users') ? [
      { name: 'User Management', href: '/users', icon: UsersIcon },
      { name: 'Approve Games', href: '/admin/approvals', icon: CheckCircleIcon }
    ] : [])
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-primary text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3 md:py-4">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-primary/80 transition-colors min-h-touch-target min-w-touch-target"
              aria-label="Toggle menu"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            <div className="flex-1 md:flex-initial">
              <h1 className="text-lg md:text-xl font-bold text-shadow">
                {t('app.title')}
              </h1>
              <p className="text-xs md:text-sm opacity-90 hidden sm:block">
                {t('app.subtitle')}
              </p>
            </div>

            <div className="flex items-center gap-2 md:gap-4">

              {/* Online/Offline Badge - Hidden on very small screens */}
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

              {/* User Info - Compact on mobile */}
              {currentUser && (
                <div className="flex items-center gap-2">
                  <div className="text-right hidden md:block">
                    <p className="text-sm font-medium">{currentUser.fullName}</p>
                    <p className="text-xs opacity-75 capitalize">{currentUser.role}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg hover:bg-primary/80 transition-colors min-h-touch-target min-w-touch-target"
                    title={t('auth.logout')}
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
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
        <nav className={`
          fixed md:sticky md:top-0 inset-y-0 left-0 z-50
          w-64 bg-white shadow-lg md:shadow-sm
          transform transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          overflow-y-auto md:h-[calc(100vh-73px)] md:self-start
        `}>
          <div className="p-4">
            {/* Mobile Menu Header */}
            <div className="flex items-center justify-between mb-4 md:hidden">
              <div>
                <p className="font-semibold text-gray-900">{currentUser?.fullName}</p>
                <p className="text-xs text-gray-600 capitalize">{currentUser?.role}</p>
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
            <div className="mb-4 space-y-2 md:hidden">
              <LanguageSelector />
              <AccessibilityControls />
            </div>

            <ul className="space-y-1 md:space-y-2">
              {navigation.map((item) => {
                const isPharmacy = item.name === 'Pharmacy'

                // Better active state detection
                let isActive = false
                if (isPharmacy) {
                  isActive = location.pathname.startsWith('/rx/') ||
                            location.pathname === '/pharmacy' ||
                            location.pathname.startsWith('/pharmacy/')
                } else if (item.href === '/') {
                  isActive = location.pathname === '/'
                } else {
                  isActive = location.pathname === item.href ||
                            location.pathname.startsWith(item.href + '/')
                }

                const Common = (
                  <>
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="font-medium">{item.name}</span>
                  </>
                )

                return (
                  <li key={item.name}>
                    {isPharmacy ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOverlay("pharmacy")
                          setMobileMenuOpen(false)
                        }}
                        className={`w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg transition-colors min-h-touch-target text-left ${
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                        }`}
                        aria-haspopup="dialog"
                        aria-controls="pharmacy-menu"
                      >
                        {Common}
                      </button>
                    ) : (
                      <Link
                        to={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg transition-colors min-h-touch-target ${
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                        }`}
                      >
                        {Common}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 w-full md:w-auto overflow-x-hidden min-h-full">
          {overlay === "pharmacy" ? (
            <div id="pharmacy-menu" role="dialog" aria-modal="true" className="p-4 sm:p-6">
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
  )
}
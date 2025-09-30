import React from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { OfflineBadge } from '@/components/OfflineBadge'
import Toasts from '@/components/Toasts'
import useLowStockWatcher from '@/features/inventory/useLowStockWatcher'
import { LanguageSelector } from '@/components/LanguageSelector'
import { AccessibilityControls } from '@/components/AccessibilityControls'
import { can } from '@/auth/roles'
import type { ElementType, ReactNode } from 'react'
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
  XMarkIcon
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
  const { currentUser, logout } = useAuthStore()
  const [overlay, setOverlay] = React.useState<null | "pharmacy">(null)
  
  // Start low stock monitoring
  useLowStockWatcher()

  const baseNavigation = [
    { name: t('nav.dashboard'), href: '/', icon: HomeIcon },
    { name: t('nav.patients'), href: '/patients', icon: UserGroupIcon },
    { name: t('nav.queue'), href: '/queue', icon: QueueListIcon },
    { name: t('nav.inventory'), href: '/inventory', icon: CubeIcon },
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
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-primary text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-xl font-bold text-shadow">
                {t('app.title')}
              </h1>
              <p className="text-sm opacity-90">
                {t('app.subtitle')}
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Online/Offline Badge */}
              <OfflineBadge />
              
              {/* Language Selector */}
              <LanguageSelector />
              
              {/* Accessibility Controls */}
              <AccessibilityControls />
              
              {/* User Info */}
              {currentUser && (
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <p className="text-sm font-medium">{currentUser.fullName}</p>
                    <p className="text-xs opacity-75 capitalize">{currentUser.role}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg hover:bg-primary/80 transition-colors touch-target"
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

      <div className="flex">
        {/* Sidebar */}
        <nav className="w-64 bg-white shadow-sm min-h-screen">
          <div className="p-4">
            <ul className="space-y-2">
              {navigation.map((item) => {
                const isPharmacy = item.name === 'Pharmacy'
                const isActive = isPharmacy 
                  ? (location.pathname.startsWith('/rx/') || location.pathname === '/pharmacy' || location.pathname.startsWith('/pharmacy/')) && overlay !== null
                  : location.pathname === item.href
                
                const Common = (
                  <>
                    <item.icon className="h-5 w-5" />
                    <span className="font-medium">{item.name}</span>
                  </>
                )
                
                return (
                  <li key={item.name}>
                    {isPharmacy ? (
                      <button
                        type="button"
                        onClick={() => setOverlay("pharmacy")}
                        className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors touch-target text-left ${
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                        aria-haspopup="dialog"
                        aria-controls="pharmacy-menu"
                      >
                        {Common}
                      </button>
                    ) : (
                      <Link
                        to={item.href}
                        className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors touch-target ${
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-gray-700 hover:bg-gray-100'
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
        <main className="flex-1">
          {overlay === "pharmacy" ? (
            <div id="pharmacy-menu" role="dialog" aria-modal="true" className="p-6">
              <PharmacyOverlay onClose={() => setOverlay(null)} />
            </div>
          ) : (
            <div className="p-6">
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
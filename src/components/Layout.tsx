import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { OfflineBadge } from '@/components/OfflineBadge'
import Toasts from '@/components/Toasts'
import useLowStockWatcher from '@/features/inventory/useLowStockWatcher'
import { LanguageSelector } from '@/components/LanguageSelector'
import { AccessibilityControls } from '@/components/AccessibilityControls'
import { MessageOutbox } from '@/components/MessageOutbox'
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
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  ChartBarIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

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
  const [pharmacyExpanded, setPharmacyExpanded] = React.useState(false)
  
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
                const isActive = location.pathname === item.href
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors touch-target ${
                        isActive
                          ? 'bg-primary text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
      
      {/* Toast notifications */}
      <Toasts />
    </div>
  )
}
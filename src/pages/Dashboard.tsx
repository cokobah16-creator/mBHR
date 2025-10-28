import React, { useEffect, useState, useMemo, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { can } from '@/auth/roles'
import { queryCache, createCacheKey } from '@/utils/queryCache'
import { OfflineAnalytics } from '@/components/OfflineAnalytics'
import { EnhancedQueueBoard } from '@/components/EnhancedQueueBoard'
import { ExportButtons } from '@/components/ExportButtons'
import { AudioButton } from '@/components/AudioButton'
import { MessageOutbox } from '@/components/MessageOutbox'
import { SyncDashboard } from '@/components/SyncDashboard'
import { AppointmentCalendar } from '@/features/appointments/AppointmentCalendar'
import {
  UserPlusIcon,
  UsersIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  CubeIcon,
  Cog6ToothIcon,
  QueueListIcon,
  CalendarIcon,
  EnvelopeIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'

// Memoized stat card component
const StatCard = memo(({ icon: Icon, label, value, colorClass }: {
  icon: any
  label: string
  value: number
  colorClass: string
}) => (
  <div className="bg-white rounded-lg shadow-sm p-6">
    <div className="flex items-center">
      <div className={`flex-shrink-0 p-2 rounded-lg ${colorClass}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="ml-4">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  </div>
))
StatCard.displayName = 'StatCard'

export function Dashboard() {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [stats, setStats] = useState({
    totalPatients: 0,
    todayRegistrations: 0,
    totalUsers: 0
  })
  const [showAppointments, setShowAppointments] = useState(false)
  const [showSync, setShowSync] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      // Check cache first
      const cacheKey = createCacheKey('dashboard', 'stats', new Date().toDateString())
      const cached = queryCache.get<typeof stats>(cacheKey)

      if (cached) {
        setStats(cached)
        return
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [totalPatients, todayRegistrations, totalUsers] = await Promise.all([
        db.patients.count(),
        db.patients.where('createdAt').between(today, tomorrow).count(),
        db.users.count()
      ])

      const newStats = {
        totalPatients,
        todayRegistrations,
        totalUsers
      }

      setStats(newStats)
      // Cache for 5 minutes
      queryCache.set(cacheKey, newStats, 5 * 60 * 1000)
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // Memoize quick actions based on user role
  const quickActions = useMemo(() => {
    const actions = [
      {
        name: 'Register Patient',
        href: '/register',
        icon: UserPlusIcon,
        color: 'bg-blue-500 hover:bg-blue-600',
        description: 'Add new patient'
      },
      {
        name: 'View Patients',
        href: '/patients',
        icon: UsersIcon,
        color: 'bg-green-500 hover:bg-green-600',
        description: 'Patient records'
      },
      {
        name: 'View Queue',
        href: '/queue',
        icon: HeartIcon,
        color: 'bg-purple-500 hover:bg-purple-600',
        description: 'Patient flow'
      },
      {
        name: 'Inventory',
        href: '/inventory',
        icon: CubeIcon,
        color: 'bg-orange-500 hover:bg-orange-600',
        description: 'Stock management'
      }
    ]

    // Add role-specific actions
    if (currentUser) {
      // Doctor Station for doctors
      if (can(currentUser.role, 'consult')) {
        actions.unshift({
          name: 'Doctor Station',
          href: '/doctor/dashboard',
          icon: DocumentTextIcon,
          color: 'bg-blue-600 hover:bg-blue-700',
          description: 'Consultation queue & tools'
        })

        actions.push({
          name: 'Lab Results',
          href: '/labs',
          icon: BeakerIcon,
          color: 'bg-teal-500 hover:bg-teal-600',
          description: 'Lab orders & results'
        })
      }

      // Appointments for all clinical staff
      if (can(currentUser.role, 'vitals')) {
        actions.push({
          name: 'Appointments',
          href: '/appointments',
          icon: CalendarIcon,
          color: 'bg-indigo-500 hover:bg-indigo-600',
          description: 'Schedule & manage'
        })
      }

      // SMS reminders for pharmacists
      if (can(currentUser.role, 'dispense')) {
        actions.push({
          name: 'SMS Reminders',
          href: '/pharmacy/sms-reminders',
          icon: EnvelopeIcon,
          color: 'bg-pink-500 hover:bg-pink-600',
          description: 'Medication alerts'
        })
      }

      // Admin actions
      if (can(currentUser.role, 'users')) {
        actions.push({
          name: 'User Management',
          href: '/users',
          icon: Cog6ToothIcon,
          color: 'bg-purple-500 hover:bg-purple-600',
          description: 'Manage users'
        })
      }
    }

    return actions
  }, [currentUser])

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }, [])
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Welcome Header */}
      <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Welcome back, {currentUser?.fullName}
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              Here's what's happening at your clinic today
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs sm:text-sm text-gray-500">
              {formattedDate}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <StatCard
          icon={UsersIcon}
          label="Total Patients"
          value={stats.totalPatients}
          colorClass="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon={UserPlusIcon}
          label="Today's Registrations"
          value={stats.todayRegistrations}
          colorClass="bg-green-50 text-green-600"
        />
        <StatCard
          icon={HeartIcon}
          label="System Users"
          value={stats.totalUsers}
          colorClass="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Control Buttons */}
      <div className="flex flex-wrap gap-3">
        {currentUser && can(currentUser.role, 'vitals') && (
          <button
            onClick={() => setShowAppointments(!showAppointments)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <CalendarIcon className="h-5 w-5 mr-2 text-gray-400" />
            {showAppointments ? 'Hide Appointments' : 'Show Appointments'}
          </button>
        )}
        {currentUser && can(currentUser.role, 'users') && (
          <button
            onClick={() => setShowSync(!showSync)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-5 w-5 mr-2 text-gray-400" />
            {showSync ? 'Hide Sync Dashboard' : 'Show Sync Dashboard'}
          </button>
        )}
      </div>

      {/* Appointments Section */}
      {showAppointments && currentUser && (
        <AppointmentCalendar createdBy={currentUser.id} />
      )}

      {/* Sync Dashboard */}
      {showSync && currentUser && can(currentUser.role, 'users') && (
        <SyncDashboard />
      )}

      {/* Message Outbox */}
      <MessageOutbox />

      {/* Enhanced Analytics */}
      <OfflineAnalytics />

      {/* Enhanced Queue Overview */}
      <EnhancedQueueBoard />

      {/* Data Export */}
      <ExportButtons />

      {/* Getting Started */}
      <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 font-semibold text-sm">1</span>
            </div>
            <div>
              <p className="font-medium text-gray-900">Register your first patient</p>
              <p className="text-sm text-gray-600">Start by adding patient information to the system</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 font-semibold text-sm">2</span>
            </div>
            <div>
              <p className="font-medium text-gray-900">Record vital signs</p>
              <p className="text-sm text-gray-600">Take measurements and track patient health</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-purple-600 font-semibold text-sm">3</span>
            </div>
            <div>
              <p className="font-medium text-gray-900">Manage inventory</p>
              <p className="text-sm text-gray-600">Keep track of medications and supplies</p>
            </div>
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <AudioButton
              audioKey="action.register"
              fallbackText="Register Patient"
              onClick={() => {}}
              className="btn-primary"
            >
              <Link to="/register" className="flex items-center space-x-2">
                <UserPlusIcon className="h-5 w-5" />
                <span>Register Patient</span>
              </Link>
            </AudioButton>
            <AudioButton
              audioKey="nav.queue"
              fallbackText="View Queue"
              onClick={() => {}}
              className="btn-secondary"
            >
              <Link to="/queue" className="flex items-center space-x-2">
                <QueueListIcon className="h-5 w-5" />
                <span>View Queue</span>
              </Link>
            </AudioButton>
          </div>
        </div>
      </div>
    </div>
  )
}
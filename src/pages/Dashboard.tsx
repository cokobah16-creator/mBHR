import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueueStore } from '@/stores/queue'
import { useAuthStore } from '@/stores/auth'
import { ExportButtons } from '@/components/ExportButtons'
import { 
  UserPlusIcon, 
  HeartIcon, 
  DocumentTextIcon, 
  BeakerIcon,
  UsersIcon,
  ClockIcon
} from '@heroicons/react/24/outline'

export function Dashboard() {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const { queueItems, loadQueue, getQueueByStage } = useQueueStore()
  const [stats, setStats] = useState({
    totalPatients: 0,
    todayRegistrations: 0,
    activeVisits: 0
  })

  useEffect(() => {
    loadQueue()
    loadStats()
  }, [])

  const loadStats = async () => {
    // TODO: Load actual stats from database
    setStats({
      totalPatients: 0,
      todayRegistrations: 0,
      activeVisits: 0
    })
  }

  const registrationQueue = getQueueByStage('registration')
  const vitalsQueue = getQueueByStage('vitals')
  const consultQueue = getQueueByStage('consult')
  const pharmacyQueue = getQueueByStage('pharmacy')

  const quickActions = [
    {
      name: 'Register Patient',
      href: '/register',
      icon: UserPlusIcon,
      color: 'bg-blue-500 hover:bg-blue-600',
      roles: ['admin', 'nurse', 'volunteer']
    },
    {
      name: 'Record Vitals',
      href: '/vitals',
      icon: HeartIcon,
      color: 'bg-green-500 hover:bg-green-600',
      roles: ['admin', 'nurse', 'volunteer']
    },
    {
      name: 'Consultation',
      href: '/consult',
      icon: DocumentTextIcon,
      color: 'bg-purple-500 hover:bg-purple-600',
      roles: ['admin', 'doctor']
    },
    {
      name: 'Pharmacy',
      href: '/pharmacy',
      icon: BeakerIcon,
      color: 'bg-orange-500 hover:bg-orange-600',
      roles: ['admin', 'pharmacist']
    }
  ]

  const userCanAccess = (roles: string[]) => {
    return currentUser && roles.includes(currentUser.role)
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {currentUser?.fullName}
        </h1>
        <p className="text-gray-600 mt-1">
          Here's what's happening at your clinic today
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UsersIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Patients</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalPatients}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserPlusIcon className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Today's Registrations</p>
              <p className="text-2xl font-bold text-gray-900">{stats.todayRegistrations}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ClockIcon className="h-8 w-8 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Active Visits</p>
              <p className="text-2xl font-bold text-gray-900">{stats.activeVisits}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            userCanAccess(action.roles) && (
              <Link
                key={action.name}
                to={action.href}
                className={`${action.color} text-white rounded-lg p-4 text-center transition-colors touch-target`}
              >
                <action.icon className="h-8 w-8 mx-auto mb-2" />
                <span className="text-sm font-medium">{action.name}</span>
              </Link>
            )
          ))}
        </div>
      </div>

      {/* Queue Overview */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Queue</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{registrationQueue.length}</p>
            <p className="text-sm text-blue-800">Registration</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{vitalsQueue.length}</p>
            <p className="text-sm text-green-800">Vitals</p>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <p className="text-2xl font-bold text-purple-600">{consultQueue.length}</p>
            <p className="text-sm text-purple-800">Consultation</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <p className="text-2xl font-bold text-orange-600">{pharmacyQueue.length}</p>
            <p className="text-sm text-orange-800">Pharmacy</p>
          </div>
        </div>
      </div>

      {/* Data Export (Admin Only) */}
      {currentUser?.role === 'admin' && (
        <ExportButtons />
      )}
    </div>
  )
}
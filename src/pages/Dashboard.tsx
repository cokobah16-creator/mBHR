import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { can } from '@/auth/roles'
import { 
  UserPlusIcon, 
  UsersIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  CubeIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline'

export function Dashboard() {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [stats, setStats] = useState({
    totalPatients: 0,
    todayRegistrations: 0,
    totalUsers: 0
  })

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [totalPatients, todayRegistrations, totalUsers] = await Promise.all([
        db.patients.count(),
        db.patients.where('createdAt').between(today, tomorrow).count(),
        db.users.count()
      ])

      setStats({
        totalPatients,
        todayRegistrations,
        totalUsers
      })
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  const quickActions = [
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

  // Add admin-only actions
  if (currentUser && can(currentUser.role, 'users')) {
    quickActions.push({
      name: 'User Management',
      href: '/users',
      icon: Cog6ToothIcon,
      color: 'bg-purple-500 hover:bg-purple-600',
      description: 'Manage users'
    })
  }
  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {currentUser?.fullName}
            </h1>
            <p className="text-gray-600 mt-1">
              Here's what's happening at your clinic today
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-blue-50">
              <UsersIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Patients</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalPatients}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-green-50">
              <UserPlusIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Today's Registrations</p>
              <p className="text-2xl font-bold text-gray-900">{stats.todayRegistrations}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-purple-50">
              <HeartIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">System Users</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalUsers}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <Link
              key={action.name}
              to={action.href}
              className={`${action.color} text-white rounded-lg p-4 text-center transition-colors touch-target group hover:scale-105 transform transition-transform`}
            >
              <action.icon className="h-8 w-8 mx-auto mb-2 group-hover:scale-110 transition-transform" />
              <div className="text-sm font-medium">{action.name}</div>
              <div className="text-xs opacity-90 mt-1">{action.description}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Getting Started */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
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
      </div>
    </div>
  )
}
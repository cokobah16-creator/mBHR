import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueueStore } from '@/stores/queue'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { QuickActions } from '@/components/QuickActions'
import { StatsCards } from '@/components/StatsCards'
import { RecentActivity } from '@/components/RecentActivity'
import { ExportButtons } from '@/components/ExportButtons'
import { UserManagement } from '@/components/UserManagement'

export function Dashboard() {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const { queueItems, loadQueue, getQueueByStage } = useQueueStore()

  useEffect(() => {
    loadQueue()
  }, [])

  const registrationQueue = getQueueByStage('registration')
  const vitalsQueue = getQueueByStage('vitals')
  const consultQueue = getQueueByStage('consult')
  const pharmacyQueue = getQueueByStage('pharmacy')

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
      <StatsCards />

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <QuickActions />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue Overview */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Queue</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              <p className="text-2xl font-bold text-blue-600">{registrationQueue.length}</p>
              <p className="text-sm text-blue-800">Registration</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors">
              <p className="text-2xl font-bold text-green-600">{vitalsQueue.length}</p>
              <p className="text-sm text-green-800">Vitals</p>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
              <p className="text-2xl font-bold text-purple-600">{consultQueue.length}</p>
              <p className="text-sm text-purple-800">Consultation</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors">
              <p className="text-2xl font-bold text-orange-600">{pharmacyQueue.length}</p>
              <p className="text-sm text-orange-800">Pharmacy</p>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <RecentActivity />
        </div>
      </div>

      {/* Data Export (Admin Only) */}
      {currentUser && can(currentUser.role, 'export') && (
        <ExportButtons />
      )}

      {/* User Management (Admin Only) */}
      {currentUser && can(currentUser.role, 'users') && (
        <UserManagement />
      )}
    </div>
  )
}
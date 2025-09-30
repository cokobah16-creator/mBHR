import React from 'react'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { UserManagement } from '@/components/UserManagement'
import { UsersIcon } from '@heroicons/react/24/outline'

export function Users() {
  const { currentUser } = useAuthStore()

  // Only admins can access user management
  if (!currentUser || !can(currentUser.role, 'users')) {
    return (
      <div className="text-center py-12">
        <UsersIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
        <p className="text-gray-600">You don't have permission to manage users.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <UsersIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600">Manage system users and permissions</p>
        </div>
      </div>

      {/* User Management Component */}
      <UserManagement />
    </div>
  )
}
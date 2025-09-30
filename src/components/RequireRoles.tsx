import React from 'react'
import { useAuthStore } from '@/stores/auth'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

type Props = { 
  roles: Array<'volunteer'|'inventory_lead'|'pharmacist'|'nurse'|'doctor'|'admin'>
  children: React.ReactNode 
}

export function RequireRoles({ roles, children }: Props) {
  const { currentUser } = useAuthStore()
  const userRole = currentUser?.role as any
  
  if (!currentUser || !userRole || !roles.includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Access Restricted
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              You do not have permission to view this page.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Required roles: {roles.join(', ')}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Your role: {userRole || 'none'}
            </p>
          </div>
        </div>
      </div>
    )
  }
  
  return <>{children}</>
}
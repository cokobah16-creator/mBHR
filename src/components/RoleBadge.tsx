import React from 'react'
import { User } from '@/db'

interface RoleBadgeProps {
  role: User['role']
  className?: string
}

export function RoleBadge({ role, className = '' }: RoleBadgeProps) {
  const getRoleColor = (role: User['role']) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-800'
      case 'doctor':
        return 'bg-blue-100 text-blue-800'
      case 'nurse':
        return 'bg-green-100 text-green-800'
      case 'pharmacist':
        return 'bg-orange-100 text-orange-800'
      case 'volunteer':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(
        role
      )} ${className}`}
    >
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  )
}
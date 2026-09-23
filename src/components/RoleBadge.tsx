import React from 'react'
import { User } from '@/db'

interface RoleBadgeProps {
  role: User['role']
  className?: string
}

/** "lead_clinician" → "Lead clinician". */
function roleLabel(role: User['role']): string {
  const words = String(role).replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A staff role is an identity, not a state, so every role uses the neutral
 * badge: colour stays reserved for clinical and operational meaning.
 */
export function RoleBadge({ role, className = '' }: RoleBadgeProps) {
  return (
    <span className={`badge badge-neutral ${className}`}>
      {roleLabel(role)}
    </span>
  )
}

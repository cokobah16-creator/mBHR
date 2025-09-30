import React, { useState, useEffect } from 'react'
import { WifiIcon, SignalSlashIcon } from '@heroicons/react/24/outline'
import { isOnlineSyncEnabled, isConfigured } from '@/sync/adapter'

export function OfflineBadge() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Check if Supabase is configured
    setConfigured(isConfigured())

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const getBadgeContent = () => {
    if (!isOnline) {
      return {
        icon: SignalSlashIcon,
        text: 'Offline',
        className: 'bg-red-100 text-red-800 border-red-200'
      }
    }

    if (!configured) {
      return {
        icon: SignalSlashIcon,
        text: 'Local Only',
        className: 'bg-yellow-100 text-yellow-800 border-yellow-200'
      }
    }

    if (isOnlineSyncEnabled()) {
      return {
        icon: WifiIcon,
        text: 'Online + Sync',
        className: 'bg-green-100 text-green-800 border-green-200'
      }
    }

    return {
      icon: WifiIcon,
      text: 'Online',
      className: 'bg-blue-100 text-blue-800 border-blue-200'
    }
  }

  const { icon: Icon, text, className } = getBadgeContent()

  return (
    <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${className}`}>
      <Icon className="h-3 w-3" />
      <span>{text}</span>
    </div>
  )
}
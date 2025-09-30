import React, { useState } from 'react'
import { syncNow, isOnlineSyncEnabled } from '@/sync/adapter'
import { ArrowPathIcon } from '@heroicons/react/24/outline'

export function SyncButton() {
  const [syncing, setSyncing] = useState(false)
  
  if (!isOnlineSyncEnabled()) return null

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncNow()
    } catch (error) {
      console.error('Manual sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="p-2 rounded-lg hover:bg-primary/80 transition-colors touch-target"
      title="Sync Now"
    >
      <ArrowPathIcon className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} />
    </button>
  )
}
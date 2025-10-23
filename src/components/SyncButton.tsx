import React, { useState, useEffect, memo } from 'react'
import { supabaseSync } from '@/services/supabaseSync'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

export const SyncButton = memo(() => {
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState(supabaseSync.getStatus())

  useEffect(() => {
    return supabaseSync.onStatusChange(setStatus)
  }, [])

  if (!supabaseSync.isInitialized()) return null

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await supabaseSync.syncAll()
      if (!result.success) {
        console.error('Sync failed:', result.error)
      }
    } catch (error) {
      console.error('Manual sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }

  const showStatus = status.lastSync || status.errorMessage

  return (
    <div className="flex items-center gap-2">
      {showStatus && (
        <div className="flex items-center gap-1 text-xs">
          {status.errorMessage ? (
            <>
              <ExclamationCircleIcon className="h-4 w-4 text-red-500" />
              <span className="text-red-600">Sync error</span>
            </>
          ) : status.lastSync ? (
            <>
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
              <span className="text-gray-600">
                {new Date(status.lastSync).toLocaleTimeString()}
              </span>
            </>
          ) : null}
          {status.pendingChanges > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
              {status.pendingChanges}
            </span>
          )}
        </div>
      )}
      <button
        onClick={handleSync}
        disabled={syncing || status.status === 'syncing'}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
        title={syncing ? 'Syncing...' : 'Sync with cloud'}
      >
        <ArrowPathIcon
          className={`h-5 w-5 ${syncing || status.status === 'syncing' ? 'animate-spin' : ''}`}
        />
      </button>
    </div>
  )
})

SyncButton.displayName = 'SyncButton'
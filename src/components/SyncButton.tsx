import React, { useState, useEffect, memo } from 'react'
import { syncNow, isOnlineSyncEnabled } from '@/sync/adapter'
import { useSyncStore } from '@/stores/syncStore'
import { useOperationsQueue } from '@/stores/operationsQueue'
import { resolveConflict } from '@/sync/conflictResolver'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon, QueueListIcon } from '@heroicons/react/24/outline'
import { ConflictResolutionModal, ConflictData } from './ConflictResolutionModal'

export const SyncButton = memo(() => {
  const syncStore = useSyncStore()
  const queueStore = useOperationsQueue()
  const [conflicts, setConflicts] = useState<ConflictData[]>([])
  const [currentConflict, setCurrentConflict] = useState<ConflictData | null>(null)

  if (!isOnlineSyncEnabled()) return null

  const handleSync = async () => {
    syncStore.setStatus('syncing')

    try {
      const result = await syncNow()

      if (result.conflicts && result.conflicts.length > 0) {
        setConflicts(result.conflicts)
        setCurrentConflict(result.conflicts[0])
      }
    } catch (error) {
      console.error('Manual sync failed:', error)
    }
  }

  const handleConflictResolve = async (strategy: 'keep-local' | 'keep-remote' | 'manual', resolution?: any) => {
    if (!currentConflict) return

    try {
      await resolveConflict(
        currentConflict,
        strategy,
        resolution
      )

      const remaining = conflicts.slice(1)
      setConflicts(remaining)
      setCurrentConflict(remaining[0] || null)

      if (remaining.length === 0) {
        await handleSync()
      }
    } catch (error) {
      console.error('Failed to resolve conflict:', error)
    }
  }

  const handleConflictCancel = () => {
    setCurrentConflict(null)
    setConflicts([])
  }

  const pendingCount = queueStore.getPendingCount()
  const failedCount = queueStore.getFailedCount()
  const isSyncing = syncStore.status === 'syncing'
  const showStatus = syncStore.lastSuccessAt > 0 || syncStore.errorMessage

  return (
    <>
      <div className="flex items-center gap-2">
        {showStatus && (
          <div className="flex items-center gap-1 text-xs">
            {syncStore.errorMessage ? (
              <>
                <ExclamationCircleIcon className="h-4 w-4 text-red-500" />
                <span className="text-red-600">Sync error</span>
              </>
            ) : syncStore.lastSuccessAt > 0 ? (
              <>
                <CheckCircleIcon className="h-4 w-4 text-green-500" />
                <span className="text-gray-600">
                  {new Date(syncStore.lastSuccessAt).toLocaleTimeString()}
                </span>
              </>
            ) : null}
          </div>
        )}

        {(pendingCount > 0 || failedCount > 0) && (
          <div className="flex items-center gap-1 text-xs">
            <QueueListIcon className="h-4 w-4 text-blue-500" />
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                {pendingCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">
                {failedCount} failed
              </span>
            )}
          </div>
        )}

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          title={isSyncing ? 'Syncing...' : 'Sync with cloud'}
        >
          <ArrowPathIcon
            className={`h-5 w-5 ${isSyncing ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {currentConflict && (
        <ConflictResolutionModal
          conflict={currentConflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictCancel}
        />
      )}
    </>
  )
})

SyncButton.displayName = 'SyncButton'
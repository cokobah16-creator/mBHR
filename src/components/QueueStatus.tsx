import React from 'react'
import { useOperationsQueue } from '@/stores/operationsQueue'
import { QueueListIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon } from '@heroicons/react/24/outline'

export function QueueStatus() {
  const queueStore = useOperationsQueue()

  const pendingCount = queueStore.getPendingCount()
  const failedCount = queueStore.getFailedCount()
  const completedOps = queueStore.operations.filter(op => op.status === 'completed')

  if (pendingCount === 0 && failedCount === 0 && completedOps.length === 0) {
    return null
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <QueueListIcon className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Sync Queue</h3>
        </div>

        {completedOps.length > 0 && (
          <button
            onClick={() => queueStore.clearCompleted()}
            className="text-xs text-gray-600 hover:text-gray-900"
          >
            Clear completed
          </button>
        )}
      </div>

      <div className="space-y-2">
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <ClockIcon className="h-4 w-4 text-blue-500" />
            <span className="text-gray-700">{pendingCount} pending operation{pendingCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {queueStore.totalProcessed > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircleIcon className="h-4 w-4 text-green-500" />
            <span className="text-gray-700">{queueStore.totalProcessed} synced</span>
          </div>
        )}

        {failedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <ExclamationCircleIcon className="h-4 w-4 text-red-500" />
            <span className="text-gray-700">{failedCount} failed</span>
            <button
              onClick={() => queueStore.retryAllFailed()}
              className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Retry all
            </button>
          </div>
        )}
      </div>

      {queueStore.isProcessing && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
            <span>Processing queue...</span>
          </div>
        </div>
      )}

      {(pendingCount > 0 || failedCount > 0) && (
        <div className="mt-3 text-xs text-gray-500">
          Operations will sync automatically when online
        </div>
      )}
    </div>
  )
}

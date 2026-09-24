import { useOperationsQueue } from '@/stores/operationsQueue'
import { isSupabaseEnabled } from '@/lib/supabaseClient'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ArrowPathIcon, QueueListIcon } from '@heroicons/react/24/outline'

/**
 * Operations saved on this device that are waiting for, or failed, their
 * background processing. Says plainly that pending work has not been sent.
 */
export function QueueStatus() {
  const queueStore = useOperationsQueue()

  const pendingCount = queueStore.getPendingCount()
  const failedCount = queueStore.getFailedCount()
  const completedOps = queueStore.operations.filter(op => op.status === 'completed')
  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  if (pendingCount === 0 && failedCount === 0 && completedOps.length === 0) {
    return null
  }

  const plural = (n: number) => (n === 1 ? '' : 's')

  return (
    <section className="panel" aria-labelledby="ops-queue-title">
      <div className="panel-header">
        <h3 id="ops-queue-title" className="panel-title flex items-center gap-2">
          <QueueListIcon className="h-5 w-5 text-ink-muted" aria-hidden />
          Saved operations on this device
        </h3>
        {completedOps.length > 0 && (
          <button
            type="button"
            onClick={() => queueStore.clearCompleted()}
            className="btn-ghost text-label"
          >
            Clear finished
          </button>
        )}
      </div>

      <div className="panel-body space-y-2">
        <ul className="space-y-2" aria-live="polite">
          {pendingCount > 0 && (
            <li className="flex items-center gap-2">
              <StatusBadge tone="warning">Not sent yet</StatusBadge>
              <span className="text-body text-ink-secondary">
                {pendingCount} operation{plural(pendingCount)} saved on this device
              </span>
            </li>
          )}

          {queueStore.totalProcessed > 0 && (
            <li className="flex items-center gap-2">
              <StatusBadge tone="success" icon>Processed</StatusBadge>
              <span className="text-body text-ink-secondary">
                {queueStore.totalProcessed} operation{plural(queueStore.totalProcessed)}
              </span>
            </li>
          )}

          {failedCount > 0 && (
            <li className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="danger">Failed</StatusBadge>
              <span className="text-body text-ink-secondary">
                {failedCount} operation{plural(failedCount)} could not be processed
              </span>
              <button
                type="button"
                onClick={() => queueStore.retryAllFailed()}
                className="btn-ghost ml-auto text-label"
              >
                <ArrowPathIcon className="h-4 w-4" aria-hidden />
                Retry failed
              </button>
            </li>
          )}
        </ul>

        {queueStore.isProcessing && (
          <p role="status" className="flex items-center gap-2 border-t border-line pt-2 text-body text-info-fg">
            <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden />
            Processing saved operations…
          </p>
        )}

        {(pendingCount > 0 || failedCount > 0) && (
          <p className="text-caption text-ink-muted">
            {!isSupabaseEnabled
              ? 'Sync is not set up on this device, so these stay here until it is.'
              : !online
                ? 'This device is offline. These stay saved here and are only sent once it is back online.'
                : 'These stay saved here until they are processed. Nothing has been sent for them yet.'}
          </p>
        )}
      </div>
    </section>
  )
}

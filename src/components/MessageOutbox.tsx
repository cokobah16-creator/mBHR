import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useT'
import { getMessageService } from '@/services/messaging'
import { MessageQueue } from '@/db/outbox'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { 
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'

export function MessageOutbox() {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const [stats, setStats] = useState({ queued: 0, sent: 0, failed: 0, delivered: 0 })
  const [processing, setProcessing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  // Only admins and nurses can manage messaging
  if (!currentUser || !can(currentUser.role, 'export')) {
    return null
  }

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
      const messageStats = await MessageQueue.getStats()
      setStats(messageStats)
    } catch (error) {
      console.error('Error loading message stats:', error)
    }
  }

  const processMessages = async () => {
    setProcessing(true)
    try {
      const messageService = getMessageService()
      const result = await messageService.processOutbox()
      
      setLastSync(new Date())
      await loadStats()
      
      if (result.sent > 0 || result.failed > 0) {
        alert(t('messaging.processComplete', { 
          sent: result.sent.toString(), 
          failed: result.failed.toString() 
        }))
      } else {
        alert(t('messaging.noMessages'))
      }
    } catch (error) {
      console.error('Error processing outbox:', error)
      alert(t('messaging.processError'))
    } finally {
      setProcessing(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'queued':
        return ClockIcon
      case 'sent':
        return CheckCircleIcon
      case 'delivered':
        return CheckCircleIcon
      case 'failed':
        return XCircleIcon
      default:
        return ClockIcon
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'queued':
        return 'text-yellow-600 bg-yellow-50'
      case 'sent':
        return 'text-blue-600 bg-blue-50'
      case 'delivered':
        return 'text-green-600 bg-green-50'
      case 'failed':
        return 'text-red-600 bg-red-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <ChatBubbleLeftRightIcon className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-gray-900">
            {t('messaging.outbox')}
          </h3>
        </div>
        
        <button
          onClick={processMessages}
          disabled={processing || stats.queued === 0}
          className="btn-primary inline-flex items-center space-x-2 disabled:opacity-50"
        >
          <PaperAirplaneIcon className="h-4 w-4" />
          <span>
            {processing ? t('messaging.sending') : t('messaging.sendQueued')}
          </span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-4 bg-yellow-50 rounded-lg">
          <div className="text-2xl font-bold text-yellow-800">{stats.queued}</div>
          <div className="text-sm text-yellow-600">{t('messaging.queued')}</div>
        </div>
        <div className="text-center p-4 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-800">{stats.sent}</div>
          <div className="text-sm text-blue-600">{t('messaging.sent')}</div>
        </div>
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-800">{stats.delivered}</div>
          <div className="text-sm text-green-600">{t('messaging.delivered')}</div>
        </div>
        <div className="text-center p-4 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-800">{stats.failed}</div>
          <div className="text-sm text-red-600">{t('messaging.failed')}</div>
        </div>
      </div>

      {/* Status Info */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>
          {lastSync ? (
            <span>{t('messaging.lastSync')}: {lastSync.toLocaleTimeString()}</span>
          ) : (
            <span>{t('messaging.neverSynced')}</span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {navigator.onLine ? (
            <>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>{t('status.online')}</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span>{t('status.offline')}</span>
            </>
          )}
        </div>
      </div>

      {stats.queued > 0 && !navigator.onLine && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
            <span className="text-sm text-yellow-800">
              {t('messaging.offlineQueue', { count: stats.queued.toString() })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
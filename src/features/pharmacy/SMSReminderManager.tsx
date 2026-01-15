import { useState, useEffect, useCallback } from 'react'
import {
  EnvelopeIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  ChartBarIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'
import {
  getPendingReminders,
  markReminderSent,
  markReminderFailed,
  getPatientReminders,
  SMSReminder,
} from '@/services/sms'
import {
  processNow,
  startNotificationWorker,
  stopNotificationWorker,
} from '@/services/notificationWorker'
import { supabase } from '@/lib/supabase'

interface ReminderStats {
  total: number
  pending: number
  sent: number
  failed: number
  successRate: number
}

interface SMSReminderManagerProps {
  patientId?: string
  dispenseId?: string
}

export function SMSReminderManager({ patientId }: SMSReminderManagerProps) {
  const [reminders, setReminders] = useState<SMSReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'failed'>('all')
  const [stats, setStats] = useState<ReminderStats | null>(null)
  const [workerActive, setWorkerActive] = useState(false)
  const [lastProcessed, setLastProcessed] = useState<{ reminders: number; messages: number } | null>(null)

  const loadReminders = useCallback(async () => {
    try {
      setLoading(true)
      let data: SMSReminder[]

      if (patientId) {
        data = await getPatientReminders(patientId)
      } else {
        data = await getPendingReminders()
      }

      setReminders(data)
    } catch (error) {
      console.error('Failed to load reminders:', error)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  const loadStats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('medication_reminders')
        .select('status')

      if (error) throw error

      const total = data?.length || 0
      const pending = data?.filter(r => r.status === 'pending').length || 0
      const sent = data?.filter(r => r.status === 'sent').length || 0
      const failed = data?.filter(r => r.status === 'failed').length || 0
      const successRate = total > 0 ? Math.round((sent / (sent + failed || 1)) * 100) : 0

      setStats({ total, pending, sent, failed, successRate })
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }, [])

  useEffect(() => {
    loadReminders()
    loadStats()
  }, [loadReminders, loadStats, filter])

  const handleProcessQueue = async () => {
    setProcessing(true)
    try {
      const result = await processNow()
      setLastProcessed(result)
      await loadReminders()
      await loadStats()
    } catch (error) {
      console.error('Failed to process queue:', error)
    } finally {
      setProcessing(false)
    }
  }

  const handleToggleWorker = () => {
    if (workerActive) {
      stopNotificationWorker()
      setWorkerActive(false)
    } else {
      startNotificationWorker(30000)
      setWorkerActive(true)
    }
  }

  const handleMarkSent = async (id: string) => {
    try {
      await markReminderSent(id)
      await loadReminders()
      await loadStats()
    } catch (error) {
      console.error('Failed to mark reminder as sent:', error)
    }
  }

  const handleMarkFailed = async (id: string, errorMessage: string) => {
    try {
      await markReminderFailed(id, errorMessage)
      await loadReminders()
      await loadStats()
    } catch (error) {
      console.error('Failed to mark reminder as failed:', error)
    }
  }

  const handleResend = async (reminder: SMSReminder) => {
    setProcessing(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

      const response = await fetch(`${supabaseUrl}/functions/v1/send-sms-reminder`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: reminder.phoneNumber,
          message: reminder.message,
          reminderId: reminder.id,
        }),
      })

      const result = await response.json()

      if (result.success) {
        await markReminderSent(reminder.id!)
      } else {
        await markReminderFailed(reminder.id!, result.error || 'Send failed')
      }

      await loadReminders()
      await loadStats()
    } catch (error) {
      console.error('Failed to resend reminder:', error)
    } finally {
      setProcessing(false)
    }
  }

  const filteredReminders = reminders.filter(r => {
    if (filter === 'all') return true
    return r.status === filter
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-green-600 bg-green-100'
      case 'failed':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-amber-600 bg-amber-100'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <CheckCircleIcon className="h-4 w-4" />
      case 'failed':
        return <XCircleIcon className="h-4 w-4" />
      default:
        return <ClockIcon className="h-4 w-4" />
    }
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            icon={<ChartBarIcon className="w-5 h-5 text-gray-600" />}
            label="Total"
            value={stats.total}
            bgColor="bg-gray-50"
          />
          <StatCard
            icon={<ClockIcon className="w-5 h-5 text-amber-600" />}
            label="Pending"
            value={stats.pending}
            bgColor="bg-amber-50"
          />
          <StatCard
            icon={<CheckCircleIcon className="w-5 h-5 text-green-600" />}
            label="Sent"
            value={stats.sent}
            bgColor="bg-green-50"
          />
          <StatCard
            icon={<XCircleIcon className="w-5 h-5 text-red-600" />}
            label="Failed"
            value={stats.failed}
            bgColor="bg-red-50"
          />
          <StatCard
            icon={<EnvelopeIcon className="w-5 h-5 text-blue-600" />}
            label="Success Rate"
            value={`${stats.successRate}%`}
            bgColor="bg-blue-50"
          />
        </div>
      )}

      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2">
              <EnvelopeIcon className="h-5 w-5 text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900">
                Medication Reminders
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(['all', 'pending', 'sent', 'failed'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      filter === f
                        ? f === 'pending' ? 'bg-amber-100 text-amber-700' :
                          f === 'sent' ? 'bg-green-100 text-green-700' :
                          f === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              <button
                onClick={handleToggleWorker}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  workerActive
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {workerActive ? 'Auto: ON' : 'Auto: OFF'}
              </button>

              <button
                onClick={handleProcessQueue}
                disabled={processing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <PaperAirplaneIcon className="w-4 h-4" />
                )}
                Process Now
              </button>
            </div>
          </div>

          {lastProcessed && (
            <p className="mt-2 text-xs text-gray-500">
              Last processed: {lastProcessed.reminders} reminders, {lastProcessed.messages} messages
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredReminders.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <EnvelopeIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">No {filter === 'all' ? '' : filter} reminders found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredReminders.map((reminder) => (
              <div key={reminder.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(reminder.status || 'pending')}`}>
                        {getStatusIcon(reminder.status || 'pending')}
                        {reminder.status || 'pending'}
                      </span>
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {reminder.medicationName}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="w-3.5 h-3.5" />
                        {new Date(reminder.scheduledAt).toLocaleString()}
                      </span>
                      {reminder.phoneNumber && (
                        <span className="inline-flex items-center gap-1">
                          <PhoneIcon className="w-3.5 h-3.5" />
                          {reminder.phoneNumber}
                        </span>
                      )}
                      {reminder.sentAt && (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          Sent {new Date(reminder.sentAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {reminder.errorMessage && (
                      <p className="mt-1 text-xs text-red-600">
                        Error: {reminder.errorMessage}
                      </p>
                    )}

                    <p className="mt-1.5 text-xs text-gray-600 line-clamp-2">
                      {reminder.message}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {reminder.status === 'failed' && (
                      <button
                        onClick={() => handleResend(reminder)}
                        disabled={processing}
                        className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 disabled:opacity-50"
                      >
                        Resend
                      </button>
                    )}

                    {reminder.status === 'pending' && new Date(reminder.scheduledAt) <= new Date() && (
                      <>
                        <button
                          onClick={() => handleResend(reminder)}
                          disabled={processing}
                          className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 disabled:opacity-50"
                        >
                          Send
                        </button>
                        <button
                          onClick={() => handleMarkSent(reminder.id!)}
                          className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                        >
                          Mark Sent
                        </button>
                        <button
                          onClick={() => {
                            const error = prompt('Error message:')
                            if (error) handleMarkFailed(reminder.id!, error)
                          }}
                          className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200"
                        >
                          Mark Failed
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
          <p className="text-xs text-gray-500">
            {filteredReminders.length} reminder{filteredReminders.length !== 1 ? 's' : ''}
          </p>
          <button
            onClick={() => {
              loadReminders()
              loadStats()
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-gray-700 bg-white border border-gray-300 hover:bg-gray-50"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, bgColor }: {
  icon: React.ReactNode
  label: string
  value: number | string
  bgColor: string
}) {
  return (
    <div className={`${bgColor} rounded-lg p-3`}>
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-xs text-gray-600">{label}</p>
          <p className="text-lg font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  )
}

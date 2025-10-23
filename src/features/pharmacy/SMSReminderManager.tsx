import { useState, useEffect } from 'react'
import { EnvelopeIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import {
  scheduleDispenseReminders,
  getPendingReminders,
  markReminderSent,
  markReminderFailed,
  getPatientReminders
} from '@/services/sms'

interface Reminder {
  id: string
  dispense_id: string
  patient_id: string
  medication_name: string
  scheduled_at: Date
  sent_at?: Date
  status: 'pending' | 'sent' | 'failed'
  error_message?: string
  created_at: Date
}

interface SMSReminderManagerProps {
  patientId?: string
  dispenseId?: string
}

export function SMSReminderManager({ patientId, dispenseId }: SMSReminderManagerProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'failed'>('all')

  useEffect(() => {
    loadReminders()
  }, [patientId, filter])

  const loadReminders = async () => {
    try {
      setLoading(true)
      let data

      if (patientId) {
        data = await getPatientReminders(patientId)
      } else if (filter === 'pending') {
        data = await getPendingReminders()
      } else {
        data = await getPendingReminders()
      }

      setReminders(data)
    } catch (error) {
      console.error('Failed to load reminders:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkSent = async (id: string) => {
    try {
      await markReminderSent(id)
      await loadReminders()
    } catch (error) {
      console.error('Failed to mark reminder as sent:', error)
    }
  }

  const handleMarkFailed = async (id: string, errorMessage: string) => {
    try {
      await markReminderFailed(id, errorMessage)
      await loadReminders()
    } catch (error) {
      console.error('Failed to mark reminder as failed:', error)
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
        return 'text-yellow-600 bg-yellow-100'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <CheckCircleIcon className="h-5 w-5" />
      case 'failed':
        return <XCircleIcon className="h-5 w-5" />
      default:
        return <ClockIcon className="h-5 w-5" />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <EnvelopeIcon className="h-6 w-6 text-gray-400 mr-2" />
            <h3 className="text-lg font-medium text-gray-900">
              SMS Medication Reminders
            </h3>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                filter === 'all'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                filter === 'pending'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('sent')}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                filter === 'sent'
                  ? 'bg-green-100 text-green-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sent
            </button>
            <button
              onClick={() => setFilter('failed')}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                filter === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Failed
            </button>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {filteredReminders.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            No reminders found
          </div>
        ) : (
          filteredReminders.map((reminder) => (
            <div key={reminder.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(reminder.status)}`}>
                      {getStatusIcon(reminder.status)}
                      <span className="ml-1">{reminder.status}</span>
                    </span>
                    <span className="ml-3 text-sm font-medium text-gray-900">
                      {reminder.medication_name}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center text-sm text-gray-500">
                    <ClockIcon className="flex-shrink-0 mr-1.5 h-4 w-4" />
                    Scheduled: {new Date(reminder.scheduled_at).toLocaleString()}
                  </div>
                  {reminder.sent_at && (
                    <div className="mt-1 flex items-center text-sm text-gray-500">
                      <CheckCircleIcon className="flex-shrink-0 mr-1.5 h-4 w-4" />
                      Sent: {new Date(reminder.sent_at).toLocaleString()}
                    </div>
                  )}
                  {reminder.error_message && (
                    <div className="mt-1 text-sm text-red-600">
                      Error: {reminder.error_message}
                    </div>
                  )}
                </div>
                {reminder.status === 'pending' && new Date(reminder.scheduled_at) <= new Date() && (
                  <div className="flex space-x-2 ml-4">
                    <button
                      onClick={() => handleMarkSent(reminder.id)}
                      className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200"
                    >
                      Mark Sent
                    </button>
                    <button
                      onClick={() => {
                        const error = prompt('Error message:')
                        if (error) handleMarkFailed(reminder.id, error)
                      }}
                      className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200"
                    >
                      Mark Failed
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {!patientId && (
        <div className="px-4 py-3 bg-gray-50 text-right sm:px-6">
          <button
            onClick={loadReminders}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}

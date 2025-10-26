import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as logger from '@/lib/logger'
import { formatNigerianDate } from '@/utils/dateFormat'
import {
  PaperAirplaneIcon,
  InboxIcon,
  PaperClipIcon,
  UserCircleIcon
} from '@heroicons/react/24/outline'

interface Message {
  id: string
  subject: string
  body: string
  from_patient: boolean
  from_name: string
  created_at: string
  read: boolean
  patient_id: string
  staff_id?: string
}

export function SecureMessaging() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCompose, setShowCompose] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [newMessage, setNewMessage] = useState({ subject: '', body: '' })

  useEffect(() => {
    loadMessages()

    // Set up real-time subscription
    const channel = supabase
      .channel('secure_messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patient_secure_messages'
        },
        () => {
          loadMessages()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const loadMessages = async () => {
    setLoading(true)
    setError('')

    try {
      const portalUserStr = localStorage.getItem('patient_portal_user')
      if (!portalUserStr) {
        window.location.href = '/patient/login'
        return
      }

      const portalUser = JSON.parse(portalUserStr)
      if (!portalUser.patientId) {
        window.location.href = '/patient/login'
        return
      }

      const { data, error: messagesError } = await supabase
        .from('patient_secure_messages')
        .select('*')
        .eq('patient_id', portalUser.patientId)
        .order('created_at', { ascending: false })

      if (messagesError) throw messagesError

      setMessages(data || [])
    } catch (err) {
      logger.error('Error loading messages:', err)
      setError('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!newMessage.subject.trim() || !newMessage.body.trim()) {
      setError('Subject and message are required')
      return
    }

    setSending(true)
    setError('')
    setSuccess('')

    try {
      const portalUserStr = localStorage.getItem('patient_portal_user')
      if (!portalUserStr) {
        window.location.href = '/patient/login'
        return
      }

      const portalUser = JSON.parse(portalUserStr)

      const { data: patient } = await supabase
        .from('patients')
        .select('name')
        .eq('id', portalUser.patientId)
        .maybeSingle()

      const { error: insertError } = await supabase
        .from('patient_secure_messages')
        .insert({
          patient_id: portalUser.patientId,
          subject: newMessage.subject,
          body: newMessage.body,
          from_patient: true,
          from_name: patient?.name || 'Patient',
          read: false
        })

      if (insertError) throw insertError

      setSuccess('Message sent successfully')
      setNewMessage({ subject: '', body: '' })
      setShowCompose(false)
      await loadMessages()
    } catch (err) {
      logger.error('Error sending message:', err)
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const markAsRead = async (messageId: string) => {
    try {
      await supabase
        .from('patient_secure_messages')
        .update({ read: true })
        .eq('id', messageId)

      await loadMessages()
    } catch (err) {
      logger.error('Error marking message as read:', err)
    }
  }

  const openMessage = (message: Message) => {
    setSelectedMessage(message)
    if (!message.read && !message.from_patient) {
      markAsRead(message.id)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading messages...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Secure Messaging</h1>
            <p className="mt-2 text-gray-600">
              Communicate securely with your healthcare providers
            </p>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            New Message
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {showCompose && (
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Compose New Message</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={newMessage.subject}
                  onChange={(e) =>
                    setNewMessage({ ...newMessage, subject: e.target.value })
                  }
                  placeholder="Enter subject"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  value={newMessage.body}
                  onChange={(e) =>
                    setNewMessage({ ...newMessage, body: e.target.value })
                  }
                  placeholder="Type your message here..."
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  <PaperAirplaneIcon className="h-5 w-5" />
                  {sending ? 'Sending...' : 'Send Message'}
                </button>
                <button
                  onClick={() => setShowCompose(false)}
                  disabled={sending}
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedMessage ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <button
              onClick={() => setSelectedMessage(null)}
              className="mb-4 text-blue-600 hover:text-blue-800"
            >
              ← Back to inbox
            </button>

            <div className="border-b border-gray-200 pb-4 mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedMessage.subject}
              </h2>
              <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <UserCircleIcon className="h-5 w-5" />
                  {selectedMessage.from_patient ? 'You' : selectedMessage.from_name}
                </span>
                <span>{formatNigerianDate(selectedMessage.created_at)}</span>
              </div>
            </div>

            <div className="prose max-w-none">
              <p className="whitespace-pre-wrap text-gray-900">{selectedMessage.body}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {messages.length === 0 ? (
              <div className="p-12 text-center">
                <InboxIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No messages</h3>
                <p className="text-gray-600">
                  Start a conversation with your healthcare provider
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    onClick={() => openMessage(message)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`font-medium ${
                              !message.read && !message.from_patient
                                ? 'text-blue-600'
                                : 'text-gray-900'
                            }`}
                          >
                            {message.subject}
                          </h3>
                          {!message.read && !message.from_patient && (
                            <span className="inline-block w-2 h-2 bg-blue-600 rounded-full"></span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          From: {message.from_patient ? 'You' : message.from_name}
                        </p>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                          {message.body}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                        {formatNigerianDate(message.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

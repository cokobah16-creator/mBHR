import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth'
import { palaverRoom, PalaverMessage, PalaverBroadcast, MessagePriority, TargetRole } from '@/services/palaverRoom'
import { db } from '@/db'
import type { User } from '@/db'
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  InboxIcon,
  MegaphoneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FireIcon,
  XMarkIcon,
  ArrowLeftIcon,
  UserCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline'

type ViewMode = 'inbox' | 'sent' | 'compose' | 'broadcast' | 'conversation'

interface PalaverRoomProps {
  onClose?: () => void
  isPanel?: boolean
}

export function PalaverRoom({ onClose, isPanel = false }: PalaverRoomProps) {
  const { currentUser } = useAuthStore()
  const [viewMode, setViewMode] = useState<ViewMode>('inbox')
  const [messages, setMessages] = useState<PalaverMessage[]>([])
  const [broadcasts, setBroadcasts] = useState<PalaverBroadcast[]>([])
  const [doctors, setDoctors] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [selectedMessage, setSelectedMessage] = useState<PalaverMessage | null>(null)
  const [conversationMessages, setConversationMessages] = useState<PalaverMessage[]>([])

  const [composeData, setComposeData] = useState({
    recipientId: '',
    recipientName: '',
    subject: '',
    body: '',
    priority: 'normal' as MessagePriority
  })

  const [broadcastData, setBroadcastData] = useState({
    targetRole: 'all_clinical' as TargetRole,
    subject: '',
    body: '',
    priority: 'normal' as MessagePriority
  })

  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadData = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)

    try {
      const [inbox, unread, broadcastList, staffList] = await Promise.all([
        palaverRoom.getInboxMessages(currentUser.id),
        palaverRoom.getUnreadCount(currentUser.id),
        palaverRoom.getBroadcasts(currentUser.role),
        db.users.where('role').anyOf(['doctor', 'nurse', 'admin']).and(u => u.isActive === 1).toArray()
      ])

      setMessages(inbox)
      setUnreadCount(unread)
      setBroadcasts(broadcastList)
      setDoctors(staffList.filter(u => u.id !== currentUser.id))
    } catch (err) {
      console.error('Failed to load Palaver Room data:', err)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [loadData])

  const handleSendMessage = async () => {
    if (!currentUser || !composeData.recipientId || !composeData.subject || !composeData.body) {
      setError('Please fill in all required fields')
      return
    }

    setSending(true)
    setError('')

    try {
      await palaverRoom.sendMessage({
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        recipientId: composeData.recipientId,
        recipientName: composeData.recipientName,
        subject: composeData.subject,
        body: composeData.body,
        priority: composeData.priority
      })

      setSuccess('Message sent successfully!')
      setComposeData({ recipientId: '', recipientName: '', subject: '', body: '', priority: 'normal' })
      setTimeout(() => {
        setSuccess('')
        setViewMode('inbox')
        loadData()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleSendBroadcast = async () => {
    if (!currentUser || !broadcastData.subject || !broadcastData.body) {
      setError('Please fill in all required fields')
      return
    }

    setSending(true)
    setError('')

    try {
      await palaverRoom.sendBroadcast({
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        targetRole: broadcastData.targetRole,
        subject: broadcastData.subject,
        body: broadcastData.body,
        priority: broadcastData.priority
      })

      setSuccess('Broadcast sent successfully!')
      setBroadcastData({ targetRole: 'all_clinical', subject: '', body: '', priority: 'normal' })
      setTimeout(() => {
        setSuccess('')
        setViewMode('inbox')
        loadData()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send broadcast')
    } finally {
      setSending(false)
    }
  }

  const handleOpenMessage = async (message: PalaverMessage) => {
    setSelectedMessage(message)

    if (!message.is_read && currentUser) {
      await palaverRoom.markAsRead(message.id)
      loadData()
    }

    const conversation = await palaverRoom.getConversation(
      currentUser!.id,
      message.sender_id === currentUser!.id ? message.recipient_id : message.sender_id
    )
    setConversationMessages(conversation)
    setViewMode('conversation')
  }

  const handleReply = () => {
    if (!selectedMessage || !currentUser) return

    const otherPerson = selectedMessage.sender_id === currentUser.id
      ? { id: selectedMessage.recipient_id, name: selectedMessage.recipient_name }
      : { id: selectedMessage.sender_id, name: selectedMessage.sender_name }

    setComposeData({
      recipientId: otherPerson.id,
      recipientName: otherPerson.name,
      subject: selectedMessage.subject.startsWith('Re:') ? selectedMessage.subject : `Re: ${selectedMessage.subject}`,
      body: '',
      priority: 'normal'
    })
    setViewMode('compose')
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getPriorityIcon = (priority: MessagePriority) => {
    switch (priority) {
      case 'critical': return <FireIcon className="h-4 w-4 text-red-600" />
      case 'urgent': return <ExclamationTriangleIcon className="h-4 w-4 text-orange-500" />
      default: return null
    }
  }

  const getPriorityBadge = (priority: MessagePriority) => {
    switch (priority) {
      case 'critical': return <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded-full">Critical</span>
      case 'urgent': return <span className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded-full">Urgent</span>
      default: return null
    }
  }

  const containerClass = isPanel
    ? "bg-white rounded-lg shadow-lg overflow-hidden h-full flex flex-col"
    : "bg-white rounded-lg shadow-lg overflow-hidden max-w-4xl mx-auto"

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {viewMode !== 'inbox' && (
              <button
                onClick={() => setViewMode('inbox')}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
            )}
            <ChatBubbleLeftRightIcon className="h-8 w-8" />
            <div>
              <h2 className="text-xl font-bold">Palaver Room</h2>
              <p className="text-sm text-emerald-100">Staff Messaging</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <span className="px-2 py-1 bg-red-500 text-white text-sm font-bold rounded-full">
                {unreadCount} new
              </span>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      {viewMode === 'inbox' && (
        <div className="flex border-b">
          <button
            onClick={() => setViewMode('inbox')}
            className="flex-1 px-4 py-3 text-sm font-medium text-emerald-700 border-b-2 border-emerald-600 flex items-center justify-center gap-2"
          >
            <InboxIcon className="h-4 w-4" />
            Inbox
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">{unreadCount}</span>
            )}
          </button>
          <button
            onClick={() => setViewMode('compose')}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2"
          >
            <PaperAirplaneIcon className="h-4 w-4" />
            Compose
          </button>
          <button
            onClick={() => setViewMode('broadcast')}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2"
          >
            <MegaphoneIcon className="h-4 w-4" />
            Broadcast
          </button>
        </div>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm flex items-center gap-2">
          <CheckCircleIcon className="h-5 w-5" />
          {success}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : (
          <>
            {/* Inbox View */}
            {viewMode === 'inbox' && (
              <div className="space-y-4">
                {/* Broadcasts Section */}
                {broadcasts.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <MegaphoneIcon className="h-4 w-4" />
                      Announcements
                    </h3>
                    <div className="space-y-2">
                      {broadcasts.slice(0, 3).map(broadcast => (
                        <div
                          key={broadcast.id}
                          className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {getPriorityIcon(broadcast.priority)}
                                <span className="font-medium text-gray-900">{broadcast.subject}</span>
                                {getPriorityBadge(broadcast.priority)}
                              </div>
                              <p className="text-sm text-gray-700 line-clamp-2">{broadcast.body}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                From {broadcast.sender_name} - {formatTime(broadcast.created_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages List */}
                <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <InboxIcon className="h-4 w-4" />
                  Messages
                </h3>
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <InboxIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No messages yet</p>
                    <p className="text-sm">Messages from colleagues will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map(message => (
                      <button
                        key={message.id}
                        onClick={() => handleOpenMessage(message)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          message.is_read
                            ? 'bg-white border-gray-200 hover:bg-gray-50'
                            : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <UserCircleIcon className="h-10 w-10 text-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-medium ${!message.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                                {message.sender_name}
                              </span>
                              <div className="flex items-center gap-2">
                                {getPriorityIcon(message.priority)}
                                <span className="text-xs text-gray-500">{formatTime(message.created_at)}</span>
                              </div>
                            </div>
                            <p className={`text-sm ${!message.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                              {message.subject}
                            </p>
                            <p className="text-sm text-gray-500 truncate">{message.body}</p>
                          </div>
                          {!message.is_read && (
                            <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-2"></div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Compose View */}
            {viewMode === 'compose' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">New Message</h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To *</label>
                  <select
                    value={composeData.recipientId}
                    onChange={(e) => {
                      const doctor = doctors.find(d => d.id === e.target.value)
                      setComposeData({
                        ...composeData,
                        recipientId: e.target.value,
                        recipientName: doctor?.fullName || ''
                      })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select recipient...</option>
                    {doctors.map(doctor => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.fullName} ({doctor.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                  <input
                    type="text"
                    value={composeData.subject}
                    onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                    placeholder="Message subject"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={composeData.priority}
                    onChange={(e) => setComposeData({ ...composeData, priority: e.target.value as MessagePriority })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                  <textarea
                    value={composeData.body}
                    onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
                    placeholder="Type your message..."
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSendMessage}
                    disabled={sending}
                    className="flex-1 py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
                  >
                    {sending ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <>
                        <PaperAirplaneIcon className="h-4 w-4" />
                        Send Message
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setViewMode('inbox')}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Broadcast View */}
            {viewMode === 'broadcast' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Send Announcement</h3>
                <p className="text-sm text-gray-600">Send a message to all staff in a specific role</p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send To *</label>
                  <select
                    value={broadcastData.targetRole}
                    onChange={(e) => setBroadcastData({ ...broadcastData, targetRole: e.target.value as TargetRole })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all_clinical">All Clinical Staff</option>
                    <option value="doctor">Doctors Only</option>
                    <option value="nurse">Nurses Only</option>
                    <option value="pharmacist">Pharmacists Only</option>
                    <option value="all_staff">All Staff</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                  <input
                    type="text"
                    value={broadcastData.subject}
                    onChange={(e) => setBroadcastData({ ...broadcastData, subject: e.target.value })}
                    placeholder="Announcement subject"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={broadcastData.priority}
                    onChange={(e) => setBroadcastData({ ...broadcastData, priority: e.target.value as MessagePriority })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                  <textarea
                    value={broadcastData.body}
                    onChange={(e) => setBroadcastData({ ...broadcastData, body: e.target.value })}
                    placeholder="Type your announcement..."
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSendBroadcast}
                    disabled={sending}
                    className="flex-1 py-2 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2"
                  >
                    {sending ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <>
                        <MegaphoneIcon className="h-4 w-4" />
                        Send Broadcast
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setViewMode('inbox')}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Conversation View */}
            {viewMode === 'conversation' && selectedMessage && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">{selectedMessage.subject}</h3>
                  <button
                    onClick={handleReply}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    Reply
                  </button>
                </div>

                <div className="space-y-3">
                  {conversationMessages.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-4 rounded-lg ${
                        msg.sender_id === currentUser?.id
                          ? 'bg-emerald-50 border border-emerald-200 ml-8'
                          : 'bg-gray-50 border border-gray-200 mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <UserCircleIcon className="h-6 w-6 text-gray-400" />
                          <span className="font-medium text-gray-900">{msg.sender_name}</span>
                          {getPriorityBadge(msg.priority)}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <ClockIcon className="h-3 w-3" />
                          {formatTime(msg.created_at)}
                        </div>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{msg.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default PalaverRoom

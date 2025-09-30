import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { GamificationService } from '@/services/gamification'
import { can } from '@/auth/roles'
import { 
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  TrophyIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'

interface PendingSession {
  id: string
  type: string
  volunteerId: string
  volunteerName: string
  startedAt: Date
  finishedAt: Date
  score: number
  tokensEarned: number
  payload: any
}

export default function ApprovalInbox() {
  const { currentUser } = useAuthStore()
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  // Only admins and leads can approve
  if (!currentUser || !can(currentUser.role, 'users')) {
    return (
      <div className="text-center py-12">
        <ExclamationTriangleIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Restricted</h3>
        <p className="text-gray-600">Only administrators can approve game sessions.</p>
      </div>
    )
  }

  useEffect(() => {
    loadPendingSessions()
  }, [])

  const loadPendingSessions = async () => {
    try {
      const sessions = await db.gameSessions.where('committed').equals(false).and(s => !!s.finishedAt).toArray()
        .where('committed_idx')
        .equals(0)
        .and(session => !!session.finishedAt)
        .toArray()

      // Get volunteer names
      const volunteerIds = [...new Set(sessions.map(s => s.volunteerId))]
      const users = await db.users.where('id').anyOf(volunteerIds).toArray()
      const userMap = new Map(users.map(u => [u.id, u.fullName]))

      const sessionsWithNames: PendingSession[] = sessions.map(session => ({
        id: session.id,
        type: session.type,
        volunteerId: session.volunteerId,
        volunteerName: userMap.get(session.volunteerId) || 'Unknown',
        startedAt: session.startedAt,
        finishedAt: session.finishedAt!,
        score: session.score,
        tokensEarned: session.tokensEarned,
        payload: JSON.parse(session.payloadJson)
      }))

      setPendingSessions(sessionsWithNames)
    } catch (error) {
      console.error('Error loading pending sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  const approveSession = async (sessionId: string) => {
    if (!currentUser) return

    setProcessing(sessionId)
    try {
      await GamificationService.approveSession(sessionId, currentUser.id)
      await loadPendingSessions() // Refresh list
    } catch (error) {
      console.error('Error approving session:', error)
      alert('Failed to approve session')
    } finally {
      setProcessing(null)
    }
  }

  const rejectSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to reject this session? This cannot be undone.')) {
      return
    }

    setProcessing(sessionId)
    try {
      await db.gameSessions.delete(sessionId)
      await loadPendingSessions() // Refresh list
    } catch (error) {
      console.error('Error rejecting session:', error)
      alert('Failed to reject session')
    } finally {
      setProcessing(null)
    }
  }

  const bulkApproveAll = async () => {
    if (!confirm(`Approve all ${pendingSessions.length} pending sessions?`)) {
      return
    }

    setProcessing('bulk')
    try {
      for (const session of pendingSessions) {
        await GamificationService.approveSession(session.id, currentUser!.id)
      }
      await loadPendingSessions()
      alert(`✅ Approved ${pendingSessions.length} sessions successfully!`)
    } catch (error) {
      console.error('Error bulk approving:', error)
      alert('Failed to approve some sessions')
    } finally {
      setProcessing(null)
    }
  }

  const getGameTypeLabel = (type: string) => {
    const labels = {
      vitals: 'Vitals Precision',
      shelf: 'Shelf Sleuth',
      quiz: 'Knowledge Blitz',
      triage: 'Triage Sprint'
    }
    return labels[type as keyof typeof labels] || type
  }

  const getGameTypeColor = (type: string) => {
    const colors = {
      vitals: 'bg-green-100 text-green-800',
      shelf: 'bg-blue-100 text-blue-800',
      quiz: 'bg-purple-100 text-purple-800',
      triage: 'bg-orange-100 text-orange-800'
    }
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <TrophyIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
            <p className="text-gray-600">Loading pending game sessions...</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <TrophyIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
            <p className="text-gray-600">Review and approve completed game sessions</p>
          </div>
        </div>
        
        {pendingSessions.length > 0 && (
          <button
            onClick={bulkApproveAll}
            disabled={processing === 'bulk'}
            className="btn-primary inline-flex items-center space-x-2"
          >
            <CheckCircleIcon className="h-5 w-5" />
            <span>{processing === 'bulk' ? 'Approving...' : `Approve All (${pendingSessions.length})`}</span>
          </button>
        )}
      </div>

      {/* Pending Sessions */}
      <div className="space-y-4">
        {pendingSessions.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircleIcon className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">All caught up!</h3>
            <p className="text-gray-600">No pending game sessions to review.</p>
          </div>
        ) : (
          pendingSessions.map((session) => (
            <div key={session.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getGameTypeColor(session.type)}`}>
                      {getGameTypeLabel(session.type)}
                    </span>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{session.volunteerName}</h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <span>Score: {session.score}</span>
                      <span>Duration: {Math.round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000)}m</span>
                      <span>Completed: {session.finishedAt.toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-lg font-bold text-primary">{session.tokensEarned}</div>
                    <div className="text-sm text-gray-600">tokens</div>
                  </div>
                  
                  <div className="flex space-x-2">
                    <button
                      onClick={() => approveSession(session.id)}
                      disabled={processing === session.id}
                      className="bg-green-100 text-green-800 px-3 py-2 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                    >
                      {processing === session.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                      ) : (
                        <CheckCircleIcon className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => rejectSession(session.id)}
                      disabled={processing === session.id}
                      className="bg-red-100 text-red-800 px-3 py-2 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                    >
                      <XCircleIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
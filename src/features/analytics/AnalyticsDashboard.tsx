import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { can } from '@/auth/roles'
import { 
  ChartBarIcon,
  UsersIcon,
  ClockIcon,
  HeartIcon,
  TrophyIcon,
  ExclamationTriangleIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'

interface AnalyticsData {
  overview: {
    totalPatients: number
    todayRegistrations: number
    activeVisits: number
    completedVisits: number
    avgWaitTime: number
    tokensAwarded: number
  }
  throughput: Array<{
    date: string
    registrations: number
    vitals: number
    consultations: number
    dispenses: number
  }>
  queueMetrics: Array<{
    stage: string
    avgWaitMinutes: number
    throughput: number
    currentWaiting: number
  }>
  gamification: {
    totalSessions: number
    pendingApprovals: number
    topPerformers: Array<{
      name: string
      tokens: number
      badges: number
    }>
  }
}

export default function AnalyticsDashboard() {
  const { currentUser } = useAuthStore()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days ago
    to: new Date().toISOString().split('T')[0] // today
  })

  // Only admins can access analytics
  if (!currentUser || !can(currentUser.role, 'export')) {
    return (
      <div className="text-center py-12">
        <ChartBarIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Restricted</h3>
        <p className="text-gray-600">Only administrators can access the analytics dashboard.</p>
      </div>
    )
  }

  useEffect(() => {
    loadAnalyticsData()
  }, [dateRange])

  const loadAnalyticsData = async () => {
    setLoading(true)
    try {
      const fromDate = new Date(dateRange.from)
      const toDate = new Date(dateRange.to)
      toDate.setHours(23, 59, 59, 999) // End of day

      // Overview metrics
      const [
        totalPatients,
        todayRegistrations,
        activeVisits,
        completedVisits,
        totalGameSessions,
        pendingApprovals,
        wallets
      ] = await Promise.all([
        db.patients.count(),
        db.patients.where('createdAt').between(fromDate, toDate).count(),
        db.visits.where('status').equals('open').count(),
        db.visits.where('status').equals('closed').count(),
        db.gameSessions.count(),
        db.gameSessions.where('committed').equals(false).and(s => !!s.finishedAt).count(),
        db.gamificationWallets.orderBy('tokens').reverse().limit(5).toArray()
      ])

      // Calculate average wait time (simplified)
      const visits = await db.visits.where('startedAt').between(fromDate, toDate).toArray()
      const avgWaitTime = visits.length > 0 ? 15 : 0 // Placeholder calculation

      // Throughput data (last 7 days)
      const throughputData = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dayStart = new Date(date)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(date)
        dayEnd.setHours(23, 59, 59, 999)

        const [registrations, vitalsCount, consultations, dispenses] = await Promise.all([
          db.patients.where('createdAt').between(dayStart, dayEnd).count(),
          db.vitals.where('takenAt').between(dayStart, dayEnd).count(),
          db.consultations.where('createdAt').between(dayStart, dayEnd).count(),
          db.dispenses.where('dispensedAt').between(dayStart, dayEnd).count()
        ])

        throughputData.push({
          date: date.toISOString().split('T')[0],
          registrations,
          vitals: vitalsCount,
          consultations,
          dispenses
        })
      }

      // Queue metrics (current state)
      const queueMetrics = await Promise.all([
        'registration', 'vitals', 'consult', 'pharmacy'
      ].map(async (stage) => {
        const waiting = await db.queue.where('stage').equals(stage).and(q => q.status === 'waiting').count()
        return {
          stage,
          avgWaitMinutes: 15, // Placeholder
          throughput: 0, // Placeholder
          currentWaiting: waiting
        }
      }))

      // Top performers
      const users = await db.users.toArray()
      const userMap = new Map(users.map(u => [u.id, u.fullName]))
      const topPerformers = wallets.map(wallet => ({
        name: userMap.get(wallet.volunteerId) || 'Unknown',
        tokens: wallet.tokens,
        badges: wallet.badges.length
      }))

      const analyticsData: AnalyticsData = {
        overview: {
          totalPatients,
          todayRegistrations,
          activeVisits,
          completedVisits,
          avgWaitTime,
          tokensAwarded: wallets.reduce((sum, w) => sum + w.tokens, 0)
        },
        throughput: throughputData,
        queueMetrics,
        gamification: {
          totalSessions,
          pendingApprovals,
          topPerformers
        }
      }

      setData(analyticsData)
    } catch (error) {
      console.error('Error loading analytics data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <ChartBarIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-600">Loading clinic performance data...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-20 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Header with Date Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <ChartBarIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-600">Clinic performance and gamification insights</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <CalendarIcon className="h-5 w-5 text-gray-400" />
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="input-field text-sm py-2"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="input-field text-sm py-2"
            />
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card bg-blue-50 border-blue-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-blue-100">
              <UsersIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-blue-600">Total Patients</p>
              <p className="text-2xl font-bold text-blue-800">{data.overview.totalPatients}</p>
            </div>
          </div>
        </div>

        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-green-100">
              <HeartIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-green-600">Active Visits</p>
              <p className="text-2xl font-bold text-green-800">{data.overview.activeVisits}</p>
            </div>
          </div>
        </div>

        <div className="card bg-orange-50 border-orange-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-orange-100">
              <ClockIcon className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-orange-600">Avg Wait Time</p>
              <p className="text-2xl font-bold text-orange-800">{data.overview.avgWaitTime}m</p>
            </div>
          </div>
        </div>

        <div className="card bg-purple-50 border-purple-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-purple-100">
              <TrophyIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-purple-600">Tokens Awarded</p>
              <p className="text-2xl font-bold text-purple-800">{data.overview.tokensAwarded}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Throughput Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Throughput</h3>
          <div className="space-y-3">
            {data.throughput.map((day, index) => (
              <div key={day.date} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <div className="flex space-x-4 text-sm">
                  <span className="text-blue-600">{day.registrations} reg</span>
                  <span className="text-green-600">{day.vitals} vitals</span>
                  <span className="text-purple-600">{day.consultations} consult</span>
                  <span className="text-orange-600">{day.dispenses} dispense</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Queue Status */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Queue Status</h3>
          <div className="space-y-4">
            {data.queueMetrics.map((stage) => (
              <div key={stage.stage} className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900 capitalize">{stage.stage}</span>
                  <span className="text-sm text-gray-600 ml-2">
                    (Avg: {stage.avgWaitMinutes}m)
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-lg font-bold text-primary">{stage.currentWaiting}</span>
                  <span className="text-sm text-gray-600">waiting</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gamification Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Performers */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Performers</h3>
          <div className="space-y-3">
            {data.gamification.topPerformers.map((performer, index) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {index + 1}
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">{performer.name}</span>
                    <span className="text-sm text-gray-600 ml-2">
                      {performer.badges} badges
                    </span>
                  </div>
                </div>
                <span className="text-lg font-bold text-primary">{performer.tokens}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gamification Overview */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Gamification Overview</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Total Game Sessions</span>
              <span className="text-lg font-bold text-gray-900">{data.gamification.totalSessions}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Pending Approvals</span>
              <div className="flex items-center space-x-2">
                {data.gamification.pendingApprovals > 0 && (
                  <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600" />
                )}
                <span className="text-lg font-bold text-gray-900">{data.gamification.pendingApprovals}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Total Tokens Awarded</span>
              <span className="text-lg font-bold text-primary">{data.overview.tokensAwarded}</span>
            </div>
          </div>
          
          {data.gamification.pendingApprovals > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button className="btn-primary w-full text-sm">
                Review Pending Approvals
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Export</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button className="btn-secondary text-sm">
            Export Analytics (CSV)
          </button>
          <button className="btn-secondary text-sm">
            Export Gamification (CSV)
          </button>
          <button className="btn-secondary text-sm">
            Export Queue Metrics (CSV)
          </button>
          <button className="btn-secondary text-sm">
            Generate Report (PDF)
          </button>
        </div>
      </div>
    </div>
  )
}
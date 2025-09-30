import React, { useEffect, useState } from 'react'
import { db, epochDay, DailyCount } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { 
  ChartBarIcon,
  UsersIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  ClockIcon,
  TrendingUpIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'

interface AnalyticsData {
  today: DailyCount
  yesterday: DailyCount
  weekTotal: DailyCount
  trends: {
    registrations: number
    vitals: number
    consultations: number
    dispenses: number
  }
  bottlenecks: string[]
}

export function OfflineAnalytics() {
  const { currentUser } = useAuthStore()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week'>('today')

  // Only admins and leads can see analytics
  if (!currentUser || !can(currentUser.role, 'export')) {
    return null
  }

  useEffect(() => {
    loadAnalyticsData()
    const interval = setInterval(loadAnalyticsData, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  const loadAnalyticsData = async () => {
    try {
      const now = new Date()
      const today = epochDay(now)
      const yesterday = today - 1
      const weekStart = today - 6

      // Get daily counts
      const [todayData, yesterdayData, weekData] = await Promise.all([
        getDailyCount(today),
        getDailyCount(yesterday),
        getWeekTotal(weekStart, today)
      ])

      // Calculate trends (today vs yesterday)
      const trends = {
        registrations: calculateTrend(todayData.registrations, yesterdayData.registrations),
        vitals: calculateTrend(todayData.vitals, yesterdayData.vitals),
        consultations: calculateTrend(todayData.consultations, yesterdayData.consultations),
        dispenses: calculateTrend(todayData.dispenses, yesterdayData.dispenses)
      }

      // Identify bottlenecks
      const bottlenecks = identifyBottlenecks(todayData)

      setData({
        today: todayData,
        yesterday: yesterdayData,
        weekTotal: weekData,
        trends,
        bottlenecks
      })
    } catch (error) {
      console.error('Error loading analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const getDailyCount = async (day: number): Promise<DailyCount> => {
    const existing = await db.dailyCounts.where('day').equals(day).first()
    if (existing) return existing

    // Calculate from raw data if no pre-aggregated count exists
    const dayStart = new Date(day * 86400000)
    const dayEnd = new Date((day + 1) * 86400000)

    const [registrations, vitals, consultations, dispenses, visits] = await Promise.all([
      db.patients.where('createdAt').between(dayStart, dayEnd, true, false).count(),
      db.vitals.where('takenAt').between(dayStart, dayEnd, true, false).count(),
      db.consultations.where('createdAt').between(dayStart, dayEnd, true, false).count(),
      db.dispenses.where('dispensedAt').between(dayStart, dayEnd, true, false).count(),
      db.visits.where('startedAt').between(dayStart, dayEnd, true, false).count()
    ])

    const count: DailyCount = {
      day,
      registrations,
      vitals,
      consultations,
      dispenses,
      visits
    }

    // Cache for future use
    await db.dailyCounts.add(count).catch(() => {}) // Ignore if already exists

    return count
  }

  const getWeekTotal = async (startDay: number, endDay: number): Promise<DailyCount> => {
    const weekCounts = await db.dailyCounts
      .where('day')
      .between(startDay, endDay, true, true)
      .toArray()

    return weekCounts.reduce((total, day) => ({
      day: endDay,
      registrations: total.registrations + day.registrations,
      vitals: total.vitals + day.vitals,
      consultations: total.consultations + day.consultations,
      dispenses: total.dispenses + day.dispenses,
      visits: total.visits + day.visits
    }), {
      day: endDay,
      registrations: 0,
      vitals: 0,
      consultations: 0,
      dispenses: 0,
      visits: 0
    })
  }

  const calculateTrend = (today: number, yesterday: number): number => {
    if (yesterday === 0) return today > 0 ? 100 : 0
    return Math.round(((today - yesterday) / yesterday) * 100)
  }

  const identifyBottlenecks = (todayData: DailyCount): string[] => {
    const bottlenecks: string[] = []
    
    // Check for flow imbalances
    if (todayData.registrations > todayData.vitals * 1.5) {
      bottlenecks.push('Vitals station may be a bottleneck')
    }
    if (todayData.vitals > todayData.consultations * 1.5) {
      bottlenecks.push('Consultation may be a bottleneck')
    }
    if (todayData.consultations > todayData.dispenses * 1.5) {
      bottlenecks.push('Pharmacy may be a bottleneck')
    }
    
    return bottlenecks
  }

  const formatTrend = (trend: number) => {
    const isPositive = trend > 0
    const isNegative = trend < 0
    
    return {
      value: Math.abs(trend),
      color: isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-600',
      icon: isPositive ? '↗' : isNegative ? '↘' : '→'
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <ChartBarIcon className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-gray-900">Analytics</h3>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const displayData = selectedPeriod === 'today' ? data.today : data.weekTotal

  const metrics = [
    {
      name: 'Registrations',
      value: displayData.registrations,
      icon: UsersIcon,
      color: 'text-blue-600 bg-blue-50',
      trend: data.trends.registrations
    },
    {
      name: 'Vitals',
      value: displayData.vitals,
      icon: HeartIcon,
      color: 'text-green-600 bg-green-50',
      trend: data.trends.vitals
    },
    {
      name: 'Consultations',
      value: displayData.consultations,
      icon: DocumentTextIcon,
      color: 'text-purple-600 bg-purple-50',
      trend: data.trends.consultations
    },
    {
      name: 'Dispenses',
      value: displayData.dispenses,
      icon: BeakerIcon,
      color: 'text-orange-600 bg-orange-50',
      trend: data.trends.dispenses
    }
  ]

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <ChartBarIcon className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-gray-900">Clinic Analytics</h3>
        </div>
        
        <div className="flex space-x-2">
          <button
            onClick={() => setSelectedPeriod('today')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedPeriod === 'today'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setSelectedPeriod('week')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedPeriod === 'week'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            This Week
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {metrics.map((metric) => {
          const trendInfo = formatTrend(metric.trend)
          const Icon = metric.icon
          
          return (
            <div key={metric.name} className="p-4 rounded-lg border">
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${metric.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {selectedPeriod === 'today' && (
                  <div className={`text-xs font-medium ${trendInfo.color}`}>
                    {trendInfo.icon} {trendInfo.value}%
                  </div>
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900">{metric.value}</div>
              <div className="text-sm text-gray-600">{metric.name}</div>
            </div>
          )
        })}
      </div>

      {/* Bottlenecks Alert */}
      {data.bottlenecks.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <div className="flex items-center space-x-2 mb-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
            <h4 className="font-medium text-yellow-800">Potential Bottlenecks</h4>
          </div>
          <ul className="text-sm text-yellow-700 space-y-1">
            {data.bottlenecks.map((bottleneck, index) => (
              <li key={index}>• {bottleneck}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="font-medium text-gray-900 mb-1">Patient Flow Efficiency</div>
          <div className="text-gray-600">
            {data.today.dispenses > 0 && data.today.registrations > 0 
              ? `${Math.round((data.today.dispenses / data.today.registrations) * 100)}% completion rate`
              : 'No completed flows today'
            }
          </div>
        </div>
        
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="font-medium text-gray-900 mb-1">Data Freshness</div>
          <div className="text-gray-600">
            Updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  )
}
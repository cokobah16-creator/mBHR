import { useState, useEffect } from 'react'
import { predictiveQueue } from '@/services/predictiveQueue'
import type {
  QueuePrediction,
  StaffingRecommendation,
  QueueOptimization,
  HistoricalPattern,
  QueueMetrics
} from '@/services/predictiveQueue'
import {
  ChartBarIcon,
  ClockIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

export function QueueAnalyticsDashboard() {
  const [predictions, setPredictions] = useState<QueuePrediction[]>([])
  const [staffing, setStaffing] = useState<StaffingRecommendation[]>([])
  const [optimizations, setOptimizations] = useState<QueueOptimization[]>([])
  const [patterns, setPatterns] = useState<HistoricalPattern[]>([])
  const [metrics, setMetrics] = useState<QueueMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStage, setSelectedStage] = useState<string>('registration')
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    loadData()

    if (autoRefresh) {
      const interval = setInterval(loadData, 30000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh, selectedStage])

  const loadData = async () => {
    try {
      setLoading(true)

      const [pred, staff, opt, pat, met] = await Promise.all([
        predictiveQueue.predictWaitTimes(),
        predictiveQueue.getStaffingRecommendations(),
        predictiveQueue.optimizeQueueOrder(selectedStage),
        predictiveQueue.analyzeHistoricalPatterns(),
        Promise.all([
          predictiveQueue.getQueueMetrics('registration'),
          predictiveQueue.getQueueMetrics('vitals'),
          predictiveQueue.getQueueMetrics('consult'),
          predictiveQueue.getQueueMetrics('pharmacy')
        ])
      ])

      setPredictions(pred)
      setStaffing(staff)
      setOptimizations(opt)
      setPatterns(pat)
      setMetrics(met)
    } catch (error) {
      console.error('Failed to load queue analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical': return 'bg-red-500 text-white'
      case 'high': return 'bg-orange-500 text-white'
      case 'moderate': return 'bg-yellow-500 text-gray-900'
      case 'low': return 'bg-blue-500 text-white'
      default: return 'bg-green-500 text-white'
    }
  }

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      default: return 'text-green-600 bg-green-50 border-green-200'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ChartBarIcon className="h-7 w-7 text-blue-600" />
              Predictive Queue Analytics
            </h2>
            <p className="text-gray-600">
              AI-powered insights for optimal queue management and patient flow
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Auto-refresh (30s)</span>
            </label>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Refresh Now
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {predictions.map((pred) => (
          <div
            key={pred.stage}
            className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-600"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 capitalize">{pred.stage}</h3>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(pred.bottleneckRisk)}`}>
                {pred.bottleneckRisk}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Waiting:</span>
                <span className="font-semibold text-gray-900">{pred.currentWaiting}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Est. Wait:</span>
                <span className="font-semibold text-gray-900">{pred.predictedWaitMinutes} min</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Confidence:</span>
                <span className="font-semibold text-gray-900">{pred.confidence}%</span>
              </div>

              <div className="pt-2 border-t">
                <p className="text-xs text-gray-600">Next patient ETA:</p>
                <p className="text-sm font-medium text-gray-900">
                  {pred.nextPatientETA.toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <UserGroupIcon className="h-6 w-6 text-blue-600" />
            Staffing Recommendations
          </h3>

          <div className="space-y-3">
            {staffing.map((rec) => (
              <div
                key={rec.stage}
                className={`border rounded-lg p-4 ${getUrgencyColor(rec.urgency)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold capitalize">{rec.stage}</h4>
                    <p className="text-sm mt-1">{rec.reason}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${
                    rec.urgency === 'high' ? 'bg-red-600 text-white' :
                    rec.urgency === 'medium' ? 'bg-yellow-600 text-white' :
                    'bg-green-600 text-white'
                  }`}>
                    {rec.urgency}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Current: </span>
                    <span className="font-semibold">{rec.currentStaff}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Recommended: </span>
                    <span className="font-semibold">{rec.recommendedStaff}</span>
                  </div>
                  {rec.recommendedStaff > rec.currentStaff && (
                    <div className="ml-auto">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-medium">
                        Need +{rec.recommendedStaff - rec.currentStaff} staff
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <SparklesIcon className="h-6 w-6 text-blue-600" />
            Queue Optimizations
          </h3>

          <div className="mb-4">
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="registration">Registration</option>
              <option value="vitals">Vitals</option>
              <option value="consult">Consultation</option>
              <option value="pharmacy">Pharmacy</option>
            </select>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {optimizations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CheckCircleIcon className="h-12 w-12 mx-auto mb-2 text-green-500" />
                <p>Queue order is optimal</p>
                <p className="text-sm mt-1">No reordering recommended</p>
              </div>
            ) : (
              optimizations.map((opt, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">Patient ID: {opt.patientId.slice(0, 8)}</p>
                      <p className="text-sm text-gray-600 mt-1">{opt.reason}</p>
                    </div>
                    <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                      Score: {opt.priorityScore}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Current: </span>
                      <span className="font-semibold">#{opt.currentPosition}</span>
                    </div>
                    <div className="text-gray-400">→</div>
                    <div>
                      <span className="text-gray-600">Recommended: </span>
                      <span className="font-semibold text-green-600">#{opt.recommendedPosition}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ClockIcon className="h-6 w-6 text-blue-600" />
          Real-time Recommendations
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {predictions.map((pred) => (
            <div key={pred.stage} className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 capitalize mb-3">{pred.stage}</h4>
              <ul className="space-y-2">
                {pred.recommendedActions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                    {action.includes('URGENT') ? (
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <span className="h-5 w-5 flex-shrink-0 flex items-center justify-center mt-0.5">
                        <span className="h-2 w-2 rounded-full bg-blue-600"></span>
                      </span>
                    )}
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ArrowTrendingUpIcon className="h-6 w-6 text-blue-600" />
          Historical Patterns & Peak Times
        </h3>

        <div className="space-y-4">
          {patterns.map((pattern, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    Average Volume: {pattern.averageVolume} patients/hour
                  </p>
                  <p className="text-sm text-gray-600">
                    Current: {pattern.timeOfDay}:00 | {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pattern.dayOfWeek]}
                  </p>
                </div>
              </div>

              {pattern.peakTimes.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-700 mb-1">Peak Times:</p>
                  <div className="flex flex-wrap gap-2">
                    {pattern.peakTimes.map((time, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-1 rounded-md bg-orange-100 text-orange-700 text-xs font-medium"
                      >
                        {time}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Recommendations:</p>
                <ul className="space-y-1">
                  {pattern.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-blue-600">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ChartBarIcon className="h-6 w-6 text-blue-600" />
          Performance Metrics
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <div key={metric.stage} className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 capitalize mb-3">{metric.stage}</h4>

              <div className="space-y-2">
                <div>
                  <p className="text-xs text-gray-600">Throughput</p>
                  <p className="text-lg font-semibold text-gray-900">{metric.throughput}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-600">Avg Service Time</p>
                  <p className="text-lg font-semibold text-gray-900">{metric.averageServiceTime}s</p>
                </div>

                <div>
                  <p className="text-xs text-gray-600">Efficiency</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          metric.efficiency >= 80 ? 'bg-green-500' :
                          metric.efficiency >= 60 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${metric.efficiency}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{metric.efficiency}%</span>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-600">Patient Satisfaction</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          metric.patientSatisfactionScore >= 80 ? 'bg-green-500' :
                          metric.patientSatisfactionScore >= 60 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${metric.patientSatisfactionScore}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{metric.patientSatisfactionScore}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <SparklesIcon className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">About Predictive Queue Analytics</p>
            <p className="text-blue-800">
              This AI-powered system analyzes historical patterns, current queue status, and patient risk factors
              to predict wait times, optimize patient order, and recommend staffing levels. All predictions work
              completely offline using machine learning algorithms running in your browser.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, Patient, QueueItem } from '@/db'
import { queueManagement, QueueStage } from '@/services/queueManagement'
import {
  QueueListIcon,
  PlayIcon,
  CheckIcon,
  ClockIcon,
  UserIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline'

const STAGES: QueueStage[] = ['registration', 'vitals', 'consult', 'pharmacy']

const stageIcons = {
  registration: UserIcon,
  vitals: HeartIcon,
  consult: DocumentTextIcon,
  pharmacy: BeakerIcon
}

const stageColors = {
  registration: 'bg-blue-50 border-blue-200 text-blue-800',
  vitals: 'bg-green-50 border-green-200 text-green-800',
  consult: 'bg-purple-50 border-purple-200 text-purple-800',
  pharmacy: 'bg-orange-50 border-orange-200 text-orange-800'
}

interface QueueWithPatient extends QueueItem {
  patient?: Patient
}

export function Queue() {
  const { t } = useTranslation()
  const [selectedStage, setSelectedStage] = useState<QueueStage>('vitals')
  const [stats, setStats] = useState<any>(null)

  // Live query for all queue items
  const allQueueItems = useLiveQuery(
    () => db.queue.toArray(),
    [],
    []
  )

  // Live query for selected stage
  const stageQueueItems = useLiveQuery(
    () => db.queue
      .where('stage')
      .equals(selectedStage)
      .and(item => item.status !== 'done')
      .sortBy('position'),
    [selectedStage],
    []
  )

  // Load patients for queue items
  const [queueWithPatients, setQueueWithPatients] = useState<QueueWithPatient[]>([])

  useEffect(() => {
    loadQueueWithPatients()
  }, [stageQueueItems])

  useEffect(() => {
    loadStats()
  }, [selectedStage])

  const loadQueueWithPatients = async () => {
    if (!stageQueueItems || stageQueueItems.length === 0) {
      setQueueWithPatients([])
      return
    }

    const withPatients = await Promise.all(
      stageQueueItems.map(async (item) => {
        const patient = await db.patients.get(item.patientId)
        return { ...item, patient }
      })
    )

    setQueueWithPatients(withPatients)
  }

  const loadStats = async () => {
    const statsData = await queueManagement.getQueueStats(selectedStage)
    setStats(statsData)
  }

  const handleStartService = async (queueItemId: string) => {
    await queueManagement.startService(queueItemId)
    await loadStats()
  }

  const handleCompleteService = async (queueItemId: string) => {
    const item = await db.queue.get(queueItemId)
    if (item) {
      await queueManagement.moveToNextStage(item.patientId)
      await loadStats()
    }
  }

  const handleSkipToFront = async (patientId: string) => {
    await queueManagement.skipQueue(patientId, 'Manual priority')
    await loadStats()
  }

  // Calculate stage counts for all stages
  const stageCounts = STAGES.map(stage => {
    const items = allQueueItems?.filter(
      item => item.stage === stage && item.status !== 'done'
    ) || []
    return {
      stage,
      count: items.length,
      waiting: items.filter(i => i.status === 'waiting').length,
      inProgress: items.filter(i => i.status === 'in_progress').length
    }
  })

  const waiting = queueWithPatients.filter(item => item.status === 'waiting')
  const inProgress = queueWithPatients.find(item => item.status === 'in_progress')

  const getWaitTime = (updatedAt: Date) => {
    const now = new Date()
    const diff = now.getTime() - new Date(updatedAt).getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <QueueListIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('nav.queue')}
          </h1>
          <p className="text-gray-600">
            Manage patient flow through care stages
          </p>
        </div>
      </div>

      {/* Queue Overview - All Stages */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Queue Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stageCounts.map(({ stage, count, waiting, inProgress }) => {
            const Icon = stageIcons[stage]

            return (
              <div key={stage} className={`p-4 rounded-lg border ${stageColors[stage]}`}>
                <div className="flex items-center space-x-2 mb-2">
                  <Icon className="h-5 w-5" />
                  <span className="font-medium capitalize">{stage}</span>
                </div>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-sm opacity-75">
                  {inProgress} active, {waiting} waiting
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stage Selector */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Queue Management</h2>
        <div className="flex space-x-2 overflow-x-auto mb-6">
          {STAGES.map(stage => {
            const stageData = stageCounts.find(s => s.stage === stage)
            return (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                className={`px-4 py-2 rounded-lg border font-medium capitalize whitespace-nowrap ${
                  selectedStage === stage
                    ? stageColors[stage]
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {stage} ({stageData?.count || 0})
              </button>
            )
          })}
        </div>

        {/* Queue Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm text-blue-600">Waiting</div>
              <div className="text-2xl font-bold text-blue-800">{stats.waiting}</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="text-sm text-yellow-600">In Progress</div>
              <div className="text-2xl font-bold text-yellow-800">{stats.inProgress}</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-sm text-green-600">Completed Today</div>
              <div className="text-2xl font-bold text-green-800">{stats.done}</div>
            </div>
          </div>
        )}

        {/* Current Patient */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Now Serving</h3>
          {inProgress ? (
            <div className="p-6 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4 flex-1">
                  <div className="w-16 h-16 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                    {inProgress.position}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-gray-900">
                      {inProgress.patient?.givenName} {inProgress.patient?.familyName}
                    </h4>
                    <p className="text-gray-600 mt-1">
                      {inProgress.patient?.sex} • {inProgress.patient?.dob}
                    </p>
                    <p className="text-gray-600">
                      {inProgress.patient?.phone}
                    </p>
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      Service time: {getWaitTime(inProgress.updatedAt)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col space-y-2">
                  <button
                    className="btn-primary flex items-center space-x-2"
                    onClick={() => handleCompleteService(inProgress.id)}
                  >
                    <CheckIcon className="h-5 w-5" />
                    <span>Complete</span>
                  </button>
                  <Link
                    to={`/patients/${inProgress.patientId}`}
                    className="btn-secondary text-center"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 bg-gray-50 border border-gray-200 rounded-lg">
              <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">No patient currently being served</p>
              {waiting.length > 0 && (
                <button
                  onClick={() => handleStartService(waiting[0].id)}
                  className="btn-primary mt-4 inline-flex items-center space-x-2"
                >
                  <PlayIcon className="h-5 w-5" />
                  <span>Start Next Patient</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Waiting Queue */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Waiting Queue ({waiting.length})
          </h3>

          {waiting.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 border border-gray-200 rounded-lg">
              <CheckIcon className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p className="text-gray-600">No patients waiting in {selectedStage}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {waiting.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-4 border rounded-lg ${
                    index === 0 ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                      index === 0 ? 'bg-green-600' : 'bg-gray-500'
                    }`}>
                      {item.position}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">
                        {item.patient?.givenName} {item.patient?.familyName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {item.patient?.phone}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Waiting: {getWaitTime(item.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {index === 0 && !inProgress && (
                      <button
                        onClick={() => handleStartService(item.id)}
                        className="btn-primary text-sm flex items-center space-x-1"
                      >
                        <PlayIcon className="h-4 w-4" />
                        <span>Start</span>
                      </button>
                    )}
                    {index > 0 && (
                      <button
                        onClick={() => handleSkipToFront(item.patientId)}
                        className="btn-secondary text-sm flex items-center space-x-1"
                        title="Move to front of queue"
                      >
                        <ArrowRightIcon className="h-4 w-4" />
                        <span>Priority</span>
                      </button>
                    )}
                    <Link
                      to={`/patients/${item.patientId}`}
                      className="btn-secondary text-sm"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

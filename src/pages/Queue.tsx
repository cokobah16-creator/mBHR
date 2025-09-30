import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { useQueue } from '@/stores/queue'
import { usePatientsStore } from '@/stores/patients'
import { 
  QueueListIcon, 
  PlayIcon, 
  CheckIcon, 
  ClockIcon,
  UserGroupIcon,
  UserIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon
} from '@heroicons/react/24/outline'

const STAGES: Array<'registration'|'vitals'|'consult'|'pharmacy'> = ['registration', 'vitals', 'consult', 'pharmacy']

// Helper functions
const asArray = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])
const shortTicket = (n?: string) => {
  if (!n) return '—'
  const parts = String(n).split('-')
  return parts.length > 1 ? parts[1] : n
}

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

export function Queue() {
  const { t } = useTranslation()
  const { callNext, completeCurrent, estimateTailMinutes, issueTicket } = useQueue()
  const [metrics, setMetrics] = useState<any[]>([])
  const [selectedStage, setSelectedStage] = useState<'registration'|'vitals'|'consult'|'pharmacy'>('registration')
  const [etaTail, setEtaTail] = useState(0)

  // Use live queries with defensive defaults
  const allTicketsQ = useLiveQuery(
    () => mbhrDb.tickets.toArray(),
    [],
    [] as any[]
  )

  const stageTicketsQ = useLiveQuery(
    () => mbhrDb.tickets
      .where('currentStage')
      .equals(selectedStage)
      .toArray(),
    [selectedStage],
    [] as any[]
  )

  // Convert to safe arrays
  const allTickets = asArray(allTicketsQ)
  const stageTickets = asArray(stageTicketsQ)

  useEffect(() => {
    loadMetrics()
    updateETA()
  }, [selectedStage])

  const loadMetrics = async () => {
    try {
      const metricsData = await mbhrDb.queue_metrics.toArray()
      setMetrics(metricsData)
    } catch (error) {
      console.error('Error loading metrics:', error)
    }
  }

  const updateETA = async () => {
    try {
      const eta = await estimateTailMinutes(selectedStage)
      setEtaTail(eta)
    } catch (error) {
      console.error('Error updating ETA:', error)
    }
  }

  // Safe filtering
  const waiting = stageTickets.filter(t => t?.state === 'waiting')
  const inProgress = stageTickets.find(t => t?.state === 'in_progress') ?? null
  const doneToday = stageTickets.filter(t => t?.state === 'done')

  const handleCallNext = async () => {
    const next = await callNext(selectedStage)
    if (next) {
      await updateETA()
    }
  }

  const handleCompleteCurrent = async () => {
    await completeCurrent(selectedStage, 240) // 4 minutes default
    await updateETA()
  }

  // Generate demo tickets if none exist
  const generateDemoTickets = async () => {
    const categories = ['adult', 'child', 'antenatal'] as const
    const priorities = ['normal', 'urgent'] as const
    
    for (let i = 1; i <= 8; i++) {
      await issueTicket({
        siteId: 'demo-site',
        category: categories[i % 3],
        priority: i <= 2 ? 'urgent' : 'normal',
        stage: STAGES[Math.floor(Math.random() * STAGES.length)]
      })
    }
  }

  const metric = metrics.find(m => m?.stage === selectedStage)
  const avgServiceSec = metric?.avgServiceSec ?? 240

  const getPriorityColor = (priority: string) => {
    return priority === 'urgent' ? 'text-red-600' : 'text-gray-600'
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
          {STAGES.map((stageName) => {
            const stageItems = asArray(useLiveQuery(
              () => mbhrDb.tickets.where('currentStage').equals(stageName).toArray(),
              [stageName],
              [] as any[]
            )).filter(item => item?.state !== 'done')
            const Icon = stageIcons[stageName]

            return (
              <div key={stageName} className={`p-4 rounded-lg border ${stageColors[stageName]}`}>
                <div className="flex items-center space-x-2 mb-2">
                  <Icon className="h-5 w-5" />
                  <span className="font-medium capitalize">{stageName}</span>
                </div>
                <p className="text-2xl font-bold">{stageItems.length}</p>
                <p className="text-sm opacity-75">
                  {stageItems.filter(item => item?.state === 'in_progress').length} active
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
            const stageCount = allTickets.filter(t => t?.currentStage === stage && t?.state !== 'done').length
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
                {stage} ({stageCount})
              </button>
            )
          })}
        </div>

        {/* Queue Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm text-blue-600">Waiting</div>
            <div className="text-2xl font-bold text-blue-800">{waiting.length}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="text-sm text-yellow-600">In Progress</div>
            <div className="text-2xl font-bold text-yellow-800">{inProgress ? '1' : '0'}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-sm text-green-600">Avg Service Time</div>
            <div className="text-2xl font-bold text-green-800">{Math.round(avgServiceSec / 60)}m</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-sm text-purple-600">ETA for Last</div>
            <div className="text-2xl font-bold text-purple-800">{etaTail}m</div>
          </div>
        </div>

        {/* Queue Controls */}
        <div className="flex space-x-4 mb-6">
          <button 
            className="btn-primary flex items-center space-x-2" 
            onClick={handleCallNext}
            disabled={waiting.length === 0 || !!inProgress}
          >
            <PlayIcon className="h-5 w-5" />
            <span>Call Next</span>
          </button>
          <button 
            className="btn-secondary flex items-center space-x-2" 
            onClick={handleCompleteCurrent} 
            disabled={!inProgress}
          >
            <CheckIcon className="h-5 w-5" />
            <span>Complete Current</span>
          </button>
          {allTickets.length === 0 && (
            <button 
              className="btn-secondary flex items-center space-x-2" 
              onClick={generateDemoTickets}
            >
              <UserGroupIcon className="h-5 w-5" />
              <span>Generate Demo Tickets</span>
            </button>
          )}
        </div>

        {/* Current Patient */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Now Serving</h3>
          {inProgress ? (
            <div className="flex items-center space-x-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                {shortTicket(inProgress?.number)}
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{inProgress?.number ?? '—'}</div>
                <div className="text-sm text-gray-600 capitalize">
                  {inProgress?.category ?? '—'} • {inProgress?.priority ?? '—'} priority
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <ClockIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No patient currently being served</p>
            </div>
          )}
        </div>

        {/* Waiting Queue */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Waiting Queue ({waiting.length})
          </h3>
          
          {waiting.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No patients waiting in {selectedStage}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {waiting.slice(0, 10).map((ticket, index) => (
                <div 
                  key={ticket?.id} 
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    index === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{ticket?.number ?? '—'}</div>
                      <div className="text-sm text-gray-600 capitalize">
                        {ticket?.category ?? '—'} • 
                        <span className={getPriorityColor(ticket?.priority ?? '')}>
                          {ticket?.priority ?? '—'} priority
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {index === 0 ? 'Next' : `~${(index * avgServiceSec) / 60}m`}
                  </div>
                </div>
              ))}
              
              {waiting.length > 10 && (
                <div className="text-center text-sm text-gray-500 py-2">
                  ... and {waiting.length - 10} more patients
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
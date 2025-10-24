import React, { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, QueueItem, Patient, epochDay } from '@/db'
import { 
  QueueListIcon, 
  PlayIcon, 
  CheckIcon, 
  ClockIcon,
  UserGroupIcon,
  UserIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline'

const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'] as const
type Stage = typeof STAGES[number]

interface StageMetrics {
  stage: Stage
  waiting: number
  inProgress: number
  avgTimeMinutes: number
  etaMinutes: number
}

export function EnhancedQueueBoard() {
  const [selectedStage, setSelectedStage] = useState<Stage>('registration')
  const [stageMetrics, setStageMetrics] = useState<StageMetrics[]>([])
  const [handoffLoading, setHandoffLoading] = useState<string | null>(null)

  // Live query for queue items
  const queueItems = useLiveQuery(
    () => db.queue.orderBy('position').toArray(),
    [],
    []
  )

  // Live query for patients to get names
  const patients = useLiveQuery(
    () => db.patients.toArray(),
    [],
    []
  )

  const patientMap = new Map(patients.map(p => [p.id, p]))

  useEffect(() => {
    calculateStageMetrics()
  }, [queueItems])

  const calculateStageMetrics = async () => {
    const metrics: StageMetrics[] = []
    
    for (const stage of STAGES) {
      const stageItems = queueItems.filter(item => item.stage === stage)
      const waiting = stageItems.filter(item => item.status === 'waiting').length
      const inProgress = stageItems.filter(item => item.status === 'in_progress').length
      
      // Simple ETA calculation (4 minutes average per patient)
      const avgTimeMinutes = 4
      const etaMinutes = waiting * avgTimeMinutes
      
      metrics.push({
        stage,
        waiting,
        inProgress,
        avgTimeMinutes,
        etaMinutes
      })
    }
    
    setStageMetrics(metrics)
  }

  const callNext = async (stage: Stage) => {
    try {
      const nextItem = queueItems
        .filter(item => item.stage === stage && item.status === 'waiting')
        .sort((a, b) => a.position - b.position)[0]
      
      if (!nextItem) return
      
      await db.queue.update(nextItem.id, {
        status: 'in_progress',
        updatedAt: new Date()
      })
    } catch (error) {
      console.error('Error calling next patient:', error)
    }
  }

  const completeHandoff = async (stage: Stage, nextStage?: Stage) => {
    setHandoffLoading(stage)
    try {
      const currentItem = queueItems.find(
        item => item.stage === stage && item.status === 'in_progress'
      )
      
      if (!currentItem) return
      
      if (nextStage) {
        // Move to next stage
        await db.queue.update(currentItem.id, {
          stage: nextStage,
          status: 'waiting',
          position: await getNextPosition(nextStage),
          updatedAt: new Date()
        })
      } else {
        // Complete (remove from queue)
        await db.queue.update(currentItem.id, {
          status: 'done',
          updatedAt: new Date()
        })
      }
    } catch (error) {
      console.error('Error completing handoff:', error)
    } finally {
      setHandoffLoading(null)
    }
  }

  const getNextPosition = async (stage: Stage): Promise<number> => {
    const stageItems = await db.queue.where('stage').equals(stage).toArray()
    return Math.max(0, ...stageItems.map(item => item.position)) + 1
  }

  const getStageIcon = (stage: Stage) => {
    switch (stage) {
      case 'registration': return UserIcon
      case 'vitals': return HeartIcon
      case 'consult': return DocumentTextIcon
      case 'pharmacy': return BeakerIcon
    }
  }

  const getStageColor = (stage: Stage) => {
    switch (stage) {
      case 'registration': return 'bg-blue-50 border-blue-200 text-blue-800'
      case 'vitals': return 'bg-green-50 border-green-200 text-green-800'
      case 'consult': return 'bg-purple-50 border-purple-200 text-purple-800'
      case 'pharmacy': return 'bg-orange-50 border-orange-200 text-orange-800'
    }
  }

  const getNextStage = (stage: Stage): Stage | null => {
    const stageIndex = STAGES.indexOf(stage)
    return stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null
  }

  const selectedMetrics = stageMetrics.find(m => m.stage === selectedStage)
  const currentPatient = queueItems.find(
    item => item.stage === selectedStage && item.status === 'in_progress'
  )
  const waitingPatients = queueItems
    .filter(item => item.stage === selectedStage && item.status === 'waiting')
    .sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <QueueListIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enhanced Queue Management</h1>
          <p className="text-gray-600">Real-time patient flow with clear handoffs</p>
        </div>
      </div>

      {/* Stage Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stageMetrics.map((metrics) => {
          const Icon = getStageIcon(metrics.stage)
          const isSelected = selectedStage === metrics.stage
          
          return (
            <button
              key={metrics.stage}
              onClick={() => setSelectedStage(metrics.stage)}
              className={`p-4 rounded-lg border-2 transition-all touch-target ${
                isSelected 
                  ? getStageColor(metrics.stage) + ' ring-2 ring-primary/20'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2 mb-2">
                <Icon className="h-5 w-5" />
                <span className="font-medium capitalize">{metrics.stage}</span>
              </div>
              <div className="text-2xl font-bold">{metrics.waiting + metrics.inProgress}</div>
              <div className="text-sm opacity-75">
                {metrics.inProgress > 0 ? `${metrics.inProgress} active` : 'Ready'}
              </div>
              {metrics.etaMinutes > 0 && (
                <div className="text-xs mt-1">ETA: {metrics.etaMinutes}m</div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Stage Details */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900 capitalize">
            {selectedStage} Station
          </h2>
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <span>Waiting: {selectedMetrics?.waiting || 0}</span>
            <span>Active: {selectedMetrics?.inProgress || 0}</span>
            <span>ETA: {selectedMetrics?.etaMinutes || 0}m</span>
          </div>
        </div>

        {/* Current Patient */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Now Serving</h3>
          {currentPatient ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold">
                    {currentPatient.position}
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">
                      {patientMap.get(currentPatient.patientId)?.givenName || 'Unknown'}{' '}
                      {patientMap.get(currentPatient.patientId)?.familyName || 'Patient'}
                    </h4>
                    <p className="text-sm text-gray-600">
                      Started: {currentPatient.updatedAt.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  {getNextStage(selectedStage) && (
                    <button
                      onClick={() => completeHandoff(selectedStage, getNextStage(selectedStage)!)}
                      disabled={handoffLoading === selectedStage}
                      className="btn-primary inline-flex items-center space-x-2"
                    >
                      <ArrowRightIcon className="h-4 w-4" />
                      <span>Send to {getNextStage(selectedStage)}</span>
                    </button>
                  )}
                  <button
                    onClick={() => completeHandoff(selectedStage)}
                    disabled={handoffLoading === selectedStage}
                    className="btn-secondary inline-flex items-center space-x-2"
                  >
                    <CheckIcon className="h-4 w-4" />
                    <span>Complete</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <ClockIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No patient currently being served</p>
              {waitingPatients.length > 0 && (
                <button
                  onClick={() => callNext(selectedStage)}
                  className="btn-primary mt-4 inline-flex items-center space-x-2"
                >
                  <PlayIcon className="h-5 w-5" />
                  <span>Call Next Patient</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Waiting Queue */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">
            Waiting Queue ({waitingPatients.length})
          </h3>
          
          {waitingPatients.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <UserGroupIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No patients waiting in {selectedStage}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {waitingPatients.slice(0, 10).map((item, index) => {
                const patient = patientMap.get(item.patientId)
                const isNext = index === 0
                
                return (
                  <div 
                    key={item.id}
                    className={`flex items-center justify-between p-3 border rounded-lg ${
                      isNext ? 'border-green-200 bg-green-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                        isNext ? 'bg-green-600' : 'bg-gray-600'
                      }`}>
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">
                          {patient?.givenName || 'Unknown'} {patient?.familyName || 'Patient'}
                        </div>
                        <div className="text-sm text-gray-600">
                          Position: {item.position} • Added: {item.updatedAt.toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      {isNext ? 'Next' : `~${index * (selectedMetrics?.avgTimeMinutes || 4)}m`}
                    </div>
                  </div>
                )
              })}
              
              {waitingPatients.length > 10 && (
                <div className="text-center text-sm text-gray-500 py-2">
                  ... and {waitingPatients.length - 10} more patients
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
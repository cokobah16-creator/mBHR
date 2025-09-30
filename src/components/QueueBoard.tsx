import React, { useEffect } from 'react'
import { useQueueStore } from '@/stores/queue'
import { usePatientsStore } from '@/stores/patients'
import { QueueItem } from '@/db'
import { 
  UserPlusIcon, 
  HeartIcon, 
  DocumentTextIcon, 
  BeakerIcon,
  ClockIcon,
  PlayIcon,
  CheckIcon
} from '@heroicons/react/24/outline'

const stageIcons = {
  registration: UserPlusIcon,
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

const statusColors = {
  waiting: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  done: 'bg-green-100 text-green-700'
}

interface QueueBoardProps {
  stage?: QueueItem['stage']
  compact?: boolean
}

export function QueueBoard({ stage, compact = false }: QueueBoardProps) {
  const { queueItems, loadQueue, updateQueueStatus, moveToNextStage } = useQueueStore()
  const { patients, loadPatients } = usePatientsStore()

  useEffect(() => {
    loadQueue()
    loadPatients()
  }, [])

  const filteredItems = stage 
    ? queueItems.filter(item => item.stage === stage && item.status !== 'done')
    : queueItems

  const handleStartPatient = async (patientId: string) => {
    await updateQueueStatus(patientId, 'in_progress')
  }

  const handleCompletePatient = async (patientId: string) => {
    await moveToNextStage(patientId)
  }

  const getPatientAge = (dob: string) => {
    const birthDate = new Date(dob)
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }
    
    return age
  }

  if (compact) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['registration', 'vitals', 'consult', 'pharmacy'] as const).map((stageName) => {
          const stageItems = queueItems.filter(item => item.stage === stageName && item.status !== 'done')
          const Icon = stageIcons[stageName]
          
          return (
            <div key={stageName} className={`p-4 rounded-lg border ${stageColors[stageName]}`}>
              <div className="flex items-center space-x-2 mb-2">
                <Icon className="h-5 w-5" />
                <span className="font-medium capitalize">{stageName}</span>
              </div>
              <p className="text-2xl font-bold">{stageItems.length}</p>
              <p className="text-sm opacity-75">
                {stageItems.filter(item => item.status === 'in_progress').length} active
              </p>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {filteredItems.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <ClockIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No patients in queue</p>
        </div>
      ) : (
        filteredItems.map((item) => {
          const patient = item.patient
          if (!patient) return null

          const Icon = stageIcons[item.stage]
          
          return (
            <div
              key={item.id}
              className={`card border-l-4 ${
                item.status === 'in_progress' 
                  ? 'border-l-yellow-500 bg-yellow-50' 
                  : item.status === 'done'
                  ? 'border-l-green-500 bg-green-50'
                  : 'border-l-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* Patient Photo */}
                  <div className="flex-shrink-0">
                    {patient.photoUrl ? (
                      <img
                        src={patient.photoUrl}
                        alt={`${patient.givenName} ${patient.familyName}`}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-lg font-medium text-gray-600">
                          {patient.givenName[0]}{patient.familyName[0]}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Patient Info */}
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {patient.givenName} {patient.familyName}
                    </h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <span>Age: {getPatientAge(patient.dob)}</span>
                      <span>•</span>
                      <span>{patient.sex}</span>
                      <span>•</span>
                      <span>{patient.phone}</span>
                    </div>
                  </div>

                  {/* Stage Info */}
                  <div className="flex items-center space-x-2">
                    <Icon className="h-5 w-5 text-gray-600" />
                    <div className="text-right">
                      <p className="text-sm font-medium capitalize">{item.stage}</p>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${statusColors[item.status]}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2 ml-4">
                  {item.status === 'waiting' && (
                    <button
                      onClick={() => handleStartPatient(patient.id)}
                      className="flex items-center space-x-1 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors touch-target"
                    >
                      <PlayIcon className="h-4 w-4" />
                      <span>Start</span>
                    </button>
                  )}
                  
                  {item.status === 'in_progress' && (
                    <button
                      onClick={() => handleCompletePatient(patient.id)}
                      className="flex items-center space-x-1 bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors touch-target"
                    >
                      <CheckIcon className="h-4 w-4" />
                      <span>Complete</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
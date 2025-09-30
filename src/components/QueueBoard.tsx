import React, { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/mbhr'
import { useQueue } from '@/stores/queue'
import { usePatientsStore } from '@/stores/patients'
import { 
  QueueListIcon, 
  PlayIcon, 
  CheckIcon, 
  ClockIcon,
  UserIcon
} from '@heroicons/react/24/outline'

// tiny helpers
const asArray = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])
const shortTicket = (n?: string) => {
  if (!n) return '—'
  const parts = String(n).split('-')
  return parts.length > 1 ? parts[1] : n
}

const stageIcons = {
  registration: UserIcon,
  vitals: ClockIcon,
  consult: QueueListIcon,
  pharmacy: CheckIcon
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
  stage?: 'registration' | 'vitals' | 'consult' | 'pharmacy'
  compact?: boolean
}

export function QueueBoard({ stage, compact = false }: QueueBoardProps) {
  const { updateQueueStatus, moveToNextStage } = useQueue()
  const { patients, loadPatients } = usePatientsStore()

  useEffect(() => {
    loadPatients()
  }, [])

  // ✅ give useLiveQuery an initial value so it never returns undefined
  const allTicketsQ = useLiveQuery(
    () => db.tickets.toArray(),
    [],
    [] as any[]
  )

  const stageTicketsQ = useLiveQuery(
    () => stage 
      ? db.tickets.where('currentStage').equals(stage).toArray()
      : db.tickets.toArray(),
    [stage],
    [] as any[]
  )

  // ✅ always coerce to an array
  const allTickets = asArray(allTicketsQ)
  const stageTickets = asArray(stageTicketsQ)

  const filteredItems = stage 
    ? stageTickets.filter(item => item.status !== 'done')
    : allTickets

  // derived sets
  const waiting = stageTickets.filter(t => t.state === 'waiting')
  const inProgress = stageTickets.find(t => t.state === 'in_progress') ?? null
  const doneToday = stageTickets.filter(t => t.state === 'done')

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
          const stageItems = allTickets.filter(item => item.currentStage === stageName && item.state !== 'done')
          const Icon = stageIcons[stageName]
          
          return (
            <div key={stageName} className={`p-4 rounded-lg border ${stageColors[stageName]}`}>
              <div className="flex items-center space-x-2 mb-2">
                <Icon className="h-5 w-5" />
                <span className="font-medium capitalize">{stageName}</span>
              </div>
              <p className="text-2xl font-bold">{stageItems.length}</p>
              <p className="text-sm opacity-75">
                {stageItems.filter(item => item.state === 'in_progress').length} active
              </p>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Waiting" value={waiting.length} />
        <Stat label="In progress" value={inProgress ? 1 : 0} />
        <Stat label="Done today" value={doneToday.length} />
      </div>

      {/* In-progress card – all fields guarded */}
      {inProgress ? (
        <div className="flex items-center space-x-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
            {shortTicket(inProgress?.number)}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{inProgress?.number ?? '—'}</div>
            <div className="text-sm text-gray-600 capitalize">
              {(inProgress?.category ?? '—')} • {(inProgress?.priority ?? '—')} priority
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <ClockIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No patient currently being served</p>
        </div>
      )}

      {/* Waiting list – uses safe array */}
      <TicketList title="Waiting Queue" items={waiting} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  )
}

function TicketList({ title, items }: { title: string; items: any[] }) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title} ({items.length})</h3>
      
      {items.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No patients waiting</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 10).map((ticket, index) => (
            <div 
              key={ticket.id} 
              className={`flex items-center justify-between p-3 border rounded-lg ${
                index === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {index + 1}
                </div>
                <div>
                  <div className="font-medium text-gray-900">{ticket.number ?? '—'}</div>
                  <div className="text-sm text-gray-600 capitalize">
                    {ticket.category ?? '—'} • {ticket.priority ?? '—'} priority
                  </div>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                {index === 0 ? 'Next' : `Position ${index + 1}`}
              </div>
            </div>
          ))}
          
          {items.length > 10 && (
            <div className="text-center text-sm text-gray-500 py-2">
              ... and {items.length - 10} more patients
            </div>
          )}
        </div>
      )}
    </div>
  )
}
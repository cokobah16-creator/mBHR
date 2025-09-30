import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useT'
import { db } from '@/db'
import { getFlagColor, getFlagLabel } from '@/utils/vitals'
import { 
  ClockIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  UserIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'

interface TimelineEvent {
  id: string
  type: 'visit' | 'vitals' | 'consultation' | 'dispense'
  timestamp: Date
  title: string
  details: string
  metadata?: any
  icon: React.ElementType
  color: string
}

interface MedicalTimelineProps {
  patientId: string
  className?: string
}

export function MedicalTimeline({ patientId, className = '' }: MedicalTimelineProps) {
  const { t } = useT()
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'vitals' | 'consultations' | 'medications'>('all')

  useEffect(() => {
    loadTimelineEvents()
  }, [patientId])

  const loadTimelineEvents = async () => {
    try {
      const [visits, vitals, consultations, dispenses] = await Promise.all([
        db.visits.where('patientId').equals(patientId).toArray(),
        db.vitals.where('patientId').equals(patientId).toArray(),
        db.consultations.where('patientId').equals(patientId).toArray(),
        db.dispenses.where('patientId').equals(patientId).toArray()
      ])

      const timelineEvents: TimelineEvent[] = []

      // Add visit events
      visits.forEach(visit => {
        timelineEvents.push({
          id: `visit-${visit.id}`,
          type: 'visit',
          timestamp: visit.startedAt,
          title: t('timeline.visitStarted'),
          details: `${visit.siteName} • ${t(`queue.status.${visit.status}`)}`,
          icon: UserIcon,
          color: 'bg-blue-100 text-blue-800'
        })
      })

      // Add vitals events
      vitals.forEach(vital => {
        const vitalDetails = []
        if (vital.systolic && vital.diastolic) {
          vitalDetails.push(`${t('vitals.bloodPressure')}: ${vital.systolic}/${vital.diastolic}`)
        }
        if (vital.pulseBpm) {
          vitalDetails.push(`${t('vitals.pulse')}: ${vital.pulseBpm} bpm`)
        }
        if (vital.tempC) {
          vitalDetails.push(`${t('vitals.temperature')}: ${vital.tempC}°C`)
        }
        if (vital.bmi) {
          vitalDetails.push(`${t('vitals.bmi')}: ${vital.bmi}`)
        }

        timelineEvents.push({
          id: `vitals-${vital.id}`,
          type: 'vitals',
          timestamp: vital.takenAt,
          title: t('timeline.vitalsRecorded'),
          details: vitalDetails.join(' • '),
          metadata: { flags: vital.flags },
          icon: HeartIcon,
          color: 'bg-green-100 text-green-800'
        })
      })

      // Add consultation events
      consultations.forEach(consultation => {
        timelineEvents.push({
          id: `consultation-${consultation.id}`,
          type: 'consultation',
          timestamp: consultation.createdAt,
          title: t('timeline.consultationCompleted'),
          details: `${consultation.providerName} • ${consultation.provisionalDx.join(', ')}`,
          metadata: { 
            assessment: consultation.soapAssessment,
            plan: consultation.soapPlan 
          },
          icon: DocumentTextIcon,
          color: 'bg-purple-100 text-purple-800'
        })
      })

      // Add dispense events
      dispenses.forEach(dispense => {
        timelineEvents.push({
          id: `dispense-${dispense.id}`,
          type: 'dispense',
          timestamp: dispense.dispensedAt,
          title: t('timeline.medicationDispensed'),
          details: `${dispense.itemName} ${dispense.dosage} × ${dispense.qty}`,
          metadata: { 
            directions: dispense.directions,
            dispensedBy: dispense.dispensedBy 
          },
          icon: BeakerIcon,
          color: 'bg-orange-100 text-orange-800'
        })
      })

      // Sort by timestamp (newest first)
      timelineEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      setEvents(timelineEvents)
    } catch (error) {
      console.error('Error loading timeline events:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredEvents = events.filter(event => {
    if (filter === 'all') return true
    if (filter === 'vitals') return event.type === 'vitals'
    if (filter === 'consultations') return event.type === 'consultation'
    if (filter === 'medications') return event.type === 'dispense'
    return true
  })

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex space-x-4 p-4">
              <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with Filters */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('timeline.medicalHistory')}
        </h3>
        
        <div className="flex space-x-2">
          {[
            { key: 'all', label: t('common.all') },
            { key: 'vitals', label: t('nav.vitals') },
            { key: 'consultations', label: t('timeline.consultations') },
            { key: 'medications', label: t('timeline.medications') }
          ].map(filterOption => (
            <button
              key={filterOption.key}
              onClick={() => setFilter(filterOption.key as any)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === filterOption.key
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {filterOption.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <ClockIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('timeline.noEvents')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
            
            {filteredEvents.map((event, index) => (
              <div key={event.id} className="relative flex items-start space-x-4">
                {/* Timeline dot */}
                <div className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-full border-4 border-white ${event.color}`}>
                  <event.icon className="h-5 w-5" />
                </div>
                
                {/* Event content */}
                <div className="flex-1 min-w-0 pb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-lg font-medium text-gray-900">
                      {event.title}
                    </h4>
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <CalendarIcon className="h-4 w-4" />
                      <span>{event.timestamp.toLocaleDateString()}</span>
                      <ClockIcon className="h-4 w-4" />
                      <span>{event.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </div>
                  
                  <p className="text-gray-700 mb-3">{event.details}</p>
                  
                  {/* Event-specific metadata */}
                  {event.metadata?.flags && event.metadata.flags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {event.metadata.flags.map((flag: string) => (
                        <span
                          key={flag}
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getFlagColor(flag)}`}
                        >
                          {getFlagLabel(flag)}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {event.metadata?.assessment && (
                    <details className="mt-2">
                      <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                        {t('timeline.viewDetails')}
                      </summary>
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm">
                        <p><strong>{t('consultation.assessment')}:</strong> {event.metadata.assessment}</p>
                        {event.metadata.plan && (
                          <p className="mt-2"><strong>{t('consultation.plan')}:</strong> {event.metadata.plan}</p>
                        )}
                      </div>
                    </details>
                  )}
                  
                  {event.metadata?.directions && (
                    <div className="mt-2 p-3 bg-blue-50 rounded-lg text-sm">
                      <p><strong>{t('pharmacy.directions')}:</strong> {event.metadata.directions}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
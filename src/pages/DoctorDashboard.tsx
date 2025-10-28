import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { db } from '@/db'
import type { Patient, Visit, Vital, QueueItem } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { doctorService } from '@/services/doctorService'
import { outreachService } from '@/services/outreachService'
import type { PatientFlag, OutreachEvent, DoctorAnalytics } from '@/types/multiTenant'
import { getFlagColor } from '@/utils/vitals'
import {
  UserIcon,
  ClockIcon,
  FlagIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'

interface PatientInQueue extends QueueItem {
  patient?: Patient
  latestVitals?: Vital
  flags: PatientFlag[]
}

export function DoctorDashboard() {
  const { currentUser } = useAuthStore()
  const [queuePatients, setQueuePatients] = useState<PatientInQueue[]>([])
  const [activeEvent, setActiveEvent] = useState<OutreachEvent | null>(null)
  const [analytics, setAnalytics] = useState<DoctorAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser) {
      loadDashboardData()
      const interval = setInterval(loadDashboardData, 30000)
      return () => clearInterval(interval)
    }
  }, [currentUser])

  const loadDashboardData = async () => {
    if (!currentUser) return

    try {
      setLoading(true)

      const event = await outreachService.getActiveEventForUser(currentUser.id)
      setActiveEvent(event)

      const queue = await db.queue
        .where('stage')
        .equals('consult')
        .and(item => item.status === 'waiting' || item.status === 'in_progress')
        .toArray()

      const patientsWithData = await Promise.all(
        queue.map(async (item) => {
          const patient = await db.patients.get(item.patientId)

          const vitals = await db.vitals
            .where('patientId')
            .equals(item.patientId)
            .reverse()
            .first()

          let flags: PatientFlag[] = []
          if (event && event.org_id) {
            flags = await doctorService.getPatientFlags({
              org_id: event.org_id,
              event_id: event.id,
              status: 'open'
            })
            flags = flags.filter(f => f.patient_id === item.patientId)
          }

          return {
            ...item,
            patient,
            latestVitals: vitals,
            flags
          }
        })
      )

      patientsWithData.sort((a, b) => {
        if (a.flags.length > 0 && b.flags.length === 0) return -1
        if (a.flags.length === 0 && b.flags.length > 0) return 1

        const hasUrgentA = a.flags.some(f => f.priority === 'urgent')
        const hasUrgentB = b.flags.some(f => f.priority === 'urgent')
        if (hasUrgentA && !hasUrgentB) return -1
        if (!hasUrgentA && hasUrgentB) return 1

        return a.position - b.position
      })

      setQueuePatients(patientsWithData)

      if (event && event.id) {
        const analyticsData = await doctorService.getDoctorAnalytics(
          event.id,
          currentUser.id
        )
        setAnalytics(analyticsData)
      }
    } catch (error) {
      console.error('Error loading doctor dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const getWaitTime = (updatedAt: Date) => {
    const now = new Date()
    const diff = now.getTime() - new Date(updatedAt).getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  const getVitalsFlags = (vitals?: Vital) => {
    if (!vitals || !vitals.flags || vitals.flags.length === 0) {
      return null
    }

    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {vitals.flags.map((flag, idx) => (
          <span
            key={idx}
            className={`text-xs px-2 py-0.5 rounded-full ${getFlagColor(flag)}`}
          >
            {flag}
          </span>
        ))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading consultation queue...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Doctor Consultation Station</h1>
          <p className="text-gray-600">
            {activeEvent ? `${activeEvent.event_name} - ${activeEvent.site_id}` : 'No active event'}
          </p>
        </div>
        {analytics && (
          <div className="flex items-center space-x-4 bg-white rounded-lg shadow-sm p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{analytics.patients_seen}</div>
              <div className="text-xs text-gray-600">Patients Seen</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{analytics.consultations_completed}</div>
              <div className="text-xs text-gray-600">Completed</div>
            </div>
            {analytics.avg_consultation_time_minutes && (
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {analytics.avg_consultation_time_minutes.toFixed(1)}m
                </div>
                <div className="text-xs text-gray-600">Avg Time</div>
              </div>
            )}
          </div>
        )}
      </div>

      {queuePatients.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Queue Clear</h3>
          <p className="text-gray-600">No patients waiting for consultation at this time.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {queuePatients.map((item) => {
            if (!item.patient) return null

            const isActive = selectedPatient === item.patientId
            const hasUrgentFlags = item.flags.some(f => f.priority === 'urgent')

            return (
              <div
                key={item.id}
                className={`bg-white rounded-lg shadow-sm p-6 border-2 transition-all ${
                  isActive
                    ? 'border-blue-500'
                    : hasUrgentFlags
                    ? 'border-red-300'
                    : 'border-transparent hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4 flex-1">
                    {item.patient.photoUrl ? (
                      <img
                        src={item.patient.photoUrl}
                        alt={`${item.patient.givenName} ${item.patient.familyName}`}
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                        <UserIcon className="h-8 w-8 text-gray-400" />
                      </div>
                    )}

                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {item.patient.givenName} {item.patient.familyName}
                        </h3>
                        <span className="text-sm text-gray-500">
                          {item.patient.sex} • {item.patient.dob}
                        </span>
                        {item.flags.length > 0 && (
                          <span className="flex items-center text-sm text-red-600">
                            <ExclamationTriangleIcon className="h-4 w-4 mr-1" />
                            {item.flags.length} flag{item.flags.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-sm text-gray-600">
                        <p>{item.patient.phone}</p>
                        <p>{item.patient.address}</p>
                      </div>

                      {item.latestVitals && (
                        <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">BP:</span>
                            <span className="ml-1 font-medium">
                              {item.latestVitals.systolic}/{item.latestVitals.diastolic}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Temp:</span>
                            <span className="ml-1 font-medium">{item.latestVitals.tempC}°C</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Pulse:</span>
                            <span className="ml-1 font-medium">{item.latestVitals.pulseBpm} bpm</span>
                          </div>
                          <div>
                            <span className="text-gray-600">SpO2:</span>
                            <span className="ml-1 font-medium">{item.latestVitals.spo2}%</span>
                          </div>
                        </div>
                      )}

                      {getVitalsFlags(item.latestVitals)}

                      {item.flags.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {item.flags.map((flag) => (
                            <div
                              key={flag.id}
                              className="flex items-start space-x-2 text-sm bg-yellow-50 border border-yellow-200 rounded p-2"
                            >
                              <FlagIcon className="h-4 w-4 text-yellow-600 mt-0.5" />
                              <div>
                                <div className="font-medium text-yellow-900">
                                  {flag.flag_type.replace(/_/g, ' ')}
                                </div>
                                <div className="text-yellow-800">{flag.message}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end space-y-2">
                    <div className="flex items-center text-sm text-gray-500">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      {getWaitTime(item.updatedAt)}
                    </div>

                    <Link
                      to={`/consult`}
                      state={{ patientId: item.patientId }}
                      className="btn-primary text-sm"
                      onClick={() => setSelectedPatient(item.patientId)}
                    >
                      Start Consultation
                    </Link>

                    <Link
                      to={`/patients/${item.patientId}`}
                      className="btn-secondary text-sm"
                    >
                      View History
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/labs" className="btn-secondary flex items-center justify-center">
            <ChartBarIcon className="h-5 w-5 mr-2" />
            Lab Orders
          </Link>
          <Link to="/pharmacy" className="btn-secondary flex items-center justify-center">
            Pharmacy
          </Link>
          <Link to="/patients" className="btn-secondary flex items-center justify-center">
            <UserIcon className="h-5 w-5 mr-2" />
            All Patients
          </Link>
          <button className="btn-secondary flex items-center justify-center">
            Protocols
          </button>
        </div>
      </div>
    </div>
  )
}

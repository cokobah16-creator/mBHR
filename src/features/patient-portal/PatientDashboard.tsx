import { useEffect, useState } from 'react'
import { formatNigerianDate } from '@/utils/dateFormat'
import { Link } from 'react-router-dom'
import {
  CalendarIcon,
  HeartIcon,
  BeakerIcon,
  EnvelopeIcon,
  BellIcon,
  ClipboardDocumentListIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { getPatientDashboard } from '@/services/patientPortalData'
import type { PatientDashboardData } from '@/types/patientPortal'
import * as logger from '@/lib/logger'

export function PatientDashboard() {
  const [data, setData] = useState<PatientDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    setLoading(true)
    setError('')
    try {
      const portalUserStr = localStorage.getItem('patient_portal_user')
      if (!portalUserStr) {
        logger.info('No portal user found in localStorage - redirecting to login')
        window.location.href = '/patient/login'
        return
      }

      const portalUser = JSON.parse(portalUserStr)
      if (!portalUser.patientId || !portalUser.id) {
        logger.warn('Invalid portal user data - redirecting to login')
        localStorage.removeItem('patient_portal_user')
        localStorage.removeItem('patient_session_token')
        window.location.href = '/patient/login'
        return
      }
      const dashboardData = await getPatientDashboard(portalUser.id, portalUser.patientId)
      if (dashboardData) {
        setData(dashboardData)
      } else {
        setError('Failed to load dashboard data')
      }
    } catch (err) {
      logger.error('Error loading dashboard:', err)
      setError('An error occurred loading your information')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  const { patient, upcomingAppointments, recentVitals, activeMedications, unreadMessages, unreadNotifications, recentLabResults } = data

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {patient.givenName}!
        </h1>
        <p className="text-gray-600 mt-2">Here's an overview of your health information</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link
          to="/patient/appointments"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Upcoming Appointments</p>
              <p className="text-2xl font-bold text-gray-900">{upcomingAppointments.length}</p>
            </div>
          </div>
          {upcomingAppointments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-700 font-medium">
                Next: {formatNigerianDate(upcomingAppointments[0].scheduledAt)}
              </p>
              <p className="text-xs text-gray-500">{upcomingAppointments[0].appointmentType}</p>
            </div>
          )}
        </Link>

        <Link
          to="/patient/messages"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <EnvelopeIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Messages</p>
              <p className="text-2xl font-bold text-gray-900">{unreadMessages}</p>
              <p className="text-xs text-gray-500">unread</p>
            </div>
          </div>
          {unreadMessages > 0 && (
            <div className="absolute top-4 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-xs text-white font-bold">{unreadMessages}</span>
            </div>
          )}
        </Link>

        <Link
          to="/patient/notifications"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <BellIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Notifications</p>
              <p className="text-2xl font-bold text-gray-900">{unreadNotifications}</p>
              <p className="text-xs text-gray-500">unread</p>
            </div>
          </div>
          {unreadNotifications > 0 && (
            <div className="absolute top-4 right-4 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
              <span className="text-xs text-white font-bold">{unreadNotifications}</span>
            </div>
          )}
        </Link>
      </div>

      {recentVitals && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Vitals</h2>
            <Link to="/patient/medical-history" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View History →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentVitals.systolic && recentVitals.diastolic && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Blood Pressure</p>
                <p className="text-xl font-bold text-gray-900">
                  {recentVitals.systolic}/{recentVitals.diastolic}
                </p>
                <p className="text-xs text-gray-500">mmHg</p>
              </div>
            )}
            {recentVitals.pulseBpm && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Heart Rate</p>
                <p className="text-xl font-bold text-gray-900">{recentVitals.pulseBpm}</p>
                <p className="text-xs text-gray-500">bpm</p>
              </div>
            )}
            {recentVitals.tempC && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Temperature</p>
                <p className="text-xl font-bold text-gray-900">{recentVitals.tempC}°C</p>
                <p className="text-xs text-gray-500">celsius</p>
              </div>
            )}
            {recentVitals.spo2 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">O2 Saturation</p>
                <p className="text-xl font-bold text-gray-900">{recentVitals.spo2}%</p>
                <p className="text-xs text-gray-500">SpO2</p>
              </div>
            )}
          </div>
          {recentVitals.takenAt && (
            <p className="text-xs text-gray-500 mt-4">
              Last recorded: {formatNigerianDate(recentVitals.takenAt)}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Active Medications</h2>
            <Link to="/patient/medications" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View All →
            </Link>
          </div>
          {activeMedications.length > 0 ? (
            <div className="space-y-3">
              {activeMedications.slice(0, 3).map((med, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HeartIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{med.medicationName}</p>
                    <p className="text-sm text-gray-600">{med.dosage}</p>
                    <p className="text-xs text-gray-500">{med.directions}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No active medications</p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Lab Results</h2>
            <Link to="/patient/labs" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View All →
            </Link>
          </div>
          {recentLabResults.length > 0 ? (
            <div className="space-y-3">
              {recentLabResults.map((result, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <BeakerIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{result.testName}</p>
                      <p className="text-xs text-gray-500">
                        {formatNigerianDate(result.resultDate)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      result.interpretation === 'normal'
                        ? 'bg-green-100 text-green-800'
                        : result.interpretation === 'abnormal'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {result.interpretation}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No recent lab results</p>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-sm p-6 text-white">
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            to="/patient/appointments/request"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors"
          >
            <PlusIcon className="w-6 h-6" />
            <span className="font-medium">Request Appointment</span>
          </Link>
          <Link
            to="/patient/messages/compose"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors"
          >
            <EnvelopeIcon className="w-6 h-6" />
            <span className="font-medium">Message Care Team</span>
          </Link>
          <Link
            to="/patient/medical-history"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors"
          >
            <ClipboardDocumentListIcon className="w-6 h-6" />
            <span className="font-medium">View Medical History</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as logger from '@/lib/logger'
import { formatNigerianDate } from '@/utils/dateFormat'
import { UserGroupIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

interface Referral {
  id: string
  referring_provider: string
  specialist_name?: string
  specialty: string
  reason: string
  referral_date: string
  appointment_date?: string
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled'
  notes?: string
  priority: 'routine' | 'urgent' | 'emergency'
}

export function Referrals() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null)

  useEffect(() => {
    loadReferrals()
  }, [])

  const loadReferrals = async () => {
    setLoading(true)
    setError('')

    try {
      const portalUserStr = localStorage.getItem('patient_portal_user')
      if (!portalUserStr) {
        window.location.href = '/patient/login'
        return
      }

      const portalUser = JSON.parse(portalUserStr)

      const { data, error: referralsError } = await supabase
        .from('patient_referrals')
        .select('*')
        .eq('patient_id', portalUser.patientId)
        .order('referral_date', { ascending: false })

      if (referralsError) throw referralsError

      setReferrals(data || [])
    } catch (err) {
      logger.error('Error loading referrals:', err)
      setError('Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-600" />
      case 'cancelled':
        return <XCircleIcon className="h-5 w-5 text-red-600" />
      case 'scheduled':
        return <CheckCircleIcon className="h-5 w-5 text-blue-600" />
      default:
        return <ClockIcon className="h-5 w-5 text-yellow-600" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'emergency':
        return 'bg-red-100 text-red-800'
      case 'urgent':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-blue-100 text-blue-800'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading referrals...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Referrals</h1>
          <p className="mt-2 text-gray-600">View your specialist referrals and appointments</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {selectedReferral ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <button
              onClick={() => setSelectedReferral(null)}
              className="mb-4 text-blue-600 hover:text-blue-800"
            >
              ← Back to all referrals
            </button>

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{selectedReferral.specialty}</h2>
                {selectedReferral.specialist_name && (
                  <p className="text-gray-600 mt-1">Dr. {selectedReferral.specialist_name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Referring Provider</p>
                  <p className="font-medium">{selectedReferral.referring_provider}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Priority</p>
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded capitalize ${getPriorityColor(selectedReferral.priority)}`}>
                    {selectedReferral.priority}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Referral Date</p>
                  <p className="font-medium">{formatNigerianDate(selectedReferral.referral_date)}</p>
                </div>
                {selectedReferral.appointment_date && (
                  <div>
                    <p className="text-sm text-gray-600">Appointment Date</p>
                    <p className="font-medium">{formatNigerianDate(selectedReferral.appointment_date)}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusIcon(selectedReferral.status)}
                    <span className="capitalize">{selectedReferral.status}</span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-2">Reason for Referral</p>
                <p className="text-gray-900">{selectedReferral.reason}</p>
              </div>

              {selectedReferral.notes && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Additional Notes</p>
                  <p className="text-gray-900">{selectedReferral.notes}</p>
                </div>
              )}

              {selectedReferral.status === 'pending' && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    <strong>Action Required:</strong> Please contact the specialist's office to
                    schedule your appointment.
                  </p>
                </div>
              )}

              {selectedReferral.priority === 'emergency' && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>URGENT:</strong> This is an emergency referral. Please seek immediate
                    attention.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {referrals.length === 0 ? (
              <div className="p-12 text-center">
                <UserGroupIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No referrals</h3>
                <p className="text-gray-600">Your specialist referrals will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {referrals.map((referral) => (
                  <button
                    key={referral.id}
                    onClick={() => setSelectedReferral(referral)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900">{referral.specialty}</h3>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded capitalize ${getPriorityColor(referral.priority)}`}>
                            {referral.priority}
                          </span>
                        </div>
                        {referral.specialist_name && (
                          <p className="text-sm text-gray-600 mt-1">Dr. {referral.specialist_name}</p>
                        )}
                        <p className="text-sm text-gray-600 mt-1">
                          Referred by: {referral.referring_provider}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          {getStatusIcon(referral.status)}
                          <span className="text-sm text-gray-600 capitalize">{referral.status}</span>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {formatNigerianDate(referral.referral_date)}
                        </span>
                        {referral.appointment_date && (
                          <p className="text-xs text-blue-600 mt-1">
                            Appt: {formatNigerianDate(referral.appointment_date)}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Need help?</strong> Contact your healthcare provider if you have questions
            about a referral or need assistance scheduling an appointment.
          </p>
        </div>
      </div>
    </div>
  )
}

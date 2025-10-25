import { useEffect, useState } from 'react'
import { formatNigerianDate } from '@/utils/dateFormat'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeftIcon, CalendarIcon, HeartIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline'
import { getVisitDetails } from '@/services/patientPortalData'
import type { PatientMedicalRecord } from '@/types/patientPortal'
import * as logger from '@/lib/logger'

export function VisitDetail() {
  const { visitId } = useParams<{ visitId: string }>()
  const [visit, setVisit] = useState<PatientMedicalRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (visitId) {
      loadVisitDetails(visitId)
    }
  }, [visitId])

  const loadVisitDetails = async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}')
      if (!portalUser.patientId || !portalUser.id) {
        setError('Session expired. Please login again.')
        return
      }
      const visitData = await getVisitDetails(portalUser.id, portalUser.patientId, id)
      if (visitData) {
        setVisit(visitData)
      } else {
        setError('Visit not found')
      }
    } catch (err) {
      logger.error('Error loading visit details:', err)
      setError('An error occurred loading visit details')
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

  if (error || !visit) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">{error || 'Visit not found'}</p>
        </div>
        <Link to="/patient/medical-history" className="inline-flex items-center gap-2 mt-4 text-blue-600 hover:text-blue-700">
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Medical History
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link
        to="/patient/medical-history"
        className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to Medical History
      </Link>

      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center">
            <CalendarIcon className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {new Date(visit.visitDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </h1>
            {visit.chiefComplaint && (
              <p className="text-gray-600 mt-1">{visit.chiefComplaint}</p>
            )}
          </div>
        </div>
      </div>

      {visit.vitals && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <HeartIcon className="w-6 h-6 text-blue-600" />
            Vital Signs
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {visit.vitals.systolic && visit.vitals.diastolic && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Blood Pressure</p>
                <p className="text-2xl font-bold text-gray-900">
                  {visit.vitals.systolic}/{visit.vitals.diastolic}
                </p>
                <p className="text-xs text-gray-500">mmHg</p>
              </div>
            )}
            {visit.vitals.pulseBpm && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Heart Rate</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.pulseBpm}</p>
                <p className="text-xs text-gray-500">bpm</p>
              </div>
            )}
            {visit.vitals.tempC && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Temperature</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.tempC}°C</p>
                <p className="text-xs text-gray-500">celsius</p>
              </div>
            )}
            {visit.vitals.spo2 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">O2 Saturation</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.spo2}%</p>
                <p className="text-xs text-gray-500">SpO2</p>
              </div>
            )}
            {visit.vitals.heightCm && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Height</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.heightCm}</p>
                <p className="text-xs text-gray-500">cm</p>
              </div>
            )}
            {visit.vitals.weightKg && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Weight</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.weightKg}</p>
                <p className="text-xs text-gray-500">kg</p>
              </div>
            )}
            {visit.vitals.bmi && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">BMI</p>
                <p className="text-2xl font-bold text-gray-900">{visit.vitals.bmi.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kg/m²</p>
              </div>
            )}
          </div>
        </div>
      )}

      {visit.consultation && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <ClipboardDocumentListIcon className="w-6 h-6 text-blue-600" />
            Consultation Notes
          </h2>

          {visit.consultation.diagnoses.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Diagnosis</h3>
              <div className="flex flex-wrap gap-2">
                {visit.consultation.diagnoses.map((diagnosis, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium"
                  >
                    {diagnosis}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {visit.consultation.subjective && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Symptoms (Subjective)</h3>
                <p className="text-gray-900 bg-gray-50 rounded-lg p-4">{visit.consultation.subjective}</p>
              </div>
            )}
            {visit.consultation.objective && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Examination (Objective)</h3>
                <p className="text-gray-900 bg-gray-50 rounded-lg p-4">{visit.consultation.objective}</p>
              </div>
            )}
            {visit.consultation.assessment && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Assessment</h3>
                <p className="text-gray-900 bg-gray-50 rounded-lg p-4">{visit.consultation.assessment}</p>
              </div>
            )}
            {visit.consultation.plan && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Treatment Plan</h3>
                <p className="text-gray-900 bg-gray-50 rounded-lg p-4">{visit.consultation.plan}</p>
              </div>
            )}
          </div>

          {visit.consultation.providerName && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Provider:</span> {visit.consultation.providerName}
              </p>
            </div>
          )}
        </div>
      )}

      {visit.prescriptions && visit.prescriptions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Medications Prescribed</h2>
          <div className="space-y-3">
            {visit.prescriptions.map((rx, idx) => (
              <div key={idx} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <HeartIcon className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{rx.medicationName}</h3>
                  <p className="text-sm text-gray-600 mt-1">{rx.dosage}</p>
                  <p className="text-sm text-gray-600 mt-1">{rx.directions}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Dispensed: {formatNigerianDate(rx.dispensedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SoapForm } from '@/components/SoapForm'
import { db, Visit, Patient, Vital } from '@/db'
import { getFlagColor, getFlagLabel } from '@/utils/vitals'
import { ArrowLeftIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

export function Consult() {
  const { visitId } = useParams<{ visitId: string }>()
  const navigate = useNavigate()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [vitals, setVitals] = useState<Vital[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (visitId) {
      loadVisitData(visitId)
    }
  }, [visitId])

  const loadVisitData = async (id: string) => {
    try {
      const visitData = await db.visits.get(id)
      if (visitData) {
        setVisit(visitData)
        const [patientData, vitalsData] = await Promise.all([
          db.patients.get(visitData.patientId),
          db.vitals.where('visitId').equals(id).toArray()
        ])
        setPatient(patientData || null)
        setVitals(vitalsData)
      }
    } catch (error) {
      console.error('Error loading visit data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSuccess = () => {
    // Navigate to pharmacy or back to queue
    if (visitId) {
      navigate(`/pharmacy/${visitId}`)
    } else {
      navigate('/queue')
    }
  }

  const handleCancel = () => {
    navigate('/queue')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading consultation...</p>
        </div>
      </div>
    )
  }

  if (!visit || !patient) {
    return (
      <div className="text-center py-12">
        <DocumentTextIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Visit not found</h3>
        <p className="text-gray-600 mb-6">The visit you're looking for doesn't exist.</p>
        <button onClick={() => navigate('/queue')} className="btn-primary">
          Back to Queue
        </button>
      </div>
    )
  }

  const latestVitals = vitals[vitals.length - 1]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/queue')}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        >
          <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consultation</h1>
          <p className="text-gray-600">
            Patient: {patient.givenName} {patient.familyName}
          </p>
        </div>
      </div>

      {/* Patient Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patient Info */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Patient Information</h3>
          <div className="flex items-center space-x-4 mb-4">
            {patient.photoUrl ? (
              <img
                src={patient.photoUrl}
                alt={`${patient.givenName} ${patient.familyName}`}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-xl font-medium text-gray-600">
                  {patient.givenName[0]}{patient.familyName[0]}
                </span>
              </div>
            )}
            <div>
              <h4 className="text-lg font-medium text-gray-900">
                {patient.givenName} {patient.familyName}
              </h4>
              <p className="text-sm text-gray-600">
                Age: {getPatientAge(patient.dob)} • {patient.sex} • {patient.phone}
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-600">
            <p><strong>Address:</strong> {patient.address}</p>
            <p><strong>State/LGA:</strong> {patient.state}, {patient.lga}</p>
          </div>
        </div>

        {/* Latest Vitals */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Vitals</h3>
          {latestVitals ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {latestVitals.heightCm && (
                  <div>
                    <span className="text-gray-600">Height:</span>
                    <span className="ml-2 font-medium">{latestVitals.heightCm} cm</span>
                  </div>
                )}
                {latestVitals.weightKg && (
                  <div>
                    <span className="text-gray-600">Weight:</span>
                    <span className="ml-2 font-medium">{latestVitals.weightKg} kg</span>
                  </div>
                )}
                {latestVitals.bmi && (
                  <div>
                    <span className="text-gray-600">BMI:</span>
                    <span className="ml-2 font-medium">{latestVitals.bmi}</span>
                  </div>
                )}
                {latestVitals.tempC && (
                  <div>
                    <span className="text-gray-600">Temperature:</span>
                    <span className="ml-2 font-medium">{latestVitals.tempC}°C</span>
                  </div>
                )}
                {latestVitals.pulseBpm && (
                  <div>
                    <span className="text-gray-600">Pulse:</span>
                    <span className="ml-2 font-medium">{latestVitals.pulseBpm} bpm</span>
                  </div>
                )}
                {latestVitals.systolic && latestVitals.diastolic && (
                  <div>
                    <span className="text-gray-600">Blood Pressure:</span>
                    <span className="ml-2 font-medium">{latestVitals.systolic}/{latestVitals.diastolic}</span>
                  </div>
                )}
                {latestVitals.spo2 && (
                  <div>
                    <span className="text-gray-600">SpO2:</span>
                    <span className="ml-2 font-medium">{latestVitals.spo2}%</span>
                  </div>
                )}
              </div>
              
              {latestVitals.flags.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Alerts:</p>
                  <div className="flex flex-wrap gap-2">
                    {latestVitals.flags.map((flag) => (
                      <span
                        key={flag}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getFlagColor(flag)}`}
                      >
                        {getFlagLabel(flag)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No vitals recorded for this visit</p>
          )}
        </div>
      </div>

      {/* SOAP Form */}
      <SoapForm
        patientId={patient.id}
        visitId={visit.id}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}
import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DispenseForm } from '@/components/DispenseForm'
import { db, Visit, Patient, Consultation } from '@/db'
import { ArrowLeftIcon, BeakerIcon } from '@heroicons/react/24/outline'

export function Pharmacy() {
  const { visitId } = useParams<{ visitId: string }>()
  const navigate = useNavigate()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [consultation, setConsultation] = useState<Consultation | null>(null)
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
        const [patientData, consultationData] = await Promise.all([
          db.patients.get(visitData.patientId),
          db.consultations.where('visitId').equals(id).first()
        ])
        setPatient(patientData || null)
        setConsultation(consultationData || null)
      }
    } catch (error) {
      console.error('Error loading visit data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSuccess = () => {
    // Complete the visit and return to queue
    navigate('/queue', {
      state: {
        message: 'Medication dispensed successfully!'
      }
    })
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
          <p className="mt-4 text-gray-600">Loading pharmacy...</p>
        </div>
      </div>
    )
  }

  if (!visit || !patient) {
    return (
      <div className="text-center py-12">
        <BeakerIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Visit not found</h3>
        <p className="text-gray-600 mb-6">The visit you're looking for doesn't exist.</p>
        <button onClick={() => navigate('/queue')} className="btn-primary">
          Back to Queue
        </button>
      </div>
    )
  }

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
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy</h1>
          <p className="text-gray-600">
            Patient: {patient.givenName} {patient.familyName}
          </p>
        </div>
      </div>

      {/* Patient & Consultation Summary */}
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
        </div>

        {/* Consultation Summary */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Consultation Summary</h3>
          {consultation ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Provider:</p>
                <p className="text-sm text-gray-600">{consultation.providerName}</p>
              </div>
              
              {consultation.provisionalDx.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700">Diagnoses:</p>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {consultation.provisionalDx.map((dx, index) => (
                      <li key={index}>{dx}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div>
                <p className="text-sm font-medium text-gray-700">Treatment Plan:</p>
                <p className="text-sm text-gray-600 line-clamp-3">
                  {consultation.soapPlan}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No consultation notes available</p>
          )}
        </div>
      </div>

      {/* Dispense Form */}
      <DispenseForm
        patientId={patient.id}
        visitId={visit.id}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}
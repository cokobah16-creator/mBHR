import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PatientSearch } from '@/components/PatientSearch'
import { VitalsForm } from '@/components/VitalsForm'
import { db, Visit, Patient, generateId } from '@/db'
import { ArrowLeftIcon, HeartIcon } from '@heroicons/react/24/outline'

export function Vitals() {
  const { visitId } = useParams<{ visitId: string }>()
  const navigate = useNavigate()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (visitId) {
      loadVisitData(visitId)
    } else {
      setLoading(false)
    }
  }, [visitId])

  const loadVisitData = async (id: string) => {
    try {
      const visitData = await db.visits.get(id)
      if (visitData) {
        setVisit(visitData)
        const patientData = await db.patients.get(visitData.patientId)
        setPatient(patientData || null)
      }
    } catch (error) {
      console.error('Error loading visit data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePatientSelect = async (selectedPatient: Patient) => {
    try {
      // Create a new visit for this patient
      const newVisit: Visit = {
        id: generateId(),
        patientId: selectedPatient.id,
        startedAt: new Date(),
        siteName: 'Mobile Clinic',
        status: 'open'
      }
      
      await db.visits.add(newVisit)
      
      setPatient(selectedPatient)
      setVisit(newVisit)
      setSelectedPatient(selectedPatient)
    } catch (error) {
      console.error('Error creating visit:', error)
    }
  }

  const handleSuccess = () => {
    // Navigate to consultation or back to queue
    if (visit) {
      navigate(`/consult/${visit.id}`)
    } else {
      navigate('/queue')
    }
  }

  const handleCancel = () => {
    navigate('/queue')
  }

  // If no visitId provided, show patient search
  if (!visitId && !selectedPatient) {
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
            <h1 className="text-2xl font-bold text-gray-900">Record Vital Signs</h1>
            <p className="text-gray-600">Search for a patient to record vitals</p>
          </div>
        </div>

        {/* Patient Search */}
        <div className="card max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Patient</h2>
          <PatientSearch
            onPatientSelect={handlePatientSelect}
            placeholder="Search patients by name or phone..."
            className="w-full"
          />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading visit...</p>
        </div>
      </div>
    )
  }

  if (!visit || !patient) {
    return (
      <div className="text-center py-12">
        <HeartIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
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
          <h1 className="text-2xl font-bold text-gray-900">Record Vital Signs</h1>
          <p className="text-gray-600">
            Patient: {patient.givenName} {patient.familyName}
          </p>
        </div>
      </div>

      {/* Patient Info */}
      <div className="card">
        <div className="flex items-center space-x-4">
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
            <h3 className="text-lg font-medium text-gray-900">
              {patient.givenName} {patient.familyName}
            </h3>
            <p className="text-sm text-gray-600">
              Visit ID: {visit.id.slice(-8).toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      {/* Vitals Form */}
      <VitalsForm
        patientId={patient.id}
        visitId={visit!.id}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}
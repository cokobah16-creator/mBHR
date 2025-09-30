import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { db, Patient, Visit, Vital, Consultation, Dispense } from '@/db'
import { getFlagColor, getFlagLabel } from '@/utils/vitals'
import { 
  ArrowLeftIcon,
  UserIcon,
  PhoneIcon,
  MapPinIcon,
  CalendarIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  PlayIcon
} from '@heroicons/react/24/outline'

export function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  
  const [patient, setPatient] = useState<Patient | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [dispenses, setDispenses] = useState<Dispense[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      loadPatientData(id)
    }
  }, [id])

  const loadPatientData = async (patientId: string) => {
    try {
      const [patientData, visitsData, vitalsData, consultationsData, dispensesData] = await Promise.all([
        db.patients.get(patientId),
        db.visits.where('patientId').equals(patientId).reverse().toArray(),
        db.vitals.where('patientId').equals(patientId).reverse().toArray(),
        db.consultations.where('patientId').equals(patientId).reverse().toArray(),
        db.dispenses.where('patientId').equals(patientId).reverse().toArray()
      ])

      setPatient(patientData || null)
      setVisits(visitsData)
      setVitals(vitalsData)
      setConsultations(consultationsData)
      setDispenses(dispensesData)
    } catch (error) {
      console.error('Error loading patient data:', error)
    } finally {
      setLoading(false)
    }
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

  const startNewVisit = async () => {
    if (!patient) return
    
    try {
      const visit = {
        id: crypto.randomUUID(),
        patientId: patient.id,
        startedAt: new Date(),
        siteName: 'Mobile Clinic',
        status: 'open' as const
      }
      
      await db.visits.add(visit)
      navigate(`/vitals/${visit.id}`)
    } catch (error) {
      console.error('Error starting visit:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading patient...</p>
        </div>
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="text-center py-12">
        <UserIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Patient not found</h3>
        <p className="text-gray-600 mb-6">The patient you're looking for doesn't exist.</p>
        <Link to="/patients" className="btn-primary">
          Back to Patients
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/patients')}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        >
          <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Patient Details</h1>
          <p className="text-gray-600">View patient information and medical history</p>
        </div>
        <button
          onClick={startNewVisit}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <PlayIcon className="h-5 w-5" />
          <span>Start Visit</span>
        </button>
      </div>

      {/* Patient Info Card */}
      <div className="card">
        <div className="flex items-start space-x-6">
          {/* Photo */}
          <div className="flex-shrink-0">
            {patient.photoUrl ? (
              <img
                src={patient.photoUrl}
                alt={`${patient.givenName} ${patient.familyName}`}
                className="w-24 h-24 rounded-full object-cover"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-2xl font-medium text-gray-600">
                  {patient.givenName[0]}{patient.familyName[0]}
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                {patient.givenName} {patient.familyName}
              </h2>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                {patient.sex}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center space-x-2 text-gray-600">
                <CalendarIcon className="h-4 w-4" />
                <span>Age: {getPatientAge(patient.dob)} ({new Date(patient.dob).toLocaleDateString()})</span>
              </div>
              
              <div className="flex items-center space-x-2 text-gray-600">
                <PhoneIcon className="h-4 w-4" />
                <span>{patient.phone}</span>
              </div>
              
              <div className="flex items-center space-x-2 text-gray-600">
                <MapPinIcon className="h-4 w-4" />
                <span>{patient.state}, {patient.lga}</span>
              </div>
              
              <div className="text-gray-600">
                <strong>ID:</strong> {patient.id.slice(-8).toUpperCase()}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm text-gray-600">
                <strong>Address:</strong> {patient.address}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Medical History Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Vitals */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <HeartIcon className="h-5 w-5 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">Recent Vitals</h3>
          </div>
          
          {vitals.length === 0 ? (
            <p className="text-gray-500 text-sm">No vitals recorded</p>
          ) : (
            <div className="space-y-3">
              {vitals.slice(0, 3).map((vital) => (
                <div key={vital.id} className="border-l-4 border-green-500 pl-3">
                  <div className="text-sm text-gray-600">
                    {vital.takenAt.toLocaleDateString()}
                  </div>
                  <div className="text-sm">
                    {vital.systolic && vital.diastolic && (
                      <span>BP: {vital.systolic}/{vital.diastolic} </span>
                    )}
                    {vital.pulseBpm && <span>HR: {vital.pulseBpm} </span>}
                    {vital.bmi && <span>BMI: {vital.bmi}</span>}
                  </div>
                  {vital.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {vital.flags.map((flag) => (
                        <span
                          key={flag}
                          className={`px-1 py-0.5 rounded text-xs ${getFlagColor(flag)}`}
                        >
                          {getFlagLabel(flag)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Consultations */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <DocumentTextIcon className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">Consultations</h3>
          </div>
          
          {consultations.length === 0 ? (
            <p className="text-gray-500 text-sm">No consultations recorded</p>
          ) : (
            <div className="space-y-3">
              {consultations.slice(0, 3).map((consultation) => (
                <div key={consultation.id} className="border-l-4 border-purple-500 pl-3">
                  <div className="text-sm text-gray-600">
                    {consultation.createdAt.toLocaleDateString()}
                  </div>
                  <div className="text-sm font-medium">
                    {consultation.providerName}
                  </div>
                  {consultation.provisionalDx.length > 0 && (
                    <div className="text-sm text-gray-700">
                      {consultation.provisionalDx.slice(0, 2).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Dispenses */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <BeakerIcon className="h-5 w-5 text-orange-600" />
            <h3 className="text-lg font-semibold text-gray-900">Medications</h3>
          </div>
          
          {dispenses.length === 0 ? (
            <p className="text-gray-500 text-sm">No medications dispensed</p>
          ) : (
            <div className="space-y-3">
              {dispenses.slice(0, 3).map((dispense) => (
                <div key={dispense.id} className="border-l-4 border-orange-500 pl-3">
                  <div className="text-sm text-gray-600">
                    {dispense.dispensedAt.toLocaleDateString()}
                  </div>
                  <div className="text-sm font-medium">
                    {dispense.itemName}
                  </div>
                  <div className="text-sm text-gray-700">
                    {dispense.dosage} × {dispense.qty}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Visit History */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Visit History</h3>
        
        {visits.length === 0 ? (
          <p className="text-gray-500">No visits recorded</p>
        ) : (
          <div className="space-y-4">
            {visits.map((visit) => (
              <div key={visit.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium">
                      {visit.startedAt.toLocaleDateString()} - {visit.siteName}
                    </span>
                    <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                      visit.status === 'open' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {visit.status}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">
                    ID: {visit.id.slice(-8).toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
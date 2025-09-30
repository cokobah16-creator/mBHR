import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePatientsStore } from '@/stores/patients'
import { Patient } from '@/db'
import { 
  MagnifyingGlassIcon, 
  UserPlusIcon, 
  UserIcon,
  PhoneIcon,
  MapPinIcon
} from '@heroicons/react/24/outline'

export function Patients() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { patients, loadPatients, searchPatients, searchQuery, setSearchQuery } = usePatientsStore()
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    console.log('Patients page: Loading patients...')
    loadPatients()
      .then(() => {
        console.log('Patients page: Patients loaded successfully')
        setLoading(false)
      })
      .catch((error) => {
        console.error('Patients page: Error loading patients:', error)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (searchQuery.trim()) {
      searchPatients(searchQuery).then(setFilteredPatients)
    } else {
      setFilteredPatients(patients)
    }
  }, [searchQuery, patients])

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
          <p className="mt-4 text-gray-600">Loading patients...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('nav.patients')}
          </h1>
          <p className="text-gray-600">
            Manage patient records and information
          </p>
        </div>
        
        <Link
          to="/register"
          className="btn-primary inline-flex items-center space-x-2"
        >
          <UserPlusIcon className="h-5 w-5" />
          <span>{t('patient.register')}</span>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field pl-10"
          placeholder={`${t('common.search')} patients by name or phone...`}
        />
      </div>

      {/* Patient List */}
      <div className="space-y-4">
        {filteredPatients.length === 0 ? (
          <div className="text-center py-12">
            <UserIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? 'No patients found' : 'No patients registered'}
            </h3>
            <p className="text-gray-600 mb-6">
              {searchQuery 
                ? 'Try adjusting your search terms'
                : 'Get started by registering your first patient'
              }
            </p>
            {!searchQuery && (
              <Link to="/register" className="btn-primary">
                {t('patient.register')}
              </Link>
            )}
          </div>
        ) : (
          filteredPatients.map((patient) => (
            <div
              key={patient.id}
              className="card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/patients/${patient.id}`)}
            >
              <div className="flex items-center space-x-4">
                {/* Patient Photo */}
                <div className="flex-shrink-0">
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
                </div>

                {/* Patient Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="text-lg font-medium text-gray-900 truncate">
                      {patient.givenName} {patient.familyName}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {patient.sex}
                    </span>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-6 space-y-1 sm:space-y-0 text-sm text-gray-600">
                    <div className="flex items-center space-x-1">
                      <span>Age: {getPatientAge(patient.dob)}</span>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      <PhoneIcon className="h-4 w-4" />
                      <span>{patient.phone}</span>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      <MapPinIcon className="h-4 w-4" />
                      <span>{patient.state}, {patient.lga}</span>
                    </div>
                  </div>
                </div>

                {/* Patient ID */}
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-gray-500">ID</p>
                  <p className="text-sm font-mono text-gray-700">
                    {patient.id.slice(-8).toUpperCase()}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
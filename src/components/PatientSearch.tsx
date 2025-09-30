import React, { useState, useEffect } from 'react'
import { usePatientsStore } from '@/stores/patients'
import { Patient } from '@/db'
import { MagnifyingGlassIcon, UserIcon } from '@heroicons/react/24/outline'

interface PatientSearchProps {
  onPatientSelect: (patient: Patient) => void
  placeholder?: string
  className?: string
}

export function PatientSearch({ onPatientSelect, placeholder = "Search patients...", className = "" }: PatientSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[]>([])
  const [showResults, setShowResults] = useState(false)
  const { searchPatients } = usePatientsStore()

  useEffect(() => {
    const searchDebounced = setTimeout(async () => {
      if (query.trim()) {
        const patients = await searchPatients(query)
        setResults(patients.slice(0, 5)) // Limit to 5 results
        setShowResults(true)
      } else {
        setResults([])
        setShowResults(false)
      }
    }, 300)

    return () => clearTimeout(searchDebounced)
  }, [query, searchPatients])

  const handleSelect = (patient: Patient) => {
    onPatientSelect(patient)
    setQuery(`${patient.givenName} ${patient.familyName}`)
    setShowResults(false)
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

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setShowResults(true)}
          className="input-field pl-10"
          placeholder={placeholder}
        />
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((patient) => (
            <button
              key={patient.id}
              onClick={() => handleSelect(patient)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 focus:bg-gray-50 focus:outline-none"
            >
              <div className="flex items-center space-x-3">
                {patient.photoUrl ? (
                  <img
                    src={patient.photoUrl}
                    alt={`${patient.givenName} ${patient.familyName}`}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-gray-500" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {patient.givenName} {patient.familyName}
                  </p>
                  <p className="text-xs text-gray-500">
                    Age {getPatientAge(patient.dob)} • {patient.phone} • {patient.state}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && results.length === 0 && query.trim() && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500">
          No patients found
        </div>
      )}
    </div>
  )
}
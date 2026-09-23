import React, { useState, useEffect, useId, useRef } from 'react'
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
  const [searchFailed, setSearchFailed] = useState(false)
  const [hasOuterLabel, setHasOuterLabel] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const { searchPatients } = usePatientsStore()

  // Some callers wrap this in a <label>; only name the input ourselves
  // when nothing else does.
  useEffect(() => {
    setHasOuterLabel(Boolean(inputRef.current?.closest('label')))
  }, [])

  useEffect(() => {
    const searchDebounced = setTimeout(async () => {
      if (query.trim()) {
        try {
          const patients = await searchPatients(query)
          setResults(patients.slice(0, 5)) // Limit to 5 results
          setSearchFailed(false)
        } catch (error) {
          console.error('Patient search failed:', error instanceof Error ? error.name : error)
          setResults([])
          setSearchFailed(true)
        }
        setShowResults(true)
      } else {
        setResults([])
        setShowResults(false)
        setSearchFailed(false)
      }
    }, 300)

    return () => clearTimeout(searchDebounced)
  }, [query, searchPatients])

  const handleSelect = (patient: Patient) => {
    onPatientSelect(patient)
    setQuery(`${patient.givenName} ${patient.familyName}`)
    setShowResults(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setShowResults(false)
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

  const open = showResults && query.trim().length > 0

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-ink-muted" aria-hidden />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setShowResults(true)}
          onKeyDown={handleKeyDown}
          className="input-field pl-10"
          placeholder={placeholder}
          aria-label={hasOuterLabel ? undefined : placeholder}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {open
          ? searchFailed
            ? 'Search failed'
            : `${results.length} patient${results.length === 1 ? '' : 's'} found`
          : ''}
      </p>

      {open && results.length > 0 && (
        <ul
          id={listId}
          aria-label="Matching patients"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {results.map((patient) => (
            <li key={patient.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => handleSelect(patient)}
                className="w-full min-h-touch-target px-4 py-3 text-left hover:bg-surface-hover focus:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="flex items-center gap-3">
                  {patient.photoUrl ? (
                    <img
                      src={patient.photoUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-sunken" aria-hidden>
                      <UserIcon className="h-5 w-5 text-ink-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">
                      {patient.givenName} {patient.familyName}
                    </p>
                    <p className="truncate text-caption text-ink-muted">
                      {[
                        `Age ${getPatientAge(patient.dob)}`,
                        patient.phone,
                        patient.state,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && results.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface p-4 text-center text-body text-ink-muted shadow-lg">
          {searchFailed
            ? 'Search could not run on this device. Try again.'
            : 'No patients found on this device'}
        </div>
      )}
    </div>
  )
}

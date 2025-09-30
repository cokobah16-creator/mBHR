import React, { useState } from 'react'
import { Patient } from '@/db'
import { mergePatients } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { 
  ExclamationTriangleIcon,
  UserIcon,
  PhoneIcon,
  CalendarIcon,
  MapPinIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

interface PatientDedupeModalProps {
  newPatient: Patient
  candidates: Patient[]
  onResolve: (action: 'merge' | 'create_new', winnerId?: string) => void
  onCancel: () => void
}

export function PatientDedupeModal({ 
  newPatient, 
  candidates, 
  onResolve, 
  onCancel 
}: PatientDedupeModalProps) {
  const { currentUser } = useAuthStore()
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleMerge = async () => {
    if (!selectedWinner || !currentUser) return
    
    setLoading(true)
    try {
      await mergePatients(selectedWinner, newPatient.id, currentUser.id)
      onResolve('merge', selectedWinner)
    } catch (error) {
      console.error('Error merging patients:', error)
      alert('Failed to merge patients')
    } finally {
      setLoading(false)
    }
  }

  const getMatchScore = (candidate: Patient): number => {
    let score = 0
    
    // Phone match (highest weight)
    if (candidate.phone && newPatient.phone && 
        candidate.phone.replace(/\D/g, '') === newPatient.phone.replace(/\D/g, '')) {
      score += 50
    }
    
    // Name similarity
    if (candidate.givenName.toLowerCase() === newPatient.givenName.toLowerCase()) score += 20
    if (candidate.familyName.toLowerCase() === newPatient.familyName.toLowerCase()) score += 20
    
    // DOB match
    if (candidate.dob === newPatient.dob) score += 30
    
    // Sex match
    if (candidate.sex === newPatient.sex) score += 10
    
    return score
  }

  const getMatchLabel = (score: number): { label: string; color: string } => {
    if (score >= 70) return { label: 'High Match', color: 'bg-red-100 text-red-800' }
    if (score >= 40) return { label: 'Possible Match', color: 'bg-yellow-100 text-yellow-800' }
    return { label: 'Low Match', color: 'bg-gray-100 text-gray-800' }
  }

  const formatField = (value: any): string => {
    if (!value) return '—'
    if (value instanceof Date) return value.toLocaleDateString()
    return String(value)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <ExclamationTriangleIcon className="h-8 w-8 text-yellow-600" />
              <div>
                <h2 className="text-xl font-bold text-gray-900">Potential Duplicate Patient</h2>
                <p className="text-gray-600">We found similar patients. Please review and choose an action.</p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <XMarkIcon className="h-6 w-6 text-gray-600" />
            </button>
          </div>

          {/* New Patient Info */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">New Patient Being Registered</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-blue-800">Name:</span>
                  <div className="text-blue-700">{newPatient.givenName} {newPatient.familyName}</div>
                </div>
                <div>
                  <span className="font-medium text-blue-800">Phone:</span>
                  <div className="text-blue-700">{formatField(newPatient.phone)}</div>
                </div>
                <div>
                  <span className="font-medium text-blue-800">DOB:</span>
                  <div className="text-blue-700">{formatField(newPatient.dob)}</div>
                </div>
                <div>
                  <span className="font-medium text-blue-800">Sex:</span>
                  <div className="text-blue-700">{formatField(newPatient.sex)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Candidate Matches */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Existing Patients ({candidates.length} found)
            </h3>
            <div className="space-y-3">
              {candidates.map((candidate) => {
                const matchScore = getMatchScore(candidate)
                const matchInfo = getMatchLabel(matchScore)
                const isSelected = selectedWinner === candidate.id
                
                return (
                  <div
                    key={candidate.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      isSelected 
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedWinner(candidate.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <UserIcon className="h-5 w-5 text-gray-500" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">
                            {candidate.givenName} {candidate.familyName}
                          </h4>
                          <p className="text-sm text-gray-600">
                            ID: {candidate.id.slice(-8).toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${matchInfo.color}`}>
                        {matchInfo.label} ({matchScore}%)
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center space-x-2">
                        <PhoneIcon className="h-4 w-4 text-gray-400" />
                        <span className={candidate.phone === newPatient.phone ? 'font-medium text-green-700' : 'text-gray-600'}>
                          {formatField(candidate.phone)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CalendarIcon className="h-4 w-4 text-gray-400" />
                        <span className={candidate.dob === newPatient.dob ? 'font-medium text-green-700' : 'text-gray-600'}>
                          {formatField(candidate.dob)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-400">Sex:</span>
                        <span className={candidate.sex === newPatient.sex ? 'font-medium text-green-700' : 'text-gray-600'}>
                          {formatField(candidate.sex)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <MapPinIcon className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600">{candidate.state}</span>
                      </div>
                    </div>
                    
                    <div className="mt-2 text-xs text-gray-500">
                      Registered: {candidate.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4">
            <button
              onClick={() => onResolve('create_new')}
              className="btn-secondary flex-1"
            >
              Create New Patient
            </button>
            <button
              onClick={handleMerge}
              disabled={!selectedWinner || loading}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Merging...' : 'Use Selected Patient'}
            </button>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500">
              Selecting an existing patient will link this registration to their record.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
import { useEffect, useState } from 'react'
import { getActiveAllergies, checkMedicationAllergy } from '../services/allergies'
import type { PatientAllergy } from '../db'
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'

interface AllergyWarningProps {
  patientId: string
  medicationName?: string
}

export function AllergyWarning({ patientId, medicationName }: AllergyWarningProps) {
  const [allergies, setAllergies] = useState<PatientAllergy[]>([])
  const [medicationConflict, setMedicationConflict] = useState<PatientAllergy | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAllergies()
  }, [patientId, medicationName])

  const loadAllergies = async () => {
    setLoading(true)
    const activeAllergies = await getActiveAllergies(patientId)
    setAllergies(activeAllergies)

    if (medicationName) {
      const conflict = await checkMedicationAllergy(patientId, medicationName)
      setMedicationConflict(conflict)
    }

    setLoading(false)
  }

  if (loading) return null

  const severityLevel = medicationConflict?.severity || (allergies.length > 0 ? 'mild' : null)

  if (!severityLevel && allergies.length === 0) return null

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'life-threatening':
        return 'bg-red-100 border-red-500 text-red-900'
      case 'severe':
        return 'bg-orange-100 border-orange-500 text-orange-900'
      case 'moderate':
        return 'bg-yellow-100 border-yellow-500 text-yellow-900'
      case 'mild':
        return 'bg-blue-100 border-blue-500 text-blue-900'
      default:
        return 'bg-gray-100 border-gray-500 text-gray-900'
    }
  }

  return (
    <div className="space-y-2">
      {medicationConflict && (
        <div
          className={`border-l-4 p-4 rounded ${getSeverityStyles(medicationConflict.severity)} animate-pulse`}
          role="alert"
        >
          <div className="flex items-start">
            <ExclamationTriangleIcon className="h-6 w-6 mr-3 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-bold text-lg mb-1">
                MEDICATION ALLERGY ALERT!
              </h4>
              <p className="font-medium mb-2">
                Patient is allergic to: <span className="font-bold">{medicationConflict.allergen}</span>
              </p>
              <p className="text-sm">
                Severity: <span className="font-bold uppercase">{medicationConflict.severity}</span>
              </p>
              {medicationConflict.reaction && (
                <p className="text-sm mt-1">
                  Reaction: {medicationConflict.reaction}
                </p>
              )}
              {medicationConflict.notes && (
                <p className="text-sm mt-1 italic">
                  Note: {medicationConflict.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!medicationConflict && allergies.length > 0 && (
        <div className={`border-l-4 p-3 rounded ${getSeverityStyles('mild')}`}>
          <div className="flex items-start">
            <ExclamationTriangleIcon className="h-5 w-5 mr-2 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-semibold mb-1">Patient has {allergies.length} known allerg{allergies.length === 1 ? 'y' : 'ies'}:</h4>
              <ul className="list-disc list-inside space-y-1">
                {allergies.map(allergy => (
                  <li key={allergy.id} className="text-sm">
                    <span className="font-medium">{allergy.allergen}</span>
                    {' '}({allergy.allergyType}, {allergy.severity})
                    {allergy.reaction && ` - ${allergy.reaction}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface AllergyBadgeProps {
  patientId: string
  compact?: boolean
}

export function AllergyBadge({ patientId, compact = false }: AllergyBadgeProps) {
  const [count, setCount] = useState(0)
  const [hasSevere, setHasSevere] = useState(false)

  useEffect(() => {
    loadAllergyCount()
  }, [patientId])

  const loadAllergyCount = async () => {
    const allergies = await getActiveAllergies(patientId)
    setCount(allergies.length)

    const severe = allergies.some(a =>
      a.severity === 'severe' || a.severity === 'life-threatening'
    )
    setHasSevere(severe)
  }

  if (count === 0) return null

  const colorClass = hasSevere
    ? 'bg-red-100 text-red-800 border-red-300'
    : 'bg-yellow-100 text-yellow-800 border-yellow-300'

  if (compact) {
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
        <ExclamationTriangleIcon className="h-3 w-3 mr-1" />
        {count}
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border-2 ${colorClass}`}>
      <ExclamationTriangleIcon className="h-4 w-4 mr-2" />
      <span className="text-sm font-semibold">
        {count} Allerg{count === 1 ? 'y' : 'ies'}
      </span>
    </div>
  )
}

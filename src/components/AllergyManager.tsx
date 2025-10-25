import { useState, useEffect } from 'react'
import { formatNigerianDate } from '@/utils/dateFormat'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  createAllergy,
  updateAllergy,
  deactivateAllergy,
  reactivateAllergy,
  getPatientAllergies,
  type CreateAllergyInput,
  type UpdateAllergyInput
} from '../services/allergies'
import type { PatientAllergy } from '../db'
import { ExclamationTriangleIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline'

const allergySchema = z.object({
  allergen: z.string().min(1, 'Allergen name is required'),
  allergyType: z.enum(['medication', 'food', 'environmental', 'other']),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']),
  onsetDate: z.string().optional(),
  notes: z.string().optional()
})

type AllergyFormData = z.infer<typeof allergySchema>

interface AllergyManagerProps {
  patientId: string
  userId: string
  showInactive?: boolean
}

export function AllergyManager({ patientId, userId, showInactive = false }: AllergyManagerProps) {
  const [allergies, setAllergies] = useState<PatientAllergy[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AllergyFormData>({
    resolver: zodResolver(allergySchema)
  })

  useEffect(() => {
    loadAllergies()
  }, [patientId, showInactive])

  const loadAllergies = async () => {
    setLoading(true)
    const data = await getPatientAllergies(patientId, !showInactive)
    setAllergies(data)
    setLoading(false)
  }

  const onSubmit = async (data: AllergyFormData) => {
    if (editingId) {
      const updates: UpdateAllergyInput = {
        allergen: data.allergen,
        allergyType: data.allergyType,
        reaction: data.reaction,
        severity: data.severity,
        onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
        notes: data.notes
      }
      await updateAllergy(editingId, updates)
      setEditingId(null)
    } else {
      const input: CreateAllergyInput = {
        patientId,
        allergen: data.allergen,
        allergyType: data.allergyType,
        reaction: data.reaction,
        severity: data.severity,
        onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
        notes: data.notes,
        createdBy: userId
      }
      await createAllergy(input)
      setIsAdding(false)
    }
    reset()
    loadAllergies()
  }

  const handleDeactivate = async (allergyId: string) => {
    if (confirm('Deactivate this allergy?')) {
      await deactivateAllergy(allergyId)
      loadAllergies()
    }
  }

  const handleReactivate = async (allergyId: string) => {
    await reactivateAllergy(allergyId)
    loadAllergies()
  }

  const handleEdit = (allergy: PatientAllergy) => {
    setEditingId(allergy.id)
    setIsAdding(true)
    reset({
      allergen: allergy.allergen,
      allergyType: allergy.allergyType,
      reaction: allergy.reaction || undefined,
      severity: allergy.severity,
      onsetDate: allergy.onsetDate ? new Date(allergy.onsetDate).toISOString().split('T')[0] : undefined,
      notes: allergy.notes || undefined
    })
  }

  const handleCancel = () => {
    setIsAdding(false)
    setEditingId(null)
    reset()
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'life-threatening': return 'bg-red-100 text-red-800 border-red-300'
      case 'severe': return 'bg-orange-100 text-orange-800 border-orange-300'
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'mild': return 'bg-blue-100 text-blue-800 border-blue-300'
      default: return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  if (loading) {
    return <div className="text-center py-4">Loading allergies...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
          Allergies
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Add Allergy
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 p-4 rounded-lg border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Allergen *</label>
              <input
                {...register('allergen')}
                className="w-full px-3 py-2 border rounded"
                placeholder="e.g., Penicillin"
              />
              {errors.allergen && <p className="text-red-600 text-sm mt-1">{errors.allergen.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select {...register('allergyType')} className="w-full px-3 py-2 border rounded">
                <option value="medication">Medication</option>
                <option value="food">Food</option>
                <option value="environmental">Environmental</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Severity *</label>
              <select {...register('severity')} className="w-full px-3 py-2 border rounded">
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
                <option value="life-threatening">Life-Threatening</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Onset Date</label>
              <input
                type="date"
                {...register('onsetDate')}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reaction</label>
            <input
              {...register('reaction')}
              className="w-full px-3 py-2 border rounded"
              placeholder="Describe the reaction"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              {...register('notes')}
              rows={2}
              className="w-full px-3 py-2 border rounded"
              placeholder="Additional information"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {editingId ? 'Update' : 'Add'} Allergy
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {allergies.length === 0 ? (
        <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
          No allergies recorded
        </div>
      ) : (
        <div className="space-y-2">
          {allergies.map(allergy => (
            <div
              key={allergy.id}
              className={`border-2 rounded-lg p-3 ${allergy.isActive ? getSeverityColor(allergy.severity) : 'bg-gray-100 text-gray-500 border-gray-300'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-lg">{allergy.allergen}</h4>
                    <span className="px-2 py-0.5 text-xs rounded bg-white bg-opacity-50">
                      {allergy.allergyType}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-white bg-opacity-50 font-medium">
                      {allergy.severity.toUpperCase()}
                    </span>
                    {!allergy.isActive && (
                      <span className="px-2 py-0.5 text-xs rounded bg-gray-400 text-white">
                        INACTIVE
                      </span>
                    )}
                  </div>
                  {allergy.reaction && (
                    <p className="text-sm mt-1">Reaction: {allergy.reaction}</p>
                  )}
                  {allergy.onsetDate && (
                    <p className="text-sm mt-1">
                      Onset: {formatNigerianDate(allergy.onsetDate)}
                    </p>
                  )}
                  {allergy.notes && (
                    <p className="text-sm mt-1 italic">{allergy.notes}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  {allergy.isActive && (
                    <>
                      <button
                        onClick={() => handleEdit(allergy)}
                        className="p-1 hover:bg-white hover:bg-opacity-50 rounded"
                        title="Edit"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeactivate(allergy.id)}
                        className="p-1 hover:bg-white hover:bg-opacity-50 rounded"
                        title="Deactivate"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {!allergy.isActive && (
                    <button
                      onClick={() => handleReactivate(allergy.id)}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

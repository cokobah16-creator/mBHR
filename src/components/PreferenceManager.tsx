import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  createOrUpdatePreference,
  getPatientPreference,
  type CreatePreferenceInput
} from '../services/preferences'
import type { PatientPreference } from '../db'
import { Cog6ToothIcon } from '@heroicons/react/24/outline'

const preferenceSchema = z.object({
  preferredLanguage: z.string().optional(),
  communicationChannel: z.enum(['sms', 'whatsapp', 'call', 'in-person']).optional().or(z.literal('')),
  bestContactTime: z.string().optional(),
  dietaryRestrictions: z.string().optional(),
  religiousCultural: z.string().optional(),
  appointmentReminders: z.boolean(),
  medicationReminders: z.boolean(),
  notes: z.string().optional()
})

type PreferenceFormData = z.infer<typeof preferenceSchema>

interface PreferenceManagerProps {
  patientId: string
}

export function PreferenceManager({ patientId }: PreferenceManagerProps) {
  const [preference, setPreference] = useState<PatientPreference | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PreferenceFormData>({
    resolver: zodResolver(preferenceSchema),
    defaultValues: {
      appointmentReminders: true,
      medicationReminders: true
    }
  })

  useEffect(() => {
    loadPreference()
  }, [patientId])

  const loadPreference = async () => {
    setLoading(true)
    const data = await getPatientPreference(patientId)
    setPreference(data || null)
    if (data) {
      reset({
        preferredLanguage: data.preferredLanguage || undefined,
        communicationChannel: data.communicationChannel || undefined,
        bestContactTime: data.bestContactTime || undefined,
        dietaryRestrictions: data.dietaryRestrictions || undefined,
        religiousCultural: data.religiousCultural || undefined,
        appointmentReminders: data.appointmentReminders === 1,
        medicationReminders: data.medicationReminders === 1,
        notes: data.notes || undefined
      })
    }
    setLoading(false)
  }

  const onSubmit = async (data: PreferenceFormData) => {
    const input: CreatePreferenceInput = {
      patientId,
      preferredLanguage: data.preferredLanguage,
      communicationChannel: data.communicationChannel || undefined,
      bestContactTime: data.bestContactTime,
      dietaryRestrictions: data.dietaryRestrictions,
      religiousCultural: data.religiousCultural,
      appointmentReminders: data.appointmentReminders ? 1 : 0,
      medicationReminders: data.medicationReminders ? 1 : 0,
      notes: data.notes
    }

    await createOrUpdatePreference(input)
    setIsEditing(false)
    loadPreference()
  }

  if (loading) {
    return <div className="text-center py-4">Loading preferences...</div>
  }

  if (!isEditing && !preference) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Cog6ToothIcon className="h-5 w-5 text-gray-600" />
            Patient Preferences
          </h3>
        </div>
        <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
          <p className="mb-3">No preferences set</p>
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Set Preferences
          </button>
        </div>
      </div>
    )
  }

  if (!isEditing && preference) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Cog6ToothIcon className="h-5 w-5 text-gray-600" />
            Patient Preferences
          </h3>
          <button
            onClick={() => setIsEditing(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Edit
          </button>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {preference.preferredLanguage && (
              <div>
                <span className="text-sm font-medium text-gray-600">Language:</span>
                <p className="mt-1">{preference.preferredLanguage}</p>
              </div>
            )}

            {preference.communicationChannel && (
              <div>
                <span className="text-sm font-medium text-gray-600">Communication:</span>
                <p className="mt-1 capitalize">{preference.communicationChannel}</p>
              </div>
            )}

            {preference.bestContactTime && (
              <div>
                <span className="text-sm font-medium text-gray-600">Best Contact Time:</span>
                <p className="mt-1">{preference.bestContactTime}</p>
              </div>
            )}

            {preference.dietaryRestrictions && (
              <div>
                <span className="text-sm font-medium text-gray-600">Dietary Restrictions:</span>
                <p className="mt-1">{preference.dietaryRestrictions}</p>
              </div>
            )}

            {preference.religiousCultural && (
              <div className="md:col-span-2">
                <span className="text-sm font-medium text-gray-600">Religious/Cultural Considerations:</span>
                <p className="mt-1">{preference.religiousCultural}</p>
              </div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preference.appointmentReminders === 1}
                disabled
                className="h-4 w-4"
              />
              <span className="text-sm">Appointment reminders enabled</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preference.medicationReminders === 1}
                disabled
                className="h-4 w-4"
              />
              <span className="text-sm">Medication reminders enabled</span>
            </div>
          </div>

          {preference.notes && (
            <div className="border-t pt-3">
              <span className="text-sm font-medium text-gray-600">Notes:</span>
              <p className="mt-1 text-sm italic">{preference.notes}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Cog6ToothIcon className="h-5 w-5 text-gray-600" />
          Patient Preferences
        </h3>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 p-4 rounded-lg border space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Preferred Language</label>
            <input
              {...register('preferredLanguage')}
              className="w-full px-3 py-2 border rounded"
              placeholder="e.g., English, Hausa, Yoruba"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Communication Channel</label>
            <select {...register('communicationChannel')} className="w-full px-3 py-2 border rounded">
              <option value="">Not specified</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Phone Call</option>
              <option value="in-person">In Person</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Best Contact Time</label>
            <input
              {...register('bestContactTime')}
              className="w-full px-3 py-2 border rounded"
              placeholder="e.g., Morning, Evening"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Dietary Restrictions</label>
            <input
              {...register('dietaryRestrictions')}
              className="w-full px-3 py-2 border rounded"
              placeholder="e.g., Vegetarian, Allergies"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Religious/Cultural Considerations</label>
          <input
            {...register('religiousCultural')}
            className="w-full px-3 py-2 border rounded"
            placeholder="Any special considerations"
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register('appointmentReminders')}
              className="h-4 w-4"
            />
            <span className="text-sm">Send appointment reminders</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register('medicationReminders')}
              className="h-4 w-4"
            />
            <span className="text-sm">Send medication reminders</span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Additional Notes</label>
          <textarea
            {...register('notes')}
            className="w-full px-3 py-2 border rounded"
            rows={3}
            placeholder="Any other preferences or notes"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Save Preferences
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditing(false)
              if (preference) {
                reset({
                  preferredLanguage: preference.preferredLanguage || undefined,
                  communicationChannel: preference.communicationChannel || undefined,
                  bestContactTime: preference.bestContactTime || undefined,
                  dietaryRestrictions: preference.dietaryRestrictions || undefined,
                  religiousCultural: preference.religiousCultural || undefined,
                  appointmentReminders: preference.appointmentReminders === 1,
                  medicationReminders: preference.medicationReminders === 1,
                  notes: preference.notes || undefined
                })
              }
            }}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

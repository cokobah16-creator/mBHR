import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { db, generateId, createAuditLog } from '@/db'
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from '@/utils/vitals'
import { useAuthStore } from '@/stores/auth'
import { HeartIcon } from '@heroicons/react/24/outline'

const vitalsSchema = z.object({
  heightCm: z.number().min(30).max(250).optional(),
  weightKg: z.number().min(1).max(300).optional(),
  tempC: z.number().min(30).max(45).optional(),
  pulseBpm: z.number().min(30).max(200).optional(),
  systolic: z.number().min(60).max(250).optional(),
  diastolic: z.number().min(30).max(150).optional(),
  spo2: z.number().min(70).max(100).optional()
})

type VitalsFormData = z.infer<typeof vitalsSchema>

interface VitalsFormProps {
  patientId: string
  visitId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function VitalsForm({ patientId, visitId, onSuccess, onCancel }: VitalsFormProps) {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [bmi, setBmi] = useState<number | null>(null)
  const [flags, setFlags] = useState<string[]>([])

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<VitalsFormData>({
    resolver: zodResolver(vitalsSchema)
  })

  const watchedValues = watch()

  // Calculate BMI and flags when height/weight change
  useEffect(() => {
    const { heightCm, weightKg, systolic, diastolic, tempC, pulseBpm } = watchedValues
    
    let calculatedBmi = null
    if (heightCm && weightKg) {
      calculatedBmi = calculateBMI(heightCm, weightKg)
      setBmi(calculatedBmi)
    } else {
      setBmi(null)
    }

    const vitalsForFlagging = {
      systolic,
      diastolic,
      tempC,
      pulseBpm,
      bmi: calculatedBmi || undefined
    }

    const newFlags = flagVitals(vitalsForFlagging)
    setFlags(newFlags)
  }, [watchedValues])

  const onSubmit = async (data: VitalsFormData) => {
    setLoading(true)
    try {
      const vital = {
        id: generateId(),
        patientId,
        visitId,
        ...data,
        bmi: bmi || undefined,
        flags,
        takenAt: new Date()
      }

      await db.vitals.add(vital)
      await createAuditLog(
        currentUser?.role || 'unknown',
        'create',
        'vital',
        vital.id
      )

      onSuccess?.()
    } catch (error) {
      console.error('Error saving vitals:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <HeartIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            Record Vital Signs
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Height and Weight */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vitals.height')}
              </label>
              <input
                {...register('heightCm', { valueAsNumber: true })}
                type="number"
                step="0.1"
                className="input-field"
                placeholder="170"
              />
              {errors.heightCm && (
                <p className="text-red-600 text-sm mt-1">{errors.heightCm.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vitals.weight')}
              </label>
              <input
                {...register('weightKg', { valueAsNumber: true })}
                type="number"
                step="0.1"
                className="input-field"
                placeholder="70"
              />
              {errors.weightKg && (
                <p className="text-red-600 text-sm mt-1">{errors.weightKg.message}</p>
              )}
            </div>
          </div>

          {/* BMI Display */}
          {bmi && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-blue-800">
                BMI: <span className="text-lg">{bmi}</span>
              </p>
            </div>
          )}

          {/* Temperature and Pulse */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vitals.temperature')}
              </label>
              <input
                {...register('tempC', { valueAsNumber: true })}
                type="number"
                step="0.1"
                className="input-field"
                placeholder="36.5"
              />
              {errors.tempC && (
                <p className="text-red-600 text-sm mt-1">{errors.tempC.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vitals.pulse')}
              </label>
              <input
                {...register('pulseBpm', { valueAsNumber: true })}
                type="number"
                className="input-field"
                placeholder="72"
              />
              {errors.pulseBpm && (
                <p className="text-red-600 text-sm mt-1">{errors.pulseBpm.message}</p>
              )}
            </div>
          </div>

          {/* Blood Pressure */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('vitals.bloodPressure')}
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <input
                  {...register('systolic', { valueAsNumber: true })}
                  type="number"
                  className="input-field"
                  placeholder="120 (systolic)"
                />
                {errors.systolic && (
                  <p className="text-red-600 text-sm mt-1">{errors.systolic.message}</p>
                )}
              </div>
              <div>
                <input
                  {...register('diastolic', { valueAsNumber: true })}
                  type="number"
                  className="input-field"
                  placeholder="80 (diastolic)"
                />
                {errors.diastolic && (
                  <p className="text-red-600 text-sm mt-1">{errors.diastolic.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* SpO2 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SpO2 (%)
            </label>
            <input
              {...register('spo2', { valueAsNumber: true })}
              type="number"
              min="70"
              max="100"
              className="input-field"
              placeholder="98"
            />
            {errors.spo2 && (
              <p className="text-red-600 text-sm mt-1">{errors.spo2.message}</p>
            )}
          </div>

          {/* Flags Display */}
          {flags.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">
                ⚠️ Abnormal Values Detected
              </h3>
              <div className="flex flex-wrap gap-2">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className={`px-2 py-1 rounded-full text-xs font-medium ${getFlagColor(flag)}`}
                  >
                    {getFlagLabel(flag)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Saving...' : 'Save Vitals'}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
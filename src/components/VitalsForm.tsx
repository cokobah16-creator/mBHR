import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { db, generateId, createAuditLog, bumpDailyCount, epochDay } from '@/db'
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from '@/utils/vitals'
import { useAuthStore } from '@/stores/auth'
import { EnhancedVitalsInput } from '@/components/EnhancedVitalsInput'
import { AudioButton } from '@/components/AudioButton'
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
  const [patient, setPatient] = useState<any>(null)

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors }
  } = useForm<VitalsFormData>({
    resolver: zodResolver(vitalsSchema)
  })

  const watchedValues = watch()

  useEffect(() => {
    // Load patient data for age/sex context
    db.patients.get(patientId).then(setPatient)
  }, [patientId])

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

      // Bump daily count
      await bumpDailyCount(epochDay(new Date()), 'vitals')

      onSuccess?.()
    } catch (error) {
      console.error('Error saving vitals:', error)
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

  if (!patient) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading patient...</p>
        </div>
      </div>
    )
  }

  const patientAge = getPatientAge(patient.dob)
  const patientSex = patient.sex === 'male' ? 'M' : patient.sex === 'female' ? 'F' : 'U'
  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <HeartIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            Record Vital Signs
          </h2>
          <div className="text-sm text-gray-600">
            Age: {patientAge} • {patient.sex}
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Height and Weight */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EnhancedVitalsInput
              name="heightCm"
              label={t('vitals.height')}
              unit="cm"
              metric="hr"
              patientAge={patientAge}
              patientSex={patientSex}
              placeholder="170"
              step={0.1}
            />
            <EnhancedVitalsInput
              name="weightKg"
              label={t('vitals.weight')}
              unit="kg"
              metric="hr"
              patientAge={patientAge}
              patientSex={patientSex}
              placeholder="70"
              step={0.1}
            />
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
            <EnhancedVitalsInput
              name="tempC"
              label={t('vitals.temperature')}
              unit="°C"
              metric="temp"
              patientAge={patientAge}
              patientSex={patientSex}
              placeholder="36.5"
              step={0.1}
            />
            <EnhancedVitalsInput
              name="pulseBpm"
              label={t('vitals.pulse')}
              unit="bpm"
              metric="hr"
              patientAge={patientAge}
              patientSex={patientSex}
              placeholder="72"
            />
          </div>

          {/* Blood Pressure */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('vitals.bloodPressure')}
            </label>
            <div className="grid grid-cols-2 gap-4">
              <EnhancedVitalsInput
                name="systolic"
                label="Systolic"
                unit="mmHg"
                metric="sbp"
                patientAge={patientAge}
                patientSex={patientSex}
                placeholder="120"
              />
              <EnhancedVitalsInput
                name="diastolic"
                label="Diastolic"
                unit="mmHg"
                metric="dbp"
                patientAge={patientAge}
                patientSex={patientSex}
                placeholder="80"
              />
            </div>
          </div>

          {/* SpO2 */}
          <EnhancedVitalsInput
            name="spo2"
            label="SpO2"
            unit="%"
            metric="spo2"
            patientAge={patientAge}
            patientSex={patientSex}
            placeholder="98"
          />

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
            <AudioButton
              audioKey="action.save"
              fallbackText="Save Vitals"
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Saving...' : 'Save Vitals'}
            </AudioButton>
            {onCancel && (
              <AudioButton
                audioKey="action.cancel"
                fallbackText="Cancel"
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </AudioButton>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
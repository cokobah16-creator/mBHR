import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { db, generateId, createAuditLog } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { DocumentTextIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'

const soapSchema = z.object({
  soapSubjective: z.string().min(1, 'Subjective findings required'),
  soapObjective: z.string().min(1, 'Objective findings required'),
  soapAssessment: z.string().min(1, 'Assessment required'),
  soapPlan: z.string().min(1, 'Plan required')
})

type SoapFormData = z.infer<typeof soapSchema>

interface SoapFormProps {
  patientId: string
  visitId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function SoapForm({ patientId, visitId, onSuccess, onCancel }: SoapFormProps) {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [diagnoses, setDiagnoses] = useState<string[]>([''])

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SoapFormData>({
    resolver: zodResolver(soapSchema)
  })

  const addDiagnosis = () => {
    setDiagnoses([...diagnoses, ''])
  }

  const removeDiagnosis = (index: number) => {
    if (diagnoses.length > 1) {
      setDiagnoses(diagnoses.filter((_, i) => i !== index))
    }
  }

  const updateDiagnosis = (index: number, value: string) => {
    const updated = [...diagnoses]
    updated[index] = value
    setDiagnoses(updated)
  }

  const onSubmit = async (data: SoapFormData) => {
    setLoading(true)
    try {
      const consultation = {
        id: generateId(),
        patientId,
        visitId,
        providerName: currentUser?.fullName || 'Unknown Provider',
        ...data,
        provisionalDx: diagnoses.filter(dx => dx.trim()),
        createdAt: new Date()
      }

      await db.consultations.add(consultation)
      await createAuditLog(
        currentUser?.role || 'unknown',
        'create',
        'consultation',
        consultation.id
      )

      onSuccess?.()
    } catch (error) {
      console.error('Error saving consultation:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <DocumentTextIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            Consultation Notes
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Subjective */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Subjective (Patient's History) *
            </label>
            <textarea
              {...register('soapSubjective')}
              className="input-field"
              rows={4}
              placeholder="Patient reports... Chief complaint, history of present illness, review of systems..."
            />
            {errors.soapSubjective && (
              <p className="text-red-600 text-sm mt-1">{errors.soapSubjective.message}</p>
            )}
          </div>

          {/* Objective */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Objective (Physical Examination) *
            </label>
            <textarea
              {...register('soapObjective')}
              className="input-field"
              rows={4}
              placeholder="Physical examination findings, vital signs, laboratory results..."
            />
            {errors.soapObjective && (
              <p className="text-red-600 text-sm mt-1">{errors.soapObjective.message}</p>
            )}
          </div>

          {/* Assessment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assessment (Clinical Impression) *
            </label>
            <textarea
              {...register('soapAssessment')}
              className="input-field"
              rows={3}
              placeholder="Clinical reasoning, differential diagnosis, problem list..."
            />
            {errors.soapAssessment && (
              <p className="text-red-600 text-sm mt-1">{errors.soapAssessment.message}</p>
            )}
          </div>

          {/* Plan */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plan (Treatment Plan) *
            </label>
            <textarea
              {...register('soapPlan')}
              className="input-field"
              rows={4}
              placeholder="Treatment plan, medications, follow-up instructions, patient education..."
            />
            {errors.soapPlan && (
              <p className="text-red-600 text-sm mt-1">{errors.soapPlan.message}</p>
            )}
          </div>

          {/* Provisional Diagnoses */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Provisional Diagnoses
              </label>
              <button
                type="button"
                onClick={addDiagnosis}
                className="flex items-center space-x-1 text-primary hover:text-primary/80 text-sm font-medium"
              >
                <PlusIcon className="h-4 w-4" />
                <span>Add Diagnosis</span>
              </button>
            </div>
            
            <div className="space-y-3">
              {diagnoses.map((diagnosis, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-500 w-8">
                    {index + 1}.
                  </span>
                  <input
                    type="text"
                    value={diagnosis}
                    onChange={(e) => updateDiagnosis(index, e.target.value)}
                    className="input-field flex-1"
                    placeholder="Enter diagnosis (e.g., Hypertension, Type 2 Diabetes)"
                  />
                  {diagnoses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDiagnosis(index)}
                      className="text-red-600 hover:text-red-800 p-1 touch-target"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Provider Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <strong>Provider:</strong> {currentUser?.fullName || 'Unknown'}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Date:</strong> {new Date().toLocaleDateString()}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Saving...' : 'Save Consultation'}
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
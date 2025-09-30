import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { usePatientsStore } from '@/stores/patients'
import { NIGERIAN_STATES, LGAS_BY_STATE, formatPhoneNG, validatePhoneNG } from '@/utils/nigeria'
import { CameraIcon, UserIcon } from '@heroicons/react/24/outline'

const patientSchema = z.object({
  givenName: z.string().min(1, 'Given name is required'),
  familyName: z.string().min(1, 'Family name is required'),
  sex: z.enum(['male', 'female', 'other']),
  dob: z.string().min(1, 'Date of birth is required'),
  phone: z.string().refine(validatePhoneNG, 'Invalid Nigerian phone number'),
  address: z.string().min(1, 'Address is required'),
  state: z.string().min(1, 'State is required'),
  lga: z.string().min(1, 'LGA is required'),
  familyId: z.string().optional()
})

type PatientFormData = z.infer<typeof patientSchema>

interface PatientFormProps {
  onSuccess?: (patientId: string) => void
  onCancel?: () => void
}

export function PatientForm({ onSuccess, onCancel }: PatientFormProps) {
  const { t } = useTranslation()
  const { addPatient } = usePatientsStore()
  const [loading, setLoading] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState('')

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema)
  })

  const watchedState = watch('state')
  const availableLGAs = LGAS_BY_STATE[watchedState] || []

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        // Create thumbnail (max 200x200)
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          const maxSize = 200
          
          let { width, height } = img
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width
              width = maxSize
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height
              height = maxSize
            }
          }
          
          canvas.width = width
          canvas.height = height
          ctx?.drawImage(img, 0, 0, width, height)
          
          const thumbnail = canvas.toDataURL('image/jpeg', 0.8)
          setPhoto(thumbnail)
        }
        img.src = result
      }
      reader.readAsDataURL(file)
    }
  }

  const onSubmit = async (data: PatientFormData) => {
    setLoading(true)
    try {
      const formattedPhone = formatPhoneNG(data.phone)
      const patientId = await addPatient({
        ...data,
        phone: formattedPhone,
        photoUrl: photo || undefined
      })
      
      onSuccess?.(patientId)
    } catch (error) {
      console.error('Error adding patient:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <UserIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            {t('patient.register')}
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Photo Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {photo ? (
                <img
                  src={photo}
                  alt="Patient"
                  className="w-32 h-32 rounded-full object-cover border-4 border-gray-200"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center border-4 border-gray-200">
                  <UserIcon className="h-16 w-16 text-gray-400" />
                </div>
              )}
              <label className="absolute bottom-0 right-0 bg-primary text-white rounded-full p-2 cursor-pointer hover:bg-primary/90 transition-colors touch-target">
                <CameraIcon className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-sm text-gray-600">Tap camera to add photo</p>
          </div>

          {/* Name Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.givenName')} *
              </label>
              <input
                {...register('givenName')}
                className="input-field"
                placeholder="Enter given name"
              />
              {errors.givenName && (
                <p className="text-red-600 text-sm mt-1">{errors.givenName.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.familyName')} *
              </label>
              <input
                {...register('familyName')}
                className="input-field"
                placeholder="Enter family name"
              />
              {errors.familyName && (
                <p className="text-red-600 text-sm mt-1">{errors.familyName.message}</p>
              )}
            </div>
          </div>

          {/* Sex and DOB */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sex *
              </label>
              <select {...register('sex')} className="input-field">
                <option value="">Select sex</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              {errors.sex && (
                <p className="text-red-600 text-sm mt-1">{errors.sex.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date of Birth *
              </label>
              <input
                {...register('dob')}
                type="date"
                className="input-field"
                max={new Date().toISOString().split('T')[0]}
              />
              {errors.dob && (
                <p className="text-red-600 text-sm mt-1">{errors.dob.message}</p>
              )}
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('patient.phone')} *
            </label>
            <input
              {...register('phone')}
              type="tel"
              className="input-field"
              placeholder="08012345678 or +2348012345678"
            />
            {errors.phone && (
              <p className="text-red-600 text-sm mt-1">{errors.phone.message}</p>
            )}
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('patient.address')} *
            </label>
            <textarea
              {...register('address')}
              className="input-field"
              rows={3}
              placeholder="Enter full address"
            />
            {errors.address && (
              <p className="text-red-600 text-sm mt-1">{errors.address.message}</p>
            )}
          </div>

          {/* State and LGA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.state')} *
              </label>
              <select
                {...register('state')}
                onChange={(e) => {
                  setSelectedState(e.target.value)
                  setValue('lga', '') // Reset LGA when state changes
                }}
                className="input-field"
              >
                <option value="">Select state</option>
                {NIGERIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              {errors.state && (
                <p className="text-red-600 text-sm mt-1">{errors.state.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.lga')} *
              </label>
              <select
                {...register('lga')}
                className="input-field"
                disabled={!watchedState}
              >
                <option value="">Select LGA</option>
                {availableLGAs.map((lga) => (
                  <option key={lga} value={lga}>
                    {lga}
                  </option>
                ))}
              </select>
              {errors.lga && (
                <p className="text-red-600 text-sm mt-1">{errors.lga.message}</p>
              )}
            </div>
          </div>

          {/* Family ID (Optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Family ID (Optional)
            </label>
            <input
              {...register('familyId')}
              className="input-field"
              placeholder="Link to existing family member"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Registering...' : 'Register Patient'}
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
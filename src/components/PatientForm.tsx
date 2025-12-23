import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { usePatientsStore } from '@/stores/patients'
import { PatientDedupeModal } from '@/components/PatientDedupeModal'
import { AudioButton } from '@/components/AudioButton'
import { PhotoCapture } from '@/components/PhotoCapture'
import { NIGERIAN_STATES, LGAS_BY_STATE } from '@/utils/nigeria'
import { normalizePhone } from '@/utils/phone'
import { patientSchema, PatientFormData } from '@/validation/schemas'
import { CameraIcon, UserIcon } from '@heroicons/react/24/outline'
import { enrollPatientInPortal } from '@/services/unifiedPortalEnrollment'

interface PatientFormProps {
  onSuccess?: (patientId: string) => void
  onCancel?: () => void
}

export function PatientForm({ onSuccess, onCancel }: PatientFormProps) {
  const { t } = useTranslation()
  const { addPatient } = usePatientsStore()
  const [loading, setLoading] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [showPhotoCapture, setShowPhotoCapture] = useState(false)
  const [showDedupeModal, setShowDedupeModal] = useState(false)
  const [dedupeData, setDedupeData] = useState<{ patient: any; candidates: any[] } | null>(null)

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

  // Auto-enable portal when contact info is entered
  useEffect(() => {
    const { phone, email } = watch()
    const hasContact = (phone && phone.trim()) || (email && email.trim())
    if (hasContact && !watch('portalEnabled')) {
      setValue('portalEnabled', true)
    }
  }, [watch('phone'), watch('email')])

  const handlePhotoCapture = (photoDataUrl: string) => {
    setPhoto(photoDataUrl)
    setShowPhotoCapture(false)
  }

  const handleRemovePhoto = () => {
    setPhoto(null)
  }

  const onSubmit = async (data: PatientFormData) => {
    setLoading(true)
    console.log('PatientForm: Submitting patient data:', data)
    try {
      const normalizedPhone = data.phone ? normalizePhone(data.phone) : null
      console.log('PatientForm: Normalized phone:', normalizedPhone)

      const patientData = {
        givenName: data.givenName || '',
        familyName: data.familyName || '',
        sex: data.sex || 'other',
        dob: data.dob || '',
        phone: normalizedPhone || undefined,
        email: data.email || undefined,
        address: data.address || '',
        state: data.state || '',
        lga: data.lga || '',
        familyId: data.familyId || '',
        photoUrl: photo || ''
      }

      const patientId = await addPatient(patientData)

      console.log('PatientForm: Patient created with ID:', patientId)

      // Automatically enroll in portal if contact info provided
      if ((normalizedPhone || data.email) && data.portalEnabled !== false) {
        const portalResult = await enrollPatientInPortal({
          patientId,
          givenName: data.givenName || '',
          familyName: data.familyName || '',
          dob: data.dob || '',
          phone: normalizedPhone || undefined,
          email: data.email || undefined,
          sex: data.sex
        })

        if (!portalResult.success) {
          console.warn('Portal enrollment failed:', portalResult.error)
          alert(`Patient registered but portal enrollment failed: ${portalResult.error}. You can enable portal access later from patient details.`)
        } else {
          console.log('Portal account created:', portalResult.portalUserId)
          alert('Patient registered successfully! Portal access enabled. Patient can login at /patient/login')
        }
      }

      onSuccess?.(patientId)
    } catch (error) {
      console.error('Error adding patient:', error)

      // Check if it's a duplicate error
      if (error.message.startsWith('DUPLICATES_FOUND:')) {
        const duplicateData = JSON.parse(error.message.replace('DUPLICATES_FOUND:', ''))
        setDedupeData(duplicateData)
        setShowDedupeModal(true)
      } else {
        alert('Failed to register patient: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDedupeResolve = async (action: 'merge' | 'create_new', winnerId?: string) => {
    setShowDedupeModal(false)
    
    if (action === 'create_new' && dedupeData) {
      // Force create new patient (bypass duplicate check)
      try {
        const patientId = await addPatient({
          ...dedupeData.patient,
          photoUrl: photo || undefined,
          // Add a suffix to make it unique
          givenName: dedupeData.patient.givenName + ' (New)'
        })
        onSuccess?.(patientId)
      } catch (error) {
        console.error('Error creating new patient:', error)
        alert('Failed to create new patient')
      }
    } else if (action === 'merge' && winnerId) {
      // Use existing patient
      onSuccess?.(winnerId)
    }
    
    setDedupeData(null)
  }
  return (
    <>
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
              {photo && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1 m-1"
                >
                  ×
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPhotoCapture(true)}
                className="absolute bottom-0 right-0 bg-primary text-white rounded-full p-2 cursor-pointer hover:bg-primary/90 transition-colors touch-target"
              >
                <CameraIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">Tap camera to {photo ? 'change' : 'add'} photo</p>
          </div>

          {/* Name Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="givenName" className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.givenName')} *
              </label>
              <input
                {...register('givenName')}
                id="givenName"
                className="input-field"
                placeholder="Enter given name"
                aria-required="true"
                aria-invalid={errors.givenName ? 'true' : 'false'}
                aria-describedby={errors.givenName ? 'givenName-error' : undefined}
              />
              {errors.givenName && (
                <p id="givenName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.givenName.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="familyName" className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.familyName')} *
              </label>
              <input
                {...register('familyName')}
                id="familyName"
                className="input-field"
                placeholder="Enter family name"
                aria-required="true"
                aria-invalid={errors.familyName ? 'true' : 'false'}
                aria-describedby={errors.familyName ? 'familyName-error' : undefined}
              />
              {errors.familyName && (
                <p id="familyName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.familyName.message}</p>
              )}
            </div>
          </div>

          {/* Sex and DOB */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sex" className="block text-sm font-medium text-gray-700 mb-2">
                Sex *
              </label>
              <select
                {...register('sex')}
                id="sex"
                className="input-field"
                aria-required="true"
                aria-invalid={errors.sex ? 'true' : 'false'}
                aria-describedby={errors.sex ? 'sex-error' : undefined}
              >
                <option value="">Select sex</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              {errors.sex && (
                <p id="sex-error" role="alert" className="text-red-600 text-sm mt-1">{errors.sex.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-2">
                Date of Birth *
              </label>
              <input
                {...register('dob')}
                id="dob"
                type="date"
                className="input-field"
                max={new Date().toISOString().split('T')[0]}
                aria-required="true"
                aria-invalid={errors.dob ? 'true' : 'false'}
                aria-describedby={errors.dob ? 'dob-error' : undefined}
              />
              {errors.dob && (
                <p id="dob-error" role="alert" className="text-red-600 text-sm mt-1">{errors.dob.message}</p>
              )}
            </div>
          </div>

          {/* Phone and Email */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.phone')} (at least one contact required)
              </label>
              <input
                {...register('phone')}
                id="phone"
                type="tel"
                className="input-field"
                placeholder="08012345678 or +2348012345678"
                aria-invalid={errors.phone ? 'true' : 'false'}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
              />
              {errors.phone && (
                <p id="phone-error" role="alert" className="text-red-600 text-sm mt-1">{errors.phone.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email (at least one contact required)
              </label>
              <input
                {...register('email')}
                id="email"
                type="email"
                className="input-field"
                placeholder="patient@example.com"
                aria-invalid={errors.email ? 'true' : 'false'}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" role="alert" className="text-red-600 text-sm mt-1">{errors.email.message}</p>
              )}
            </div>
          </div>

          {/* Address */}
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
              {t('patient.address')} *
            </label>
            <textarea
              {...register('address')}
              id="address"
              className="input-field"
              rows={3}
              placeholder="Enter full address"
              aria-required="true"
              aria-invalid={errors.address ? 'true' : 'false'}
              aria-describedby={errors.address ? 'address-error' : undefined}
            />
            {errors.address && (
              <p id="address-error" role="alert" className="text-red-600 text-sm mt-1">{errors.address.message}</p>
            )}
          </div>

          {/* State and LGA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.state')} *
              </label>
              <select
                {...register('state', {
                  onChange: () => {
                    setValue('lga', '')
                  }
                })}
                id="state"
                className="input-field"
                aria-required="true"
                aria-invalid={errors.state ? 'true' : 'false'}
                aria-describedby={errors.state ? 'state-error' : undefined}
              >
                <option value="">Select state</option>
                {NIGERIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              {errors.state && (
                <p id="state-error" role="alert" className="text-red-600 text-sm mt-1">{errors.state.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="lga" className="block text-sm font-medium text-gray-700 mb-2">
                {t('patient.lga')} *
              </label>
              <select
                {...register('lga')}
                id="lga"
                className={`input-field ${!watchedState ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                disabled={!watchedState || availableLGAs.length === 0}
                aria-required="true"
                aria-invalid={errors.lga ? 'true' : 'false'}
                aria-describedby={errors.lga ? 'lga-error' : 'lga-hint'}
              >
                <option value="">
                  {!watchedState
                    ? 'Select state first'
                    : availableLGAs.length === 0
                    ? 'No LGAs available for this state'
                    : 'Select LGA'}
                </option>
                {availableLGAs.map((lga) => (
                  <option key={lga} value={lga}>
                    {lga}
                  </option>
                ))}
              </select>
              {errors.lga && (
                <p id="lga-error" role="alert" className="text-red-600 text-sm mt-1">{errors.lga.message}</p>
              )}
              {watchedState && availableLGAs.length > 0 && (
                <p id="lga-hint" className="text-gray-500 text-xs mt-1">
                  {availableLGAs.length} LGAs available
                </p>
              )}
            </div>
          </div>

          {/* Family ID (Optional) */}
          <div>
            <label htmlFor="familyId" className="block text-sm font-medium text-gray-700 mb-2">
              Family ID (Optional)
            </label>
            <input
              {...register('familyId')}
              id="familyId"
              className="input-field"
              placeholder="Link to existing family member"
            />
          </div>

          {/* Portal Access Section */}
          <div className="border-t pt-6 mt-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">Patient Portal Access</h3>
              <p className="text-sm text-blue-800">
                Enable secure online access to medical records, appointments, and test results.
                Patients can view their health information anytime via phone or email.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start">
                <input
                  {...register('portalEnabled')}
                  type="checkbox"
                  id="portalEnabled"
                  className="mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
                  onChange={(e) => {
                    // Auto-check portalEnabled if email or phone exists
                    const hasContact = (watch('email') || watch('phone'))
                    if (!hasContact && e.target.checked) {
                      alert('Please provide at least an email or phone number for portal access')
                      e.target.checked = false
                    }
                  }}
                />
                <label htmlFor="portalEnabled" className="ml-2 text-sm text-gray-700">
                  <span className="font-medium">Enable patient portal access</span>
                  <span className="text-gray-600 block mt-1">
                    Patient will receive login instructions via {watch('email') ? 'email' : 'SMS'}
                  </span>
                </label>
              </div>

              {watch('portalEnabled') && (
                <>
                  <div className="flex items-start ml-6">
                    <input
                      {...register('termsAccepted')}
                      type="checkbox"
                      id="termsAccepted"
                      className="mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
                    />
                    <label htmlFor="termsAccepted" className="ml-2 text-sm text-gray-700">
                      I have explained portal access terms to the patient and they agree
                    </label>
                  </div>
                  {errors.termsAccepted && (
                    <p className="text-red-600 text-sm ml-6">{errors.termsAccepted.message}</p>
                  )}

                  <div className="flex items-start ml-6">
                    <input
                      {...register('sendInviteNow')}
                      type="checkbox"
                      id="sendInviteNow"
                      className="mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
                    />
                    <label htmlFor="sendInviteNow" className="ml-2 text-sm text-gray-700">
                      <span className="font-medium">Send portal invitation now</span>
                      <span className="text-gray-600 block mt-1">
                        Uncheck to send invitation later from patient details page
                      </span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <AudioButton
              audioKey="action.register"
              fallbackText="Register Patient"
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Registering...' : 'Register Patient'}
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
    
    {/* Dedupe Modal */}
    {showDedupeModal && dedupeData && (
      <PatientDedupeModal
        newPatient={dedupeData.patient}
        candidates={dedupeData.candidates}
        onResolve={handleDedupeResolve}
        onCancel={() => {
          setShowDedupeModal(false)
          setDedupeData(null)
          setLoading(false)
        }}
      />
    )}

    {/* Photo Capture Modal */}
    {showPhotoCapture && (
      <PhotoCapture
        onCapture={handlePhotoCapture}
        onCancel={() => setShowPhotoCapture(false)}
        currentPhoto={photo || undefined}
      />
    )}
    </>
  )
}
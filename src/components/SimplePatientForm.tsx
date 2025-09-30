import React, { useState } from 'react'
import { useT } from '@/hooks/useT'
import { StepperForm } from '@/components/StepperForm'
import { VisualNumberInput } from '@/components/VisualNumberInput'
import { usePatientsStore } from '@/stores/patients'
import { NIGERIAN_STATES, LGAS_BY_STATE, formatPhoneNG } from '@/utils/nigeria'
import { 
  UserIcon, 
  CameraIcon, 
  PhoneIcon,
  MapPinIcon,
  CalendarIcon,
  IdentificationIcon
} from '@heroicons/react/24/outline'

interface SimplePatientFormProps {
  onSuccess?: (patientId: string) => void
  onCancel?: () => void
}

export function SimplePatientForm({ onSuccess, onCancel }: SimplePatientFormProps) {
  const { t, speak } = useT()
  const { addPatient } = usePatientsStore()
  
  const [formData, setFormData] = useState({
    givenName: '',
    familyName: '',
    sex: '',
    age: 25,
    phone: '',
    address: '',
    state: '',
    lga: '',
    photo: null as string | null
  })
  
  const [loading, setLoading] = useState(false)

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        // Create thumbnail
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
          setFormData(prev => ({ ...prev, photo: thumbnail }))
        }
        img.src = result
      }
      reader.readAsDataURL(file)
    }
  }

  const calculateDOB = (age: number): string => {
    const today = new Date()
    const birthYear = today.getFullYear() - age
    return `${birthYear}-01-01` // Approximate DOB
  }

  const handleComplete = async () => {
    setLoading(true)
    try {
      const dob = calculateDOB(formData.age)
      const formattedPhone = formatPhoneNG(formData.phone)
      
      const patientId = await addPatient({
        givenName: formData.givenName,
        familyName: formData.familyName,
        sex: formData.sex as 'male' | 'female' | 'other',
        dob,
        phone: formattedPhone,
        address: formData.address,
        state: formData.state,
        lga: formData.lga,
        photoUrl: formData.photo || undefined
      })
      
      onSuccess?.(patientId)
    } catch (error) {
      console.error('Error registering patient:', error)
      alert(t('error.registrationFailed'))
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    {
      id: 'photo',
      title: t('patient.photo'),
      audioKey: 'patient.photo',
      isValid: true,
      component: (
        <div className="text-center space-y-6">
          <div className="relative mx-auto w-32 h-32">
            {formData.photo ? (
              <img
                src={formData.photo}
                alt="Patient"
                className="w-32 h-32 rounded-full object-cover border-4 border-gray-200"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center border-4 border-gray-200">
                <UserIcon className="h-16 w-16 text-gray-400" />
              </div>
            )}
            <label className="absolute bottom-0 right-0 bg-primary text-white rounded-full p-3 cursor-pointer hover:bg-primary/90 transition-colors touch-target-large shadow-lg">
              <CameraIcon className="h-6 w-6" />
              <input
                type="file"
                accept="image/*"
                capture="user"
                onChange={handlePhotoCapture}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-lg text-gray-600">
            {t('simple.tapCameraToAddPhoto')}
          </p>
        </div>
      )
    },
    {
      id: 'names',
      title: t('patient.names'),
      audioKey: 'patient.names',
      isValid: formData.givenName.trim() && formData.familyName.trim(),
      component: (
        <div className="space-y-6">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <IdentificationIcon className="h-6 w-6 text-primary" />
              <span>{t('patient.givenName')} *</span>
            </label>
            <input
              type="text"
              value={formData.givenName}
              onChange={(e) => setFormData(prev => ({ ...prev, givenName: e.target.value }))}
              className="input-field text-xl"
              placeholder={t('simple.enterFirstName')}
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <IdentificationIcon className="h-6 w-6 text-primary" />
              <span>{t('patient.familyName')} *</span>
            </label>
            <input
              type="text"
              value={formData.familyName}
              onChange={(e) => setFormData(prev => ({ ...prev, familyName: e.target.value }))}
              className="input-field text-xl"
              placeholder={t('simple.enterLastName')}
            />
          </div>
        </div>
      )
    },
    {
      id: 'demographics',
      title: t('patient.demographics'),
      audioKey: 'patient.demographics',
      isValid: formData.sex && formData.age > 0,
      component: (
        <div className="space-y-8">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-4 text-center">
              {t('patient.sex')} *
            </label>
            <div className="grid grid-cols-3 gap-4">
              {[
                { value: 'male', label: t('patient.male'), icon: '👨', color: 'bg-blue-100 border-blue-300 text-blue-800' },
                { value: 'female', label: t('patient.female'), icon: '👩', color: 'bg-pink-100 border-pink-300 text-pink-800' },
                { value: 'other', label: t('patient.other'), icon: '👤', color: 'bg-gray-100 border-gray-300 text-gray-800' }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, sex: option.value }))}
                  className={`p-6 rounded-xl border-2 transition-all touch-target-large ${
                    formData.sex === option.value
                      ? `${option.color} ring-2 ring-primary/20`
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-4xl mb-2">{option.icon}</div>
                  <div className="text-lg font-medium">{option.label}</div>
                </button>
              ))}
            </div>
          </div>
          
          <VisualNumberInput
            value={formData.age}
            onChange={(age) => setFormData(prev => ({ ...prev, age }))}
            min={0}
            max={120}
            label={t('patient.age')}
            unit={t('common.years')}
            showDots={formData.age <= 10}
          />
        </div>
      )
    },
    {
      id: 'contact',
      title: t('patient.contact'),
      audioKey: 'patient.contact',
      isValid: formData.phone.trim(),
      component: (
        <div className="space-y-6">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <PhoneIcon className="h-6 w-6 text-primary" />
              <span>{t('patient.phone')} *</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              className="input-field text-xl"
              placeholder="08012345678"
            />
            <p className="text-sm text-gray-600 mt-2">
              {t('simple.phoneExample')}
            </p>
          </div>
          
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <MapPinIcon className="h-6 w-6 text-primary" />
              <span>{t('patient.address')}</span>
            </label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
              className="input-field text-lg"
              rows={3}
              placeholder={t('simple.enterAddress')}
            />
          </div>
        </div>
      )
    },
    {
      id: 'location',
      title: t('patient.location'),
      audioKey: 'patient.location',
      isValid: formData.state && formData.lga,
      component: (
        <div className="space-y-6">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3">
              {t('patient.state')} *
            </label>
            <select
              value={formData.state}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, state: e.target.value, lga: '' }))
              }}
              className="input-field text-xl"
            >
              <option value="">{t('simple.selectState')}</option>
              {NIGERIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3">
              {t('patient.lga')} *
            </label>
            <select
              value={formData.lga}
              onChange={(e) => setFormData(prev => ({ ...prev, lga: e.target.value }))}
              className="input-field text-xl"
              disabled={!formData.state}
            >
              <option value="">{t('simple.selectLGA')}</option>
              {(LGAS_BY_STATE[formData.state] || []).map((lga) => (
                <option key={lga} value={lga}>
                  {lga}
                </option>
              ))}
            </select>
          </div>
        </div>
      )
    }
  ]

  return (
    <StepperForm
      steps={steps}
      onComplete={handleComplete}
      onCancel={onCancel}
      className={className}
    />
  )
}
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/hooks/useT'
import { SimplePatientForm } from '@/components/SimplePatientForm'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

export function SimpleRegister() {
  const { t } = useT()
  const navigate = useNavigate()

  const handleSuccess = (patientId: string) => {
    navigate('/', { 
      state: { 
        message: t('patient.registrationSuccess'),
        patientId 
      }
    })
  }

  const handleCancel = () => {
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <button
            onClick={() => navigate('/')}
            className="p-3 rounded-lg hover:bg-gray-100 transition-colors touch-target-large"
          >
            <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {t('patient.register')}
            </h1>
            <p className="text-lg text-gray-600">
              {t('simple.registerDescription')}
            </p>
          </div>
        </div>

        {/* Form */}
        <SimplePatientForm 
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}
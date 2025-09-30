import React from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientForm } from '@/components/PatientForm'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

export function Register() {
  const navigate = useNavigate()

  const handleSuccess = (patientId: string) => {
    // Navigate to patient details or back to dashboard
    navigate('/', { 
      state: { 
        message: 'Patient registered successfully!',
        patientId 
      }
    })
  }

  const handleCancel = () => {
    navigate('/')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        >
          <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Registration</h1>
          <p className="text-gray-600">Register a new patient for today's clinic</p>
        </div>
      </div>

      {/* Form */}
      <PatientForm 
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}
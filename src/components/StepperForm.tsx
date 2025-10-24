import React, { useState } from 'react'
import { useT } from '@/hooks/useT'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon, 
  CheckIcon,
  SpeakerWaveIcon 
} from '@heroicons/react/24/outline'

interface StepperFormProps {
  steps: Array<{
    id: string
    title: string
    component: React.ReactNode
    isValid?: boolean
    audioKey?: string
  }>
  onComplete: () => void
  onCancel?: () => void
  className?: string
}

export function StepperForm({ 
  steps, 
  onComplete, 
  onCancel, 
  className = '' 
}: StepperFormProps) {
  const { t, speak } = useT()
  const [currentStep, setCurrentStep] = useState(0)

  const canGoNext = currentStep < steps.length - 1
  const canGoPrev = currentStep > 0
  const isLastStep = currentStep === steps.length - 1
  const currentStepData = steps[currentStep]

  const handleNext = async () => {
    if (isLastStep) {
      onComplete()
    } else {
      setCurrentStep(currentStep + 1)
      
      // Play audio for next step
      const nextStep = steps[currentStep + 1]
      if (nextStep.audioKey) {
        try {
          await speak(nextStep.audioKey as any)
        } catch (error) {
          console.warn('Audio playback failed:', error)
        }
      }
    }
  }

  const handlePrev = () => {
    if (canGoPrev) {
      setCurrentStep(currentStep - 1)
    }
  }

  const playStepAudio = async () => {
    if (currentStepData.audioKey) {
      try {
        await speak(currentStepData.audioKey as any)
      } catch (error) {
        console.warn('Audio playback failed:', error)
      }
    }
  }

  return (
    <div className={`max-w-2xl mx-auto ${className}`}>
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-gray-600">
            {t('stepper.step')} {currentStep + 1} {t('common.of')} {steps.length}
          </span>
          <span className="text-sm text-gray-500">
            {Math.round(((currentStep + 1) / steps.length) * 100)}%
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div 
            className="bg-primary h-3 rounded-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
        
        <div className="flex justify-between mt-2">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                index < currentStep
                  ? 'bg-green-500 text-white'
                  : index === currentStep
                  ? 'bg-primary text-white'
                  : 'bg-gray-300 text-gray-600'
              }`}
            >
              {index < currentStep ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center space-x-3 mb-2">
          <h2 className="text-2xl font-bold text-gray-900">
            {currentStepData.title}
          </h2>
          {currentStepData.audioKey && (
            <button
              onClick={playStepAudio}
              className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors touch-target"
              title={t('accessibility.playAudio')}
            >
              <SpeakerWaveIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Step Content */}
      <div className="card mb-8">
        {currentStepData.component}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button
          onClick={handlePrev}
          disabled={!canGoPrev}
          className="btn-secondary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          <span>{t('action.back')}</span>
        </button>

        <div className="flex space-x-4">
          {onCancel && (
            <button
              onClick={onCancel}
              className="btn-secondary"
            >
              {t('action.cancel')}
            </button>
          )}
          
          <button
            onClick={handleNext}
            disabled={currentStepData.isValid === false}
            className="btn-primary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {isLastStep ? t('action.complete') : t('action.next')}
            </span>
            {!isLastStep && <ChevronRightIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
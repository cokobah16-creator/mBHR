import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/hooks/useT'
import { useAuthStore } from '@/stores/auth'
import { db, generateId } from '@/db'
import { usePatientsStore } from '@/stores/patients'
import { 
  ExclamationTriangleIcon,
  UserIcon,
  HeartIcon,
  ClockIcon,
  FireIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

interface QuickTriageProps {
  patientId?: string
  onComplete?: (priority: 'urgent' | 'normal' | 'low', queueStage: string) => void
  onCancel?: () => void
}

export default function QuickTriage({ patientId, onComplete, onCancel }: QuickTriageProps) {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()
  const [selectedPriority, setSelectedPriority] = useState<'urgent' | 'normal' | 'low' | null>(null)
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [abcAssessment, setAbcAssessment] = useState({
    airway: 'clear',
    breathing: 'normal',
    circulation: 'normal'
  })
  const [vitalSigns, setVitalSigns] = useState({
    conscious: true,
    responsive: true,
    skinColor: 'normal',
    temperature: 'normal'
  })
  const [loading, setLoading] = useState(false)

  const priorityOptions = [
    {
      value: 'urgent',
      label: t('triage.priority.urgent'),
      description: 'Immediate attention required',
      color: 'bg-red-500 hover:bg-red-600 text-white',
      icon: '🚨',
      examples: ['Chest pain', 'Difficulty breathing', 'Unconscious', 'Severe bleeding']
    },
    {
      value: 'normal',
      label: t('triage.priority.normal'),
      description: 'Standard care pathway',
      color: 'bg-yellow-500 hover:bg-yellow-600 text-white',
      icon: '⚠️',
      examples: ['Fever', 'Cough', 'Minor injuries', 'Routine check-up']
    },
    {
      value: 'low',
      label: t('triage.priority.low'),
      description: 'Can wait for routine care',
      color: 'bg-green-500 hover:bg-green-600 text-white',
      icon: '✅',
      examples: ['Minor cuts', 'Prescription refills', 'Health education']
    }
  ]

  const abcOptions = {
    airway: [
      { value: 'clear', label: 'Clear', safe: true },
      { value: 'partial', label: 'Partially obstructed', safe: false },
      { value: 'obstructed', label: 'Obstructed', safe: false }
    ],
    breathing: [
      { value: 'normal', label: 'Normal', safe: true },
      { value: 'labored', label: 'Labored', safe: false },
      { value: 'absent', label: 'Absent/Minimal', safe: false }
    ],
    circulation: [
      { value: 'normal', label: 'Normal pulse', safe: true },
      { value: 'weak', label: 'Weak pulse', safe: false },
      { value: 'absent', label: 'No pulse', safe: false }
    ]
  }

  const calculateSuggestedPriority = (): 'urgent' | 'normal' | 'low' => {
    // ABC assessment takes priority
    if (abcAssessment.airway !== 'clear' || 
        abcAssessment.breathing !== 'normal' || 
        abcAssessment.circulation !== 'normal') {
      return 'urgent'
    }

    // Consciousness check
    if (!vitalSigns.conscious || !vitalSigns.responsive) {
      return 'urgent'
    }

    // Temperature check
    if (vitalSigns.temperature === 'high') {
      return 'normal'
    }

    // Skin color check
    if (vitalSigns.skinColor !== 'normal') {
      return 'urgent'
    }

    // Chief complaint keywords
    const urgentKeywords = ['chest pain', 'difficulty breathing', 'severe pain', 'bleeding', 'unconscious']
    const complaint = chiefComplaint.toLowerCase()
    if (urgentKeywords.some(keyword => complaint.includes(keyword))) {
      return 'urgent'
    }

    return 'normal'
  }

  const suggestedPriority = calculateSuggestedPriority()

  const handleSubmit = async () => {
    if (!selectedPriority || !currentUser) return

    setLoading(true)
    try {
      // Create triage record
      const triageRecord = {
        id: generateId(),
        patientId: patientId || 'walk-in',
        assessedBy: currentUser.id,
        priority: selectedPriority,
        chiefComplaint,
        abcAssessment: JSON.stringify(abcAssessment),
        vitalSigns: JSON.stringify(vitalSigns),
        suggestedPriority,
        overriddenPriority: selectedPriority !== suggestedPriority,
        createdAt: new Date(),
        _dirty: 1
      }

      // Store in triage samples for training data
      await db.triageSamples.add({
        id: generateId(),
        createdAt: new Date(),
        caseHash: btoa(JSON.stringify({ chiefComplaint, abcAssessment, vitalSigns })),
        goldPriority: selectedPriority,
        createdBy: currentUser.id
      })

      // Determine next queue stage based on priority
      let queueStage = 'vitals'
      if (selectedPriority === 'urgent') {
        queueStage = 'consult' // Skip vitals for urgent cases
      }

      onComplete?.(selectedPriority, queueStage)
    } catch (error) {
      console.error('Error saving triage assessment:', error)
      alert('Failed to save triage assessment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <ExclamationTriangleIcon className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Quick Triage Assessment</h2>
          <p className="text-gray-600">Rapid priority assessment for patient flow</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assessment Form */}
        <div className="space-y-6">
          {/* Chief Complaint */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Chief Complaint</h3>
            <textarea
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              className="input-field"
              rows={3}
              placeholder="What is the main problem? (e.g., chest pain, fever, cough)"
            />
          </div>

          {/* ABC Assessment */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">ABC Assessment</h3>
            <div className="space-y-4">
              {Object.entries(abcOptions).map(([category, options]) => (
                <div key={category}>
                  <label className="block text-sm font-medium text-gray-700 mb-2 capitalize">
                    {category}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {options.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setAbcAssessment(prev => ({ ...prev, [category]: option.value }))}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          abcAssessment[category as keyof typeof abcAssessment] === option.value
                            ? option.safe
                              ? 'border-green-300 bg-green-50 text-green-800'
                              : 'border-red-300 bg-red-50 text-red-800'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <div className={`w-3 h-3 rounded-full ${option.safe ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className="font-medium">{option.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Vitals */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Vital Assessment</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Conscious</label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setVitalSigns(prev => ({ ...prev, conscious: true }))}
                      className={`flex-1 p-2 rounded-lg border ${
                        vitalSigns.conscious 
                          ? 'border-green-300 bg-green-50 text-green-800' 
                          : 'border-gray-200'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setVitalSigns(prev => ({ ...prev, conscious: false }))}
                      className={`flex-1 p-2 rounded-lg border ${
                        !vitalSigns.conscious 
                          ? 'border-red-300 bg-red-50 text-red-800' 
                          : 'border-gray-200'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Responsive</label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setVitalSigns(prev => ({ ...prev, responsive: true }))}
                      className={`flex-1 p-2 rounded-lg border ${
                        vitalSigns.responsive 
                          ? 'border-green-300 bg-green-50 text-green-800' 
                          : 'border-gray-200'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setVitalSigns(prev => ({ ...prev, responsive: false }))}
                      className={`flex-1 p-2 rounded-lg border ${
                        !vitalSigns.responsive 
                          ? 'border-red-300 bg-red-50 text-red-800' 
                          : 'border-gray-200'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Skin Color</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'normal', label: 'Normal', safe: true },
                    { value: 'pale', label: 'Pale', safe: false },
                    { value: 'cyanotic', label: 'Blue/Gray', safe: false }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setVitalSigns(prev => ({ ...prev, skinColor: option.value }))}
                      className={`p-2 rounded-lg border text-center ${
                        vitalSigns.skinColor === option.value
                          ? option.safe
                            ? 'border-green-300 bg-green-50 text-green-800'
                            : 'border-red-300 bg-red-50 text-red-800'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Priority Selection */}
        <div className="space-y-6">
          {/* AI Suggestion */}
          <div className="card bg-blue-50 border-blue-200">
            <div className="flex items-center space-x-2 mb-3">
              <HeartIcon className="h-5 w-5 text-blue-600" />
              <h3 className="font-medium text-blue-800">AI Suggestion</h3>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-2xl">
                {suggestedPriority === 'urgent' ? '🚨' : 
                 suggestedPriority === 'normal' ? '⚠️' : '✅'}
              </div>
              <div>
                <div className="font-medium text-blue-800 capitalize">
                  {suggestedPriority} Priority
                </div>
                <div className="text-sm text-blue-600">
                  Based on ABC assessment and symptoms
                </div>
              </div>
            </div>
          </div>

          {/* Priority Selection */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Assign Priority</h3>
            <div className="space-y-4">
              {priorityOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSelectedPriority(option.value as any)}
                  className={`w-full p-4 rounded-xl border-2 transition-all touch-target-large ${
                    selectedPriority === option.value
                      ? `${option.color} ring-2 ring-primary/20`
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="text-3xl">{option.icon}</div>
                    <div className="text-left flex-1">
                      <div className="text-lg font-bold">{option.label}</div>
                      <div className="text-sm opacity-90">{option.description}</div>
                      <div className="text-xs opacity-75 mt-1">
                        Examples: {option.examples.slice(0, 2).join(', ')}
                      </div>
                    </div>
                    {selectedPriority === option.value && (
                      <CheckCircleIcon className="h-6 w-6" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Priority Override Warning */}
          {selectedPriority && selectedPriority !== suggestedPriority && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                <div>
                  <h4 className="font-medium text-yellow-800">Priority Override</h4>
                  <p className="text-sm text-yellow-700">
                    You selected {selectedPriority} but AI suggests {suggestedPriority}. 
                    Please confirm your clinical judgment.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-4">
            <button
              onClick={handleSubmit}
              disabled={!selectedPriority || loading}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Complete Triage'}
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="btn-secondary"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
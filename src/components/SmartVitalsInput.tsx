import { useState, useEffect } from 'react'
import { clinicalDecisionSupport } from '@/services/clinicalDecisionSupport'
import type { VitalsAnalysis } from '@/services/clinicalDecisionSupport'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline'

interface SmartVitalsInputProps {
  vitals: {
    heightCm?: number
    weightKg?: number
    tempC?: number
    pulseBpm?: number
    systolic?: number
    diastolic?: number
    spo2?: number
    bmi?: number
  }
  onChange: (field: string, value: number) => void
}

export function SmartVitalsInput({ vitals, onChange }: SmartVitalsInputProps) {
  const [analysis, setAnalysis] = useState<VitalsAnalysis | null>(null)

  useEffect(() => {
    if (hasAnyVitals()) {
      analyzeVitals()
    }
  }, [vitals])

  const hasAnyVitals = () => {
    return Object.values(vitals).some(v => v !== undefined && v > 0)
  }

  const analyzeVitals = () => {
    const result = clinicalDecisionSupport.analyzeVitals(vitals)
    setAnalysis(result)
  }

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-50 border-red-300 text-red-900'
      case 'high': return 'bg-orange-50 border-orange-300 text-orange-900'
      case 'moderate': return 'bg-yellow-50 border-yellow-300 text-yellow-900'
      case 'low': return 'bg-green-50 border-green-300 text-green-900'
      default: return 'bg-gray-50 border-gray-300 text-gray-900'
    }
  }

  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'critical':
      case 'high':
        return <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
      case 'moderate':
        return <InformationCircleIcon className="h-5 w-5 text-yellow-600" />
      case 'low':
        return <CheckCircleIcon className="h-5 w-5 text-green-600" />
      default:
        return <InformationCircleIcon className="h-5 w-5 text-gray-600" />
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Height (cm)
          </label>
          <input
            type="number"
            value={vitals.heightCm || ''}
            onChange={(e) => onChange('heightCm', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 170"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Weight (kg)
          </label>
          <input
            type="number"
            value={vitals.weightKg || ''}
            onChange={(e) => onChange('weightKg', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 70"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Temperature (°C)
          </label>
          <input
            type="number"
            step="0.1"
            value={vitals.tempC || ''}
            onChange={(e) => onChange('tempC', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 37.0"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pulse (bpm)
          </label>
          <input
            type="number"
            value={vitals.pulseBpm || ''}
            onChange={(e) => onChange('pulseBpm', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 80"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Blood Pressure - Systolic
          </label>
          <input
            type="number"
            value={vitals.systolic || ''}
            onChange={(e) => onChange('systolic', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 120"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Blood Pressure - Diastolic
          </label>
          <input
            type="number"
            value={vitals.diastolic || ''}
            onChange={(e) => onChange('diastolic', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 80"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            SpO2 (%)
          </label>
          <input
            type="number"
            value={vitals.spo2 || ''}
            onChange={(e) => onChange('spo2', parseFloat(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 98"
          />
        </div>

        {vitals.bmi && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              BMI (calculated)
            </label>
            <div className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-gray-700">
              {vitals.bmi.toFixed(1)}
            </div>
          </div>
        )}
      </div>

      {analysis && hasAnyVitals() && (
        <div className={`rounded-lg border p-4 ${getRiskLevelColor(analysis.riskLevel)}`}>
          <div className="flex items-start gap-3">
            {getRiskIcon(analysis.riskLevel)}
            <div className="flex-1">
              <h4 className="font-semibold mb-2 capitalize">
                {analysis.riskLevel} Risk Level
                <span className="ml-2 text-sm font-normal">
                  (Score: {analysis.score})
                </span>
              </h4>

              {analysis.urgentFlags.length > 0 && (
                <div className="mb-3 p-3 bg-red-100 border border-red-300 rounded-md">
                  <p className="font-semibold text-red-900 mb-1">URGENT:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.urgentFlags.map((flag, idx) => (
                      <li key={idx} className="text-sm text-red-800">{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.concerns.length > 0 && (
                <div className="mb-3">
                  <p className="font-medium mb-1">Concerns Identified:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.concerns.map((concern, idx) => (
                      <li key={idx} className="text-sm">{concern}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.recommendations.length > 0 && (
                <div>
                  <p className="font-medium mb-1">Recommendations:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.recommendations.map((rec, idx) => (
                      <li key={idx} className="text-sm">{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.concerns.length === 0 && analysis.urgentFlags.length === 0 && (
                <p className="text-sm">All vital signs appear within normal ranges.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

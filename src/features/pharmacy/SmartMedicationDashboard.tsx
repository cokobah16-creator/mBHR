import { useState } from 'react'
import { smartMedication } from '@/services/smartMedication'
import type { MedicationReview } from '@/services/smartMedication'
import {
  ShieldExclamationIcon,
  BeakerIcon,
  CalculatorIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

export function SmartMedicationDashboard() {
  const [patientId, setPatientId] = useState('')
  const [medications, setMedications] = useState('')
  const [review, setReview] = useState<MedicationReview | null>(null)
  const [loading, setLoading] = useState(false)

  const performReview = async () => {
    if (!patientId || !medications) return

    setLoading(true)
    try {
      const medList = medications.split(',').map(m => m.trim()).filter(Boolean)
      const result = await smartMedication.performMedicationReview(patientId, medList)
      setReview(result)
    } catch (error) {
      console.error('Medication review failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'danger': return 'bg-red-500'
      case 'warning': return 'bg-orange-500'
      case 'caution': return 'bg-yellow-500'
      default: return 'bg-green-500'
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-red-600 bg-red-50'
      case 'major': return 'border-orange-600 bg-orange-50'
      case 'moderate': return 'border-yellow-600 bg-yellow-50'
      default: return 'border-blue-600 bg-blue-50'
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <BeakerIcon className="h-7 w-7 text-blue-600" />
          Smart Medication Management
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Patient ID
            </label>
            <input
              type="text"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Enter patient ID"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Medications (comma-separated)
            </label>
            <input
              type="text"
              value={medications}
              onChange={(e) => setMedications(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="paracetamol, amoxicillin, ibuprofen"
            />
          </div>
        </div>

        <button
          onClick={performReview}
          disabled={loading || !patientId || !medications}
          className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Analyzing...' : 'Perform Safety Review'}
        </button>
      </div>

      {review && (
        <>
          <div className={`rounded-lg shadow-sm p-6 border-l-4 ${getRiskColor(review.overallRisk)} bg-white`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Overall Risk Assessment</h3>
              <span className={`px-3 py-1 rounded-full text-white text-sm font-medium uppercase ${getRiskColor(review.overallRisk)}`}>
                {review.overallRisk}
              </span>
            </div>

            <div className="space-y-2">
              {review.recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  {rec.includes('✓') ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  )}
                  <p className="text-sm text-gray-700">{rec}</p>
                </div>
              ))}
            </div>
          </div>

          {review.allergyConflicts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-red-900 mb-4 flex items-center gap-2">
                <ShieldExclamationIcon className="h-6 w-6" />
                Allergy Conflicts Detected
              </h3>

              <div className="space-y-4">
                {review.allergyConflicts.map((conflict, idx) => (
                  <div key={idx} className="bg-white border border-red-300 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-red-900">{conflict.allergyType} Allergy</p>
                        <p className="text-sm text-red-700 mt-1">{conflict.recommendation}</p>
                      </div>
                      <span className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium uppercase">
                        {conflict.severity}
                      </span>
                    </div>

                    {conflict.alternatives.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-red-200">
                        <p className="text-sm font-medium text-gray-700 mb-1">Alternative Medications:</p>
                        <div className="flex flex-wrap gap-2">
                          {conflict.alternatives.map((alt, i) => (
                            <span key={i} className="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-medium">
                              {alt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {review.interactions.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <BeakerIcon className="h-6 w-6 text-blue-600" />
                Drug Interactions ({review.interactions.length})
              </h3>

              <div className="space-y-3">
                {review.interactions.map((interaction, idx) => (
                  <div key={idx} className={`border-l-4 rounded-lg p-4 ${getSeverityColor(interaction.severity)}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {interaction.drug1} ↔ {interaction.drug2}
                        </p>
                        <p className="text-sm text-gray-700 mt-1">{interaction.description}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-white text-xs font-medium uppercase ${
                        interaction.severity === 'critical' ? 'bg-red-600' :
                        interaction.severity === 'major' ? 'bg-orange-600' :
                        interaction.severity === 'moderate' ? 'bg-yellow-600' :
                        'bg-blue-600'
                      }`}>
                        {interaction.severity}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <p className="text-sm font-medium text-gray-700">Recommendation:</p>
                      <p className="text-sm text-gray-600 mt-1">{interaction.recommendation}</p>
                    </div>

                    <div className="mt-2 flex gap-2">
                      {interaction.references.map((ref, i) => (
                        <span key={i} className="text-xs text-gray-500">
                          Ref: {ref}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ChartBarIcon className="h-6 w-6 text-blue-600" />
                Adherence Prediction
              </h3>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Adherence Score</span>
                  <span className="text-2xl font-bold text-gray-900">{review.adherencePrediction.score}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${
                      review.adherencePrediction.score >= 70 ? 'bg-green-500' :
                      review.adherencePrediction.score >= 50 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${review.adherencePrediction.score}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-600 mt-1 capitalize">
                  Likelihood: {review.adherencePrediction.likelihood.replace('-', ' ')}
                </p>
              </div>

              {review.adherencePrediction.riskFactors.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Risk Factors:</p>
                  <ul className="space-y-1">
                    {review.adherencePrediction.riskFactors.map((factor, i) => (
                      <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                        <span className="text-orange-600">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {review.adherencePrediction.supportStrategies.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Support Strategies:</p>
                  <ul className="space-y-1">
                    {review.adherencePrediction.supportStrategies.map((strategy, i) => (
                      <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                        <span className="text-blue-600">✓</span>
                        <span>{strategy}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ClockIcon className="h-6 w-6 text-blue-600" />
                Medication List
              </h3>

              <div className="space-y-2">
                {review.medications.map((med, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-900 capitalize">{med}</span>
                    <span className="text-sm text-gray-600">#{idx + 1}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-gray-600">
                  Total medications: <span className="font-semibold">{review.medications.length}</span>
                </p>
                {review.medications.length > 5 && (
                  <p className="text-sm text-orange-600 mt-1">
                    ⚠️ Polypharmacy detected - consider medication review
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CalculatorIcon className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-medium mb-1">Smart Medication Safety System</p>
                <p className="text-blue-800">
                  This AI-powered system checks for drug interactions, allergy conflicts, appropriate dosing,
                  and predicts medication adherence. All checks run completely offline using clinical guidelines
                  from BNF, Micromedex, and WHO Essential Medicines List.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

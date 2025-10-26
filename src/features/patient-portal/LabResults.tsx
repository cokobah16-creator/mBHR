import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as logger from '@/lib/logger'
import { formatNigerianDate } from '@/utils/dateFormat'
import { BeakerIcon, DocumentArrowDownIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline'

interface LabResult {
  id: string
  test_name: string
  test_type: string
  result_value: string
  unit: string
  reference_range: string
  status: 'pending' | 'completed' | 'reviewed'
  ordered_date: string
  result_date?: string
  notes?: string
  abnormal: boolean
}

export function LabResults() {
  const [results, setResults] = useState<LabResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedResult, setSelectedResult] = useState<LabResult | null>(null)

  useEffect(() => {
    loadLabResults()
  }, [])

  const loadLabResults = async () => {
    setLoading(true)
    setError('')

    try {
      const portalUserStr = localStorage.getItem('patient_portal_user')
      if (!portalUserStr) {
        window.location.href = '/patient/login'
        return
      }

      const portalUser = JSON.parse(portalUserStr)

      const { data, error: resultsError } = await supabase
        .from('patient_lab_results')
        .select('*')
        .eq('patient_id', portalUser.patientId)
        .order('ordered_date', { ascending: false })

      if (resultsError) throw resultsError

      setResults(data || [])
    } catch (err) {
      logger.error('Error loading lab results:', err)
      setError('Failed to load lab results')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading lab results...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Lab Results</h1>
          <p className="mt-2 text-gray-600">View your test results and lab reports</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {selectedResult ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <button
              onClick={() => setSelectedResult(null)}
              className="mb-4 text-blue-600 hover:text-blue-800"
            >
              ← Back to all results
            </button>

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{selectedResult.test_name}</h2>
                <p className="text-gray-600">{selectedResult.test_type}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="font-medium capitalize">{selectedResult.status}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Ordered Date</p>
                  <p className="font-medium">{formatNigerianDate(selectedResult.ordered_date)}</p>
                </div>
                {selectedResult.result_date && (
                  <div>
                    <p className="text-sm text-gray-600">Result Date</p>
                    <p className="font-medium">{formatNigerianDate(selectedResult.result_date)}</p>
                  </div>
                )}
              </div>

              {selectedResult.status === 'completed' && (
                <div className={`p-4 rounded-lg ${selectedResult.abnormal ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Result</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {selectedResult.result_value} {selectedResult.unit}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        Reference Range: {selectedResult.reference_range}
                      </p>
                    </div>
                    {selectedResult.abnormal && (
                      <span className="px-2 py-1 bg-yellow-200 text-yellow-800 text-xs font-medium rounded">
                        Abnormal
                      </span>
                    )}
                  </div>
                </div>
              )}

              {selectedResult.notes && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Notes</p>
                  <p className="text-gray-900">{selectedResult.notes}</p>
                </div>
              )}

              {selectedResult.abnormal && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Important:</strong> This result is outside the normal range. Please
                    contact your healthcare provider to discuss these results.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {results.length === 0 ? (
              <div className="p-12 text-center">
                <BeakerIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No lab results</h3>
                <p className="text-gray-600">Your lab results will appear here once available</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => setSelectedResult(result)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{result.test_name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{result.test_type}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                            {result.status === 'completed' ? (
                              <CheckCircleIcon className="h-4 w-4 text-green-600" />
                            ) : (
                              <ClockIcon className="h-4 w-4 text-yellow-600" />
                            )}
                            {result.status}
                          </span>
                          {result.abnormal && (
                            <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs font-medium rounded">
                              Abnormal
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                        {formatNigerianDate(result.ordered_date)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

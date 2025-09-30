import React, { useState, useEffect } from 'react'
import { useT } from '@/hooks/useT'
import { useAuthStore } from '@/stores/auth'
import { db, generateId } from '@/db'
import { VisualNumberInput } from '@/components/VisualNumberInput'
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from '@/utils/vitals'
import { 
  HeartIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline'

interface VitalsRange {
  metric: string
  min: number
  max: number
  unit: string
}

interface EnhancedVitalsFormProps {
  patientId: string
  visitId: string
  patientAge: number
  patientSex: 'M' | 'F' | 'U'
  onSuccess?: () => void
  onCancel?: () => void
}

export default function EnhancedVitalsForm({ 
  patientId, 
  visitId, 
  patientAge, 
  patientSex, 
  onSuccess, 
  onCancel 
}: EnhancedVitalsFormProps) {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const [vitals, setVitals] = useState({
    heightCm: 0,
    weightKg: 0,
    tempC: 36.5,
    pulseBpm: 72,
    systolic: 120,
    diastolic: 80,
    spo2: 98
  })
  const [ranges, setRanges] = useState<Record<string, VitalsRange>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [bmi, setBmi] = useState<number | null>(null)
  const [flags, setFlags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadVitalsRanges()
  }, [patientAge, patientSex])

  useEffect(() => {
    validateVitals()
    calculateBMIAndFlags()
  }, [vitals, ranges])

  const loadVitalsRanges = async () => {
    try {
      // Load age/sex-specific ranges from database
      const vitalsRanges = await db.vitalsRanges
        .where('sex')
        .equals(patientSex)
        .and(range => patientAge >= range.ageMin && patientAge <= range.ageMax)
        .toArray()

      const rangeMap: Record<string, VitalsRange> = {}
      vitalsRanges.forEach(range => {
        rangeMap[range.metric] = {
          metric: range.metric,
          min: range.min,
          max: range.max,
          unit: getMetricUnit(range.metric)
        }
      })

      // Fallback to adult ranges if no specific ranges found
      if (Object.keys(rangeMap).length === 0) {
        rangeMap.hr = { metric: 'hr', min: 60, max: 100, unit: 'bpm' }
        rangeMap.temp = { metric: 'temp', min: 36.1, max: 37.2, unit: '°C' }
        rangeMap.sbp = { metric: 'sbp', min: 90, max: 140, unit: 'mmHg' }
        rangeMap.dbp = { metric: 'dbp', min: 60, max: 90, unit: 'mmHg' }
        rangeMap.rr = { metric: 'rr', min: 12, max: 20, unit: '/min' }
        rangeMap.spo2 = { metric: 'spo2', min: 95, max: 100, unit: '%' }
      }

      setRanges(rangeMap)
    } catch (error) {
      console.error('Error loading vitals ranges:', error)
    }
  }

  const getMetricUnit = (metric: string): string => {
    const units = {
      hr: 'bpm',
      temp: '°C',
      sbp: 'mmHg',
      dbp: 'mmHg',
      rr: '/min',
      spo2: '%'
    }
    return units[metric as keyof typeof units] || ''
  }

  const validateVitals = () => {
    const newWarnings: string[] = []

    // Check each vital against normal ranges
    Object.entries(vitals).forEach(([key, value]) => {
      if (value <= 0) return

      let metric = key
      if (key === 'pulseBpm') metric = 'hr'
      if (key === 'tempC') metric = 'temp'

      const range = ranges[metric]
      if (range && (value < range.min || value > range.max)) {
        const status = value < range.min ? 'low' : 'high'
        newWarnings.push(`${range.metric.toUpperCase()} ${status}: ${value} (normal: ${range.min}-${range.max})`)
      }
    })

    // Special validations
    if (vitals.systolic > 0 && vitals.diastolic > 0 && vitals.systolic <= vitals.diastolic) {
      newWarnings.push('Systolic pressure should be higher than diastolic')
    }

    if (vitals.heightCm > 0 && vitals.heightCm < 50) {
      newWarnings.push('Height seems unusually low - please verify')
    }

    if (vitals.weightKg > 0 && vitals.weightKg < 2) {
      newWarnings.push('Weight seems unusually low - please verify')
    }

    setWarnings(newWarnings)
  }

  const calculateBMIAndFlags = () => {
    let calculatedBmi = null
    if (vitals.heightCm > 0 && vitals.weightKg > 0) {
      calculatedBmi = calculateBMI(vitals.heightCm, vitals.weightKg)
      setBmi(calculatedBmi)
    } else {
      setBmi(null)
    }

    const vitalsForFlagging = {
      systolic: vitals.systolic,
      diastolic: vitals.diastolic,
      tempC: vitals.tempC,
      pulseBpm: vitals.pulseBpm,
      bmi: calculatedBmi || undefined
    }

    const newFlags = flagVitals(vitalsForFlagging)
    setFlags(newFlags)
  }

  const handleSubmit = async () => {
    if (warnings.length > 0) {
      const proceed = confirm(
        `There are ${warnings.length} warnings about these vitals. Do you want to proceed?\n\n${warnings.join('\n')}`
      )
      if (!proceed) return
    }

    setLoading(true)
    try {
      const vital = {
        id: generateId(),
        patientId,
        visitId,
        heightCm: vitals.heightCm || undefined,
        weightKg: vitals.weightKg || undefined,
        tempC: vitals.tempC || undefined,
        pulseBpm: vitals.pulseBpm || undefined,
        systolic: vitals.systolic || undefined,
        diastolic: vitals.diastolic || undefined,
        spo2: vitals.spo2 || undefined,
        bmi: bmi || undefined,
        flags,
        takenAt: new Date(),
        _dirty: 1
      }

      await db.vitals.add(vital)

      // Create audit log
      await db.auditLogs.add({
        id: generateId(),
        actorRole: currentUser?.role || 'unknown',
        action: 'create',
        entity: 'vital',
        entityId: vital.id,
        at: new Date()
      })

      onSuccess?.()
    } catch (error) {
      console.error('Error saving vitals:', error)
      alert('Failed to save vitals')
    } finally {
      setLoading(false)
    }
  }

  const getVitalStatus = (key: string, value: number) => {
    if (value <= 0) return null

    let metric = key
    if (key === 'pulseBpm') metric = 'hr'
    if (key === 'tempC') metric = 'temp'

    const range = ranges[metric]
    if (!range) return null

    if (value < range.min) return 'low'
    if (value > range.max) return 'high'
    return 'normal'
  }

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'low':
        return 'text-blue-600 bg-blue-50'
      case 'high':
        return 'text-red-600 bg-red-50'
      case 'normal':
        return 'text-green-600 bg-green-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <HeartIcon className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Enhanced Vitals Recording</h2>
          <p className="text-gray-600">
            Age: {patientAge} years • Sex: {patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vitals Input */}
        <div className="space-y-6">
          {/* Height and Weight */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Anthropometric</h3>
            <div className="space-y-6">
              <VisualNumberInput
                value={vitals.heightCm}
                onChange={(value) => setVitals(prev => ({ ...prev, heightCm: value }))}
                min={50}
                max={250}
                label={t('vitals.height')}
                unit="cm"
                showDots={false}
              />
              
              <VisualNumberInput
                value={vitals.weightKg}
                onChange={(value) => setVitals(prev => ({ ...prev, weightKg: value }))}
                min={2}
                max={200}
                label={t('vitals.weight')}
                unit="kg"
                showDots={false}
              />
            </div>
          </div>

          {/* Vital Signs */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Vital Signs</h3>
            <div className="space-y-6">
              <VisualNumberInput
                value={vitals.tempC}
                onChange={(value) => setVitals(prev => ({ ...prev, tempC: value }))}
                min={30}
                max={45}
                step={0.1}
                label={t('vitals.temperature')}
                unit="°C"
                showDots={false}
              />
              
              <VisualNumberInput
                value={vitals.pulseBpm}
                onChange={(value) => setVitals(prev => ({ ...prev, pulseBpm: value }))}
                min={30}
                max={200}
                label={t('vitals.pulse')}
                unit="bpm"
                showDots={false}
              />
              
              <div>
                <label className="block text-lg font-medium text-gray-700 mb-4 text-center">
                  {t('vitals.bloodPressure')}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <VisualNumberInput
                    value={vitals.systolic}
                    onChange={(value) => setVitals(prev => ({ ...prev, systolic: value }))}
                    min={60}
                    max={250}
                    label="Systolic"
                    unit="mmHg"
                    showDots={false}
                  />
                  <VisualNumberInput
                    value={vitals.diastolic}
                    onChange={(value) => setVitals(prev => ({ ...prev, diastolic: value }))}
                    min={30}
                    max={150}
                    label="Diastolic"
                    unit="mmHg"
                    showDots={false}
                  />
                </div>
              </div>
              
              <VisualNumberInput
                value={vitals.spo2}
                onChange={(value) => setVitals(prev => ({ ...prev, spo2: value }))}
                min={70}
                max={100}
                label="SpO2"
                unit="%"
                showDots={false}
              />
            </div>
          </div>
        </div>

        {/* Validation and Results */}
        <div className="space-y-6">
          {/* BMI Display */}
          {bmi && (
            <div className="card bg-blue-50 border-blue-200">
              <div className="text-center">
                <h3 className="text-lg font-medium text-blue-800 mb-2">Body Mass Index</h3>
                <div className="text-4xl font-bold text-blue-900">{bmi}</div>
                <div className="text-sm text-blue-600 mt-2">
                  {bmi < 18.5 ? 'Underweight' :
                   bmi < 25 ? 'Normal' :
                   bmi < 30 ? 'Overweight' : 'Obese'}
                </div>
              </div>
            </div>
          )}

          {/* Vital Status Indicators */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Range Validation</h3>
            <div className="space-y-3">
              {Object.entries(vitals).map(([key, value]) => {
                if (value <= 0) return null
                
                const status = getVitalStatus(key, value)
                const range = ranges[key === 'pulseBpm' ? 'hr' : key === 'tempC' ? 'temp' : key]
                
                return (
                  <div key={key} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <span className="font-medium text-gray-900">
                        {key === 'heightCm' ? 'Height' :
                         key === 'weightKg' ? 'Weight' :
                         key === 'tempC' ? 'Temperature' :
                         key === 'pulseBpm' ? 'Pulse' :
                         key === 'systolic' ? 'Systolic' :
                         key === 'diastolic' ? 'Diastolic' :
                         key === 'spo2' ? 'SpO2' : key}
                      </span>
                      <div className="text-sm text-gray-600">
                        {value} {getMetricUnit(key)}
                        {range && ` (normal: ${range.min}-${range.max})`}
                      </div>
                    </div>
                    {status && (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
                        {status}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-3">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                <h3 className="font-medium text-yellow-800">Validation Warnings</h3>
              </div>
              <ul className="text-sm text-yellow-700 space-y-1">
                {warnings.map((warning, index) => (
                  <li key={index}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Clinical Flags */}
          {flags.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-3">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                <h3 className="font-medium text-red-800">Clinical Alerts</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${getFlagColor(flag)}`}
                  >
                    {getFlagLabel(flag)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Normal Ranges Reference */}
          <div className="card bg-gray-50">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Normal Ranges</h3>
            <div className="text-sm text-gray-700 space-y-2">
              <p><strong>Age Group:</strong> {patientAge < 18 ? 'Pediatric' : 'Adult'}</p>
              <p><strong>Sex:</strong> {patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown'}</p>
              {Object.values(ranges).map(range => (
                <p key={range.metric}>
                  <strong>{range.metric.toUpperCase()}:</strong> {range.min}-{range.max} {range.unit}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <button
          onClick={handleSubmit}
          disabled={loading || Object.values(vitals).every(v => v <= 0)}
          className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Enhanced Vitals'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="btn-secondary"
          >
            {t('action.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
import React, { useState, useEffect } from 'react'
import { useFormContext } from 'react-hook-form'
import { db, VitalsRange, epochDay } from '@/db'
import { 
  HeartIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline'

interface EnhancedVitalsInputProps {
  name: string
  label: string
  unit: string
  metric: 'hr' | 'temp' | 'sbp' | 'dbp' | 'rr' | 'spo2'
  patientAge: number
  patientSex: 'M' | 'F' | 'U'
  placeholder?: string
  step?: number
}

export function EnhancedVitalsInput({
  name,
  label,
  unit,
  metric,
  patientAge,
  patientSex,
  placeholder,
  step = 1
}: EnhancedVitalsInputProps) {
  const { register, watch, formState: { errors } } = useFormContext()
  const [range, setRange] = useState<VitalsRange | null>(null)
  const [status, setStatus] = useState<'normal' | 'low' | 'high' | 'critical' | null>(null)
  const [loading, setLoading] = useState(true)

  const value = Number(watch(name)) || 0

  useEffect(() => {
    loadVitalRange()
  }, [metric, patientAge, patientSex])

  useEffect(() => {
    if (range && value > 0) {
      calculateStatus()
    } else {
      setStatus(null)
    }
  }, [value, range])

  const loadVitalRange = async () => {
    try {
      const vitalsRange = await db.vitalsRanges
        .where('metric').equals(metric)
        .and(r => r.sex === patientSex || r.sex === 'U')
        .and(r => patientAge >= r.ageMin && patientAge <= r.ageMax)
        .first()
      
      setRange(vitalsRange || null)
    } catch (error) {
      console.error('Error loading vital range:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateStatus = () => {
    if (!range || value <= 0) {
      setStatus(null)
      return
    }

    const { min, max } = range
    const criticalLow = min * 0.7  // 30% below normal
    const criticalHigh = max * 1.3 // 30% above normal

    if (value < criticalLow || value > criticalHigh) {
      setStatus('critical')
    } else if (value < min) {
      setStatus('low')
    } else if (value > max) {
      setStatus('high')
    } else {
      setStatus('normal')
    }
  }

  const getStatusDisplay = () => {
    switch (status) {
      case 'critical':
        return {
          icon: ExclamationTriangleIcon,
          color: 'text-red-700 bg-red-50 border-red-200',
          message: 'Critical value - immediate attention required',
          priority: 'high'
        }
      case 'high':
        return {
          icon: ExclamationTriangleIcon,
          color: 'text-orange-700 bg-orange-50 border-orange-200',
          message: 'Above normal - consider recheck',
          priority: 'medium'
        }
      case 'low':
        return {
          icon: ExclamationTriangleIcon,
          color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
          message: 'Below normal - verify reading',
          priority: 'medium'
        }
      case 'normal':
        return {
          icon: CheckCircleIcon,
          color: 'text-green-700 bg-green-50 border-green-200',
          message: 'Within normal range',
          priority: 'low'
        }
      default:
        return null
    }
  }

  const statusDisplay = getStatusDisplay()

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {range && !loading && (
          <span className="ml-2 text-xs text-gray-500">
            (Normal: {range.min}-{range.max} {unit})
          </span>
        )}
      </label>
      
      <div className="relative">
        <input
          {...register(name, { 
            valueAsNumber: true,
            required: `${label} is required`
          })}
          type="number"
          step={step}
          className={`input-field ${
            statusDisplay?.priority === 'high' ? 'border-red-300 ring-red-200' :
            statusDisplay?.priority === 'medium' ? 'border-yellow-300 ring-yellow-200' :
            status === 'normal' ? 'border-green-300 ring-green-200' :
            'border-gray-300'
          }`}
          placeholder={placeholder}
          aria-describedby={`${name}-status ${name}-range`}
        />
        
        {statusDisplay && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <statusDisplay.icon className={`h-5 w-5 ${
              statusDisplay.priority === 'high' ? 'text-red-600' :
              statusDisplay.priority === 'medium' ? 'text-yellow-600' :
              'text-green-600'
            }`} />
          </div>
        )}
      </div>

      {/* Status Message */}
      {statusDisplay && (
        <div 
          id={`${name}-status`}
          className={`p-2 rounded-lg border text-sm ${statusDisplay.color}`}
          role={statusDisplay.priority === 'high' ? 'alert' : 'status'}
          aria-live={statusDisplay.priority === 'high' ? 'assertive' : 'polite'}
        >
          <div className="flex items-center space-x-2">
            <statusDisplay.icon className="h-4 w-4" />
            <span>{statusDisplay.message}</span>
          </div>
        </div>
      )}

      {/* Range Info */}
      {range && !loading && (
        <p id={`${name}-range`} className="text-xs text-gray-500">
          Age {patientAge}, {patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown'} • 
          Source: {range.source}
        </p>
      )}

      {/* Validation Error */}
      {errors[name] && (
        <p className="text-red-600 text-sm" role="alert">
          {errors[name]?.message}
        </p>
      )}
    </div>
  )
}
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BeakerIcon } from '@heroicons/react/24/outline'
import { createLabOrder } from '@/services/labs'
import { useToast } from '@/stores/toast'

const labOrderSchema = z.object({
  testName: z.string().min(1, 'Test name is required'),
  testCode: z.string().optional(),
  priority: z.enum(['routine', 'urgent', 'stat']),
  notes: z.string().optional(),
})

type LabOrderFormData = z.infer<typeof labOrderSchema>

interface LabOrderFormProps {
  patientId: string
  visitId?: string
  orderedBy: string
  onSuccess?: () => void
  onCancel?: () => void
}

const commonTests = [
  { name: 'Complete Blood Count (CBC)', code: 'CBC' },
  { name: 'Basic Metabolic Panel', code: 'BMP' },
  { name: 'Comprehensive Metabolic Panel', code: 'CMP' },
  { name: 'Lipid Panel', code: 'LIPID' },
  { name: 'Hemoglobin A1C', code: 'HBA1C' },
  { name: 'Thyroid Stimulating Hormone', code: 'TSH' },
  { name: 'Urinalysis', code: 'UA' },
  { name: 'Blood Glucose', code: 'GLUCOSE' },
  { name: 'Liver Function Tests', code: 'LFT' },
  { name: 'Kidney Function Tests', code: 'RFT' },
  { name: 'HIV Test', code: 'HIV' },
  { name: 'Hepatitis B Surface Antigen', code: 'HBSAG' },
  { name: 'Malaria Rapid Test', code: 'MRDTrunc' },
  { name: 'Pregnancy Test', code: 'PREG' },
  { name: 'Stool Analysis', code: 'STOOL' },
]

export function LabOrderForm({ patientId, visitId, orderedBy, onSuccess, onCancel }: LabOrderFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<LabOrderFormData>({
    resolver: zodResolver(labOrderSchema),
    defaultValues: {
      priority: 'routine',
    },
  })

  const selectedTest = watch('testName')

  const handleQuickSelect = (testName: string, testCode: string) => {
    setValue('testName', testName)
    setValue('testCode', testCode)
  }

  const onSubmit = async (data: LabOrderFormData) => {
    try {
      setSubmitting(true)

      await createLabOrder({
        patientId,
        visitId,
        orderedBy,
        testName: data.testName,
        testCode: data.testCode,
        priority: data.priority,
        status: 'ordered',
        clinicalNotes: data.notes,
      })

      toast.push({ id: Date.now().toString(), title: 'Lab order created successfully' })
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create lab order:', error)
      toast.push({ id: Date.now().toString(), title: 'Failed to create lab order' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
        <div className="flex items-center">
          <BeakerIcon className="h-6 w-6 text-gray-400 mr-2" />
          <h3 className="text-lg font-medium text-gray-900">
            Order Laboratory Test
          </h3>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="px-4 py-5 sm:p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quick Select
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {commonTests.map((test) => (
              <button
                key={test.code}
                type="button"
                onClick={() => handleQuickSelect(test.name, test.code)}
                className={`px-3 py-2 text-sm text-left border rounded-md hover:bg-gray-50 ${
                  selectedTest === test.name
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-300'
                }`}
              >
                {test.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="testName" className="block text-sm font-medium text-gray-700">
            Test Name *
          </label>
          <input
            {...register('testName')}
            id="testName"
            type="text"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Enter test name or select from quick select"
          />
          {errors.testName && (
            <p className="mt-1 text-sm text-red-600">{errors.testName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="testCode" className="block text-sm font-medium text-gray-700">
            Test Code
          </label>
          <input
            {...register('testCode')}
            id="testCode"
            type="text"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Optional test code"
          />
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-gray-700">
            Priority *
          </label>
          <select
            {...register('priority')}
            id="priority"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT (Immediate)</option>
          </select>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
            Clinical Notes
          </label>
          <textarea
            {...register('notes')}
            id="notes"
            rows={3}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Any additional instructions or clinical indications..."
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Ordering...' : 'Order Test'}
          </button>
        </div>
      </form>
    </div>
  )
}

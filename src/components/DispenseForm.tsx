import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { db, generateId, createAuditLog, InventoryItem } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { BeakerIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

const dispenseSchema = z.object({
  itemName: z.string().min(1, 'Medication name is required'),
  qty: z.number().min(1, 'Quantity must be at least 1'),
  dosage: z.string().min(1, 'Dosage is required'),
  directions: z.string().min(1, 'Directions are required')
})

type DispenseFormData = z.infer<typeof dispenseSchema>

interface DispenseFormProps {
  patientId: string
  visitId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function DispenseForm({ patientId, visitId, onSuccess, onCancel }: DispenseFormProps) {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [lowStockWarning, setLowStockWarning] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm<DispenseFormData>({
    resolver: zodResolver(dispenseSchema)
  })

  const watchedItemName = watch('itemName')
  const watchedQty = watch('qty')

  useEffect(() => {
    loadInventory()
  }, [])

  useEffect(() => {
    if (watchedItemName) {
      const item = inventory.find(i => i.itemName === watchedItemName)
      setSelectedItem(item || null)
      
      if (item && watchedQty) {
        const remainingStock = item.onHandQty - watchedQty
        setLowStockWarning(remainingStock <= item.reorderThreshold)
      }
    }
  }, [watchedItemName, watchedQty, inventory])

  const loadInventory = async () => {
    try {
      const items = await db.inventory.orderBy('itemName').toArray()
      setInventory(items)
    } catch (error) {
      console.error('Error loading inventory:', error)
    }
  }

  const onSubmit = async (data: DispenseFormData) => {
    if (!selectedItem) {
      alert('Please select a valid medication from inventory')
      return
    }

    if (data.qty > selectedItem.onHandQty) {
      alert(`Insufficient stock. Available: ${selectedItem.onHandQty}`)
      return
    }

    setLoading(true)
    try {
      // Create dispense record
      const dispense = {
        id: generateId(),
        patientId,
        visitId,
        ...data,
        dispensedBy: currentUser?.fullName || 'Unknown',
        dispensedAt: new Date()
      }

      await db.dispenses.add(dispense)

      // Update inventory
      const newQty = selectedItem.onHandQty - data.qty
      await db.inventory.update(selectedItem.id, {
        onHandQty: newQty,
        updatedAt: new Date()
      })

      await createAuditLog(
        currentUser?.role || 'unknown',
        'dispense',
        'medication',
        dispense.id
      )

      onSuccess?.()
    } catch (error) {
      console.error('Error dispensing medication:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <BeakerIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            Dispense Medication
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Medication Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Medication *
            </label>
            <select
              {...register('itemName')}
              className="input-field"
              onChange={(e) => {
                setValue('itemName', e.target.value)
              }}
            >
              <option value="">Select medication</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.itemName}>
                  {item.itemName} (Available: {item.onHandQty} {item.unit})
                </option>
              ))}
            </select>
            {errors.itemName && (
              <p className="text-red-600 text-sm mt-1">{errors.itemName.message}</p>
            )}
          </div>

          {/* Stock Info */}
          {selectedItem && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    Available Stock: {selectedItem.onHandQty} {selectedItem.unit}
                  </p>
                  <p className="text-xs text-blue-600">
                    Reorder threshold: {selectedItem.reorderThreshold}
                  </p>
                </div>
                {selectedItem.onHandQty <= selectedItem.reorderThreshold && (
                  <div className="flex items-center text-orange-600">
                    <ExclamationTriangleIcon className="h-5 w-5 mr-1" />
                    <span className="text-sm font-medium">Low Stock</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quantity to Dispense *
            </label>
            <input
              {...register('qty', { valueAsNumber: true })}
              type="number"
              min="1"
              max={selectedItem?.onHandQty || 999}
              className="input-field"
              placeholder="Enter quantity"
            />
            {errors.qty && (
              <p className="text-red-600 text-sm mt-1">{errors.qty.message}</p>
            )}
          </div>

          {/* Low Stock Warning */}
          {lowStockWarning && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2" />
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> This dispense will bring stock below reorder threshold.
                </p>
              </div>
            </div>
          )}

          {/* Dosage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dosage *
            </label>
            <input
              {...register('dosage')}
              className="input-field"
              placeholder="e.g., 500mg, 10ml, 1 tablet"
            />
            {errors.dosage && (
              <p className="text-red-600 text-sm mt-1">{errors.dosage.message}</p>
            )}
          </div>

          {/* Directions */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Directions for Use *
            </label>
            <textarea
              {...register('directions')}
              className="input-field"
              rows={3}
              placeholder="e.g., Take 1 tablet twice daily with food for 7 days"
            />
            {errors.directions && (
              <p className="text-red-600 text-sm mt-1">{errors.directions.message}</p>
            )}
          </div>

          {/* Dispensed By Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <strong>Dispensed by:</strong> {currentUser?.fullName || 'Unknown'}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Date:</strong> {new Date().toLocaleDateString()}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              type="submit"
              disabled={loading || !selectedItem}
              className="btn-primary flex-1"
            >
              {loading ? 'Dispensing...' : 'Dispense Medication'}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
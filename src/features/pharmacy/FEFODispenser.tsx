import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useT'
import { db } from '@/db'
import { getMessageService } from '@/services/messaging'
import { 
  BeakerIcon, 
  ExclamationTriangleIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'

interface StockBatch {
  id: string
  drugId: string
  lotNumber: string
  expiryDate: string
  qtyOnHand: number
  supplier?: string
}

interface DispenseAllocation {
  batchId: string
  lotNumber: string
  qty: number
  expiryDate: string
}

interface FEFODispenserProps {
  patientId: string
  visitId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export default function FEFODispenser({ patientId, visitId, onSuccess, onCancel }: FEFODispenserProps) {
  const { t } = useT()
  const [medications, setMedications] = useState<any[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [selectedMedication, setSelectedMedication] = useState('')
  const [requestedQty, setRequestedQty] = useState(1)
  const [allocation, setAllocation] = useState<DispenseAllocation[]>([])
  const [dosage, setDosage] = useState('')
  const [directions, setDirections] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadMedications()
  }, [])

  useEffect(() => {
    if (selectedMedication) {
      loadBatchesForMedication(selectedMedication)
    }
  }, [selectedMedication])

  useEffect(() => {
    if (selectedMedication && requestedQty > 0) {
      calculateFEFOAllocation()
    }
  }, [selectedMedication, requestedQty, batches])

  const loadMedications = async () => {
    try {
      const items = await db.inventory.where('onHandQty').above(0).toArray()
      setMedications(items)
    } catch (error) {
      console.error('Error loading medications:', error)
    }
  }

  const loadBatchesForMedication = async (medicationId: string) => {
    try {
      const stockBatches = await db.stockBatches
        .where('drugId')
        .equals(medicationId)
        .and(batch => batch.qtyOnHand > 0)
        .toArray()
      
      setBatches(stockBatches)
    } catch (error) {
      console.error('Error loading batches:', error)
      setBatches([])
    }
  }

  const calculateFEFOAllocation = () => {
    if (!batches.length || requestedQty <= 0) {
      setAllocation([])
      return
    }

    // Sort by expiry date (First Expired, First Out)
    const sortedBatches = [...batches].sort((a, b) => 
      new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
    )

    const allocations: DispenseAllocation[] = []
    let remaining = requestedQty

    for (const batch of sortedBatches) {
      if (remaining <= 0) break
      
      const allocateQty = Math.min(batch.qtyOnHand, remaining)
      allocations.push({
        batchId: batch.id,
        lotNumber: batch.lotNumber,
        qty: allocateQty,
        expiryDate: batch.expiryDate
      })
      
      remaining -= allocateQty
    }

    setAllocation(allocations)
  }

  const getExpiryStatus = (expiryDate: string) => {
    const now = new Date()
    const expiry = new Date(expiryDate)
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (daysUntilExpiry < 0) {
      return { status: 'expired', color: 'text-red-600 bg-red-50', icon: XCircleIcon }
    } else if (daysUntilExpiry <= 30) {
      return { status: 'expiring', color: 'text-yellow-600 bg-yellow-50', icon: ExclamationTriangleIcon }
    } else if (daysUntilExpiry <= 90) {
      return { status: 'warning', color: 'text-orange-600 bg-orange-50', icon: ClockIcon }
    } else {
      return { status: 'good', color: 'text-green-600 bg-green-50', icon: CheckCircleIcon }
    }
  }

  const canDispense = () => {
    return selectedMedication && 
           requestedQty > 0 && 
           allocation.length > 0 && 
           allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
           dosage.trim() &&
           directions.trim()
  }

  const handleDispense = async () => {
    if (!canDispense()) return

    setLoading(true)
    try {
      const medication = medications.find(m => m.id === selectedMedication)
      if (!medication) throw new Error('Medication not found')

      // Create dispense record
      const dispense = {
        id: crypto.randomUUID(),
        patientId,
        visitId,
        itemName: medication.itemName,
        qty: requestedQty,
        dosage,
        directions,
        dispensedBy: currentUser?.fullName || 'Unknown',
        dispensedAt: new Date(),
        _dirty: 1
      }

      await db.dispenses.add(dispense)

      // Update batch quantities
      for (const alloc of allocation) {
        const batch = batches.find(b => b.id === alloc.batchId)
        if (batch) {
          await db.stockBatches.update(alloc.batchId, {
            qtyOnHand: batch.qtyOnHand - alloc.qty
          })
        }
      }

      // Update total inventory
      await db.inventory.update(selectedMedication, {
        onHandQty: medication.onHandQty - requestedQty,
        updatedAt: new Date()
      })

      // Queue medication reminder for tomorrow
      try {
        const messageService = getMessageService()
        const reminderDate = new Date()
        reminderDate.setDate(reminderDate.getDate() + 1)
        reminderDate.setHours(9, 0, 0, 0) // 9 AM tomorrow

        await messageService.queueMedicationReminder(
          patientId,
          medication.itemName,
          dosage,
          directions,
          reminderDate
        )
      } catch (error) {
        console.warn('Failed to queue reminder:', error)
      }

      onSuccess?.()
    } catch (error) {
      console.error('Error dispensing medication:', error)
      alert(t('error.dispenseFailed'))
    } finally {
      setLoading(false)
    }
  }

  const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0)
  const isShortfall = totalAvailable < requestedQty

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <BeakerIcon className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t('pharmacy.fefoDispense')}
          </h2>
          <p className="text-gray-600">
            {t('pharmacy.fefoDescription')}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="space-y-6">
          {/* Medication Selection */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3">
              {t('pharmacy.medication')} *
            </label>
            <select
              value={selectedMedication}
              onChange={(e) => setSelectedMedication(e.target.value)}
              className="input-field text-lg"
            >
              <option value="">{t('simple.selectMedication')}</option>
              {medications.map((med) => (
                <option key={med.id} value={med.id}>
                  {med.itemName} ({med.onHandQty} {med.unit} {t('common.available')})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity Selection */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3">
              {t('pharmacy.quantity')} *
            </label>
            <div className="flex items-center space-x-4">
              <button
                type="button"
                onClick={() => setRequestedQty(Math.max(1, requestedQty - 1))}
                className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 touch-target-large"
              >
                <span className="text-xl font-bold">−</span>
              </button>
              
              <div className="text-center">
                <input
                  type="number"
                  value={requestedQty}
                  onChange={(e) => setRequestedQty(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  className="w-20 text-2xl font-bold text-center border-2 border-gray-300 rounded-lg py-2"
                />
              </div>
              
              <button
                type="button"
                onClick={() => setRequestedQty(requestedQty + 1)}
                className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center hover:bg-green-200 touch-target-large"
              >
                <span className="text-xl font-bold">+</span>
              </button>
            </div>
          </div>

          {/* FEFO Allocation Display */}
          {allocation.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-gray-700 mb-3">
                {t('pharmacy.fefoAllocation')}
              </h3>
              
              {isShortfall && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                    <span className="text-sm text-red-800">
                      {t('pharmacy.insufficientStock', { 
                        available: totalAvailable.toString(), 
                        requested: requestedQty.toString() 
                      })}
                    </span>
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                {allocation.map((alloc, index) => {
                  const expiryStatus = getExpiryStatus(alloc.expiryDate)
                  const StatusIcon = expiryStatus.icon
                  
                  return (
                    <div key={alloc.batchId} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-900">
                            {t('pharmacy.batch')} {index + 1}: {alloc.lotNumber}
                          </div>
                          <div className="text-sm text-gray-600">
                            {t('pharmacy.quantity')}: {alloc.qty} • 
                            {t('pharmacy.expires')}: {new Date(alloc.expiryDate).toLocaleDateString()}
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {t(`pharmacy.expiry.${expiryStatus.status}`)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Dosage and Directions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-lg font-medium text-gray-700 mb-3">
                {t('pharmacy.dosage')} *
              </label>
              <input
                type="text"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                className="input-field text-lg"
                placeholder={t('simple.dosageExample')}
              />
            </div>
            
            <div>
              <label className="block text-lg font-medium text-gray-700 mb-3">
                {t('pharmacy.directions')} *
              </label>
              <textarea
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                className="input-field text-lg"
                rows={3}
                placeholder={t('simple.directionsExample')}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              onClick={handleDispense}
              disabled={!canDispense() || loading || isShortfall}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('pharmacy.dispensing') : t('pharmacy.dispenseAndRemind')}
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
      </div>
    </div>
  )
}
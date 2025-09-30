import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useT'
import { useAuthStore } from '@/stores/auth'
import { db, generateId } from '@/db'
import { getMessageService } from '@/services/messaging'
import { can } from '@/auth/roles'
import { 
  BeakerIcon, 
  ExclamationTriangleIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldExclamationIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline'

interface DrugInteraction {
  drug1: string
  drug2: string
  severity: 'minor' | 'moderate' | 'major'
  description: string
  action: string
}

interface DispenseAllocation {
  batchId: string
  lotNumber: string
  qty: number
  expiryDate: string
  daysUntilExpiry: number
}

interface EnhancedPharmacyProps {
  patientId: string
  visitId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export default function EnhancedPharmacy({ patientId, visitId, onSuccess, onCancel }: EnhancedPharmacyProps) {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const [medications, setMedications] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [selectedMedication, setSelectedMedication] = useState('')
  const [requestedQty, setRequestedQty] = useState(1)
  const [allocation, setAllocation] = useState<DispenseAllocation[]>([])
  const [dosage, setDosage] = useState('')
  const [directions, setDirections] = useState('')
  const [patientAllergies, setPatientAllergies] = useState<string[]>([])
  const [currentMedications, setCurrentMedications] = useState<string[]>([])
  const [interactions, setInteractions] = useState<DrugInteraction[]>([])
  const [loading, setLoading] = useState(false)
  const [showCounseling, setShowCounseling] = useState(false)

  // Drug interaction database (simplified)
  const interactionDatabase: DrugInteraction[] = [
    {
      drug1: 'Warfarin',
      drug2: 'Aspirin',
      severity: 'major',
      description: 'Increased bleeding risk',
      action: 'Monitor INR closely, consider alternative'
    },
    {
      drug1: 'ACE Inhibitor',
      drug2: 'Potassium',
      severity: 'moderate',
      description: 'Risk of hyperkalemia',
      action: 'Monitor potassium levels'
    },
    {
      drug1: 'NSAID',
      drug2: 'ACE Inhibitor',
      severity: 'moderate',
      description: 'Reduced antihypertensive effect',
      action: 'Monitor blood pressure'
    }
  ]

  // Only pharmacists and admins can access
  if (!currentUser || !can(currentUser.role, 'dispense')) {
    return (
      <div className="text-center py-12">
        <ExclamationTriangleIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Restricted</h3>
        <p className="text-gray-600">Only pharmacists and administrators can access enhanced pharmacy features.</p>
      </div>
    )
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedMedication) {
      loadBatchesForMedication(selectedMedication)
      checkInteractions()
    }
  }, [selectedMedication, currentMedications])

  useEffect(() => {
    if (selectedMedication && requestedQty > 0) {
      calculateFEFOAllocation()
    }
  }, [selectedMedication, requestedQty, batches])

  const loadData = async () => {
    try {
      const [medicationsData, patientData, recentDispenses] = await Promise.all([
        db.inventory.where('onHandQty').above(0).toArray(),
        db.patients.get(patientId),
        db.dispenses.where('patientId').equals(patientId).reverse().limit(10).toArray()
      ])
      
      setMedications(medicationsData)
      
      // Extract current medications from recent dispenses (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      
      const recentMeds = recentDispenses
        .filter(d => d.dispensedAt > thirtyDaysAgo)
        .map(d => d.itemName)
      
      setCurrentMedications([...new Set(recentMeds)])
      
      // TODO: Load patient allergies from patient record
      setPatientAllergies([]) // Placeholder
    } catch (error) {
      console.error('Error loading pharmacy data:', error)
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
      const daysUntilExpiry = Math.ceil(
        (new Date(batch.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      )
      
      allocations.push({
        batchId: batch.id,
        lotNumber: batch.lotNumber,
        qty: allocateQty,
        expiryDate: batch.expiryDate,
        daysUntilExpiry
      })
      
      remaining -= allocateQty
    }

    setAllocation(allocations)
  }

  const checkInteractions = () => {
    if (!selectedMedication) {
      setInteractions([])
      return
    }

    const selectedMed = medications.find(m => m.id === selectedMedication)
    if (!selectedMed) return

    const foundInteractions = interactionDatabase.filter(interaction => {
      const medName = selectedMed.itemName.toLowerCase()
      return currentMedications.some(currentMed => {
        const currentName = currentMed.toLowerCase()
        return (
          (interaction.drug1.toLowerCase().includes(medName.split(' ')[0]) && 
           interaction.drug2.toLowerCase().includes(currentName.split(' ')[0])) ||
          (interaction.drug2.toLowerCase().includes(medName.split(' ')[0]) && 
           interaction.drug1.toLowerCase().includes(currentName.split(' ')[0]))
        )
      })
    })

    setInteractions(foundInteractions)
  }

  const getExpiryStatus = (daysUntilExpiry: number) => {
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

  const getInteractionSeverityColor = (severity: DrugInteraction['severity']) => {
    switch (severity) {
      case 'major':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'moderate':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'minor':
        return 'bg-blue-100 text-blue-800 border-blue-200'
    }
  }

  const canDispense = () => {
    const hasExpiredBatches = allocation.some(a => a.daysUntilExpiry < 0)
    const hasMajorInteractions = interactions.some(i => i.severity === 'major')
    
    return selectedMedication && 
           requestedQty > 0 && 
           allocation.length > 0 && 
           allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
           dosage.trim() &&
           directions.trim() &&
           !hasExpiredBatches &&
           !hasMajorInteractions
  }

  const handleDispense = async () => {
    if (!canDispense()) return

    setLoading(true)
    try {
      const medication = medications.find(m => m.id === selectedMedication)
      if (!medication) throw new Error('Medication not found')

      // Create dispense record
      const dispense = {
        id: generateId(),
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

      setShowCounseling(true)
    } catch (error) {
      console.error('Error dispensing medication:', error)
      alert(t('error.dispenseFailed'))
    } finally {
      setLoading(false)
    }
  }

  const completeCounseling = () => {
    setShowCounseling(false)
    onSuccess?.()
  }

  if (showCounseling) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <InformationCircleIcon className="h-8 w-8 text-primary" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Patient Counseling</h2>
            <p className="text-gray-600">Review medication instructions with patient</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-800 mb-2">Medication Dispensed</h3>
              <p className="text-blue-700">
                <strong>{medications.find(m => m.id === selectedMedication)?.itemName}</strong> × {requestedQty}
              </p>
              <p className="text-blue-700">
                <strong>Dosage:</strong> {dosage}
              </p>
              <p className="text-blue-700">
                <strong>Instructions:</strong> {directions}
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Counseling Checklist</h3>
              
              <div className="space-y-3">
                {[
                  'Explained how to take the medication',
                  'Reviewed dosage and timing',
                  'Discussed potential side effects',
                  'Confirmed patient understanding',
                  'Provided written instructions',
                  'Scheduled follow-up reminder'
                ].map((item, index) => (
                  <label key={index} className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 text-primary focus:ring-primary border-gray-300 rounded"
                    />
                    <span className="text-gray-700">{item}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <CheckCircleIcon className="h-5 w-5 text-green-600" />
                <span className="text-green-800 font-medium">
                  SMS reminder scheduled for tomorrow at 9:00 AM
                </span>
              </div>
            </div>

            <button onClick={completeCounseling} className="btn-primary w-full">
              Complete Dispensing
            </button>
          </div>
        </div>
      </div>
    )
  }

  const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0)
  const isShortfall = totalAvailable < requestedQty
  const hasExpiredBatches = allocation.some(a => a.daysUntilExpiry < 0)
  const hasMajorInteractions = interactions.some(i => i.severity === 'major')

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <BeakerIcon className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Enhanced Pharmacy</h2>
          <p className="text-gray-600">FEFO dispensing with interaction checking</p>
        </div>
      </div>

      {/* Current Medications Alert */}
      {currentMedications.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <InformationCircleIcon className="h-5 w-5 text-blue-600" />
            <h3 className="font-medium text-blue-800">Current Medications</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {currentMedications.map((med, index) => (
              <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                {med}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Drug Interactions Alert */}
      {interactions.length > 0 && (
        <div className="space-y-3">
          {interactions.map((interaction, index) => (
            <div key={index} className={`border rounded-lg p-4 ${getInteractionSeverityColor(interaction.severity)}`}>
              <div className="flex items-center space-x-2 mb-2">
                <ShieldExclamationIcon className="h-5 w-5" />
                <h3 className="font-medium">
                  {interaction.severity.toUpperCase()} Drug Interaction
                </h3>
              </div>
              <p className="text-sm mb-2">{interaction.description}</p>
              <p className="text-sm font-medium">Action: {interaction.action}</p>
            </div>
          ))}
        </div>
      )}

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

          {/* Quantity Selection with Visual Input */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-3">
              {t('pharmacy.quantity')} *
            </label>
            <div className="flex items-center justify-center space-x-4">
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
                  className="w-24 text-3xl font-bold text-center border-2 border-gray-300 rounded-lg py-2"
                />
                {requestedQty <= 10 && (
                  <div className="flex justify-center gap-1 mt-2">
                    {Array.from({ length: requestedQty }, (_, i) => (
                      <div key={i} className="w-3 h-3 bg-primary rounded-full" />
                    ))}
                  </div>
                )}
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
                FEFO Batch Allocation
              </h3>
              
              {isShortfall && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                    <span className="text-sm text-red-800">
                      Insufficient stock: {totalAvailable} available, {requestedQty} requested
                    </span>
                  </div>
                </div>
              )}

              {hasExpiredBatches && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2">
                    <XCircleIcon className="h-5 w-5 text-red-600" />
                    <span className="text-sm text-red-800">
                      Cannot dispense: Some batches have expired
                    </span>
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                {allocation.map((alloc, index) => {
                  const expiryStatus = getExpiryStatus(alloc.daysUntilExpiry)
                  const StatusIcon = expiryStatus.icon
                  
                  return (
                    <div key={alloc.batchId} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-900">
                            Batch {index + 1}: {alloc.lotNumber}
                          </div>
                          <div className="text-sm text-gray-600">
                            Quantity: {alloc.qty} • 
                            Expires: {new Date(alloc.expiryDate).toLocaleDateString()} 
                            ({alloc.daysUntilExpiry} days)
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {expiryStatus.status}
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

          {/* Safety Warnings */}
          {(hasExpiredBatches || hasMajorInteractions) && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <ShieldExclamationIcon className="h-5 w-5 text-red-600" />
                <h3 className="font-medium text-red-800">Safety Alert</h3>
              </div>
              <ul className="text-sm text-red-700 space-y-1">
                {hasExpiredBatches && <li>• Cannot dispense expired medication</li>}
                {hasMajorInteractions && <li>• Major drug interaction detected</li>}
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              onClick={handleDispense}
              disabled={!canDispense() || loading}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('pharmacy.dispensing') : 'Dispense & Counsel'}
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
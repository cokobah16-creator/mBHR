import React, { useEffect, useMemo, useState } from 'react'
import { mbhrDb, ulid } from '@/db/mbhr'
import { BeakerIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

export default function Dispense() {
  const [rx, setRx] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [rxData, batchesData, itemsData] = await Promise.all([
        mbhrDb.prescriptions.where('status').equals('open').toArray(),
        mbhrDb.pharmacy_batches.toArray(),
        mbhrDb.pharmacy_items.toArray()
      ])
      setRx(rxData)
      setBatches(batchesData)
      setItems(itemsData)
    } catch (error) {
      console.error('Error loading dispense data:', error)
    }
  }

  const chosen = rx.find(r => r.id === selected)
  const chosenLine = chosen?.lines[0]
  const chosenItem = chosenLine ? items.find(i => i.id === chosenLine.itemId) : null

  const availableBatches = useMemo(() => {
    if (!chosenLine) return []
    return batches
      .filter(b => b.itemId === chosenLine.itemId && b.qtyOnHand > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)) // FEFO - First Expired, First Out
  }, [chosenLine, batches])

  async function doDispense() {
    if (!chosen || !chosenLine || !chosenItem) return
    
    const batch = availableBatches[0]
    if (!batch) {
      alert('❌ No available batches for this medication')
      return
    }
    
    if (new Date(batch.expiryDate) < new Date()) {
      alert('❌ Selected batch has expired')
      return
    }

    if (batch.qtyOnHand < chosenLine.qty) {
      alert(`❌ Insufficient stock. Available: ${batch.qtyOnHand}, Required: ${chosenLine.qty}`)
      return
    }

    setLoading(true)
    try {
      const now = new Date().toISOString()
      await mbhrDb.transaction('rw', 
        mbhrDb.pharmacy_batches, 
        mbhrDb.dispenses, 
        mbhrDb.pharmacy_items, 
        mbhrDb.stock_moves_rx, 
        mbhrDb.prescriptions, 
        async () => {
          // Record dispense
          await mbhrDb.dispenses.add({
            id: ulid(),
            prescriptionId: chosen.id,
            patientId: chosen.patientId,
            itemId: chosenLine.itemId,
            batchId: batch.id,
            qty: chosenLine.qty,
            dispensedBy: 'pharmacist-1', // In real app, use current user
            dispensedAt: now
          })

          // Update batch quantity
          await mbhrDb.pharmacy_batches.update(batch.id, { 
            qtyOnHand: batch.qtyOnHand - chosenLine.qty 
          })
          
          // Update item total quantity
          await mbhrDb.pharmacy_items.update(chosenItem.id, { 
            onHandQty: Math.max(0, chosenItem.onHandQty - chosenLine.qty), 
            updatedAt: now 
          })

          // Record stock movement
          await mbhrDb.stock_moves_rx.add({ 
            id: ulid(), 
            itemId: chosenLine.itemId, 
            batchId: batch.id, 
            qtyDelta: -chosenLine.qty, 
            reason: 'dispense', 
            createdAt: now 
          })
          
          // Mark prescription as dispensed
          await mbhrDb.prescriptions.update(chosen.id, { status: 'dispensed' })
        }
      )

      alert('✅ Medication dispensed successfully!')
      setSelected('')
      await loadData() // Refresh data
    } catch (error) {
      console.error('Error dispensing medication:', error)
      alert('❌ Failed to dispense medication')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <BeakerIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">Dispense Medication</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prescription Selection */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Open Prescriptions</h3>
          
          {rx.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <DocumentTextIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No open prescriptions</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rx.map(r => {
                const line = r.lines[0]
                const item = items.find(i => i.id === line?.itemId)
                return (
                  <div 
                    key={r.id} 
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selected === r.id 
                        ? 'border-primary bg-primary/5' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelected(r.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-900">
                          Rx #{r.id.slice(-6)}
                        </div>
                        <div className="text-sm text-gray-600">
                          {item?.medName} {item?.strength} × {line?.qty}
                        </div>
                        <div className="text-xs text-gray-500">
                          {line?.dosage} • {line?.frequency}
                        </div>
                      </div>
                      {selected === r.id && (
                        <CheckCircleIcon className="h-5 w-5 text-primary" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Dispense Details */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Dispense Details</h3>
          
          {!chosen ? (
            <div className="text-center py-8 text-gray-500">
              <p>Select a prescription to dispense</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Prescription Info */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Patient:</span> {chosen.patientId}
                  </div>
                  <div>
                    <span className="font-medium">Prescriber:</span> {chosen.prescriberId}
                  </div>
                  <div>
                    <span className="font-medium">Medication:</span> {chosenItem?.medName} {chosenItem?.strength}
                  </div>
                  <div>
                    <span className="font-medium">Quantity:</span> {chosenLine?.qty} {chosenItem?.unit}
                  </div>
                </div>
              </div>

              {/* Batch Information */}
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Available Batches (FEFO)</h4>
                {availableBatches.length === 0 ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-center space-x-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                      <span className="text-sm text-red-800">No available batches</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableBatches.slice(0, 3).map((batch, index) => {
                      const isExpired = new Date(batch.expiryDate) < new Date()
                      const isExpiringSoon = new Date(batch.expiryDate) < new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000)
                      
                      return (
                        <div key={batch.id} className={`p-3 border rounded-lg ${
                          index === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">
                                Lot: {batch.lotNumber}
                                {index === 0 && <span className="ml-2 text-green-600">(Next to dispense)</span>}
                              </div>
                              <div className="text-xs text-gray-600">
                                Expires: {new Date(batch.expiryDate).toLocaleDateString()} • 
                                Available: {batch.qtyOnHand}
                              </div>
                            </div>
                            <div className="flex flex-col space-y-1">
                              {isExpired && (
                                <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                                  Expired
                                </span>
                              )}
                              {!isExpired && isExpiringSoon && (
                                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                                  Expiring Soon
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Dispense Action */}
              <div className="pt-4 border-t">
                <button 
                  className="btn-primary w-full" 
                  disabled={!selected || availableBatches.length === 0 || loading} 
                  onClick={doDispense}
                >
                  {loading ? 'Dispensing...' : 'Dispense Medication'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
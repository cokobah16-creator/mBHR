import React, { useEffect, useMemo, useState } from 'react'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { BeakerIcon, ExclamationTriangleIcon, PlusIcon } from '@heroicons/react/24/outline'

type Row = {
  id: string
  medName: string
  unit: string
  onHandQty: number
  batches: number
  earliestExpiry?: string
}

export default function PharmacyStock() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showBatch, setShowBatch] = useState<string|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const items = await mbhrDb.pharmacy_items.orderBy('medName').toArray()
      const batches = await mbhrDb.pharmacy_batches.toArray()
      const byItem = new Map<string, {count:number; earliest?:string}>()
      
      for (const b of batches) {
        const entry = byItem.get(b.itemId) ?? { count:0 as number, earliest: undefined as string|undefined }
        entry.count += 1
        if (!entry.earliest || b.expiryDate < entry.earliest) entry.earliest = b.expiryDate
        byItem.set(b.itemId, entry)
      }
      
      const rows: Row[] = items.map(i => ({
        id: i.id,
        medName: [i.medName, i.strength].filter(Boolean).join(' '),
        unit: i.unit,
        onHandQty: i.onHandQty,
        batches: byItem.get(i.id)?.count ?? 0,
        earliestExpiry: byItem.get(i.id)?.earliest
      }))
      
      setRows(rows)
    } catch (error) {
      console.error('Error loading pharmacy data:', error)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter(r => r.medName.toLowerCase().includes(s)) : rows
  }, [q, rows])

  const addItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const medName = String(fd.get('medName')||'').trim()
    const strength = String(fd.get('strength')||'').trim()
    const unit = String(fd.get('unit')||'tabs')
    if (!medName) return
    
    try {
      const now = new Date().toISOString()
      const obj = { 
        id: ulid(), 
        medName, 
        strength, 
        unit, 
        form: 'tab', 
        onHandQty: 0, 
        reorderThreshold: 0, 
        updatedAt: now 
      }
      await mbhrDb.pharmacy_items.add(obj as any)
      setShowAdd(false)
      await loadData()
    } catch (error) {
      console.error('Error adding item:', error)
      alert('Failed to add medication')
    }
  }

  const addBatch = async (itemId: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const lotNumber = String(fd.get('lot')||'').trim()
    const qty = Number(fd.get('qty')||0)
    const expiry = String(fd.get('expiry')||'')
    if (!lotNumber || !qty || !expiry) return
    
    try {
      await mbhrDb.transaction('rw', mbhrDb.pharmacy_batches, mbhrDb.pharmacy_items, async () => {
        await mbhrDb.pharmacy_batches.add({
          id: ulid(), 
          itemId, 
          lotNumber, 
          qtyOnHand: qty,
          expiryDate: expiry, 
          receivedAt: new Date().toISOString()
        } as any)
        
        const item = await mbhrDb.pharmacy_items.get(itemId)
        if (item) {
          await mbhrDb.pharmacy_items.update(itemId, { 
            onHandQty: (item.onHandQty||0)+qty, 
            updatedAt: new Date().toISOString() 
          })
        }
      })
      
      setShowBatch(null)
      await loadData()
    } catch (error) {
      console.error('Error adding batch:', error)
      alert('Failed to add batch')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <BeakerIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pharmacy Stock</h1>
            <p className="text-gray-600">Loading pharmaceutical inventory...</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <BeakerIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy Stock</h1>
          <p className="text-gray-600">Manage pharmaceutical inventory and batches</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex-1 max-w-md">
          <input 
            className="input-field w-full" 
            placeholder="Search medications (e.g. Paracetamol 500mg)" 
            value={q} 
            onChange={e=>setQ(e.target.value)} 
          />
        </div>
        <button 
          className="btn-primary ml-4 flex items-center space-x-2" 
          onClick={()=>setShowAdd(true)}
        >
          <PlusIcon className="h-5 w-5" />
          <span>Add Item</span>
        </button>
      </div>

      {/* Stock Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Drug
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  On Hand
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Batches
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Earliest Exp.
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{r.medName}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                    {r.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium text-gray-900">
                    {r.onHandQty}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                    {r.batches}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                    {r.earliestExpiry ? new Date(r.earliestExpiry).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <button 
                      className="btn-primary text-sm px-3 py-1" 
                      onClick={()=>setShowBatch(r.id)}
                    >
                      Add Batch
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td className="px-6 py-8 text-center text-gray-500" colSpan={6}>
                    <BeakerIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No pharmacy items found</p>
                    {q && <p className="text-sm">Try adjusting your search terms</p>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <form onSubmit={addItem} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Medication</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medication Name *
                </label>
                <input 
                  name="medName" 
                  className="input-field" 
                  placeholder="e.g. Paracetamol" 
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Strength
                </label>
                <input 
                  name="strength" 
                  className="input-field" 
                  placeholder="e.g. 500mg" 
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Unit *
                </label>
                <input 
                  name="unit" 
                  className="input-field" 
                  defaultValue="tabs" 
                  required
                />
              </div>
              
              <div className="flex space-x-4 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  Add Medication
                </button>
                <button 
                  type="button" 
                  className="btn-secondary flex-1" 
                  onClick={()=>setShowAdd(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Batch Modal */}
      {showBatch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <form onSubmit={(e)=>addBatch(showBatch, e)} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Batch</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lot Number *
                </label>
                <input 
                  name="lot" 
                  className="input-field" 
                  placeholder="Batch/Lot number" 
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity *
                </label>
                <input 
                  name="qty" 
                  type="number" 
                  min={1} 
                  className="input-field" 
                  placeholder="Quantity received" 
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date *
                </label>
                <input 
                  name="expiry" 
                  type="date" 
                  className="input-field" 
                  required
                />
              </div>
              
              <div className="flex space-x-4 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  Add Batch
                </button>
                <button 
                  type="button" 
                  className="btn-secondary flex-1" 
                  onClick={()=>setShowBatch(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
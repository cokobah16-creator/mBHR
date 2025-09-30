import React, { useEffect, useState } from 'react'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline'

export default function RxForm() {
  const [items, setItems] = useState<any[]>([])
  const [form, setForm] = useState({ 
    patientId: '', 
    itemId: '', 
    dosage: '', 
    frequency: '', 
    durationDays: 7, 
    qty: 10,
    notes: ''
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => { 
    mbhrDb.pharmacy_items.orderBy('medName').toArray().then(setItems) 
  }, [])

  async function save() {
    if (!form.itemId || !form.dosage || !form.frequency) {
      alert('Please fill in all required fields')
      return
    }

    setLoading(true)
    try {
      const rxId = ulid()
      await mbhrDb.prescriptions.add({
        id: rxId,
        visitId: ulid(), // In real app, this would come from current visit
        patientId: form.patientId || 'demo-patient',
        prescriberId: 'doctor-1', // In real app, this would be current user
        createdAt: new Date().toISOString(),
        status: 'open',
        lines: [{
          itemId: form.itemId,
          dosage: form.dosage,
          frequency: form.frequency,
          durationDays: form.durationDays,
          qty: form.qty,
          notes: form.notes || undefined
        }]
      })
      
      // Reset form
      setForm({
        patientId: '',
        itemId: '',
        dosage: '',
        frequency: '',
        durationDays: 7,
        qty: 10,
        notes: ''
      })
      
      alert('✅ Prescription saved successfully!')
    } catch (error) {
      console.error('Error saving prescription:', error)
      alert('Failed to save prescription')
    } finally {
      setLoading(false)
    }
  }

  const selectedItem = items.find(item => item.id === form.itemId)

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <DocumentTextIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">New Prescription</h2>
      </div>

      <div className="card max-w-2xl">
        <div className="space-y-4">
          {/* Patient ID (simplified for demo) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Patient ID (Optional)
            </label>
            <input 
              className="input-field" 
              placeholder="Leave blank for demo patient"
              value={form.patientId} 
              onChange={e => setForm({ ...form, patientId: e.target.value })}
            />
          </div>

          {/* Drug Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Medication *
            </label>
            <select 
              className="input-field" 
              value={form.itemId} 
              onChange={e => setForm({ ...form, itemId: e.target.value })}
            >
              <option value="">Select medication…</option>
              {items.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.medName} {item.strength} ({item.form}) - {item.onHandQty} {item.unit} available
                </option>
              ))}
            </select>
          </div>

          {/* Stock Warning */}
          {selectedItem && selectedItem.onHandQty <= selectedItem.reorderThreshold && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="text-sm text-yellow-800">
                ⚠️ <strong>Low Stock:</strong> Only {selectedItem.onHandQty} {selectedItem.unit} remaining
              </div>
            </div>
          )}

          {/* Dosage & Frequency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dosage *
              </label>
              <input 
                className="input-field" 
                placeholder="e.g., 1 tablet, 5ml"
                value={form.dosage} 
                onChange={e => setForm({ ...form, dosage: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Frequency *
              </label>
              <input 
                className="input-field" 
                placeholder="e.g., twice daily, q8h"
                value={form.frequency} 
                onChange={e => setForm({ ...form, frequency: e.target.value })}
              />
            </div>
          </div>

          {/* Duration & Quantity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Duration (days)
              </label>
              <input 
                className="input-field" 
                type="number" 
                min="1"
                max="90"
                value={form.durationDays} 
                onChange={e => setForm({ ...form, durationDays: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Quantity
              </label>
              <input 
                className="input-field" 
                type="number" 
                min="1"
                value={form.qty} 
                onChange={e => setForm({ ...form, qty: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Special Instructions
            </label>
            <textarea 
              className="input-field" 
              rows={3}
              placeholder="e.g., Take with food, avoid alcohol"
              value={form.notes} 
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Actions */}
          <div className="flex space-x-4 pt-4">
            <button 
              className="btn-primary flex-1" 
              disabled={!form.itemId || !form.dosage || !form.frequency || loading} 
              onClick={save}
            >
              {loading ? 'Saving...' : 'Save Prescription'}
            </button>
            <button 
              className="btn-secondary" 
              onClick={() => setForm({
                patientId: '',
                itemId: '',
                dosage: '',
                frequency: '',
                durationDays: 7,
                qty: 10,
                notes: ''
              })}
            >
              Clear Form
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
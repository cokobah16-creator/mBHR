import React, { useEffect, useState } from 'react'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { 
  BeakerIcon, 
  ExclamationTriangleIcon, 
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'

interface PharmacyItem {
  id: string
  medName: string
  form: string
  strength: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  isControlled?: boolean
  updatedAt: string
}

interface PharmacyBatch {
  id: string
  itemId: string
  lotNumber: string
  expiryDate: string
  qtyOnHand: number
  receivedAt: string
  supplier?: string
}

interface ItemWithBatches extends PharmacyItem {
  batches: PharmacyBatch[]
  totalBatches: number
  earliestExpiry?: string
  expiredBatches: number
  expiringSoonBatches: number
}

export default function PharmacyStock() {
  const { currentUser } = useAuthStore()
  const [items, setItems] = useState<ItemWithBatches[]>([])
  const [filteredItems, setFilteredItems] = useState<ItemWithBatches[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAddItem, setShowAddItem] = useState(false)
  const [showAddBatch, setShowAddBatch] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<PharmacyItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'low_stock' | 'expired' | 'expiring_soon'>('all')

  // Form states
  const [itemForm, setItemForm] = useState({
    medName: '',
    form: 'tablet',
    strength: '',
    unit: 'tablets',
    reorderThreshold: 50,
    isControlled: false
  })

  const [batchForm, setBatchForm] = useState({
    lotNumber: '',
    qtyOnHand: 0,
    expiryDate: '',
    supplier: ''
  })

  // Only pharmacists and admins can access
  if (!currentUser || !can(currentUser.role, 'dispense')) {
    return (
      <div className="text-center py-12">
        <ExclamationTriangleIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Restricted</h3>
        <p className="text-gray-600">Only pharmacists and administrators can access pharmacy stock.</p>
      </div>
    )
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    filterItems()
  }, [items, searchQuery, filterType])

  const loadData = async () => {
    setLoading(true)
    try {
      const [itemsData, batchesData] = await Promise.all([
        mbhrDb.pharmacy_items.orderBy('medName').toArray(),
        mbhrDb.pharmacy_batches.toArray()
      ])

      const itemsWithBatches: ItemWithBatches[] = itemsData.map(item => {
        const itemBatches = batchesData.filter(batch => batch.itemId === item.id)
        const now = new Date()
        const sixMonthsFromNow = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000))

        const expiredBatches = itemBatches.filter(batch => new Date(batch.expiryDate) < now).length
        const expiringSoonBatches = itemBatches.filter(batch => {
          const expiryDate = new Date(batch.expiryDate)
          return expiryDate >= now && expiryDate <= sixMonthsFromNow
        }).length

        const earliestExpiry = itemBatches
          .filter(batch => batch.qtyOnHand > 0)
          .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0]?.expiryDate

        return {
          ...item,
          batches: itemBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()),
          totalBatches: itemBatches.length,
          earliestExpiry,
          expiredBatches,
          expiringSoonBatches
        }
      })

      setItems(itemsWithBatches)
    } catch (error) {
      console.error('Error loading pharmacy data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterItems = () => {
    let filtered = items

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(item => 
        item.medName.toLowerCase().includes(query) ||
        item.strength.toLowerCase().includes(query) ||
        item.form.toLowerCase().includes(query)
      )
    }

    // Apply type filter
    switch (filterType) {
      case 'low_stock':
        filtered = filtered.filter(item => item.onHandQty <= item.reorderThreshold)
        break
      case 'expired':
        filtered = filtered.filter(item => item.expiredBatches > 0)
        break
      case 'expiring_soon':
        filtered = filtered.filter(item => item.expiringSoonBatches > 0)
        break
    }

    setFilteredItems(filtered)
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!itemForm.medName.trim()) {
      alert('Please enter medication name')
      return
    }

    try {
      const newItem = {
        id: ulid(),
        medName: itemForm.medName.trim(),
        form: itemForm.form,
        strength: itemForm.strength.trim(),
        unit: itemForm.unit,
        onHandQty: 0,
        reorderThreshold: itemForm.reorderThreshold,
        isControlled: itemForm.isControlled,
        updatedAt: new Date().toISOString()
      }

      await mbhrDb.pharmacy_items.add(newItem)
      await loadData()
      setShowAddItem(false)
      resetItemForm()
    } catch (error) {
      console.error('Error adding item:', error)
      alert('Failed to add medication')
    }
  }

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!showAddBatch || !batchForm.lotNumber.trim() || !batchForm.expiryDate || batchForm.qtyOnHand <= 0) {
      alert('Please fill all required fields')
      return
    }

    try {
      await mbhrDb.transaction('rw', mbhrDb.pharmacy_batches, mbhrDb.pharmacy_items, async () => {
        // Add batch
        await mbhrDb.pharmacy_batches.add({
          id: ulid(),
          itemId: showAddBatch,
          lotNumber: batchForm.lotNumber.trim(),
          expiryDate: batchForm.expiryDate,
          qtyOnHand: batchForm.qtyOnHand,
          receivedAt: new Date().toISOString(),
          supplier: batchForm.supplier.trim() || undefined
        })

        // Update item total quantity
        const item = await mbhrDb.pharmacy_items.get(showAddBatch)
        if (item) {
          await mbhrDb.pharmacy_items.update(showAddBatch, {
            onHandQty: item.onHandQty + batchForm.qtyOnHand,
            updatedAt: new Date().toISOString()
          })
        }
      })

      await loadData()
      setShowAddBatch(null)
      resetBatchForm()
    } catch (error) {
      console.error('Error adding batch:', error)
      alert('Failed to add batch')
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this medication? This will also delete all associated batches.')) {
      return
    }

    try {
      await mbhrDb.transaction('rw', mbhrDb.pharmacy_items, mbhrDb.pharmacy_batches, async () => {
        await mbhrDb.pharmacy_batches.where('itemId').equals(itemId).delete()
        await mbhrDb.pharmacy_items.delete(itemId)
      })
      await loadData()
    } catch (error) {
      console.error('Error deleting item:', error)
      alert('Failed to delete medication')
    }
  }

  const resetItemForm = () => {
    setItemForm({
      medName: '',
      form: 'tablet',
      strength: '',
      unit: 'tablets',
      reorderThreshold: 50,
      isControlled: false
    })
    setEditingItem(null)
  }

  const resetBatchForm = () => {
    setBatchForm({
      lotNumber: '',
      qtyOnHand: 0,
      expiryDate: '',
      supplier: ''
    })
  }

  const getStockStatus = (item: ItemWithBatches) => {
    if (item.onHandQty === 0) {
      return { label: 'Out of Stock', color: 'bg-red-100 text-red-800', icon: XCircleIcon }
    }
    if (item.onHandQty <= item.reorderThreshold) {
      return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800', icon: ExclamationTriangleIcon }
    }
    return { label: 'In Stock', color: 'bg-green-100 text-green-800', icon: CheckCircleIcon }
  }

  const getExpiryStatus = (expiryDate: string) => {
    const now = new Date()
    const expiry = new Date(expiryDate)
    const sixMonthsFromNow = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000))

    if (expiry < now) {
      return { label: 'Expired', color: 'text-red-600 bg-red-50' }
    }
    if (expiry <= sixMonthsFromNow) {
      return { label: 'Expiring Soon', color: 'text-yellow-600 bg-yellow-50' }
    }
    return { label: 'Good', color: 'text-green-600 bg-green-50' }
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
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <BeakerIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pharmacy Stock</h1>
            <p className="text-gray-600">Manage pharmaceutical inventory and batches</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddItem(true)}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <PlusIcon className="h-5 w-5" />
          <span>Add Medication</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card bg-blue-50 border-blue-200">
          <div className="text-sm text-blue-600">Total Medications</div>
          <div className="text-2xl font-bold text-blue-800">{items.length}</div>
        </div>
        <div className="card bg-yellow-50 border-yellow-200">
          <div className="text-sm text-yellow-600">Low Stock Items</div>
          <div className="text-2xl font-bold text-yellow-800">
            {items.filter(item => item.onHandQty <= item.reorderThreshold).length}
          </div>
        </div>
        <div className="card bg-red-50 border-red-200">
          <div className="text-sm text-red-600">Expired Batches</div>
          <div className="text-2xl font-bold text-red-800">
            {items.reduce((sum, item) => sum + item.expiredBatches, 0)}
          </div>
        </div>
        <div className="card bg-orange-50 border-orange-200">
          <div className="text-sm text-orange-600">Expiring Soon</div>
          <div className="text-2xl font-bold text-orange-800">
            {items.reduce((sum, item) => sum + item.expiringSoonBatches, 0)}
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-10"
              placeholder="Search medications..."
            />
          </div>
          
          <div className="flex space-x-2">
            {[
              { key: 'all', label: 'All Items' },
              { key: 'low_stock', label: 'Low Stock' },
              { key: 'expired', label: 'Expired' },
              { key: 'expiring_soon', label: 'Expiring Soon' }
            ].map(filter => (
              <button
                key={filter.key}
                onClick={() => setFilterType(filter.key as any)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterType === filter.key
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medication
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Batches
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Expiry
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredItems.map((item) => {
                const status = getStockStatus(item)
                const StatusIcon = status.icon
                
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {item.medName} {item.strength}
                        </div>
                        <div className="text-sm text-gray-500">
                          {item.form} • {item.unit}
                          {item.isControlled && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              Controlled
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm font-medium text-gray-900">{item.onHandQty}</div>
                      <div className="text-xs text-gray-500">Reorder at {item.reorderThreshold}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm text-gray-900">{item.totalBatches}</div>
                      {(item.expiredBatches > 0 || item.expiringSoonBatches > 0) && (
                        <div className="text-xs space-x-1">
                          {item.expiredBatches > 0 && (
                            <span className="text-red-600">{item.expiredBatches} expired</span>
                          )}
                          {item.expiringSoonBatches > 0 && (
                            <span className="text-yellow-600">{item.expiringSoonBatches} expiring</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {item.earliestExpiry ? (
                        <div>
                          <div className="text-sm text-gray-900">
                            {new Date(item.earliestExpiry).toLocaleDateString()}
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            getExpiryStatus(item.earliestExpiry).color
                          }`}>
                            {getExpiryStatus(item.earliestExpiry).label}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-2">
                      <button
                        onClick={() => setShowAddBatch(item.id)}
                        className="text-primary hover:text-primary/80"
                        title="Add Batch"
                      >
                        <PlusIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSelectedItem(selectedItem === item.id ? null : item.id)}
                        className="text-blue-600 hover:text-blue-800"
                        title="View Batches"
                      >
                        <MagnifyingGlassIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-red-600 hover:text-red-800"
                        title="Delete Item"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          
          {filteredItems.length === 0 && (
            <div className="text-center py-12">
              <BeakerIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No medications found</h3>
              <p className="text-gray-600">
                {searchQuery ? 'Try adjusting your search terms' : 'Add your first medication to get started'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Batch Details */}
      {selectedItem && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Batch Details - {items.find(i => i.id === selectedItem)?.medName}
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lot Number
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Expiry Date
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.find(i => i.id === selectedItem)?.batches.map((batch) => {
                  const expiryStatus = getExpiryStatus(batch.expiryDate)
                  return (
                    <tr key={batch.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {batch.lotNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                        {batch.qtyOnHand}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                        {new Date(batch.expiryDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`}>
                          {expiryStatus.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {batch.supplier || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Medication</h2>
            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medication Name *
                </label>
                <input
                  type="text"
                  required
                  value={itemForm.medName}
                  onChange={(e) => setItemForm({ ...itemForm, medName: e.target.value })}
                  className="input-field"
                  placeholder="e.g., Paracetamol"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Form
                  </label>
                  <select
                    value={itemForm.form}
                    onChange={(e) => setItemForm({ ...itemForm, form: e.target.value })}
                    className="input-field"
                  >
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="syrup">Syrup</option>
                    <option value="injection">Injection</option>
                    <option value="cream">Cream</option>
                    <option value="drops">Drops</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Strength
                  </label>
                  <input
                    type="text"
                    value={itemForm.strength}
                    onChange={(e) => setItemForm({ ...itemForm, strength: e.target.value })}
                    className="input-field"
                    placeholder="e.g., 500mg"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Unit
                  </label>
                  <select
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    className="input-field"
                  >
                    <option value="tablets">Tablets</option>
                    <option value="capsules">Capsules</option>
                    <option value="bottles">Bottles</option>
                    <option value="vials">Vials</option>
                    <option value="tubes">Tubes</option>
                    <option value="boxes">Boxes</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reorder Threshold
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={itemForm.reorderThreshold}
                    onChange={(e) => setItemForm({ ...itemForm, reorderThreshold: parseInt(e.target.value) || 0 })}
                    className="input-field"
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="isControlled"
                  checked={itemForm.isControlled}
                  onChange={(e) => setItemForm({ ...itemForm, isControlled: e.target.checked })}
                  className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                />
                <label htmlFor="isControlled" className="text-sm text-gray-700">
                  Controlled substance
                </label>
              </div>
              
              <div className="flex space-x-4 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  Add Medication
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddItem(false)
                    resetItemForm()
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Batch Modal */}
      {showAddBatch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Add New Batch - {items.find(i => i.id === showAddBatch)?.medName}
            </h2>
            <form onSubmit={handleAddBatch} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lot Number *
                </label>
                <input
                  type="text"
                  required
                  value={batchForm.lotNumber}
                  onChange={(e) => setBatchForm({ ...batchForm, lotNumber: e.target.value })}
                  className="input-field"
                  placeholder="Batch/Lot number"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={batchForm.qtyOnHand}
                  onChange={(e) => setBatchForm({ ...batchForm, qtyOnHand: parseInt(e.target.value) || 0 })}
                  className="input-field"
                  placeholder="Quantity received"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date *
                </label>
                <input
                  type="date"
                  required
                  value={batchForm.expiryDate}
                  onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                  className="input-field"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Supplier
                </label>
                <input
                  type="text"
                  value={batchForm.supplier}
                  onChange={(e) => setBatchForm({ ...batchForm, supplier: e.target.value })}
                  className="input-field"
                  placeholder="Supplier name"
                />
              </div>
              
              <div className="flex space-x-4 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  Add Batch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddBatch(null)
                    resetBatchForm()
                  }}
                  className="btn-secondary flex-1"
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
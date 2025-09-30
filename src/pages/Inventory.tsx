import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, InventoryItem, generateId } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { 
  CubeIcon, 
  PlusIcon, 
  ExclamationTriangleIcon,
  PencilIcon
} from '@heroicons/react/24/outline'

export function Inventory() {
  const { t } = useTranslation()
  const { currentUser } = useAuthStore()
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [formData, setFormData] = useState({
    itemName: '',
    unit: '',
    onHandQty: 0,
    reorderThreshold: 0
  })

  useEffect(() => {
    console.log('[Inventory] Component mounted, loading inventory...')
    loadInventory()
  }, [])

  const loadInventory = async () => {
    setLoading(true)
    setError(null)
    try {
      console.log('[Inventory] Loading inventory items...')
      const items = await db.inventory.orderBy('itemName').toArray()
      console.log('[Inventory] Loaded items:', items.length, items)
      setInventory(items)
    } catch (error) {
      console.error('Error loading inventory:', error)
      setError('Failed to load inventory. Please try refreshing the page.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      if (editingItem) {
        // Update existing item
        await db.inventory.update(editingItem.id, {
          ...formData,
          updatedAt: new Date()
        })
      } else {
        // Add new item
        const newItem: InventoryItem = {
          id: generateId(),
          ...formData,
          updatedAt: new Date()
        }
        await db.inventory.add(newItem)
      }
      
      await loadInventory()
      resetForm()
    } catch (error) {
      console.error('Error saving inventory item:', error)
      alert('Failed to save inventory item. Please try again.')
    }
  }

  const resetForm = () => {
    setFormData({
      itemName: '',
      unit: '',
      onHandQty: 0,
      reorderThreshold: 0
    })
    setShowAddForm(false)
    setEditingItem(null)
  }

  const startEdit = (item: InventoryItem) => {
    setFormData({
      itemName: item.itemName,
      unit: item.unit,
      onHandQty: item.onHandQty,
      reorderThreshold: item.reorderThreshold
    })
    setEditingItem(item)
    setShowAddForm(true)
  }

  const lowStockItems = inventory.filter(item => item.onHandQty <= item.reorderThreshold)

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <CubeIcon className="h-12 w-12 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Inventory</h3>
          <p className="text-red-600 mb-6">{error}</p>
          <button
            onClick={loadInventory}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading inventory...</p>
        </div>
      </div>
    )
  }

  console.log('[Inventory] Rendering with', inventory.length, 'items')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-3">
          <CubeIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Inventory
            </h1>
            <p className="text-gray-600">
              Manage medication and supply inventory
            </p>
          </div>
        </div>
        
        {currentUser && (can(currentUser.role, 'inventory') || can(currentUser.role, 'users')) && (
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary inline-flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Add Item</span>
          </button>
        )}
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
            <h3 className="text-sm font-medium text-yellow-800">
              Low Stock Alert ({lowStockItems.length} items)
            </h3>
          </div>
          <div className="text-sm text-yellow-700">
            {lowStockItems.map(item => item.itemName).join(', ')}
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingItem ? 'Edit Item' : 'Add New Item'}
          </h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.itemName}
                  onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                  className="input-field"
                  placeholder="e.g., Paracetamol 500mg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Unit *
                </label>
                <input
                  type="text"
                  required
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="input-field"
                  placeholder="e.g., tablets, bottles, boxes"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity on Hand *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.onHandQty}
                  onChange={(e) => setFormData({ ...formData, onHandQty: parseInt(e.target.value) || 0 })}
                  className="input-field"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reorder Threshold *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.reorderThreshold}
                  onChange={(e) => setFormData({ ...formData, reorderThreshold: parseInt(e.target.value) || 0 })}
                  className="input-field"
                />
              </div>
            </div>
            
            <div className="flex space-x-4">
              <button type="submit" className="btn-primary">
                {editingItem ? 'Update Item' : 'Add Item'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Inventory List */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Inventory</h3>
        
        {inventory.length === 0 ? (
          <div className="text-center py-8">
            <CubeIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No inventory items</h3>
            <p className="text-gray-600 mb-6">Add your first inventory item to get started</p>
            {(currentUser?.role === 'admin' || currentUser?.role === 'pharmacist') && (
              <button
                onClick={() => setShowAddForm(true)}
                className="btn-primary"
              >
                Add First Item
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Item Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    On Hand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reorder At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {inventory.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {item.itemName}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {item.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.onHandQty}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {item.reorderThreshold}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {item.onHandQty <= item.reorderThreshold ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <ExclamationTriangleIcon className="h-3 w-3 mr-1" />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          In Stock
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {(currentUser?.role === 'admin' || currentUser?.role === 'pharmacist') && (
                        <button
                          onClick={() => startEdit(item)}
                          className="text-primary hover:text-primary/80 inline-flex items-center space-x-1"
                        >
                          <PencilIcon className="h-4 w-4" />
                          <span>Edit</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
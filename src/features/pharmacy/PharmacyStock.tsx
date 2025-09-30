import React, { useEffect, useMemo, useState } from 'react'
import { db as mbhrDb } from '@/db/mbhr'
import { BeakerIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export default function PharmacyStock() {
  const [items, setItems] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const [itemsData, batchesData] = await Promise.all([
          mbhrDb.pharmacy_items.orderBy('medName').toArray(),
          mbhrDb.pharmacy_batches.toArray()
        ])
        setItems(itemsData)
        setBatches(batchesData)
      } catch (error) {
        console.error('Error loading pharmacy data:', error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function earliestExpiry(itemId: string) {
    const bs = batches.filter(b => b.itemId === itemId)
    const sorted = bs.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    return sorted[0]?.expiryDate ?? '—'
  }

  function isExpiringSoon(expiryDate: string) {
    if (expiryDate === '—') return false
    const expiry = new Date(expiryDate)
    const sixMonthsFromNow = new Date()
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)
    return expiry <= sixMonthsFromNow
  }

  function isLowStock(item: any) {
    return item.onHandQty <= item.reorderThreshold
  }

  const lowStockItems = items.filter(isLowStock)
  const expiringSoonItems = items.filter(item => isExpiringSoon(earliestExpiry(item.id)))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading pharmacy stock...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <BeakerIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">Pharmacy Stock</h2>
      </div>

      {/* Alerts */}
      {(lowStockItems.length > 0 || expiringSoonItems.length > 0) && (
        <div className="space-y-3">
          {lowStockItems.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                <h3 className="text-sm font-medium text-red-800">
                  Low Stock Alert ({lowStockItems.length} items)
                </h3>
              </div>
              <div className="text-sm text-red-700">
                {lowStockItems.map(item => `${item.medName} ${item.strength}`).join(', ')}
              </div>
            </div>
          )}

          {expiringSoonItems.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                <h3 className="text-sm font-medium text-yellow-800">
                  Expiring Soon ({expiringSoonItems.length} items)
                </h3>
              </div>
              <div className="text-sm text-yellow-700">
                {expiringSoonItems.map(item => `${item.medName} ${item.strength}`).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Drug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Form & Strength
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  On Hand
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Batches
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Earliest Expiry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map(item => {
                const itemBatches = batches.filter(b => b.itemId === item.id)
                const expiry = earliestExpiry(item.id)
                const lowStock = isLowStock(item)
                const expiringSoon = isExpiringSoon(expiry)
                
                return (
                  <tr key={item.id} className={lowStock ? 'bg-red-50' : expiringSoon ? 'bg-yellow-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{item.medName}</div>
                      {item.isControlled && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                          Controlled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {item.form} • {item.strength}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {item.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                      {item.onHandQty}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-center">
                      {itemBatches.length}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {expiry !== '—' ? new Date(expiry).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col space-y-1">
                        {lowStock && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Low Stock
                          </span>
                        )}
                        {expiringSoon && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            Expiring Soon
                          </span>
                        )}
                        {!lowStock && !expiringSoon && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Good
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {items.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <BeakerIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No pharmacy items found</p>
          </div>
        )}
      </div>
    </div>
  )
}
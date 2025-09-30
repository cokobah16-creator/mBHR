import React from 'react'
import { db } from '@/db'
import { exportTable } from '@/utils/export'
import { useAuthStore } from '@/stores/auth'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

export function ExportButtons() {
  const { currentUser } = useAuthStore()
  
  // Only admins can export data
  if (currentUser?.role !== 'admin') return null

  const exports = [
    { table: db.patients, filename: 'patients.csv', label: 'Patients' },
    { table: db.vitals, filename: 'vitals.csv', label: 'Vitals' },
    { table: db.consultations, filename: 'consultations.csv', label: 'Consultations' },
    { table: db.dispenses, filename: 'dispenses.csv', label: 'Dispenses' },
    { table: db.inventory, filename: 'inventory.csv', label: 'Inventory' },
    { table: db.auditLogs, filename: 'audit_logs.csv', label: 'Audit Logs' }
  ]

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Export</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {exports.map(({ table, filename, label }) => (
          <button
            key={filename}
            onClick={() => exportTable(table, filename, 'csv')}
            className="flex items-center space-x-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-200">
        <button
          onClick={() => exportTable(db.patients, 'all_data.json', 'json')}
          className="flex items-center space-x-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors text-sm font-medium"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          <span>Export All Data (JSON)</span>
        </button>
      </div>
    </div>
  )
}
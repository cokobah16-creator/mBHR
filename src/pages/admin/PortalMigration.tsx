/**
 * Portal Migration Admin Page
 *
 * Bulk enable portal access for existing patients with contact information
 * Features:
 * - Filter patients by date, state, contact method
 * - Preview count before starting
 * - Batch processing with progress tracking
 * - Export CSV report of results
 */

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftIcon,
  UserGroupIcon,
  FunnelIcon,
  PlayIcon,
  PauseIcon,
  CheckCircleIcon,
  XCircleIcon,
  DocumentArrowDownIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { db, type Patient } from '@/db'
import {
  findEligiblePatients,
  bulkEnablePortalAccess
} from '@/services/portalEnrollment'
import { NIGERIAN_STATES } from '@/utils/nigeria'
import { formatNigerianDate } from '@/utils/dateFormat'

interface MigrationFilters {
  startDate?: string
  endDate?: string
  state?: string
  contactMethod: 'any' | 'email' | 'phone'
}

interface MigrationProgress {
  total: number
  completed: number
  successful: number
  failed: number
  isRunning: boolean
  isPaused: boolean
}

export function PortalMigration() {
  const [filters, setFilters] = useState<MigrationFilters>({
    contactMethod: 'any'
  })
  const [eligiblePatients, setEligiblePatients] = useState<Patient[]>([])
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress>({
    total: 0,
    completed: 0,
    successful: 0,
    failed: 0,
    isRunning: false,
    isPaused: false
  })
  const [errors, setErrors] = useState<Array<{ patientId: string; error: string }>>([])
  const [showResults, setShowResults] = useState(false)

  useEffect(() => {
    loadEligiblePatients()
  }, [filters])

  const loadEligiblePatients = async () => {
    setLoading(true)
    try {
      const patients = await findEligiblePatients({
        startDate: filters.startDate ? new Date(filters.startDate) : undefined,
        endDate: filters.endDate ? new Date(filters.endDate) : undefined,
        state: filters.state,
        contactMethod: filters.contactMethod
      })
      setEligiblePatients(patients)
      setSelectedPatients(new Set())
    } catch (error) {
      console.error('Error loading eligible patients:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectAll = () => {
    if (selectedPatients.size === eligiblePatients.length) {
      setSelectedPatients(new Set())
    } else {
      setSelectedPatients(new Set(eligiblePatients.map(p => p.id)))
    }
  }

  const handleTogglePatient = (patientId: string) => {
    const newSelected = new Set(selectedPatients)
    if (newSelected.has(patientId)) {
      newSelected.delete(patientId)
    } else {
      newSelected.add(patientId)
    }
    setSelectedPatients(newSelected)
  }

  const handleStartMigration = async (sendInvitations: boolean) => {
    const patientIds = Array.from(selectedPatients)
    if (patientIds.length === 0) return

    setProgress({
      total: patientIds.length,
      completed: 0,
      successful: 0,
      failed: 0,
      isRunning: true,
      isPaused: false
    })
    setErrors([])
    setShowResults(false)

    const result = await bulkEnablePortalAccess(patientIds, {
      sendInvitations,
      batchSize: 50,
      onProgress: (completed, total) => {
        setProgress(prev => ({
          ...prev,
          completed,
          total
        }))
      }
    })

    setProgress(prev => ({
      ...prev,
      successful: result.success,
      failed: result.failed,
      isRunning: false
    }))
    setErrors(result.errors)
    setShowResults(true)

    // Refresh eligible patients list
    await loadEligiblePatients()
  }

  const handleExportCSV = () => {
    const headers = ['Patient ID', 'Name', 'Status', 'Error']
    const rows = eligiblePatients
      .filter(p => selectedPatients.has(p.id))
      .map(p => {
        const error = errors.find(e => e.patientId === p.id)
        return [
          p.id,
          `${p.givenName} ${p.familyName}`,
          error ? 'Failed' : 'Success',
          error?.error || ''
        ]
      })

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portal-migration-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const progressPercentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link
          to="/admin/portal-dashboard"
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        >
          <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Portal Migration Tool</h1>
          <p className="text-gray-600">
            Bulk enable portal access for existing patients
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <FunnelIcon className="h-6 w-6 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={e => setFilters({ ...filters, startDate: e.target.value })}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={e => setFilters({ ...filters, endDate: e.target.value })}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              State
            </label>
            <select
              value={filters.state || ''}
              onChange={e => setFilters({ ...filters, state: e.target.value })}
              className="input-field"
            >
              <option value="">All States</option>
              {NIGERIAN_STATES.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contact Method
            </label>
            <select
              value={filters.contactMethod}
              onChange={e => setFilters({ ...filters, contactMethod: e.target.value as any })}
              className="input-field"
            >
              <option value="any">Any</option>
              <option value="email">Email Only</option>
              <option value="phone">Phone Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-600 font-medium">Eligible Patients</p>
              <p className="text-2xl font-bold text-blue-900">{eligiblePatients.length}</p>
            </div>
            <UserGroupIcon className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-600 font-medium">Selected</p>
              <p className="text-2xl font-bold text-green-900">{selectedPatients.size}</p>
            </div>
            <CheckCircleIcon className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="card bg-yellow-50 border-yellow-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-yellow-600 font-medium">In Progress</p>
              <p className="text-2xl font-bold text-yellow-900">{progress.completed}/{progress.total}</p>
            </div>
            <ClockIcon className="h-8 w-8 text-yellow-600" />
          </div>
        </div>

        <div className="card bg-red-50 border-red-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-red-600 font-medium">Failed</p>
              <p className="text-2xl font-bold text-red-900">{progress.failed}</p>
            </div>
            <XCircleIcon className="h-8 w-8 text-red-600" />
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {progress.isRunning && (
        <div className="card bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-900">Migration Progress</span>
            <span className="text-sm font-medium text-blue-900">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-4 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <p className="text-sm text-blue-800 mt-2">
            Processing {progress.completed} of {progress.total} patients...
          </p>
        </div>
      )}

      {/* Results Summary */}
      {showResults && !progress.isRunning && (
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-green-900 mb-2">Migration Complete</h3>
              <p className="text-sm text-green-800">
                Successfully enabled portal access for {progress.successful} patients.
                {progress.failed > 0 && ` ${progress.failed} failed.`}
              </p>
            </div>
            <button
              onClick={handleExportCSV}
              className="btn-secondary inline-flex items-center space-x-2"
            >
              <DocumentArrowDownIcon className="h-5 w-5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      )}

      {/* Patient List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Eligible Patients ({eligiblePatients.length})
          </h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleSelectAll}
              className="btn-secondary text-sm"
            >
              {selectedPatients.size === eligiblePatients.length ? 'Deselect All' : 'Select All'}
            </button>
            <button
              onClick={() => handleStartMigration(false)}
              disabled={selectedPatients.size === 0 || progress.isRunning}
              className="btn-secondary inline-flex items-center space-x-2"
            >
              <PlayIcon className="h-4 w-4" />
              <span>Enable Portal (No Invites)</span>
            </button>
            <button
              onClick={() => handleStartMigration(true)}
              disabled={selectedPatients.size === 0 || progress.isRunning}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <PlayIcon className="h-4 w-4" />
              <span>Enable & Send Invitations</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : eligiblePatients.length === 0 ? (
          <div className="text-center py-12">
            <UserGroupIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">No eligible patients found with current filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <input
                      type="checkbox"
                      checked={selectedPatients.size === eligiblePatients.length}
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-primary border-gray-300 rounded"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DOB</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {eligiblePatients.map(patient => (
                  <tr key={patient.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPatients.has(patient.id)}
                        onChange={() => handleTogglePatient(patient.id)}
                        className="h-4 w-4 text-primary border-gray-300 rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/patients/${patient.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {patient.givenName} {patient.familyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{patient.dob}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{patient.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{patient.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{patient.state}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatNigerianDate(patient.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Error List */}
      {errors.length > 0 && (
        <div className="card bg-red-50 border-red-200">
          <h3 className="text-lg font-semibold text-red-900 mb-4">Failed Migrations ({errors.length})</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {errors.map((error, index) => (
              <div key={index} className="flex items-start space-x-2 text-sm">
                <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-900">Patient ID: {error.patientId}</p>
                  <p className="text-red-800">{error.error}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

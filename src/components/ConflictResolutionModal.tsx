import React, { useState } from 'react'
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'

export interface ConflictField {
  field: string
  label: string
  localValue: unknown
  remoteValue: unknown
  type: 'string' | 'number' | 'date' | 'object'
}

export interface ConflictData {
  entityType: string
  entityId: string
  localTimestamp: string
  remoteTimestamp: string
  conflicts: ConflictField[]
}

export type ResolutionStrategy = 'keep-local' | 'keep-remote' | 'manual'

interface Resolution {
  [field: string]: 'local' | 'remote'
}

interface ConflictResolutionModalProps {
  conflict: ConflictData
  onResolve: (strategy: ResolutionStrategy, resolution?: Resolution) => void
  onCancel: () => void
}

export function ConflictResolutionModal({
  conflict,
  onResolve,
  onCancel,
}: ConflictResolutionModalProps) {
  const [strategy, setStrategy] = useState<ResolutionStrategy>('keep-local')
  const [manualResolution, setManualResolution] = useState<Resolution>(() => {
    const initial: Resolution = {}
    conflict.conflicts.forEach((c) => {
      initial[c.field] = 'local'
    })
    return initial
  })

  const formatValue = (value: unknown, type: ConflictField['type']): string => {
    if (value === null || value === undefined) return '(empty)'

    switch (type) {
      case 'date':
        return new Date(value as string).toLocaleString()
      case 'object':
        return JSON.stringify(value, null, 2)
      case 'number':
        return String(value)
      default:
        return String(value)
    }
  }

  const handleResolve = () => {
    if (strategy === 'manual') {
      onResolve(strategy, manualResolution)
    } else {
      onResolve(strategy)
    }
  }

  const toggleFieldResolution = (field: string) => {
    setManualResolution((prev) => ({
      ...prev,
      [field]: prev[field] === 'local' ? 'remote' : 'local',
    }))
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onCancel}
        />

        <div className="relative w-full max-w-4xl rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
                <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Sync Conflict Detected
                </h2>
                <p className="text-sm text-gray-600">
                  {conflict.entityType} • ID: {conflict.entityId.substring(0, 8)}...
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="mb-6 space-y-4">
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                This record was modified both locally and on the server. Please choose
                how to resolve the conflict.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-300 p-4">
                <h3 className="mb-2 font-semibold text-gray-900">Your Changes</h3>
                <p className="text-xs text-gray-600">
                  {new Date(conflict.localTimestamp).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-gray-300 p-4">
                <h3 className="mb-2 font-semibold text-gray-900">Server Changes</h3>
                <p className="text-xs text-gray-600">
                  {new Date(conflict.remoteTimestamp).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Resolution Strategy
              </label>
              <div className="space-y-2">
                <label className="flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="strategy"
                    value="keep-local"
                    checked={strategy === 'keep-local'}
                    onChange={() => setStrategy('keep-local')}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">
                    <strong>Keep Your Changes</strong> - Use all local values
                  </span>
                </label>

                <label className="flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="strategy"
                    value="keep-remote"
                    checked={strategy === 'keep-remote'}
                    onChange={() => setStrategy('keep-remote')}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">
                    <strong>Keep Server Changes</strong> - Use all remote values
                  </span>
                </label>

                <label className="flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="strategy"
                    value="manual"
                    checked={strategy === 'manual'}
                    onChange={() => setStrategy('manual')}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">
                    <strong>Choose Field by Field</strong> - Manually select each value
                  </span>
                </label>
              </div>
            </div>

            {strategy === 'manual' && (
              <div className="mt-4 space-y-4 rounded-lg border border-gray-300 p-4">
                <h3 className="font-semibold text-gray-900">Conflicting Fields</h3>
                {conflict.conflicts.map((conflictField) => (
                  <div
                    key={conflictField.field}
                    className="rounded-lg border border-gray-200 p-4"
                  >
                    <h4 className="mb-3 font-medium text-gray-900">
                      {conflictField.label}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => toggleFieldResolution(conflictField.field)}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          manualResolution[conflictField.field] === 'local'
                            ? 'border-primary bg-primary/5'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-600">
                            Your Value
                          </span>
                          {manualResolution[conflictField.field] === 'local' && (
                            <span className="text-xs font-semibold text-primary">
                              ✓ Selected
                            </span>
                          )}
                        </div>
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                          {formatValue(conflictField.localValue, conflictField.type)}
                        </pre>
                      </button>

                      <button
                        onClick={() => toggleFieldResolution(conflictField.field)}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          manualResolution[conflictField.field] === 'remote'
                            ? 'border-primary bg-primary/5'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-600">
                            Server Value
                          </span>
                          {manualResolution[conflictField.field] === 'remote' && (
                            <span className="text-xs font-semibold text-primary">
                              ✓ Selected
                            </span>
                          )}
                        </div>
                        <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                          {formatValue(conflictField.remoteValue, conflictField.type)}
                        </pre>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex space-x-4">
            <button
              onClick={handleResolve}
              className="btn-primary flex-1"
            >
              Resolve Conflict
            </button>
            <button
              onClick={onCancel}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

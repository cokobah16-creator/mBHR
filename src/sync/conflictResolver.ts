import { db } from '@/db'
import { ConflictData } from '@/components/ConflictResolutionModal'

export type ResolutionStrategy = 'keep-local' | 'keep-remote' | 'manual'

interface Resolution {
  [field: string]: 'local' | 'remote'
}

const tableMap: Record<string, string> = {
  app_users: 'users',
  patients: 'patients',
  visits: 'visits',
  vitals: 'vitals',
  consultations: 'consultations',
  dispenses: 'dispenses',
  inventory: 'inventory',
  queue: 'queue'
}

export async function resolveConflict(
  conflict: ConflictData,
  strategy: ResolutionStrategy,
  manualResolution?: Resolution,
  localData?: Record<string, unknown>,
  remoteData?: Record<string, unknown>
): Promise<void> {
  const tableName = tableMap[conflict.entityType] || conflict.entityType
  const table = (db as any)[tableName]

  if (!table) {
    throw new Error(`Unknown table: ${tableName}`)
  }

  if (strategy === 'keep-local') {
    await table.update(conflict.entityId, {
      _dirty: 1,
      updatedAt: new Date(),
      _syncedAt: null
    })
  } else if (strategy === 'keep-remote') {
    if (!remoteData) {
      throw new Error('Remote data not available for keep-remote strategy')
    }

    const mappedData = mapRemoteToLocal(remoteData, conflict.entityType)

    await table.put({
      ...mappedData,
      id: conflict.entityId,
      _dirty: 0,
      _syncedAt: new Date().toISOString(),
      updatedAt: new Date(conflict.remoteTimestamp)
    })
  } else if (strategy === 'manual' && manualResolution) {
    if (!localData || !remoteData) {
      throw new Error('Both local and remote data required for manual resolution')
    }

    const resolvedData: Record<string, unknown> = { id: conflict.entityId }

    for (const [field, choice] of Object.entries(manualResolution)) {
      if (choice === 'local') {
        resolvedData[field] = localData[field]
      } else {
        const remoteField = camelToSnake(field)
        resolvedData[field] = remoteData[remoteField] ?? remoteData[field]
      }
    }

    await table.put({
      ...resolvedData,
      _dirty: 1,
      updatedAt: new Date(),
      _syncedAt: null
    })
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function mapRemoteToLocal(remoteData: Record<string, unknown>, entityType: string): Record<string, unknown> {
  const fieldMaps: Record<string, Record<string, string>> = {
    patients: {
      given_name: 'givenName',
      family_name: 'familyName',
      photo_url: 'photoUrl',
      family_id: 'familyId',
      created_at: 'createdAt',
      updated_at: 'updatedAt'
    },
    vitals: {
      patient_id: 'patientId',
      visit_id: 'visitId',
      height_cm: 'heightCm',
      weight_kg: 'weightKg',
      temp_c: 'tempC',
      pulse_bpm: 'pulseBpm',
      taken_at: 'takenAt',
      updated_at: 'updatedAt'
    },
    consultations: {
      patient_id: 'patientId',
      visit_id: 'visitId',
      provider_name: 'providerName',
      soap_subjective: 'soapSubjective',
      soap_objective: 'soapObjective',
      soap_assessment: 'soapAssessment',
      soap_plan: 'soapPlan',
      provisional_dx: 'provisionalDx',
      created_at: 'createdAt',
      updated_at: 'updatedAt'
    },
    dispenses: {
      patient_id: 'patientId',
      visit_id: 'visitId',
      item_name: 'itemName',
      dispensed_by: 'dispensedBy',
      dispensed_at: 'dispensedAt',
      updated_at: 'updatedAt'
    },
    inventory: {
      item_name: 'itemName',
      on_hand_qty: 'onHandQty',
      reorder_threshold: 'reorderThreshold',
      updated_at: 'updatedAt'
    },
    visits: {
      patient_id: 'patientId',
      started_at: 'startedAt',
      site_name: 'siteName',
      updated_at: 'updatedAt'
    },
    queue: {
      patient_id: 'patientId',
      updated_at: 'updatedAt'
    },
    app_users: {
      full_name: 'fullName',
      admin_access: 'adminAccess',
      admin_permanent: 'adminPermanent',
      created_at: 'createdAt',
      updated_at: 'updatedAt'
    }
  }

  const fieldMap = fieldMaps[entityType] || {}
  const mapped: Record<string, unknown> = {}

  for (const [snakeKey, value] of Object.entries(remoteData)) {
    const camelKey = fieldMap[snakeKey] || snakeKey
    mapped[camelKey] = value
  }

  if (mapped.createdAt && typeof mapped.createdAt === 'string') {
    mapped.createdAt = new Date(mapped.createdAt)
  }
  if (mapped.updatedAt && typeof mapped.updatedAt === 'string') {
    mapped.updatedAt = new Date(mapped.updatedAt)
  }

  return mapped
}

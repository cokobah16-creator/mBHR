// src/sync/adapter.ts
import { createClient } from '@supabase/supabase-js'
import { db } from '../db'
import { useOperationsQueue, PendingOperation, processQueue } from '../stores/operationsQueue'
import { useSyncStore } from '../stores/syncStore'
import { ConflictData, ConflictField } from '../components/ConflictResolutionModal'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Check if URL and key are valid (not placeholder values)
const isValidUrl = url && key && 
  url !== 'your_supabase_project_url_here' && 
  key !== 'your_supabase_anon_key_here' &&
  (url.startsWith('http://') || url.startsWith('https://'))

const sb = isValidUrl ? createClient(url, key, { auth: { persistSession: false } }) : null

export function isOnlineSyncEnabled() { return !!sb }

type Tbl = 'app_users'|'patients'|'visits'|'vitals'|'consultations'|'dispenses'|'inventory'|'queue'|'patient_allergies'|'patient_preferences'

const mapToDB: Record<Tbl, Record<string,string>> = {
  app_users: {
    id:'id', fullName:'full_name', role:'role', adminAccess:'admin_access', 
    adminPermanent:'admin_permanent', createdAt:'created_at', updatedAt:'updated_at'
  },
  patients: {
    id:'id', givenName:'given_name', familyName:'family_name', sex:'sex', dob:'dob',
    phone:'phone', address:'address', state:'state', lga:'lga', photoUrl:'photo_url',
    familyId:'family_id', createdAt:'created_at', updatedAt:'updated_at'
  },
  visits: {
    id:'id', patientId:'patient_id', startedAt:'started_at', siteName:'site_name',
    status:'status', updatedAt:'updated_at'
  },
  vitals: {
    id:'id', patientId:'patient_id', visitId:'visit_id', heightCm:'height_cm', weightKg:'weight_kg',
    tempC:'temp_c', pulseBpm:'pulse_bpm', systolic:'systolic', diastolic:'diastolic', spo2:'spo2',
    bmi:'bmi', flags:'flags', takenAt:'taken_at', updatedAt:'updated_at'
  },
  consultations: {
    id:'id', patientId:'patient_id', visitId:'visit_id', providerName:'provider_name',
    soapSubjective:'soap_subjective', soapObjective:'soap_objective', soapAssessment:'soap_assessment',
    soapPlan:'soap_plan', provisionalDx:'provisional_dx', createdAt:'created_at', updatedAt:'updated_at'
  },
  dispenses: {
    id:'id', patientId:'patient_id', visitId:'visit_id', itemName:'item_name', qty:'qty',
    dosage:'dosage', directions:'directions', dispensedBy:'dispensed_by',
    dispensedAt:'dispensed_at', updatedAt:'updated_at'
  },
  inventory: {
    id:'id', itemName:'item_name', unit:'unit', onHandQty:'on_hand_qty',
    reorderThreshold:'reorder_threshold', updatedAt:'updated_at'
  },
  queue: {
    id:'id', patientId:'patient_id', stage:'stage', position:'position',
    status:'status', updatedAt:'updated_at'
  },
  patient_allergies: {
    id:'id', patientId:'patient_id', allergen:'allergen', allergyType:'allergy_type',
    reaction:'reaction', severity:'severity', onsetDate:'onset_date', notes:'notes',
    isActive:'is_active', createdAt:'created_at', updatedAt:'updated_at', createdBy:'created_by'
  },
  patient_preferences: {
    id:'id', patientId:'patient_id', preferredLanguage:'preferred_language',
    communicationChannel:'communication_channel', bestContactTime:'best_contact_time',
    dietaryRestrictions:'dietary_restrictions', religiousCultural:'religious_cultural',
    appointmentReminders:'appointment_reminders', medicationReminders:'medication_reminders',
    notes:'notes', createdAt:'created_at', updatedAt:'updated_at'
  },
}

const mapFromDB: Record<Tbl, Record<string,string>> = Object.fromEntries(
  Object.entries(mapToDB).map(([t, m]) => [t, Object.fromEntries(Object.entries(m).map(([app, db])=>[db, app]))])
) as any

function toDB(obj:any, map:Record<string,string>) {
  const out:any = {}
  for (const [appKey, dbKey] of Object.entries(map)) if (obj[appKey] !== undefined) out[dbKey] = obj[appKey]
  return out
}
function fromDB(obj:any, map:Record<string,string>) {
  const out:any = {}
  for (const [dbKey, appKey] of Object.entries(map)) if (obj[dbKey] !== undefined) out[appKey] = obj[dbKey]
  return out
}

const tables: Tbl[] = ['app_users','patients','visits','vitals','consultations','dispenses','inventory','queue','patient_allergies','patient_preferences']

// Map remote table names to local Dexie table names
const localTableMap: Record<Tbl, string> = {
  app_users: 'users',
  patients: 'patients',
  visits: 'visits',
  vitals: 'vitals',
  consultations: 'consultations',
  dispenses: 'dispenses',
  inventory: 'inventory',
  queue: 'queue',
  patient_allergies: 'patientAllergies',
  patient_preferences: 'patientPreferences'
}

// --- Cursor helpers (per-table) ---
const DEFAULT_TS = '1970-01-01T00:00:00.000Z'
const CURSOR_KEY = (t: Tbl) => `sync_cursor:${t}`

type Cursor = { ts: string }

async function getCursor(table: Tbl): Promise<string> {
  // settings store shape: { key: string, value: any }
  const row = await db.settings.get(CURSOR_KEY(table)).catch(() => undefined as any)
  const ts = row?.value?.ts ?? row?.ts ?? row?.value ?? undefined // be liberal in what we accept
  if (typeof ts === 'string' && ts) return ts
  return DEFAULT_TS
}

async function setCursor(table: Tbl, ts: string) {
  const iso = new Date(ts).toISOString()
  await db.settings.put({ key: CURSOR_KEY(table), value: iso as any })
}

// Detect conflicts by comparing local and remote versions
type ConflictDetectionResult = {
  hasConflict: boolean
  conflicts?: ConflictField[]
  localData?: any
  remoteData?: any
}

async function detectConflict(table: Tbl, id: string, localData: any): Promise<ConflictDetectionResult> {
  if (!sb) return { hasConflict: false }

  try {
    const { data: remoteData, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()

    if (error || !remoteData) return { hasConflict: false }

    const localUpdated = new Date(localData.updatedAt || localData.updated_at).getTime()
    const remoteUpdated = new Date(remoteData.updated_at).getTime()

    // No conflict if local is newer or same timestamp
    if (localUpdated >= remoteUpdated) return { hasConflict: false }

    // Check if there's a synced timestamp and data hasn't changed since
    if (localData._syncedAt) {
      const syncedAt = new Date(localData._syncedAt).getTime()
      if (remoteUpdated <= syncedAt) return { hasConflict: false }
    }

    // Detect field-level conflicts
    const conflicts: ConflictField[] = []
    const dbMap = mapToDB[table]
    const fieldMap = mapFromDB[table]

    for (const [appKey, dbKey] of Object.entries(dbMap)) {
      const localVal = localData[appKey]
      const remoteVal = remoteData[dbKey]

      if (localVal !== remoteVal && appKey !== 'updatedAt' && appKey !== 'createdAt') {
        conflicts.push({
          field: appKey,
          label: appKey.replace(/([A-Z])/g, ' $1').trim(),
          localValue: localVal,
          remoteValue: remoteVal,
          type: typeof localVal === 'number' ? 'number' :
                localVal instanceof Date ? 'date' :
                typeof localVal === 'object' ? 'object' : 'string'
        })
      }
    }

    if (conflicts.length === 0) return { hasConflict: false }

    return {
      hasConflict: true,
      conflicts,
      localData,
      remoteData
    }
  } catch (err) {
    return { hasConflict: false }
  }
}

export async function pushChanges() {
  if (!sb) return { conflicts: [] as ConflictData[] }

  const detectedConflicts: ConflictData[] = []

  for (const t of tables) {
    const localTable = localTableMap[t]
    const dirty = await (db as any)[localTable].where('_dirty').equals(1).toArray().catch(() => [])
    if (!dirty?.length) continue

    for (const record of dirty) {
      // Check for conflicts before pushing
      const conflictCheck = await detectConflict(t, record.id, record)

      if (conflictCheck.hasConflict && conflictCheck.conflicts) {
        detectedConflicts.push({
          entityType: t,
          entityId: record.id,
          localTimestamp: record.updatedAt || new Date().toISOString(),
          remoteTimestamp: conflictCheck.remoteData.updated_at,
          conflicts: conflictCheck.conflicts
        })
        continue // Skip this record, needs manual resolution
      }

      // No conflict, proceed with push
      const payload = toDB(record, mapToDB[t])
      const { error } = await sb.from(t).upsert(payload, { onConflict: 'id' })

      if (!error) {
        await (db as any)[localTable].update(record.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }
  }

  return { conflicts: detectedConflicts }
}

export async function pullChanges() {
  if (!sb) return
  for (const t of tables) {
    const localTable = localTableMap[t]
    const since = await getCursor(t) // ALWAYS a valid ISO string
    // If it's the default, don't send a gt filter to avoid corner cases
    let q = sb.from(t).select('*').limit(1000)
    if (since !== DEFAULT_TS) q = q.gt('updated_at', since)

    const { data, error } = await q
    if (error) { console.warn('pull error', t, error); continue }

    let maxTs = since
    for (const row of data ?? []) {
      const mapped = fromDB(row, mapFromDB[t])
      await (db as any)[localTable].put({ ...mapped, _dirty: 0, _syncedAt: new Date().toISOString() })
      if (row.updated_at && row.updated_at > maxTs) maxTs = row.updated_at
    }
    await setCursor(t, maxTs)
  }
}

// Process operations queue and sync with conflict detection
export async function processOperationsQueue(): Promise<ConflictData[]> {
  const detectedConflicts: ConflictData[] = []

  await processQueue(async (operation: PendingOperation) => {
    const table = operation.entity === 'patient' ? 'patients' :
                  operation.entity === 'visit' ? 'visits' :
                  operation.entity === 'vital' ? 'vitals' :
                  operation.entity === 'consultation' ? 'consultations' :
                  operation.entity === 'dispense' ? 'dispenses' :
                  operation.entity === 'inventory' ? 'inventory' :
                  operation.entity === 'patient_allergy' ? 'patient_allergies' :
                  operation.entity === 'patient_preference' ? 'patient_preferences' : null

    if (!table) throw new Error(`Unknown entity type: ${operation.entity}`)

    // Check for conflicts
    const conflictCheck = await detectConflict(table as Tbl, operation.entityId, operation.data)

    if (conflictCheck.hasConflict && conflictCheck.conflicts) {
      detectedConflicts.push({
        entityType: table,
        entityId: operation.entityId,
        localTimestamp: (operation.data.updatedAt as string) || new Date().toISOString(),
        remoteTimestamp: conflictCheck.remoteData.updated_at,
        conflicts: conflictCheck.conflicts
      })
      throw new Error('Conflict detected - needs resolution')
    }

    // Process operation based on type
    if (operation.type === 'create' || operation.type === 'update') {
      const payload = toDB(operation.data, mapToDB[table as Tbl])
      const { error } = await sb!.from(table).upsert(payload, { onConflict: 'id' })
      if (error) throw error

      // Mark as synced in local DB
      const localTable = localTableMap[table as Tbl]
      await (db as any)[localTable].update(operation.entityId, {
        _dirty: 0,
        _syncedAt: new Date().toISOString()
      })
    } else if (operation.type === 'delete') {
      const { error } = await sb!.from(table).delete().eq('id', operation.entityId)
      if (error) throw error
    }
  })

  return detectedConflicts
}

export async function syncNow() {
  if (!isOnlineSyncEnabled()) return { success: false, conflicts: [] }

  const syncStore = useSyncStore.getState()
  syncStore.setStatus('syncing')

  try {
    // Process operations queue first
    const queueConflicts = await processOperationsQueue()

    // Then push remaining dirty records
    const { conflicts: pushConflicts } = await pushChanges()

    // Pull remote changes
    await pullChanges()

    const allConflicts = [...queueConflicts, ...pushConflicts]

    syncStore.setLastSuccessAt(Date.now())
    syncStore.setStatus('ok')

    return { success: true, conflicts: allConflicts }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    syncStore.setLastErrorAt(Date.now(), message)
    syncStore.setStatus('error')
    return { success: false, conflicts: [], error: message }
  }
}

export function isConfigured() {
  return !!sb
}

// Auto-sync on network reconnection
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    const syncStore = useSyncStore.getState()
    if (syncStore.isOnline && isOnlineSyncEnabled()) {
      setTimeout(() => {
        syncNow().catch(err => {
          console.error('Auto-sync on reconnection failed:', err)
        })
      }, 2000) // Wait 2s for stable connection
    }
  })
}
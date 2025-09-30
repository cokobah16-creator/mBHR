// src/sync/adapter.ts
import { createClient } from '@supabase/supabase-js'
import { db } from '../db'

const url  = import.meta.env.VITE_SUPABASE_URL
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY
const sb = (url && key) ? createClient(url, key, { auth: { persistSession: false } }) : null

export function isOnlineSyncEnabled() { return !!sb }

type Tbl = 'patients'|'visits'|'vitals'|'consultations'|'dispenses'|'inventory'|'queue'

const mapToDB: Record<Tbl, Record<string,string>> = {
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

const tables: Tbl[] = ['patients','visits','vitals','consultations','dispenses','inventory','queue']

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
  await db.settings.put({ key: CURSOR_KEY(table), value: { ts: iso } })
}

export async function pushChanges() {
  if (!sb) return
  for (const t of tables) {
    const dirty = await (db as any)[t].where('_dirty').equals(1).toArray().catch(() => [])
    if (!dirty?.length) continue
    const payload = dirty.map((r:any) => toDB(r, mapToDB[t]))
    console.log('SYNC push payload', t, payload[0])
    const { error } = await sb.from(t).upsert(payload, { onConflict: 'id' })
    if (error) { console.warn('push error', t, error); continue }
    await (db as any)[t].where('_dirty').equals(1).modify({ _dirty: 0, _syncedAt: new Date().toISOString() })
  }
}

export async function pullChanges() {
  if (!sb) return
  for (const t of tables) {
    const since = await getCursor(t) // ALWAYS a valid ISO string
    // If it's the default, don't send a gt filter to avoid corner cases
    let q = sb.from(t).select('*').limit(1000)
    if (since !== DEFAULT_TS) q = q.gt('updated_at', since)

    const { data, error } = await q
    if (error) { console.warn('pull error', t, error); continue }

    let maxTs = since
    for (const row of data ?? []) {
      const mapped = fromDB(row, mapFromDB[t])
      await (db as any)[t].put({ ...mapped, _dirty: 0, _syncedAt: new Date().toISOString() })
      if (row.updated_at && row.updated_at > maxTs) maxTs = row.updated_at
    }
    await setCursor(t, maxTs)
  }
}

export async function syncNow() {
  if (!isOnlineSyncEnabled()) return
  
  try {
    await pushChanges()
    await pullChanges()
    console.log('Sync completed successfully')
  } catch (error) {
    console.error('Sync failed:', error)
  }
}

export function isConfigured() {
  return !!sb
}
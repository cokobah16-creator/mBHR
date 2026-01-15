import { supabase } from '@/lib/supabase'
import { db } from '@/db'
import * as logger from '@/lib/logger'

export type RecordType = 'vitals' | 'consultations' | 'dispenses' | 'lab_results'

export type VisibilityReason =
  | 'sensitive'
  | 'preliminary'
  | 'error'
  | 'staff_review'
  | 'patient_request'
  | 'other'

interface ToggleVisibilityInput {
  recordType: RecordType
  recordId: string
  patientId: string
  visible: boolean
  reason?: VisibilityReason
  performedBy: string
}

interface BulkToggleInput {
  recordType: RecordType
  recordIds: string[]
  patientId: string
  visible: boolean
  reason?: VisibilityReason
  performedBy: string
}

interface VisibilityLogEntry {
  id: string
  recordType: RecordType
  recordId: string
  patientId: string
  action: 'hidden' | 'shown'
  reason?: string
  performedBy: string
  performedAt: Date
}

export async function toggleRecordVisibility(
  input: ToggleVisibilityInput
): Promise<boolean> {
  const now = new Date()

  try {
    const table = getLocalTable(input.recordType)
    if (table) {
      await table.update(input.recordId, {
        portalVisible: input.visible,
        visibilityReason: input.visible ? undefined : input.reason,
        hiddenBy: input.visible ? undefined : input.performedBy,
        hiddenAt: input.visible ? undefined : now,
        _dirty: 1
      })
    }

    if (supabase) {
      const supabaseTable = getSupabaseTable(input.recordType)

      const { error: updateError } = await supabase
        .from(supabaseTable)
        .update({
          portal_visible: input.visible,
          visibility_reason: input.visible ? null : input.reason,
          hidden_by: input.visible ? null : input.performedBy,
          hidden_at: input.visible ? null : now.toISOString()
        })
        .eq('id', input.recordId)

      if (updateError) {
        logger.error('Failed to update visibility in Supabase:', updateError)
      }

      const { error: logError } = await supabase
        .from('record_visibility_log')
        .insert({
          record_type: input.recordType,
          record_id: input.recordId,
          patient_id: input.patientId,
          action: input.visible ? 'shown' : 'hidden',
          reason: input.reason,
          performed_by: input.performedBy,
          performed_at: now.toISOString()
        })

      if (logError) {
        logger.error('Failed to log visibility change:', logError)
      }
    }

    logger.log(`Record ${input.recordId} visibility set to ${input.visible}`)
    return true
  } catch (error) {
    logger.error('Failed to toggle record visibility:', error)
    return false
  }
}

export async function bulkToggleVisibility(
  input: BulkToggleInput
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  for (const recordId of input.recordIds) {
    const result = await toggleRecordVisibility({
      recordType: input.recordType,
      recordId,
      patientId: input.patientId,
      visible: input.visible,
      reason: input.reason,
      performedBy: input.performedBy
    })

    if (result) {
      success++
    } else {
      failed++
    }
  }

  return { success, failed }
}

export async function getHiddenRecords(
  patientId: string,
  recordType?: RecordType
): Promise<{ type: RecordType; id: string; reason?: string; hiddenAt?: Date }[]> {
  const results: { type: RecordType; id: string; reason?: string; hiddenAt?: Date }[] = []

  try {
    const types: RecordType[] = recordType
      ? [recordType]
      : ['vitals', 'consultations', 'dispenses']

    for (const type of types) {
      const table = getLocalTable(type)
      if (!table) continue

      const hidden = await table
        .where('patientId')
        .equals(patientId)
        .and(r => r.portalVisible === false)
        .toArray()

      for (const record of hidden) {
        results.push({
          type,
          id: record.id,
          reason: record.visibilityReason,
          hiddenAt: record.hiddenAt
        })
      }
    }
  } catch (error) {
    logger.error('Failed to get hidden records:', error)
  }

  return results
}

export async function getVisibilityLog(
  patientId: string,
  limit: number = 50
): Promise<VisibilityLogEntry[]> {
  if (!supabase) {
    return []
  }

  try {
    const { data, error } = await supabase
      .from('record_visibility_log')
      .select('*')
      .eq('patient_id', patientId)
      .order('performed_at', { ascending: false })
      .limit(limit)

    if (error) {
      logger.error('Failed to fetch visibility log:', error)
      return []
    }

    return (data || []).map(entry => ({
      id: entry.id,
      recordType: entry.record_type as RecordType,
      recordId: entry.record_id,
      patientId: entry.patient_id,
      action: entry.action as 'hidden' | 'shown',
      reason: entry.reason,
      performedBy: entry.performed_by,
      performedAt: new Date(entry.performed_at)
    }))
  } catch (error) {
    logger.error('Failed to get visibility log:', error)
    return []
  }
}

export async function getPatientVisibilityStats(
  patientId: string
): Promise<{ total: number; hidden: number; byType: Record<RecordType, { total: number; hidden: number }> }> {
  const stats = {
    total: 0,
    hidden: 0,
    byType: {
      vitals: { total: 0, hidden: 0 },
      consultations: { total: 0, hidden: 0 },
      dispenses: { total: 0, hidden: 0 },
      lab_results: { total: 0, hidden: 0 }
    }
  }

  try {
    const vitals = await db.vitals.where('patientId').equals(patientId).toArray()
    stats.byType.vitals.total = vitals.length
    stats.byType.vitals.hidden = vitals.filter(v => v.portalVisible === false).length

    const consultations = await db.consultations.where('patientId').equals(patientId).toArray()
    stats.byType.consultations.total = consultations.length
    stats.byType.consultations.hidden = consultations.filter(c => c.portalVisible === false).length

    const dispenses = await db.dispenses.where('patientId').equals(patientId).toArray()
    stats.byType.dispenses.total = dispenses.length
    stats.byType.dispenses.hidden = dispenses.filter(d => d.portalVisible === false).length

    stats.total =
      stats.byType.vitals.total +
      stats.byType.consultations.total +
      stats.byType.dispenses.total +
      stats.byType.lab_results.total

    stats.hidden =
      stats.byType.vitals.hidden +
      stats.byType.consultations.hidden +
      stats.byType.dispenses.hidden +
      stats.byType.lab_results.hidden
  } catch (error) {
    logger.error('Failed to get visibility stats:', error)
  }

  return stats
}

function getLocalTable(recordType: RecordType) {
  switch (recordType) {
    case 'vitals':
      return db.vitals
    case 'consultations':
      return db.consultations
    case 'dispenses':
      return db.dispenses
    default:
      return null
  }
}

function getSupabaseTable(recordType: RecordType): string {
  return recordType
}

export async function syncVisibilityChanges(): Promise<void> {
  if (!supabase) return

  try {
    const dirtyVitals = await db.vitals.where('_dirty').equals(1).toArray()
    for (const record of dirtyVitals) {
      const { error } = await supabase
        .from('vitals')
        .update({
          portal_visible: record.portalVisible,
          visibility_reason: record.visibilityReason,
          hidden_by: record.hiddenBy,
          hidden_at: record.hiddenAt?.toISOString()
        })
        .eq('id', record.id)

      if (!error) {
        await db.vitals.update(record.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }

    const dirtyConsultations = await db.consultations.where('_dirty').equals(1).toArray()
    for (const record of dirtyConsultations) {
      const { error } = await supabase
        .from('consultations')
        .update({
          portal_visible: record.portalVisible,
          visibility_reason: record.visibilityReason,
          hidden_by: record.hiddenBy,
          hidden_at: record.hiddenAt?.toISOString()
        })
        .eq('id', record.id)

      if (!error) {
        await db.consultations.update(record.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }

    const dirtyDispenses = await db.dispenses.where('_dirty').equals(1).toArray()
    for (const record of dirtyDispenses) {
      const { error } = await supabase
        .from('dispenses')
        .update({
          portal_visible: record.portalVisible,
          visibility_reason: record.visibilityReason,
          hidden_by: record.hiddenBy,
          hidden_at: record.hiddenAt?.toISOString()
        })
        .eq('id', record.id)

      if (!error) {
        await db.dispenses.update(record.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }
  } catch (error) {
    logger.error('Failed to sync visibility changes:', error)
  }
}

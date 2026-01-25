import { supabase } from '@/lib/supabase'
import { db, Patient } from '@/db'
import { patientDeduplication } from './patientDeduplication'
import logger from '@/lib/logger'

export type ConflictType = 'sync_conflict' | 'duplicate' | 'data_quality'
export type ConflictStatus = 'pending' | 'resolved' | 'ignored' | 'auto_resolved' | 'needs_approval'
export type ConflictPriority = 'low' | 'medium' | 'high' | 'critical'
export type PHISensitivity = 'none' | 'low' | 'medium' | 'high'
export type ResolutionStrategy = 'keep_local' | 'keep_remote' | 'manual' | 'merge' | 'ignore'

export interface ConflictField {
  field: string
  label: string
  localValue: unknown
  remoteValue: unknown
  type: 'string' | 'number' | 'date' | 'object' | 'array'
  phiSensitivity: PHISensitivity
}

export interface ConflictResolution {
  id: string
  conflictType: ConflictType
  entityType: string
  entityId: string
  candidateIds: string[]
  status: ConflictStatus
  priority: ConflictPriority
  phiSensitivity: PHISensitivity
  conflictDetails: {
    fields: ConflictField[]
    localTimestamp?: string
    remoteTimestamp?: string
    matchScore?: number
    matchReasons?: string[]
  }
  resolutionStrategy?: ResolutionStrategy
  resolutionDetails?: Record<string, unknown>
  resolvedBy?: string
  resolvedAt?: string
  approvedBy?: string
  approvedAt?: string
  autoRuleId?: string
  createdAt: string
  updatedAt: string
}

export interface AutoResolutionRule {
  id: string
  name: string
  description?: string
  entityType: string
  conflictType: ConflictType
  conditions: Record<string, unknown>
  resolutionStrategy: string
  phiAllowed: boolean
  isActive: boolean
  priorityOrder: number
}

const PHI_FIELDS: Record<string, PHISensitivity> = {
  givenName: 'high',
  familyName: 'high',
  dob: 'high',
  phone: 'high',
  email: 'high',
  address: 'high',
  state: 'medium',
  lga: 'medium',
  photoUrl: 'high',
  sex: 'medium',
  soapSubjective: 'high',
  soapObjective: 'high',
  soapAssessment: 'high',
  soapPlan: 'high',
  provisionalDx: 'high',
  heightCm: 'low',
  weightKg: 'low',
  tempC: 'low',
  pulseBpm: 'low',
  systolic: 'low',
  diastolic: 'low',
  spo2: 'low',
  bmi: 'low',
}

function getFieldPHISensitivity(field: string): PHISensitivity {
  return PHI_FIELDS[field] || 'none'
}

function calculateOverallPHISensitivity(fields: ConflictField[]): PHISensitivity {
  const sensitivities = fields.map(f => f.phiSensitivity)
  if (sensitivities.includes('high')) return 'high'
  if (sensitivities.includes('medium')) return 'medium'
  if (sensitivities.includes('low')) return 'low'
  return 'none'
}

function calculatePriority(
  conflictType: ConflictType,
  phiSensitivity: PHISensitivity,
  entityType: string
): ConflictPriority {
  if (phiSensitivity === 'high' && entityType === 'patients') return 'critical'
  if (phiSensitivity === 'high') return 'high'
  if (conflictType === 'duplicate' && entityType === 'patients') return 'high'
  if (phiSensitivity === 'medium') return 'medium'
  return 'low'
}

export class ConflictQueueService {
  async createConflict(params: {
    conflictType: ConflictType
    entityType: string
    entityId: string
    candidateIds?: string[]
    conflictDetails: ConflictResolution['conflictDetails']
  }): Promise<string | null> {
    const fieldsWithPHI = params.conflictDetails.fields.map(f => ({
      ...f,
      phiSensitivity: getFieldPHISensitivity(f.field)
    }))

    const phiSensitivity = calculateOverallPHISensitivity(fieldsWithPHI)
    const priority = calculatePriority(params.conflictType, phiSensitivity, params.entityType)
    const needsApproval = phiSensitivity === 'high' && params.entityType === 'patients'

    const { data, error } = await supabase
      .from('conflict_resolutions')
      .insert({
        conflict_type: params.conflictType,
        entity_type: params.entityType,
        entity_id: params.entityId,
        candidate_ids: params.candidateIds || [],
        status: needsApproval ? 'needs_approval' : 'pending',
        priority,
        phi_sensitivity: phiSensitivity,
        conflict_details: {
          ...params.conflictDetails,
          fields: fieldsWithPHI
        }
      })
      .select('id')
      .single()

    if (error) {
      logger.error('Failed to create conflict', error)
      return null
    }

    await this.logAuditEvent(data.id, 'created', {
      conflict_type: params.conflictType,
      entity_type: params.entityType
    })

    return data.id
  }

  async getPendingConflicts(filters?: {
    entityType?: string
    conflictType?: ConflictType
    priority?: ConflictPriority
    limit?: number
    offset?: number
  }): Promise<{ conflicts: ConflictResolution[], total: number }> {
    let query = supabase
      .from('conflict_resolutions')
      .select('*', { count: 'exact' })
      .in('status', ['pending', 'needs_approval'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    if (filters?.entityType) {
      query = query.eq('entity_type', filters.entityType)
    }
    if (filters?.conflictType) {
      query = query.eq('conflict_type', filters.conflictType)
    }
    if (filters?.priority) {
      query = query.eq('priority', filters.priority)
    }
    if (filters?.limit) {
      query = query.limit(filters.limit)
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1)
    }

    const { data, error, count } = await query

    if (error) {
      logger.error('Failed to fetch pending conflicts', error)
      return { conflicts: [], total: 0 }
    }

    return {
      conflicts: (data || []).map(this.mapFromDB),
      total: count || 0
    }
  }

  async getConflictById(id: string): Promise<ConflictResolution | null> {
    const { data, error } = await supabase
      .from('conflict_resolutions')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) return null

    await this.logAuditEvent(id, 'viewed', {})

    return this.mapFromDB(data)
  }

  async resolveConflict(params: {
    conflictId: string
    strategy: ResolutionStrategy
    resolutionDetails: Record<string, unknown>
    resolvedBy: string
    justification?: string
  }): Promise<boolean> {
    const conflict = await this.getConflictById(params.conflictId)
    if (!conflict) return false

    const needsApproval = conflict.phiSensitivity === 'high' &&
      conflict.entityType === 'patients' &&
      params.strategy !== 'ignore'

    const { error } = await supabase
      .from('conflict_resolutions')
      .update({
        status: needsApproval ? 'needs_approval' : 'resolved',
        resolution_strategy: params.strategy,
        resolution_details: params.resolutionDetails,
        resolved_by: params.resolvedBy,
        resolved_at: new Date().toISOString()
      })
      .eq('id', params.conflictId)

    if (error) {
      logger.error('Failed to resolve conflict', error)
      return false
    }

    await this.logAuditEvent(params.conflictId, 'resolved', {
      strategy: params.strategy,
      justification: params.justification,
      field_changes: params.resolutionDetails
    })

    return true
  }

  async approveResolution(params: {
    conflictId: string
    approvedBy: string
    justification?: string
  }): Promise<boolean> {
    const { error } = await supabase
      .from('conflict_resolutions')
      .update({
        status: 'resolved',
        approved_by: params.approvedBy,
        approved_at: new Date().toISOString()
      })
      .eq('id', params.conflictId)
      .eq('status', 'needs_approval')

    if (error) {
      logger.error('Failed to approve resolution', error)
      return false
    }

    await this.logAuditEvent(params.conflictId, 'approved', {
      justification: params.justification
    })

    return true
  }

  async rejectResolution(params: {
    conflictId: string
    rejectedBy: string
    reason: string
  }): Promise<boolean> {
    const { error } = await supabase
      .from('conflict_resolutions')
      .update({
        status: 'pending',
        resolution_strategy: null,
        resolution_details: null,
        resolved_by: null,
        resolved_at: null
      })
      .eq('id', params.conflictId)

    if (error) {
      logger.error('Failed to reject resolution', error)
      return false
    }

    await this.logAuditEvent(params.conflictId, 'rejected', {
      reason: params.reason
    })

    return true
  }

  async bulkResolve(params: {
    conflictIds: string[]
    strategy: ResolutionStrategy
    resolvedBy: string
    justification?: string
  }): Promise<{ success: number, failed: number }> {
    let success = 0
    let failed = 0

    for (const conflictId of params.conflictIds) {
      const resolved = await this.resolveConflict({
        conflictId,
        strategy: params.strategy,
        resolutionDetails: { bulk: true },
        resolvedBy: params.resolvedBy,
        justification: params.justification
      })

      if (resolved) {
        success++
      } else {
        failed++
      }
    }

    return { success, failed }
  }

  async scanForDuplicates(limit = 100): Promise<number> {
    const patients = await db.patients
      .where('mergeInto')
      .equals('')
      .or('mergeInto')
      .equals(undefined as unknown as string)
      .limit(limit)
      .toArray()

    let duplicatesFound = 0

    for (const patient of patients) {
      const candidates = await patientDeduplication.findDuplicates({
        givenName: patient.givenName,
        familyName: patient.familyName,
        phone: patient.phone || undefined,
        dob: new Date(patient.dob),
        address: patient.address
      })

      const otherCandidates = candidates.filter(c => c.patient.id !== patient.id)

      if (otherCandidates.length > 0) {
        const existing = await this.checkExistingConflict(patient.id, 'duplicate')
        if (!existing) {
          await this.createConflict({
            conflictType: 'duplicate',
            entityType: 'patients',
            entityId: patient.id,
            candidateIds: otherCandidates.map(c => c.patient.id),
            conflictDetails: {
              fields: this.buildDuplicateFields(patient, otherCandidates[0].patient),
              matchScore: otherCandidates[0].score,
              matchReasons: otherCandidates[0].matchReasons
            }
          })
          duplicatesFound++
        }
      }
    }

    return duplicatesFound
  }

  private async checkExistingConflict(entityId: string, conflictType: ConflictType): Promise<boolean> {
    const { data } = await supabase
      .from('conflict_resolutions')
      .select('id')
      .eq('entity_id', entityId)
      .eq('conflict_type', conflictType)
      .in('status', ['pending', 'needs_approval'])
      .limit(1)

    return (data?.length || 0) > 0
  }

  private buildDuplicateFields(patient1: Patient, patient2: Patient): ConflictField[] {
    const fields: ConflictField[] = []
    const compareFields = [
      { key: 'givenName', label: 'Given Name' },
      { key: 'familyName', label: 'Family Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'dob', label: 'Date of Birth' },
      { key: 'sex', label: 'Sex' },
      { key: 'address', label: 'Address' },
      { key: 'state', label: 'State' },
      { key: 'lga', label: 'LGA' }
    ]

    for (const { key, label } of compareFields) {
      const val1 = (patient1 as unknown as Record<string, unknown>)[key]
      const val2 = (patient2 as unknown as Record<string, unknown>)[key]

      fields.push({
        field: key,
        label,
        localValue: val1,
        remoteValue: val2,
        type: key === 'dob' ? 'date' : 'string',
        phiSensitivity: getFieldPHISensitivity(key)
      })
    }

    return fields
  }

  async getAutoResolutionRules(): Promise<AutoResolutionRule[]> {
    const { data, error } = await supabase
      .from('auto_resolution_rules')
      .select('*')
      .eq('is_active', true)
      .order('priority_order')

    if (error) {
      logger.error('Failed to fetch auto-resolution rules', error)
      return []
    }

    return (data || []).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      entityType: r.entity_type,
      conflictType: r.conflict_type,
      conditions: r.conditions,
      resolutionStrategy: r.resolution_strategy,
      phiAllowed: r.phi_allowed,
      isActive: r.is_active,
      priorityOrder: r.priority_order
    }))
  }

  async applyAutoResolution(conflictId: string): Promise<boolean> {
    const conflict = await this.getConflictById(conflictId)
    if (!conflict) return false

    const rules = await this.getAutoResolutionRules()
    const applicableRule = rules.find(r =>
      r.entityType === conflict.entityType &&
      r.conflictType === conflict.conflictType &&
      (r.phiAllowed || conflict.phiSensitivity !== 'high')
    )

    if (!applicableRule) return false

    const { error } = await supabase
      .from('conflict_resolutions')
      .update({
        status: 'auto_resolved',
        resolution_strategy: applicableRule.resolutionStrategy as ResolutionStrategy,
        resolution_details: { auto_rule: applicableRule.name },
        auto_rule_id: applicableRule.id,
        resolved_at: new Date().toISOString()
      })
      .eq('id', conflictId)

    if (error) {
      logger.error('Failed to auto-resolve conflict', error)
      return false
    }

    await this.logAuditEvent(conflictId, 'auto_resolved', {
      rule_id: applicableRule.id,
      rule_name: applicableRule.name
    })

    return true
  }

  async getConflictStats(): Promise<{
    pending: number
    needsApproval: number
    resolvedToday: number
    autoResolvedToday: number
    byPriority: Record<ConflictPriority, number>
    byType: Record<ConflictType, number>
  }> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: pending } = await supabase
      .from('conflict_resolutions')
      .select('priority, conflict_type, status', { count: 'exact' })
      .in('status', ['pending', 'needs_approval'])

    const { count: resolvedToday } = await supabase
      .from('conflict_resolutions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'resolved')
      .gte('resolved_at', today.toISOString())

    const { count: autoResolvedToday } = await supabase
      .from('conflict_resolutions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'auto_resolved')
      .gte('resolved_at', today.toISOString())

    const byPriority: Record<ConflictPriority, number> = {
      low: 0, medium: 0, high: 0, critical: 0
    }
    const byType: Record<ConflictType, number> = {
      sync_conflict: 0, duplicate: 0, data_quality: 0
    }

    let needsApprovalCount = 0

    for (const row of pending || []) {
      byPriority[row.priority as ConflictPriority]++
      byType[row.conflict_type as ConflictType]++
      if (row.status === 'needs_approval') needsApprovalCount++
    }

    return {
      pending: (pending?.length || 0) - needsApprovalCount,
      needsApproval: needsApprovalCount,
      resolvedToday: resolvedToday || 0,
      autoResolvedToday: autoResolvedToday || 0,
      byPriority,
      byType
    }
  }

  async getAuditHistory(conflictId: string): Promise<Array<{
    id: string
    action: string
    actorId?: string
    actorRole?: string
    fieldChanges: Record<string, unknown>
    justification?: string
    createdAt: string
  }>> {
    const { data, error } = await supabase
      .from('conflict_audit_logs')
      .select('*')
      .eq('conflict_id', conflictId)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch audit history', error)
      return []
    }

    return (data || []).map(log => ({
      id: log.id,
      action: log.action,
      actorId: log.actor_id,
      actorRole: log.actor_role,
      fieldChanges: log.field_changes || {},
      justification: log.justification,
      createdAt: log.created_at
    }))
  }

  private async logAuditEvent(
    conflictId: string,
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    const { error } = await supabase
      .from('conflict_audit_logs')
      .insert({
        conflict_id: conflictId,
        action,
        field_changes: details,
        justification: details.justification as string | undefined
      })

    if (error) {
      logger.error('Failed to log audit event', error)
    }
  }

  private mapFromDB(row: Record<string, unknown>): ConflictResolution {
    return {
      id: row.id as string,
      conflictType: row.conflict_type as ConflictType,
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      candidateIds: (row.candidate_ids as string[]) || [],
      status: row.status as ConflictStatus,
      priority: row.priority as ConflictPriority,
      phiSensitivity: row.phi_sensitivity as PHISensitivity,
      conflictDetails: row.conflict_details as ConflictResolution['conflictDetails'],
      resolutionStrategy: row.resolution_strategy as ResolutionStrategy | undefined,
      resolutionDetails: row.resolution_details as Record<string, unknown> | undefined,
      resolvedBy: row.resolved_by as string | undefined,
      resolvedAt: row.resolved_at as string | undefined,
      approvedBy: row.approved_by as string | undefined,
      approvedAt: row.approved_at as string | undefined,
      autoRuleId: row.auto_rule_id as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }
}

export const conflictQueueService = new ConflictQueueService()

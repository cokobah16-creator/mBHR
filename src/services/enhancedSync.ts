import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { db } from '@/db'
import { queryCache } from '@/utils/queryCache'
import logger from '@/lib/logger'

interface SyncResult {
  success: boolean
  pushed: number
  pulled: number
  conflicts: number
  error?: string
}

interface TableSyncConfig {
  localTable: string
  remoteTable: string
  localToRemote: (local: any) => any
  remoteToLocal: (remote: any) => any
  hasDirtyFlag: boolean
}

class EnhancedSync {
  private client: SupabaseClient | null = null
  private syncing = false
  private lastSyncTimes: Map<string, Date> = new Map()

  initialize(url: string, anonKey: string): boolean {
    if (!url || !anonKey) return false

    try {
      this.client = createClient(url, anonKey, {
        auth: { persistSession: true }
      })
      return true
    } catch (error) {
      logger.error('Failed to initialize Supabase client', error)
      return false
    }
  }

  isInitialized(): boolean {
    return this.client !== null
  }

  isSyncing(): boolean {
    return this.syncing
  }

  private getTableConfig(): TableSyncConfig[] {
    return [
      {
        localTable: 'patients',
        remoteTable: 'patients',
        hasDirtyFlag: true,
        localToRemote: (p) => ({
          id: p.id,
          given_name: p.givenName,
          family_name: p.familyName,
          sex: p.sex,
          dob: p.dob,
          phone: p.phone,
          address: p.address,
          state: p.state,
          lga: p.lga,
          photo_url: p.photoUrl,
          family_id: p.familyId,
          created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
          updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          givenName: r.given_name,
          familyName: r.family_name,
          sex: r.sex,
          dob: r.dob,
          phone: r.phone,
          address: r.address,
          state: r.state,
          lga: r.lga,
          photoUrl: r.photo_url,
          familyId: r.family_id,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'visits',
        remoteTable: 'visits',
        hasDirtyFlag: true,
        localToRemote: (v) => ({
          id: v.id,
          patient_id: v.patientId,
          started_at: v.startedAt instanceof Date ? v.startedAt.toISOString() : v.startedAt,
          site_name: v.siteName,
          status: v.status,
          updated_at: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : v.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          startedAt: new Date(r.started_at),
          siteName: r.site_name,
          status: r.status,
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'vitals',
        remoteTable: 'vitals',
        hasDirtyFlag: true,
        localToRemote: (v) => ({
          id: v.id,
          patient_id: v.patientId,
          visit_id: v.visitId,
          height_cm: v.heightCm,
          weight_kg: v.weightKg,
          temp_c: v.tempC,
          pulse_bpm: v.pulseBpm,
          systolic: v.systolic,
          diastolic: v.diastolic,
          spo2: v.spo2,
          bmi: v.bmi,
          flags: v.flags,
          taken_at: v.takenAt instanceof Date ? v.takenAt.toISOString() : v.takenAt,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          visitId: r.visit_id,
          heightCm: r.height_cm,
          weightKg: r.weight_kg,
          tempC: r.temp_c,
          pulseBpm: r.pulse_bpm,
          systolic: r.systolic,
          diastolic: r.diastolic,
          spo2: r.spo2,
          bmi: r.bmi,
          flags: Array.isArray(r.flags) ? r.flags : [],
          takenAt: new Date(r.taken_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'consultations',
        remoteTable: 'consultations',
        hasDirtyFlag: true,
        localToRemote: (c) => ({
          id: c.id,
          patient_id: c.patientId,
          visit_id: c.visitId,
          provider_name: c.providerName,
          soap_subjective: c.soapSubjective,
          soap_objective: c.soapObjective,
          soap_assessment: c.soapAssessment,
          soap_plan: c.soapPlan,
          provisional_dx: c.provisionalDx || [],
          created_at: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          visitId: r.visit_id,
          providerName: r.provider_name,
          soapSubjective: r.soap_subjective,
          soapObjective: r.soap_objective,
          soapAssessment: r.soap_assessment,
          soapPlan: r.soap_plan,
          provisionalDx: Array.isArray(r.provisional_dx) ? r.provisional_dx : [],
          createdAt: new Date(r.created_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'dispenses',
        remoteTable: 'dispenses',
        hasDirtyFlag: true,
        localToRemote: (d) => ({
          id: d.id,
          patient_id: d.patientId,
          visit_id: d.visitId,
          item_name: d.itemName,
          qty: d.qty,
          dosage: d.dosage,
          directions: d.directions,
          dispensed_by: d.dispensedBy,
          dispensed_at: d.dispensedAt instanceof Date ? d.dispensedAt.toISOString() : d.dispensedAt,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          visitId: r.visit_id,
          itemName: r.item_name,
          qty: r.qty,
          dosage: r.dosage,
          directions: r.directions,
          dispensedBy: r.dispensed_by,
          dispensedAt: new Date(r.dispensed_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'inventory',
        remoteTable: 'inventory',
        hasDirtyFlag: true,
        localToRemote: (i) => ({
          id: i.id,
          item_name: i.itemName,
          unit: i.unit,
          on_hand_qty: i.onHandQty,
          reorder_threshold: i.reorderThreshold,
          updated_at: i.updatedAt instanceof Date ? i.updatedAt.toISOString() : i.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          itemName: r.item_name,
          unit: r.unit,
          onHandQty: r.on_hand_qty,
          reorderThreshold: r.reorder_threshold,
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'queue',
        remoteTable: 'queue',
        hasDirtyFlag: true,
        localToRemote: (q) => ({
          id: q.id,
          patient_id: q.patientId,
          stage: q.stage,
          position: q.position,
          status: q.status,
          updated_at: q.updatedAt instanceof Date ? q.updatedAt.toISOString() : q.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          stage: r.stage,
          position: r.position,
          status: r.status,
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'gameSessions',
        remoteTable: 'game_sessions',
        hasDirtyFlag: true,
        localToRemote: (g) => ({
          id: g.id,
          type: g.type,
          volunteer_id: g.volunteerId,
          started_at: g.startedAt instanceof Date ? g.startedAt.toISOString() : g.startedAt,
          finished_at: g.finishedAt ? (g.finishedAt instanceof Date ? g.finishedAt.toISOString() : g.finishedAt) : null,
          score: g.score,
          tokens_earned: g.tokensEarned,
          payload_json: g.payloadJson,
          committed: g.committed || false,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          type: r.type,
          volunteerId: r.volunteer_id,
          startedAt: new Date(r.started_at),
          finishedAt: r.finished_at ? new Date(r.finished_at) : undefined,
          score: r.score,
          tokensEarned: r.tokens_earned,
          payloadJson: r.payload_json,
          committed: r.committed || false,
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'gamificationWallets',
        remoteTable: 'gamification_wallets',
        hasDirtyFlag: true,
        localToRemote: (w) => ({
          volunteer_id: w.volunteerId,
          tokens: w.tokens,
          badges: w.badges || [],
          level: w.level,
          streak_days: w.streakDays,
          lifetime_tokens: w.lifetimeTokens,
          last_active_date: w.lastActiveDate ? (w.lastActiveDate instanceof Date ? w.lastActiveDate.toISOString() : w.lastActiveDate) : null,
          updated_at: w.updatedAt instanceof Date ? w.updatedAt.toISOString() : w.updatedAt
        }),
        remoteToLocal: (r) => ({
          volunteerId: r.volunteer_id,
          tokens: r.tokens,
          badges: Array.isArray(r.badges) ? r.badges : [],
          level: r.level,
          streakDays: r.streak_days,
          lifetimeTokens: r.lifetime_tokens,
          lastActiveDate: r.last_active_date ? new Date(r.last_active_date) : undefined,
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'stockBatches',
        remoteTable: 'stock_batches',
        hasDirtyFlag: true,
        localToRemote: (b) => ({
          id: b.id,
          drug_id: b.drugId,
          lot_number: b.lotNumber,
          expiry_date: b.expiryDate instanceof Date ? b.expiryDate.toISOString().split('T')[0] : b.expiryDate,
          qty_on_hand: b.qtyOnHand,
          received_at: b.receivedAt instanceof Date ? b.receivedAt.toISOString() : b.receivedAt,
          supplier: b.supplier,
          notes: b.notes,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          drugId: r.drug_id,
          lotNumber: r.lot_number,
          expiryDate: new Date(r.expiry_date),
          qtyOnHand: r.qty_on_hand,
          receivedAt: new Date(r.received_at),
          supplier: r.supplier,
          notes: r.notes,
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'careTasks',
        remoteTable: 'care_tasks',
        hasDirtyFlag: true,
        localToRemote: (t) => ({
          id: t.id,
          patient_id: t.patientId,
          type: t.type,
          title: t.title,
          description: t.description,
          status: t.status,
          due_date: t.dueDate instanceof Date ? t.dueDate.toISOString() : t.dueDate,
          completed_at: t.completedAt ? (t.completedAt instanceof Date ? t.completedAt.toISOString() : t.completedAt) : null,
          created_at: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          type: r.type,
          title: r.title,
          description: r.description,
          status: r.status,
          dueDate: new Date(r.due_date),
          completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
          createdAt: new Date(r.created_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'triageRecords',
        remoteTable: 'triage_records',
        hasDirtyFlag: true,
        localToRemote: (t) => ({
          id: t.id,
          patient_id: t.patientId,
          visit_id: t.visitId,
          priority: t.priority,
          chief_complaint: t.chiefComplaint,
          notes: t.notes,
          created_by: t.createdBy,
          created_at: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
          updated_at: new Date().toISOString()
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          visitId: r.visit_id,
          priority: r.priority,
          chiefComplaint: r.chief_complaint,
          notes: r.notes,
          createdBy: r.created_by,
          createdAt: new Date(r.created_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'patientAllergies',
        remoteTable: 'patient_allergies',
        hasDirtyFlag: true,
        localToRemote: (a) => ({
          id: a.id,
          patient_id: a.patientId,
          allergen: a.allergen,
          allergy_type: a.allergyType,
          reaction: a.reaction,
          severity: a.severity,
          onset_date: a.onsetDate ? (a.onsetDate instanceof Date ? a.onsetDate.toISOString().split('T')[0] : a.onsetDate) : null,
          notes: a.notes,
          is_active: a.isActive,
          created_by: a.createdBy,
          created_at: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
          updated_at: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          allergen: r.allergen,
          allergyType: r.allergy_type,
          reaction: r.reaction,
          severity: r.severity,
          onsetDate: r.onset_date ? new Date(r.onset_date) : undefined,
          notes: r.notes,
          isActive: r.is_active,
          createdBy: r.created_by,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'patientPreferences',
        remoteTable: 'patient_preferences',
        hasDirtyFlag: true,
        localToRemote: (p) => ({
          id: p.id,
          patient_id: p.patientId,
          preferred_language: p.preferredLanguage,
          communication_channel: p.communicationChannel,
          best_contact_time: p.bestContactTime,
          dietary_restrictions: p.dietaryRestrictions,
          religious_cultural: p.religiousCultural,
          appointment_reminders: p.appointmentReminders,
          medication_reminders: p.medicationReminders,
          notes: p.notes,
          created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
          updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          preferredLanguage: r.preferred_language,
          communicationChannel: r.communication_channel,
          bestContactTime: r.best_contact_time,
          dietaryRestrictions: r.dietary_restrictions,
          religiousCultural: r.religious_cultural,
          appointmentReminders: r.appointment_reminders,
          medicationReminders: r.medication_reminders,
          notes: r.notes,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      },
      {
        localTable: 'vitalsRanges',
        remoteTable: 'vitals_ranges',
        hasDirtyFlag: false,
        localToRemote: (v) => ({
          id: v.id,
          age_min: v.ageMin,
          age_max: v.ageMax,
          sex: v.sex,
          metric: v.metric,
          min_value: v.min,
          max_value: v.max,
          source: v.source,
          updated_at: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : v.updatedAt
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          ageMin: r.age_min,
          ageMax: r.age_max,
          sex: r.sex,
          metric: r.metric,
          min: r.min_value,
          max: r.max_value,
          source: r.source,
          updatedAt: new Date(r.updated_at)
        })
      }
    ]
  }

  async syncTable(config: TableSyncConfig): Promise<SyncResult> {
    if (!this.client) {
      return { success: false, pushed: 0, pulled: 0, conflicts: 0, error: 'Not initialized' }
    }

    let pushed = 0
    let pulled = 0
    let conflicts = 0

    try {
      const table = (db as any)[config.localTable]
      if (!table) {
        throw new Error(`Table ${config.localTable} not found in local database`)
      }

      // Push dirty records
      if (config.hasDirtyFlag) {
        const dirtyRecords = await table.where('_dirty').equals(1).toArray()

        for (const record of dirtyRecords) {
          const remoteData = config.localToRemote(record)
          const { error } = await this.client
            .from(config.remoteTable)
            .upsert(remoteData)

          if (!error) {
            await table.update(record.id, {
              _dirty: 0,
              _syncedAt: new Date().toISOString()
            })
            pushed++
          } else {
            logger.error(`Failed to push ${config.localTable} record`, error)
            conflicts++
          }
        }
      }

      // Pull new/updated records
      const lastSync = this.lastSyncTimes.get(config.localTable)?.toISOString() || '1970-01-01'

      const { data: remoteRecords, error: pullError } = await this.client
        .from(config.remoteTable)
        .select('*')
        .gt('updated_at', lastSync)
        .order('updated_at', { ascending: true })
        .limit(100)

      if (!pullError && remoteRecords) {
        for (const remote of remoteRecords) {
          const localData = config.remoteToLocal(remote)
          await table.put(localData)
          pulled++
        }

        if (remoteRecords.length > 0) {
          this.lastSyncTimes.set(config.localTable, new Date())
        }
      }

      // Clear cache for this table
      queryCache.invalidatePattern(new RegExp(`^${config.localTable}:`))

      return { success: true, pushed, pulled, conflicts }
    } catch (error: any) {
      logger.error(`Sync failed for ${config.localTable}`, error)
      return { success: false, pushed, pulled, conflicts, error: error.message }
    }
  }

  async syncAll(): Promise<SyncResult> {
    if (!this.client || this.syncing) {
      return { success: false, pushed: 0, pulled: 0, conflicts: 0, error: 'Already syncing or not initialized' }
    }

    this.syncing = true
    const startTime = Date.now()

    let totalPushed = 0
    let totalPulled = 0
    let totalConflicts = 0

    try {
      logger.log('Starting full sync...')

      const configs = this.getTableConfig()

      for (const config of configs) {
        const result = await this.syncTable(config)
        totalPushed += result.pushed
        totalPulled += result.pulled
        totalConflicts += result.conflicts

        if (!result.success) {
          logger.error(`Failed to sync table: ${config.localTable}`, result.error)
        }
      }

      const duration = Date.now() - startTime
      logger.log(`Sync completed in ${duration}ms - Pushed: ${totalPushed}, Pulled: ${totalPulled}, Conflicts: ${totalConflicts}`)

      return {
        success: true,
        pushed: totalPushed,
        pulled: totalPulled,
        conflicts: totalConflicts
      }
    } catch (error: any) {
      logger.error('Full sync failed', error)
      return {
        success: false,
        pushed: totalPushed,
        pulled: totalPulled,
        conflicts: totalConflicts,
        error: error.message
      }
    } finally {
      this.syncing = false
    }
  }

  async getPendingChangesCount(): Promise<number> {
    const configs = this.getTableConfig().filter(c => c.hasDirtyFlag)

    const counts = await Promise.all(
      configs.map(async (config) => {
        const table = (db as any)[config.localTable]
        if (!table) return 0
        return await table.where('_dirty').equals(1).count()
      })
    )

    return counts.reduce((sum, count) => sum + count, 0)
  }

  getLastSyncTime(tableName: string): Date | null {
    return this.lastSyncTimes.get(tableName) || null
  }
}

export const enhancedSync = new EnhancedSync()

// Initialize on startup
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (url && key && url.startsWith('http')) {
  enhancedSync.initialize(url, key)
  logger.log('Enhanced sync service initialized')
}

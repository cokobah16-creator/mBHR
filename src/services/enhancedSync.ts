import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { checkCloudSession } from "@/lib/cloudSession";
import { db } from "@/db";
import { queryCache } from "@/utils/queryCache";
import logger from "@/lib/logger";
import { getErrorMessage } from "@/utils/errors";
import { mergePulledRow } from "@/sync/pullMerge";
import { markersAfterUpload } from "@/sync/uploadMarkers";
import { syncErrorCode } from "@/sync/errorCode";

export interface TableSyncFailure {
  /** This device's table name. */
  table: string;
  /** Short reason, for display. */
  error: string;
}

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  /**
   * Uploads the server refused. Those records stay on this device, still
   * marked unsent, and are retried on the next sync.
   */
  failedUploads: number;
  /**
   * @deprecated Same number as failedUploads: uploads the server refused,
   * not edit conflicts. Kept so existing callers keep working.
   */
  conflicts: number;
  /**
   * Downloaded rows not written because this device has changes to them
   * that are not uploaded yet.
   */
  keptLocalEdits: number;
  /** syncAll only: tables that did not finish (local error or failed download). */
  failedTables?: TableSyncFailure[];
  error?: string;
}

interface TableSyncConfig {
  localTable: string;
  remoteTable: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localToRemote: (local: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  remoteToLocal: (remote: any) => any;
  hasDirtyFlag: boolean;
  /** This device's primary key field; "id" when not given. */
  primaryKey?: string;
}

const EPOCH_CURSOR = "1970-01-01";
const PULL_PAGE_SIZE = 100;
/** Pages per table per run (PULL_PAGE_SIZE rows each); the rest come next run. */
const PULL_MAX_PAGES = 10;
const PULL_CURSOR_KEY = (localTable: string) =>
  `enhanced_sync_cursor:${localTable}`;

function emptyResult(error: string): SyncResult {
  return {
    success: false,
    pushed: 0,
    pulled: 0,
    failedUploads: 0,
    conflicts: 0,
    keptLocalEdits: 0,
    error,
  };
}

export class EnhancedSync {
  private client: SupabaseClient | null = null;
  private syncing = false;
  /** When Sync now last downloaded rows for each table (shown to staff). */
  private lastSyncTimes: Map<string, Date> = new Map();
  /**
   * Newest server updated_at downloaded per table (also saved in settings).
   * Downloads continue from here, so rows past the page limit are fetched
   * next time instead of being skipped (a cursor taken from this device's
   * clock skipped them).
   */
  private pullCursors: Map<string, string> = new Map();

  initialize(url: string, anonKey: string): boolean {
    if (!url || !anonKey || url === "your_supabase_project_url_here") {
      logger.log("Supabase not configured, running in offline-only mode");
      return false;
    }

    try {
      this.client = createClient(url, anonKey, {
        auth: { persistSession: true },
      });
      logger.log("Supabase client initialized successfully");
      return true;
    } catch (error) {
      logger.error("Failed to initialize Supabase client", syncErrorCode(error));
      return false;
    }
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  /** Where this table's download continues: this session's cursor, else the saved one. */
  private async readPullCursor(localTable: string): Promise<string> {
    const inSession = this.pullCursors.get(localTable);
    if (inSession) return inSession;
    try {
      const saved = await db.settings.get(PULL_CURSOR_KEY(localTable));
      if (saved && typeof saved.value === "string" && saved.value) {
        return saved.value;
      }
    } catch {
      // Not readable: start from the oldest rows (nothing is skipped).
    }
    return EPOCH_CURSOR;
  }

  private async savePullCursor(localTable: string, cursor: string): Promise<void> {
    this.pullCursors.set(localTable, cursor);
    try {
      await db.settings.put({ key: PULL_CURSOR_KEY(localTable), value: cursor });
    } catch {
      // Kept for this session only; after a restart the download repeats
      // from the last saved point, which re-reads rows but skips none.
    }
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  /**
   * Tables this engine syncs. patients and queue are not here: the shared
   * sync adapter (src/sync/adapter.ts) alone uploads and downloads them,
   * with server row versions and the server-owned fields (portal access,
   * merge links, queue tickets). Two engines uploading the same table with
   * different column sets would overwrite each other's changes.
   */
  private getTableConfig(): TableSyncConfig[] {
    return [
      {
        localTable: "visits",
        remoteTable: "visits",
        hasDirtyFlag: true,
        localToRemote: (v) => ({
          id: v.id,
          patient_id: v.patientId,
          started_at:
            v.startedAt instanceof Date
              ? v.startedAt.toISOString()
              : v.startedAt,
          site_name: v.siteName,
          status: v.status,
          updated_at:
            v.updatedAt instanceof Date
              ? v.updatedAt.toISOString()
              : v.updatedAt,
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          patientId: r.patient_id,
          startedAt: new Date(r.started_at),
          siteName: r.site_name,
          status: r.status,
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "vitals",
        remoteTable: "vitals",
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
          taken_at:
            v.takenAt instanceof Date ? v.takenAt.toISOString() : v.takenAt,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "consultations",
        remoteTable: "consultations",
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
          created_at:
            c.createdAt instanceof Date
              ? c.createdAt.toISOString()
              : c.createdAt,
          updated_at: new Date().toISOString(),
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
          provisionalDx: Array.isArray(r.provisional_dx)
            ? r.provisional_dx
            : [],
          createdAt: new Date(r.created_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "dispenses",
        remoteTable: "dispenses",
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
          dispensed_at:
            d.dispensedAt instanceof Date
              ? d.dispensedAt.toISOString()
              : d.dispensedAt,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "inventory",
        remoteTable: "inventory",
        hasDirtyFlag: true,
        localToRemote: (i) => ({
          id: i.id,
          item_name: i.itemName,
          unit: i.unit,
          on_hand_qty: i.onHandQty,
          reorder_threshold: i.reorderThreshold,
          updated_at:
            i.updatedAt instanceof Date
              ? i.updatedAt.toISOString()
              : i.updatedAt,
        }),
        remoteToLocal: (r) => ({
          id: r.id,
          itemName: r.item_name,
          unit: r.unit,
          onHandQty: r.on_hand_qty,
          reorderThreshold: r.reorder_threshold,
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "gameSessions",
        remoteTable: "game_sessions",
        hasDirtyFlag: true,
        localToRemote: (g) => ({
          id: g.id,
          type: g.type,
          volunteer_id: g.volunteerId,
          started_at:
            g.startedAt instanceof Date
              ? g.startedAt.toISOString()
              : g.startedAt,
          finished_at: g.finishedAt
            ? g.finishedAt instanceof Date
              ? g.finishedAt.toISOString()
              : g.finishedAt
            : null,
          score: g.score,
          tokens_earned: g.tokensEarned,
          payload_json: g.payloadJson,
          committed: g.committed || false,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "gamificationWallets",
        remoteTable: "gamification_wallets",
        hasDirtyFlag: true,
        primaryKey: "volunteerId",
        localToRemote: (w) => ({
          volunteer_id: w.volunteerId,
          tokens: w.tokens,
          badges: w.badges || [],
          level: w.level,
          streak_days: w.streakDays,
          lifetime_tokens: w.lifetimeTokens,
          last_active_date: w.lastActiveDate
            ? w.lastActiveDate instanceof Date
              ? w.lastActiveDate.toISOString()
              : w.lastActiveDate
            : null,
          updated_at:
            w.updatedAt instanceof Date
              ? w.updatedAt.toISOString()
              : w.updatedAt,
        }),
        remoteToLocal: (r) => ({
          volunteerId: r.volunteer_id,
          tokens: r.tokens,
          badges: Array.isArray(r.badges) ? r.badges : [],
          level: r.level,
          streakDays: r.streak_days,
          lifetimeTokens: r.lifetime_tokens,
          lastActiveDate: r.last_active_date
            ? new Date(r.last_active_date)
            : undefined,
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "stockBatches",
        remoteTable: "stock_batches",
        hasDirtyFlag: true,
        localToRemote: (b) => ({
          id: b.id,
          drug_id: b.drugId,
          lot_number: b.lotNumber,
          expiry_date:
            b.expiryDate instanceof Date
              ? b.expiryDate.toISOString().split("T")[0]
              : b.expiryDate,
          qty_on_hand: b.qtyOnHand,
          received_at:
            b.receivedAt instanceof Date
              ? b.receivedAt.toISOString()
              : b.receivedAt,
          supplier: b.supplier,
          notes: b.notes,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "careTasks",
        remoteTable: "care_tasks",
        hasDirtyFlag: true,
        localToRemote: (t) => ({
          id: t.id,
          patient_id: t.patientId,
          type: t.type,
          title: t.title,
          description: t.description,
          status: t.status,
          due_date:
            t.dueDate instanceof Date ? t.dueDate.toISOString() : t.dueDate,
          completed_at: t.completedAt
            ? t.completedAt instanceof Date
              ? t.completedAt.toISOString()
              : t.completedAt
            : null,
          created_at:
            t.createdAt instanceof Date
              ? t.createdAt.toISOString()
              : t.createdAt,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "triageRecords",
        remoteTable: "triage_records",
        hasDirtyFlag: true,
        localToRemote: (t) => ({
          id: t.id,
          patient_id: t.patientId,
          visit_id: t.visitId,
          priority: t.priority,
          chief_complaint: t.chiefComplaint,
          notes: t.notes,
          created_by: t.createdBy,
          created_at:
            t.createdAt instanceof Date
              ? t.createdAt.toISOString()
              : t.createdAt,
          updated_at: new Date().toISOString(),
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "patientAllergies",
        remoteTable: "patient_allergies",
        hasDirtyFlag: true,
        localToRemote: (a) => ({
          id: a.id,
          patient_id: a.patientId,
          allergen: a.allergen,
          allergy_type: a.allergyType,
          reaction: a.reaction,
          severity: a.severity,
          onset_date: a.onsetDate
            ? a.onsetDate instanceof Date
              ? a.onsetDate.toISOString().split("T")[0]
              : a.onsetDate
            : null,
          notes: a.notes,
          is_active: a.isActive,
          created_by: a.createdBy,
          created_at:
            a.createdAt instanceof Date
              ? a.createdAt.toISOString()
              : a.createdAt,
          updated_at:
            a.updatedAt instanceof Date
              ? a.updatedAt.toISOString()
              : a.updatedAt,
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
          isActive: toAllergyActiveFlag(r.is_active),
          createdBy: r.created_by,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "patientPreferences",
        remoteTable: "patient_preferences",
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
          created_at:
            p.createdAt instanceof Date
              ? p.createdAt.toISOString()
              : p.createdAt,
          updated_at:
            p.updatedAt instanceof Date
              ? p.updatedAt.toISOString()
              : p.updatedAt,
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
          _syncedAt: new Date().toISOString(),
        }),
      },
      {
        localTable: "vitalsRanges",
        remoteTable: "vitals_ranges",
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
          updated_at:
            v.updatedAt instanceof Date
              ? v.updatedAt.toISOString()
              : v.updatedAt,
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
          updatedAt: new Date(r.updated_at),
        }),
      },
    ];
  }

  async syncTable(config: TableSyncConfig): Promise<SyncResult> {
    if (!this.client) return emptyResult("Not initialized");

    const key = config.primaryKey ?? "id";
    let pushed = 0;
    let pulled = 0;
    let failedUploads = 0;
    let keptLocalEdits = 0;
    let downloadError: string | undefined;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const table = (db as any)[config.localTable];
      if (!table) {
        throw new Error(
          `Table ${config.localTable} not found in local database`,
        );
      }

      // Push dirty records
      if (config.hasDirtyFlag) {
        const dirtyRecords = await table.where("_dirty").equals(1).toArray();

        for (const record of dirtyRecords) {
          const remoteData = config.localToRemote(record);
          const { error } = await this.client
            .from(config.remoteTable)
            .upsert(remoteData);

          if (!error) {
            // Mark it clean only if it was not edited during the upload; a
            // newer edit stays marked unsent (and safe from the download).
            const syncedAt = new Date().toISOString();
            await db.transaction("rw", table, async () => {
              const current = await table.get(record[key]);
              await table.update(
                record[key],
                markersAfterUpload(record, current, syncedAt),
              );
            });
            pushed++;
          } else {
            // Stays marked unsent; retried on the next sync.
            logger.error(
              `[sync] upload refused for ${config.localTable}`,
              syncErrorCode(error),
            );
            failedUploads++;
          }
        }
      }

      // Pull new/updated records, oldest first, from where the last
      // download stopped (saved on this device, so an app restart does not
      // start again from the oldest rows). A full page means more rows are
      // waiting, so keep going, up to PULL_MAX_PAGES pages per run.
      let cursor = await this.readPullCursor(config.localTable);

      for (let page = 0; page < PULL_MAX_PAGES; page++) {
        const { data: remoteRecords, error: pullError } = await this.client
          .from(config.remoteTable)
          .select("*")
          .gt("updated_at", cursor)
          .order("updated_at", { ascending: true })
          .limit(PULL_PAGE_SIZE);

        if (pullError) {
          const code = syncErrorCode(pullError);
          logger.error(`[sync] download failed for ${config.localTable}`, code);
          downloadError = `Download failed (${code})`;
          break;
        }
        if (!remoteRecords || remoteRecords.length === 0) break;

        let newest = cursor;
        // Read and write each row in one transaction so an edit saved on
        // this device in between cannot be overwritten.
        await db.transaction("rw", table, async () => {
          for (const remote of remoteRecords) {
            // The cursor advances past every row, applied or kept local.
            if (typeof remote.updated_at === "string" && remote.updated_at > newest) {
              newest = remote.updated_at;
            }
            const incoming = config.remoteToLocal(remote);
            const localRow = await table.get(incoming[key]);
            // Rows with unsent changes on this device are kept (their upload
            // is retried); others get the server row laid over the local
            // one so device-only fields survive.
            const decision = mergePulledRow(localRow, incoming);
            if (decision.kind === "kept-local") {
              keptLocalEdits++;
              continue;
            }
            await table.put(decision.row);
            pulled++;
          }
        });

        this.lastSyncTimes.set(config.localTable, new Date());
        // Rows without a usable updated_at cannot move the cursor; stop
        // instead of asking for the same page again.
        if (newest === cursor) break;
        cursor = newest;
        await this.savePullCursor(config.localTable, cursor);
        if (remoteRecords.length < PULL_PAGE_SIZE) break;
      }

      // Clear cache for this table
      queryCache.invalidatePattern(new RegExp(`^${config.localTable}:`));

      return {
        success: downloadError === undefined,
        pushed,
        pulled,
        failedUploads,
        conflicts: failedUploads,
        keptLocalEdits,
        error: downloadError,
      };
    } catch (error: unknown) {
      logger.error(
        `[sync] sync failed for ${config.localTable}`,
        syncErrorCode(error),
      );
      return {
        success: false,
        pushed,
        pulled,
        failedUploads,
        conflicts: failedUploads,
        keptLocalEdits,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Sync every table. `success` is true only when every table finished;
   * `failedTables` lists the ones that did not. Uploads the server refused
   * are counted in `failedUploads` and do not by themselves fail a table.
   */
  async syncAll(): Promise<SyncResult> {
    if (!this.client || this.syncing) {
      return {
        ...emptyResult("Already syncing or not initialized"),
        failedTables: [],
      };
    }
    // Never sync without an online sign-in (e.g. after a PIN unlock).
    if (!(await checkCloudSession())) {
      return { ...emptyResult("NoCloudSession"), failedTables: [] };
    }

    this.syncing = true;
    const startTime = Date.now();

    let totalPushed = 0;
    let totalPulled = 0;
    let totalFailedUploads = 0;
    let totalKeptLocal = 0;
    const failedTables: TableSyncFailure[] = [];

    try {
      logger.log("Starting full sync...");

      const configs = this.getTableConfig();

      for (const config of configs) {
        const result = await this.syncTable(config);
        totalPushed += result.pushed;
        totalPulled += result.pulled;
        totalFailedUploads += result.failedUploads;
        totalKeptLocal += result.keptLocalEdits;

        if (!result.success) {
          failedTables.push({
            table: config.localTable,
            error: result.error ?? "Sync failed",
          });
          logger.error(`[sync] table did not sync: ${config.localTable}`);
        }
      }

      const duration = Date.now() - startTime;
      logger.log(
        `Sync completed in ${duration}ms - Pushed: ${totalPushed}, Pulled: ${totalPulled}, Refused uploads: ${totalFailedUploads}, Kept local edits: ${totalKeptLocal}, Tables failed: ${failedTables.length}`,
      );

      const success = failedTables.length === 0;
      return {
        success,
        pushed: totalPushed,
        pulled: totalPulled,
        failedUploads: totalFailedUploads,
        conflicts: totalFailedUploads,
        keptLocalEdits: totalKeptLocal,
        failedTables,
        error: success
          ? undefined
          : `${failedTables.length} of ${configs.length} tables did not sync: ${failedTables
              .map((f) => f.table)
              .join(", ")}`,
      };
    } catch (error: unknown) {
      logger.error("[sync] full sync failed", syncErrorCode(error));
      return {
        success: false,
        pushed: totalPushed,
        pulled: totalPulled,
        failedUploads: totalFailedUploads,
        conflicts: totalFailedUploads,
        keptLocalEdits: totalKeptLocal,
        failedTables,
        error: getErrorMessage(error),
      };
    } finally {
      this.syncing = false;
    }
  }

  async getPendingChangesCount(): Promise<number> {
    const configs = this.getTableConfig().filter((c) => c.hasDirtyFlag);

    const counts = await Promise.all(
      configs.map(async (config) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = (db as any)[config.localTable];
        if (!table) return 0;
        return await table.where("_dirty").equals(1).count();
      }),
    );

    return counts.reduce((sum, count) => sum + count, 0);
  }

  getLastSyncTime(tableName: string): Date | null {
    return this.lastSyncTimes.get(tableName) || null;
  }
}

export const enhancedSync = new EnhancedSync();

// Initialize on startup
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (url && key && url.startsWith("http")) {
  enhancedSync.initialize(url, key);
  logger.log("Enhanced sync service initialized");
}

// src/sync/adapter.ts
import { supabase as sharedClient } from "@/lib/supabase";
import { checkCloudSession } from "@/lib/cloudSession";
import { db } from "../db";
import { PendingOperation, processQueue } from "../stores/operationsQueue";
import { useSyncStore } from "../stores/syncStore";
import type {
  ConflictData,
  ConflictField,
} from "../components/ConflictResolutionModal";
import { findFieldConflicts } from "./fieldCompare";
import { mergePulledRow } from "./pullMerge";
import { markersAfterUpload } from "./uploadMarkers";
import { namedSyncError, syncErrorCode } from "./errorCode";
import { queueSyncConflicts } from "./queueConflicts";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Check if URL and key are valid (not placeholder values)
const isValidUrl =
  url &&
  key &&
  url !== "your_supabase_project_url_here" &&
  key !== "your_supabase_anon_key_here" &&
  (url.startsWith("http://") || url.startsWith("https://"));

// The shared client carries the staff member's online sign-in, so the
// server's row-level security sees who is syncing. (A private client with
// persistSession: false synced as the anonymous role and was refused.)
const sb = isValidUrl ? sharedClient : null;

/** syncNow result error when there is no online sign-in (not a failure). */
export const NO_CLOUD_SESSION = "NoCloudSession";

export function isOnlineSyncEnabled() {
  return !!sb;
}

type Tbl =
  | "app_users"
  | "patients"
  | "visits"
  | "vitals"
  | "consultations"
  | "dispenses"
  | "inventory"
  | "queue"
  | "patient_allergies"
  | "patient_preferences"
  | "queue_transitions";

/**
 * Append-only audit tables. Rows are created on a device and never edited,
 * so they are uploaded with insert-if-absent (no conflict check, no update
 * of a server row) and never downloaded: the server copy is read by
 * admins, auditors and lead clinicians, not by devices.
 */
const APPEND_ONLY: ReadonlySet<Tbl> = new Set<Tbl>(["queue_transitions"]);

const mapToDB: Record<Tbl, Record<string, string>> = {
  app_users: {
    id: "id",
    fullName: "full_name",
    role: "role",
    adminAccess: "admin_access",
    adminPermanent: "admin_permanent",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  patients: {
    id: "id",
    givenName: "given_name",
    familyName: "family_name",
    sex: "sex",
    dob: "dob",
    phone: "phone",
    address: "address",
    state: "state",
    lga: "lga",
    photoUrl: "photo_url",
    familyId: "family_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  visits: {
    id: "id",
    patientId: "patient_id",
    startedAt: "started_at",
    siteName: "site_name",
    status: "status",
    updatedAt: "updated_at",
  },
  vitals: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    heightCm: "height_cm",
    weightKg: "weight_kg",
    tempC: "temp_c",
    pulseBpm: "pulse_bpm",
    systolic: "systolic",
    diastolic: "diastolic",
    spo2: "spo2",
    bmi: "bmi",
    flags: "flags",
    takenAt: "taken_at",
    updatedAt: "updated_at",
  },
  consultations: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    providerName: "provider_name",
    soapSubjective: "soap_subjective",
    soapObjective: "soap_objective",
    soapAssessment: "soap_assessment",
    soapPlan: "soap_plan",
    provisionalDx: "provisional_dx",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  dispenses: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    itemName: "item_name",
    qty: "qty",
    dosage: "dosage",
    directions: "directions",
    dispensedBy: "dispensed_by",
    dispensedAt: "dispensed_at",
    updatedAt: "updated_at",
  },
  inventory: {
    id: "id",
    itemName: "item_name",
    unit: "unit",
    onHandQty: "on_hand_qty",
    reorderThreshold: "reorder_threshold",
    updatedAt: "updated_at",
  },
  queue: {
    id: "id",
    patientId: "patient_id",
    stage: "stage",
    position: "position",
    status: "status",
    // Urgent status must reach every device (owner decision): sync it.
    priority: "priority",
    queuedAt: "queued_at",
    createdBy: "created_by",
    updatedAt: "updated_at",
  },
  patient_allergies: {
    id: "id",
    patientId: "patient_id",
    allergen: "allergen",
    allergyType: "allergy_type",
    reaction: "reaction",
    severity: "severity",
    onsetDate: "onset_date",
    notes: "notes",
    isActive: "is_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
    createdBy: "created_by",
  },
  patient_preferences: {
    id: "id",
    patientId: "patient_id",
    preferredLanguage: "preferred_language",
    communicationChannel: "communication_channel",
    bestContactTime: "best_contact_time",
    dietaryRestrictions: "dietary_restrictions",
    religiousCultural: "religious_cultural",
    appointmentReminders: "appointment_reminders",
    medicationReminders: "medication_reminders",
    notes: "notes",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  queue_transitions: {
    id: "id",
    queueItemId: "queue_item_id",
    toQueueItemId: "to_queue_item_id",
    patientId: "patient_id",
    kind: "kind",
    fromStage: "from_stage",
    toStage: "to_stage",
    fromStatus: "from_status",
    toStatus: "to_status",
    fromPriority: "from_priority",
    toPriority: "to_priority",
    reason: "reason",
    userId: "user_id",
    userRole: "user_role",
    deviceId: "device_id",
    at: "at",
  },
};

const mapFromDB: Record<Tbl, Record<string, string>> = Object.fromEntries(
  Object.entries(mapToDB).map(([t, m]) => [
    t,
    Object.fromEntries(Object.entries(m).map(([app, db]) => [db, app])),
  ]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDB(obj: any, map: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  for (const [appKey, dbKey] of Object.entries(map))
    if (obj[appKey] !== undefined) out[dbKey] = obj[appKey];
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDB(obj: any, map: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  for (const [dbKey, appKey] of Object.entries(map))
    if (obj[dbKey] !== undefined) out[appKey] = obj[dbKey];
  return out;
}

const tables: Tbl[] = [
  "app_users",
  "patients",
  "visits",
  "vitals",
  "consultations",
  "dispenses",
  "inventory",
  "queue",
  "patient_allergies",
  "patient_preferences",
  "queue_transitions",
];

// Map remote table names to local Dexie table names
const localTableMap: Record<Tbl, string> = {
  app_users: "users",
  patients: "patients",
  visits: "visits",
  vitals: "vitals",
  consultations: "consultations",
  dispenses: "dispenses",
  inventory: "inventory",
  queue: "queue",
  patient_allergies: "patientAllergies",
  patient_preferences: "patientPreferences",
  queue_transitions: "queueTransitions",
};

/**
 * Records saved on this device that have not been uploaded yet (rows with
 * _dirty = 1 in every synced table). Safe to call inside a Dexie liveQuery.
 */
export async function countUnsyncedRecords(): Promise<number> {
  let total = 0;
  for (const t of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[localTableMap[t]];
    if (!table) continue;
    total += await table
      .where("_dirty")
      .equals(1)
      .count()
      .catch(() => 0);
  }
  return total;
}

// --- Cursor helpers (per-table) ---
const DEFAULT_TS = "1970-01-01T00:00:00.000Z";
const CURSOR_KEY = (t: Tbl) => `sync_cursor:${t}`;

async function getCursor(table: Tbl): Promise<string> {
  // settings store shape: { key: string, value: any }

  const row = await db.settings.get(CURSOR_KEY(table)).catch(() => undefined);
  const ts = row?.value?.ts ?? row?.ts ?? row?.value ?? undefined; // be liberal in what we accept
  if (typeof ts === "string" && ts) return ts;
  return DEFAULT_TS;
}

async function setCursor(table: Tbl, ts: string) {
  const iso = new Date(ts).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.settings.put({ key: CURSOR_KEY(table), value: iso as any });
}

// Detect conflicts by comparing local and remote versions
type ConflictDetectionResult = {
  hasConflict: boolean;
  conflicts?: ConflictField[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  remoteData?: any;
};

async function detectConflict(
  table: Tbl,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData: any,
): Promise<ConflictDetectionResult> {
  if (!sb) return { hasConflict: false };

  try {
    const { data: remoteData, error } = await sb
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !remoteData) return { hasConflict: false };

    const localUpdated = new Date(
      localData.updatedAt || localData.updated_at,
    ).getTime();
    const remoteUpdated = new Date(remoteData.updated_at).getTime();

    // No conflict if local is newer or same timestamp
    if (localUpdated >= remoteUpdated) return { hasConflict: false };

    // Check if there's a synced timestamp and data hasn't changed since
    if (localData._syncedAt) {
      const syncedAt = new Date(localData._syncedAt).getTime();
      if (remoteUpdated <= syncedAt) return { hasConflict: false };
    }

    // Detect field-level conflicts. Values are normalised first (Date vs
    // ISO string, null vs missing, JSON key order) so a different shape of
    // the same value is not reported as a conflict.
    const conflicts: ConflictField[] = findFieldConflicts(
      localData,
      remoteData,
      mapToDB[table],
    );

    if (conflicts.length === 0) return { hasConflict: false };

    return {
      hasConflict: true,
      conflicts,
      localData,
      remoteData,
    };
  } catch {
    return { hasConflict: false };
  }
}

export async function pushChanges() {
  if (!sb) return { conflicts: [] as ConflictData[] };

  const detectedConflicts: ConflictData[] = [];

  for (const t of tables) {
    const localTable = localTableMap[t];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirty = await (db as any)[localTable]
      .where("_dirty")
      .equals(1)
      .toArray()
      .catch((e: unknown) => {
        console.error(
          `[sync] failed to read dirty records for ${t}:`,
          syncErrorCode(e),
        );
        return [];
      });
    if (!dirty?.length) continue;

    for (const record of dirty) {
      // Check for conflicts before pushing (append-only rows cannot conflict)
      const conflictCheck = APPEND_ONLY.has(t)
        ? { hasConflict: false as const }
        : await detectConflict(t, record.id, record);

      if (conflictCheck.hasConflict && conflictCheck.conflicts) {
        detectedConflicts.push({
          entityType: t,
          entityId: record.id,
          localTimestamp: record.updatedAt || new Date().toISOString(),
          remoteTimestamp: conflictCheck.remoteData.updated_at,
          conflicts: conflictCheck.conflicts,
        });
        continue; // Skip this record, needs manual resolution
      }

      // No conflict, proceed with push
      const payload = toDB(record, mapToDB[t]);
      // Append-only rows: insert if absent, so a retry after a lost reply
      // succeeds without needing (or getting) update rights on the server.
      const { error } = await sb.from(t).upsert(payload, {
        onConflict: "id",
        ignoreDuplicates: APPEND_ONLY.has(t),
      });

      if (!error) {
        // Mark it clean only if it was not edited during the upload; a
        // newer edit stays marked unsent (and safe from the download).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = (db as any)[localTable];
        const syncedAt = new Date().toISOString();
        await db.transaction("rw", table, async () => {
          const current = await table.get(record.id);
          await table.update(
            record.id,
            markersAfterUpload(record, current, syncedAt),
          );
        });
      } else {
        // The row stays marked unsent and is retried on the next sync.
        console.warn(`[sync] upload refused for ${t}`, syncErrorCode(error));
      }
    }
  }

  return { conflicts: detectedConflicts };
}

export interface PullSummary {
  /** Downloaded rows written on this device. */
  applied: number;
  /**
   * Downloaded rows not written because this device has changes to them
   * that are not uploaded yet. The upload step compares those rows with the
   * server copy and raises a conflict when both sides changed.
   */
  keptLocalEdits: number;
  /** Server tables whose download failed in this run. */
  failedTables: string[];
}

export async function pullChanges(): Promise<PullSummary> {
  const summary: PullSummary = {
    applied: 0,
    keptLocalEdits: 0,
    failedTables: [],
  };
  if (!sb) return summary;
  for (const t of tables) {
    if (APPEND_ONLY.has(t)) continue; // upload-only audit tables
    const localTable = localTableMap[t];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[localTable];
    const since = await getCursor(t); // ALWAYS a valid ISO string
    // If it's the default, don't send a gt filter to avoid corner cases
    let q = sb.from(t).select("*");
    if (since !== DEFAULT_TS) q = q.gt("updated_at", since);

    // Oldest changes first: the cursor moves to the newest row of this page,
    // so a page cut off by the limit continues on the next sync instead of
    // skipping the rows it did not return.
    const { data, error } = await q
      .order("updated_at", { ascending: true })
      .limit(1000);
    if (error) {
      console.warn(`[sync] download failed for ${t}`, syncErrorCode(error));
      summary.failedTables.push(t);
      continue;
    }

    const rows = data ?? [];
    let maxTs = since;
    const syncedAt = new Date().toISOString();
    // Read and write each row in one transaction so an edit saved on this
    // device between the read and the write cannot be overwritten.
    if (rows.length > 0) {
      await db.transaction("rw", table, async () => {
        for (const row of rows) {
          // The cursor advances past every row, applied or kept local.
          if (row.updated_at && row.updated_at > maxTs) maxTs = row.updated_at;
          const mapped = fromDB(row, mapFromDB[t]);
          const localRow = await table.get(mapped.id);
          // Rows with unsent changes are kept; others get the server row
          // laid over the local one, so device-only fields survive (queue
          // assignee and ticket number, patient search keys and merge
          // links, staff PIN hashes).
          const decision = mergePulledRow(localRow, mapped, {
            _dirty: 0,
            _syncedAt: syncedAt,
          });
          if (decision.kind === "kept-local") {
            summary.keptLocalEdits += 1;
            continue;
          }
          await table.put(decision.row);
          summary.applied += 1;
        }
      });
    }
    await setCursor(t, maxTs);
  }
  return summary;
}

// Process operations queue and sync with conflict detection
export async function processOperationsQueue(): Promise<ConflictData[]> {
  const detectedConflicts: ConflictData[] = [];

  await processQueue(async (operation: PendingOperation) => {
    const table =
      operation.entity === "patient"
        ? "patients"
        : operation.entity === "visit"
          ? "visits"
          : operation.entity === "vital"
            ? "vitals"
            : operation.entity === "consultation"
              ? "consultations"
              : operation.entity === "dispense"
                ? "dispenses"
                : operation.entity === "inventory"
                  ? "inventory"
                  : operation.entity === "patient_allergy"
                    ? "patient_allergies"
                    : operation.entity === "patient_preference"
                      ? "patient_preferences"
                      : null;

    if (!table) throw new Error(`Unknown entity type: ${operation.entity}`);

    // Check for conflicts
    const conflictCheck = await detectConflict(
      table as Tbl,
      operation.entityId,
      operation.data,
    );

    if (conflictCheck.hasConflict && conflictCheck.conflicts) {
      detectedConflicts.push({
        entityType: table,
        entityId: operation.entityId,
        localTimestamp:
          (operation.data.updatedAt as string) || new Date().toISOString(),
        remoteTimestamp: conflictCheck.remoteData.updated_at,
        conflicts: conflictCheck.conflicts,
      });
      throw new Error("Conflict detected - needs resolution");
    }

    // Process operation based on type
    if (operation.type === "create" || operation.type === "update") {
      const payload = toDB(operation.data, mapToDB[table as Tbl]);
      const { error } = await sb!
        .from(table)
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;

      // Mark as synced in local DB
      const localTable = localTableMap[table as Tbl];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)[localTable].update(operation.entityId, {
        _dirty: 0,
        _syncedAt: new Date().toISOString(),
      });
    } else if (operation.type === "delete") {
      const { error } = await sb!
        .from(table)
        .delete()
        .eq("id", operation.entityId);
      if (error) throw error;
    }
  });

  return detectedConflicts;
}

let syncInProgress = false;

const SYNC_IN_PROGRESS = "Sync already in progress";

export interface SyncNowResult {
  success: boolean;
  conflicts: ConflictData[];
  error?: string;
  /** Server tables whose download failed in this run. */
  downloadFailedTables?: string[];
  /**
   * Downloaded rows not applied because this device has unsent changes to
   * them (kept until they upload or their conflict is resolved).
   */
  keptLocalEdits?: number;
}

export async function syncNow(): Promise<SyncNowResult> {
  if (!isOnlineSyncEnabled()) return { success: false, conflicts: [] };
  // A PIN unlock after logout opens the local workspace only: never sync
  // (or show a sync error) without an online sign-in.
  if (!(await checkCloudSession())) {
    return { success: false, conflicts: [], error: NO_CLOUD_SESSION };
  }
  if (syncInProgress) {
    return { success: false, conflicts: [], error: SYNC_IN_PROGRESS };
  }

  syncInProgress = true;
  const syncStore = useSyncStore.getState();
  syncStore.setStatus("syncing");

  try {
    // Process operations queue first
    const queueConflicts = await processOperationsQueue();

    // Then push remaining dirty records
    const { conflicts: pushConflicts } = await pushChanges();

    // Pull remote changes
    const pulled = await pullChanges();

    const allConflicts = [...queueConflicts, ...pushConflicts];

    syncStore.setLastSuccessAt(Date.now());
    syncStore.setStatus("ok");

    return {
      success: true,
      conflicts: allConflicts,
      downloadFailedTables: pulled.failedTables,
      keptLocalEdits: pulled.keptLocalEdits,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    syncStore.setLastErrorAt(Date.now(), message);
    syncStore.setStatus("error");
    return { success: false, conflicts: [], error: message };
  } finally {
    syncInProgress = false;
  }
}

export function isConfigured() {
  return !!sb;
}

/**
 * The server's current copy of one record (server column names), used to
 * resolve a sync conflict. Resolves to null when the server has no such
 * record. Throws an error that carries only a name when the copy cannot be
 * read: cloud sync not set up, unknown record type, offline, or the
 * request failed.
 */
export async function fetchRemoteRecord(
  entityType: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!sb) throw namedSyncError("SyncNotConfigured");
  if (!(tables as string[]).includes(entityType)) {
    throw namedSyncError("UnknownRecordType");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw namedSyncError("Offline");
  }
  const { data, error } = await sb
    .from(entityType)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn(
      `[sync] could not read the server copy from ${entityType}`,
      syncErrorCode(error),
    );
    throw namedSyncError("RemoteReadFailed");
  }
  return (data as Record<string, unknown> | null) ?? null;
}

// Auto-sync on network reconnection
if (typeof window !== "undefined") {
  window.addEventListener("online", async () => {
    const syncStore = useSyncStore.getState();
    if (syncStore.isOnline && isOnlineSyncEnabled()) {
      setTimeout(() => {
        syncNow()
          // No dialog on automatic runs: queue conflicts for review.
          .then((result) => queueSyncConflicts(result.conflicts))
          .catch((err) => {
            console.error(
              "Auto-sync on reconnection failed:",
              syncErrorCode(err),
            );
          });
      }, 2000); // Wait 2s for stable connection
    }
  });
}

// Background opportunistic push.
//
// Without this, dirty rows could sit on a tablet for hours before the user
// thinks to press "sync" — and if the tablet is lost or wiped before then,
// those rows are gone. The interval below pushes every dirty row at most
// BACKGROUND_SYNC_INTERVAL_MS old, even with no user action.
//
// Guard rails:
//   - skipped while a sync is already running (avoids overlap)
//   - skipped while offline (the network listener handles reconnects)
//   - consecutive failures back off exponentially up to 5 minutes
const BACKGROUND_SYNC_INTERVAL_MS = 60_000; // 60s opportunistic push
const BACKGROUND_SYNC_MAX_BACKOFF_MS = 5 * 60_000;

let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundSyncFailures = 0;
let backgroundSyncActive = false;

function scheduleNextBackgroundSync(delayMs: number): void {
  if (typeof window === "undefined") return;
  if (!backgroundSyncActive) return; // stopped while a run was in flight
  if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
  backgroundSyncTimer = setTimeout(runBackgroundSync, delayMs);
}

async function runBackgroundSync(): Promise<void> {
  try {
    if (!isOnlineSyncEnabled()) {
      backgroundSyncFailures = 0;
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    const store = useSyncStore.getState();
    if (!store.isOnline) {
      // Network listener will resume on `online`.
      backgroundSyncFailures = 0;
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    if (store.status === "syncing") {
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    const result = await syncNow();
    // No dialog on background runs: queue conflicts for review so they are
    // not dropped. Records already queued are skipped.
    if (result.conflicts.length > 0) {
      await queueSyncConflicts(result.conflicts);
    }
    // syncNow reports failure in its result rather than throwing; count it
    // so repeated failures back off.
    if (!result.success && result.error !== SYNC_IN_PROGRESS && result.error !== NO_CLOUD_SESSION) {
      throw namedSyncError("BackgroundSyncFailed");
    }
    backgroundSyncFailures = 0;
    scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
  } catch (err) {
    backgroundSyncFailures += 1;
    const backoff = Math.min(
      BACKGROUND_SYNC_INTERVAL_MS * 2 ** backgroundSyncFailures,
      BACKGROUND_SYNC_MAX_BACKOFF_MS,
    );
    console.warn(
      `[sync] background push failed (attempt ${backgroundSyncFailures}); retry in ${backoff}ms`,
      syncErrorCode(err),
    );
    scheduleNextBackgroundSync(backoff);
  }
}

// Kick off after a small startup delay so the rest of the app can finish
// mounting before we start hitting the network.
export function startBackgroundSync(): void {
  if (typeof window === "undefined") return;
  if (backgroundSyncActive) return; // already running
  backgroundSyncActive = true;
  backgroundSyncFailures = 0;
  scheduleNextBackgroundSync(5_000);
}

/** Stop background sync (for example on sign-out). Safe to call twice. */
export function stopBackgroundSync(): void {
  backgroundSyncActive = false;
  backgroundSyncFailures = 0;
  if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
  backgroundSyncTimer = null;
}

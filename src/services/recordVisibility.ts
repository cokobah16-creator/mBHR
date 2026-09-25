import { supabase } from "@/lib/supabase";
import { db, createAuditLog } from "@/db";
import * as logger from "@/lib/logger";
import { can, type Permission, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { safeErrorLabel } from "./logSafe";

export type RecordType =
  | "vitals"
  | "consultations"
  | "dispenses"
  | "lab_results";

export type VisibilityReason =
  | "sensitive"
  | "preliminary"
  | "error"
  | "staff_review"
  | "patient_request"
  | "other";

interface ToggleVisibilityInput {
  recordType: RecordType;
  recordId: string;
  patientId: string;
  visible: boolean;
  reason?: VisibilityReason;
  performedBy: string;
}

interface BulkToggleInput {
  recordType: RecordType;
  recordIds: string[];
  patientId: string;
  visible: boolean;
  reason?: VisibilityReason;
  performedBy: string;
}

interface VisibilityLogEntry {
  id: string;
  recordType: RecordType;
  recordId: string;
  patientId: string;
  action: "hidden" | "shown";
  reason?: string;
  performedBy: string;
  performedAt: Date;
}

/**
 * Who may hide or show a record in the patient portal, by record type: the
 * people who record that kind of record (and consulting clinicians). The
 * server's record_visibility_log rule allows vitals, consult and dispense
 * holders.
 */
const VISIBILITY_PERMISSIONS: Record<RecordType, Permission[]> = {
  vitals: ["vitals", "consult"],
  consultations: ["consult"],
  dispenses: ["dispense", "consult"],
  lab_results: ["lab_review"],
};

/** May the person signed in on this device change this record type's visibility? */
export function canChangeVisibility(recordType: RecordType): boolean {
  const role = useAuthStore.getState().currentUser?.role as Role | undefined;
  if (!role) return false;
  return VISIBILITY_PERMISSIONS[recordType].some((permission) => can(role, permission));
}

/**
 * Hide or show one record in the patient portal. True only when every write
 * changed a row: this device's copy (when the type is kept on this device)
 * and, when a server is set up, the server's record. A write that changed
 * nothing (record missing, refused by the server, offline) is a failure.
 */
export async function toggleRecordVisibility(
  input: ToggleVisibilityInput,
): Promise<boolean> {
  const now = new Date();

  if (!canChangeVisibility(input.recordType)) {
    logger.warn(`Visibility not changed: this role cannot change ${input.recordType} visibility`);
    return false;
  }

  try {
    const table = getLocalTable(input.recordType);
    if (table) {
      const changed = await table.update(input.recordId, {
        portalVisible: input.visible,
        visibilityReason: input.visible ? undefined : input.reason,
        hiddenBy: input.visible ? undefined : input.performedBy,
        hiddenAt: input.visible ? undefined : now,
        _dirty: 1,
      });
      if (changed === 0) {
        logger.warn(`Visibility not changed: the ${input.recordType} record is not on this device`);
        return false;
      }
    }

    if (supabase) {
      const supabaseTable = getSupabaseTable(input.recordType);

      const { data: updatedRows, error: updateError } = await supabase
        .from(supabaseTable)
        .update({
          portal_visible: input.visible,
          visibility_reason: input.visible ? null : input.reason,
          hidden_by: input.visible ? null : input.performedBy,
          hidden_at: input.visible ? null : now.toISOString(),
        })
        .eq("id", input.recordId)
        .select("id");

      if (updateError || !Array.isArray(updatedRows) || updatedRows.length === 0) {
        logger.error(
          "Visibility not saved on the server:",
          updateError ? safeErrorLabel(updateError) : "no row changed",
        );
        return false;
      }

      const { error: logError } = await supabase
        .from("record_visibility_log")
        .insert({
          record_type: input.recordType,
          record_id: input.recordId,
          patient_id: input.patientId,
          action: input.visible ? "shown" : "hidden",
          reason: input.reason,
          performed_by: input.performedBy,
          performed_at: now.toISOString(),
        });

      if (logError) {
        logger.error("Failed to log visibility change:", safeErrorLabel(logError));
      }
    }

    await createAuditLog(
      input.performedBy,
      input.visible ? "show" : "hide",
      input.recordType,
      input.recordId,
    );
    logger.log(`A ${input.recordType} record's portal visibility was changed`);
    return true;
  } catch (error) {
    logger.error("Failed to toggle record visibility:", safeErrorLabel(error));
    return false;
  }
}

export async function bulkToggleVisibility(
  input: BulkToggleInput,
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const recordId of input.recordIds) {
    const result = await toggleRecordVisibility({
      recordType: input.recordType,
      recordId,
      patientId: input.patientId,
      visible: input.visible,
      reason: input.reason,
      performedBy: input.performedBy,
    });

    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
}

export async function getHiddenRecords(
  patientId: string,
  recordType?: RecordType,
): Promise<
  { type: RecordType; id: string; reason?: string; hiddenAt?: Date }[]
> {
  const results: {
    type: RecordType;
    id: string;
    reason?: string;
    hiddenAt?: Date;
  }[] = [];

  try {
    const types: RecordType[] = recordType
      ? [recordType]
      : ["vitals", "consultations", "dispenses"];

    for (const type of types) {
      const table = getLocalTable(type);
      if (!table) continue;

      const hidden = await table
        .where("patientId")
        .equals(patientId)
        .and((r) => r.portalVisible === false)
        .toArray();

      for (const record of hidden) {
        results.push({
          type,
          id: record.id,
          reason: record.visibilityReason,
          hiddenAt: record.hiddenAt,
        });
      }
    }
  } catch (error) {
    logger.error("Failed to get hidden records:", safeErrorLabel(error));
  }

  return results;
}

export async function getVisibilityLog(
  patientId: string,
  limit: number = 50,
): Promise<VisibilityLogEntry[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("record_visibility_log")
      .select("*")
      .eq("patient_id", patientId)
      .order("performed_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("Failed to fetch visibility log:", safeErrorLabel(error));
      return [];
    }

    return (data || []).map((entry) => ({
      id: entry.id,
      recordType: entry.record_type as RecordType,
      recordId: entry.record_id,
      patientId: entry.patient_id,
      action: entry.action as "hidden" | "shown",
      reason: entry.reason,
      performedBy: entry.performed_by,
      performedAt: new Date(entry.performed_at),
    }));
  } catch (error) {
    logger.error("Failed to get visibility log:", safeErrorLabel(error));
    return [];
  }
}

export async function getPatientVisibilityStats(patientId: string): Promise<{
  total: number;
  hidden: number;
  byType: Record<RecordType, { total: number; hidden: number }>;
}> {
  const stats = {
    total: 0,
    hidden: 0,
    byType: {
      vitals: { total: 0, hidden: 0 },
      consultations: { total: 0, hidden: 0 },
      dispenses: { total: 0, hidden: 0 },
      lab_results: { total: 0, hidden: 0 },
    },
  };

  try {
    const vitals = await db.vitals
      .where("patientId")
      .equals(patientId)
      .toArray();
    stats.byType.vitals.total = vitals.length;
    stats.byType.vitals.hidden = vitals.filter(
      (v) => v.portalVisible === false,
    ).length;

    const consultations = await db.consultations
      .where("patientId")
      .equals(patientId)
      .toArray();
    stats.byType.consultations.total = consultations.length;
    stats.byType.consultations.hidden = consultations.filter(
      (c) => c.portalVisible === false,
    ).length;

    const dispenses = await db.dispenses
      .where("patientId")
      .equals(patientId)
      .toArray();
    stats.byType.dispenses.total = dispenses.length;
    stats.byType.dispenses.hidden = dispenses.filter(
      (d) => d.portalVisible === false,
    ).length;

    stats.total =
      stats.byType.vitals.total +
      stats.byType.consultations.total +
      stats.byType.dispenses.total +
      stats.byType.lab_results.total;

    stats.hidden =
      stats.byType.vitals.hidden +
      stats.byType.consultations.hidden +
      stats.byType.dispenses.hidden +
      stats.byType.lab_results.hidden;
  } catch (error) {
    logger.error("Failed to get visibility stats:", safeErrorLabel(error));
  }

  return stats;
}

function getLocalTable(recordType: RecordType) {
  switch (recordType) {
    case "vitals":
      return db.vitals;
    case "consultations":
      return db.consultations;
    case "dispenses":
      return db.dispenses;
    default:
      return null;
  }
}

function getSupabaseTable(recordType: RecordType): string {
  return recordType;
}

/**
 * Upload portal visibility of records changed on this device (the sync
 * engine does not carry these columns). Only rows with a visibility setting
 * are sent, only by someone allowed to change it, and `_dirty` is left for
 * the sync engine: the rest of the record still has to be uploaded by it.
 * Returns how many rows the server changed and how many it did not.
 */
export async function syncVisibilityChanges(): Promise<{ saved: number; notSaved: number }> {
  const summary = { saved: 0, notSaved: 0 };
  if (!supabase) return summary;

  const sources: { type: RecordType; table: "vitals" | "consultations" | "dispenses" }[] = [
    { type: "vitals", table: "vitals" },
    { type: "consultations", table: "consultations" },
    { type: "dispenses", table: "dispenses" },
  ];

  try {
    for (const { type, table } of sources) {
      if (!canChangeVisibility(type)) continue;
      const dirty = await db[table].where("_dirty").equals(1).toArray();
      for (const record of dirty) {
        if (record.portalVisible === undefined) continue;
        const { data, error } = await supabase
          .from(table)
          .update({
            portal_visible: record.portalVisible,
            visibility_reason: record.visibilityReason ?? null,
            hidden_by: record.hiddenBy ?? null,
            hidden_at: record.hiddenAt ? new Date(record.hiddenAt).toISOString() : null,
          })
          .eq("id", record.id)
          .select("id");

        if (!error && Array.isArray(data) && data.length > 0) {
          summary.saved++;
        } else {
          summary.notSaved++;
        }
      }
    }
    if (summary.notSaved > 0) {
      logger.warn(
        `${summary.notSaved} visibility change(s) not saved on the server yet (record not uploaded, refused or offline)`,
      );
    }
  } catch (error) {
    logger.error("Failed to sync visibility changes:", safeErrorLabel(error));
  }
  return summary;
}

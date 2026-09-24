// Writes a confirmed conflict plan on this device. The caller checks
// permissions first; this module only performs the write it was shown.

import { db, createAuditLog } from "@/db";
import logger from "@/lib/logger";
import { patientDeduplication } from "@/services/patientDeduplication";
import { buildLocalPatch, type DevicePlan } from "./devicePlan";
import { localTable } from "./localContext";

export interface DeviceActor {
  id: string;
  role: string;
}

/** Errors carry a descriptive name only, so logs never hold record data. */
function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export type ApplyResult =
  | { applied: true; fieldsChanged: number }
  | { applied: false };

/**
 * The record write has already succeeded at this point; a failed local audit
 * entry must not be reported as a failed write (the conflict log on the
 * server still holds the decision and who made it).
 */
async function auditOnDevice(
  actor: DeviceActor,
  action: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  try {
    await createAuditLog(actor.role, action, entityType, entityId);
  } catch (error) {
    logger.error(
      "Local audit entry for a conflict decision was not saved",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

export async function applyPlanOnDevice(
  plan: DevicePlan,
  actor: DeviceActor,
  entityType: string,
): Promise<ApplyResult> {
  if (plan.kind === "none") return { applied: false };

  if (plan.kind === "update_record") {
    const table = localTable(plan.table);
    if (!table) throw namedError("LocalTableUnavailable");
    const patch = buildLocalPatch(plan.changes);
    const updated = await table.update(plan.recordId, {
      ...patch,
      updatedAt: new Date(),
      _dirty: 1,
    });
    if (!updated) throw namedError("LocalRecordMissing");
    await auditOnDevice(actor, "conflict_resolution_applied", entityType, plan.recordId);
    return { applied: true, fieldsChanged: Object.keys(patch).length };
  }

  // Duplicate patients: optionally copy chosen values into the kept record,
  // then use the standard patient merge so history moves with the record.
  const patch = buildLocalPatch(plan.copied);
  await db.transaction(
    "rw",
    [
      db.patients,
      db.vitals,
      db.consultations,
      db.dispenses,
      db.visits,
      db.queue,
      db.patientMerges,
      db.patientAllergies,
      db.patientPreferences,
      db.careTasks,
    ],
    async () => {
      if (Object.keys(patch).length > 0) {
        await db.patients.update(plan.winnerId, {
          ...patch,
          updatedAt: new Date(),
          _dirty: 1,
        });
      }
      if (!plan.alreadyMerged) {
        await patientDeduplication.mergePatients(plan.winnerId, plan.loserId, actor.id);
      }
    },
  );
  await auditOnDevice(actor, "conflict_merge_patients", "patients", plan.winnerId);
  return { applied: true, fieldsChanged: Object.keys(patch).length };
}

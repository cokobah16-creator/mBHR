// Writes a confirmed conflict plan on this device. The caller checks
// permissions first; this module only performs the write it was shown.
// Patient merges also check merge_patients (services/patientMerge) and are
// sent to the server, which applies them for every device.

import { db, createAuditLog } from "@/db";
import logger from "@/lib/logger";
import type { Role } from "@/auth/roles";
import { requestMerge } from "@/services/patientMerge";
import { fetchServerVersion } from "@/sync/adapter";
import { serverStampOf } from "@/sync/serverStamp";
import { buildLocalPatch, mergeFieldChoicesFor, type DevicePlan } from "./devicePlan";
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
  | {
      applied: true;
      fieldsChanged: number;
      /** Merges only: how the merge reaches the server. */
      merge?: {
        /** False when cloud sync is not set up on this device. */
        willSync: boolean;
        /** Chosen fields the merge cannot copy (for example an empty name). */
        skippedFields: string[];
      };
    }
  | {
      applied: false;
      /** Plain-English reason nothing was written (merges refused on this device). */
      message?: string;
    };

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
  /** The server's updated_at the conflict was raised on, when known. */
  remoteUpdatedAt?: string,
): Promise<ApplyResult> {
  if (plan.kind === "none") return { applied: false };

  if (plan.kind === "update_record") {
    const table = localTable(plan.table);
    if (!table) throw namedError("LocalTableUnavailable");
    const patch = buildLocalPatch(plan.changes, plan.table);
    // Staff accounts: only the name and contact details are ever written
    // here. With nothing of those to write, leave the record (and whether
    // it is marked unsent) untouched.
    if (plan.table === "users" && Object.keys(patch).length === 0) {
      return {
        applied: false,
        message: "Roles, admin access and sign-in details change only on the Users screen.",
      };
    }
    // Patients and queue: record the server version this decision was
    // applied against, so the next upload is not held back as the same
    // conflict again (skipped when the server cannot be read). Every record
    // type also records the server's updated_at the conflict was raised on
    // (a server change made after it is still compared at the upload).
    const serverVersion = await fetchServerVersion(entityType, plan.recordId);
    const serverStamp = serverStampOf(remoteUpdatedAt);
    const updated = await table.update(plan.recordId, {
      ...patch,
      updatedAt: new Date(),
      _dirty: 1,
      ...(serverVersion !== undefined ? { _serverVersion: serverVersion } : {}),
      ...(serverStamp !== undefined ? { _serverUpdatedAt: serverStamp } : {}),
    });
    if (!updated) throw namedError("LocalRecordMissing");
    await auditOnDevice(actor, "conflict_resolution_applied", entityType, plan.recordId);
    return { applied: true, fieldsChanged: Object.keys(patch).length };
  }

  // Duplicate patients, already merged here: only copy the chosen values
  // onto the kept record (an ordinary edit, uploaded at the next sync).
  if (plan.alreadyMerged) {
    const patch = buildLocalPatch(plan.copied);
    if (Object.keys(patch).length > 0) {
      const updated = await db.patients.update(plan.winnerId, {
        ...patch,
        updatedAt: new Date(),
        _dirty: 1,
      });
      if (!updated) throw namedError("LocalRecordMissing");
    }
    await auditOnDevice(actor, "conflict_merge_patients", "patients", plan.winnerId);
    return { applied: true, fieldsChanged: Object.keys(patch).length };
  }

  // Duplicate patients: merge on this device now and queue the merge for the
  // server, which moves the history and tells every device. The chosen
  // values travel with the merge (the server applies them to the kept record).
  const { choices, skipped } = mergeFieldChoicesFor(plan);
  const result = await requestMerge({
    winnerId: plan.winnerId,
    loserId: plan.loserId,
    fieldChoices: choices,
    source: "conflict_review",
    actor: { id: actor.id, role: actor.role as Role },
  });
  if (result.ok === false) {
    if (result.reason === "not_saved") throw namedError("LocalMergeNotSaved");
    return { applied: false, message: result.message };
  }
  await auditOnDevice(actor, "conflict_merge_patients", "patients", result.winnerId);
  return {
    applied: true,
    fieldsChanged: result.fieldsChanged,
    merge: { willSync: result.willSync, skippedFields: skipped },
  };
}

import { db } from "@/db";
import { ConflictData } from "@/components/ConflictResolutionModal";
import { namedSyncError } from "./errorCode";
import { serverStampOf } from "./serverStamp";

export type ResolutionStrategy = "keep-local" | "keep-remote" | "manual";

interface Resolution {
  [field: string]: "local" | "remote";
}

// Server table name -> this device's table (same mapping as the adapter).
const tableMap: Record<string, string> = {
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
};

/** Server tables whose rows carry row_version (as in the adapter). */
const VERSIONED_TYPES: ReadonlySet<string> = new Set(["patients", "queue"]);

/** A server row_version as a number, or undefined when it has none. */
function serverVersionOf(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const version = Number(value);
  return Number.isFinite(version) ? version : undefined;
}

/**
 * For patients and queue: the server version the decision was made
 * against, so the next upload of this device's copy is not held back as
 * the same conflict again. Empty when the server copy was not available.
 */
function versionMarker(
  entityType: string,
  remoteData: Record<string, unknown> | undefined,
): { _serverVersion?: number } {
  if (!VERSIONED_TYPES.has(entityType) || !remoteData) return {};
  const version = serverVersionOf(remoteData.row_version);
  return version === undefined ? {} : { _serverVersion: version };
}

/**
 * The same for the server's updated_at (every record type). Without it,
 * keeping this device's copy would raise the same conflict at every sync.
 * `preferConflict` (keeping this device's copy, choosing field by field):
 * the updated_at the conflict was raised on, since only the fields compared
 * then were decided; a server change made after it (possibly to other
 * fields) is then compared at the next upload instead of overwritten. Else
 * (keeping the server's copy): the copy just applied, which may be newer.
 */
function stampMarker(
  conflict: ConflictData,
  remoteData: Record<string, unknown> | undefined,
  preferConflict: boolean,
): { _serverUpdatedAt?: string } {
  const raised = serverStampOf(conflict.remoteTimestamp);
  const fetched = serverStampOf(remoteData?.updated_at);
  const stamp = preferConflict ? (raised ?? fetched) : (fetched ?? raised);
  return stamp === undefined ? {} : { _serverUpdatedAt: stamp };
}

export async function resolveConflict(
  conflict: ConflictData,
  strategy: ResolutionStrategy,
  manualResolution?: Resolution,
  localData?: Record<string, unknown>,
  remoteData?: Record<string, unknown>,
): Promise<void> {
  const tableName = tableMap[conflict.entityType] || conflict.entityType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any)[tableName];

  if (!table) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  if (strategy === "keep-local") {
    await table.update(conflict.entityId, {
      _dirty: 1,
      updatedAt: new Date(),
      _syncedAt: null,
      ...versionMarker(conflict.entityType, remoteData),
      ...stampMarker(conflict, remoteData, true),
    });
  } else if (strategy === "keep-remote") {
    if (!remoteData) {
      throw new Error("Remote data not available for keep-remote strategy");
    }

    const mappedData = mapRemoteToLocal(remoteData, conflict.entityType);
    // Lay the server copy over this device's row rather than replacing it,
    // so fields kept only on this device (patient search keys and merge
    // links, queue assignee and ticket number) are not lost.
    const localRow = await table.get(conflict.entityId);

    await table.put({
      ...(localRow ?? {}),
      ...mappedData,
      id: conflict.entityId,
      _dirty: 0,
      _syncedAt: new Date().toISOString(),
      // The copy just read from the server may be newer than the one the
      // conflict was raised on; keep its own timestamp when it has one.
      updatedAt: mappedData.updatedAt ?? new Date(conflict.remoteTimestamp),
      ...stampMarker(conflict, remoteData, false),
    });
  } else if (strategy === "manual" && manualResolution) {
    if (!localData || !remoteData) {
      throw new Error(
        "Both local and remote data required for manual resolution",
      );
    }

    // Only the chosen fields change; every other field of the local record
    // is kept (a put here would have replaced the whole record).
    const resolvedData: Record<string, unknown> = {};

    for (const [field, choice] of Object.entries(manualResolution)) {
      if (field === "id") continue; // the primary key never changes
      if (choice === "local") {
        resolvedData[field] = localData[field];
      } else {
        const remoteField = camelToSnake(field);
        resolvedData[field] = remoteData[remoteField] ?? remoteData[field];
      }
    }

    const updated = await table.update(conflict.entityId, {
      ...resolvedData,
      _dirty: 1,
      updatedAt: new Date(),
      _syncedAt: null,
      ...versionMarker(conflict.entityType, remoteData),
      ...stampMarker(conflict, remoteData, true),
    });
    // update() writes nothing when the record is not on this device; say so
    // instead of reporting the choice as applied.
    if (!updated) throw namedSyncError("LocalRecordMissing");
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function mapRemoteToLocal(
  remoteData: Record<string, unknown>,
  entityType: string,
): Record<string, unknown> {
  const fieldMaps: Record<string, Record<string, string>> = {
    patients: {
      given_name: "givenName",
      family_name: "familyName",
      photo_url: "photoUrl",
      family_id: "familyId",
      created_at: "createdAt",
      updated_at: "updatedAt",
      row_version: "_serverVersion",
    },
    vitals: {
      patient_id: "patientId",
      visit_id: "visitId",
      height_cm: "heightCm",
      weight_kg: "weightKg",
      temp_c: "tempC",
      pulse_bpm: "pulseBpm",
      taken_at: "takenAt",
      updated_at: "updatedAt",
    },
    consultations: {
      patient_id: "patientId",
      visit_id: "visitId",
      provider_name: "providerName",
      soap_subjective: "soapSubjective",
      soap_objective: "soapObjective",
      soap_assessment: "soapAssessment",
      soap_plan: "soapPlan",
      provisional_dx: "provisionalDx",
      created_at: "createdAt",
      updated_at: "updatedAt",
    },
    dispenses: {
      patient_id: "patientId",
      visit_id: "visitId",
      item_name: "itemName",
      dispensed_by: "dispensedBy",
      dispensed_at: "dispensedAt",
      updated_at: "updatedAt",
    },
    inventory: {
      item_name: "itemName",
      on_hand_qty: "onHandQty",
      reorder_threshold: "reorderThreshold",
      updated_at: "updatedAt",
    },
    visits: {
      patient_id: "patientId",
      started_at: "startedAt",
      site_name: "siteName",
      updated_at: "updatedAt",
    },
    queue: {
      patient_id: "patientId",
      updated_at: "updatedAt",
      row_version: "_serverVersion",
    },
    app_users: {
      full_name: "fullName",
      admin_access: "adminAccess",
      admin_permanent: "adminPermanent",
      created_at: "createdAt",
      updated_at: "updatedAt",
    },
    patient_allergies: {
      patient_id: "patientId",
      allergy_type: "allergyType",
      onset_date: "onsetDate",
      is_active: "isActive",
      created_at: "createdAt",
      updated_at: "updatedAt",
      created_by: "createdBy",
    },
    patient_preferences: {
      patient_id: "patientId",
      preferred_language: "preferredLanguage",
      communication_channel: "communicationChannel",
      best_contact_time: "bestContactTime",
      dietary_restrictions: "dietaryRestrictions",
      religious_cultural: "religiousCultural",
      appointment_reminders: "appointmentReminders",
      medication_reminders: "medicationReminders",
      created_at: "createdAt",
      updated_at: "updatedAt",
    },
  };

  const fieldMap = fieldMaps[entityType] || {};
  const mapped: Record<string, unknown> = {};

  for (const [snakeKey, value] of Object.entries(remoteData)) {
    const camelKey = fieldMap[snakeKey] || snakeKey;
    mapped[camelKey] = value;
  }

  if (mapped.createdAt && typeof mapped.createdAt === "string") {
    mapped.createdAt = new Date(mapped.createdAt);
  }
  if (mapped.updatedAt && typeof mapped.updatedAt === "string") {
    mapped.updatedAt = new Date(mapped.updatedAt);
  }
  if ("_serverVersion" in mapped) {
    const version = serverVersionOf(mapped._serverVersion);
    if (version === undefined) delete mapped._serverVersion;
    else mapped._serverVersion = version;
  }

  return mapped;
}

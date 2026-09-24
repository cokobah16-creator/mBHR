// Reads this device's copies of the records a conflict is about: to name the
// patient in the list and to plan exactly what a decision writes here.

import { db, type Patient } from "@/db";
import { formatPatientId } from "@/utils/patient";
import type { ConflictResolution } from "@/services/conflictQueue";
import { ENTITY_LOCAL_TABLE, localTableFor } from "./entityTables";
import type { DeviceSnapshot } from "./devicePlan";

interface LooseTable {
  get(key: string): Promise<unknown>;
  update(key: string, changes: Record<string, unknown>): Promise<number>;
}

const KNOWN_TABLES = Object.values(ENTITY_LOCAL_TABLE);

/** One of the synced local tables by name; never any other database member. */
export function localTable(name: string): LooseTable | null {
  if (!KNOWN_TABLES.includes(name)) return null;
  const t = (db as unknown as Record<string, unknown>)[name];
  if (
    t &&
    typeof t === "object" &&
    typeof (t as LooseTable).get === "function" &&
    typeof (t as LooseTable).update === "function"
  ) {
    return t as LooseTable;
  }
  return null;
}

function availableTables(): string[] {
  return KNOWN_TABLES.filter((name) => localTable(name) !== null);
}

export interface PatientRef {
  id: string;
  name: string;
  mbhrId: string;
  merged: boolean;
}

export interface LocalConflictContext extends DeviceSnapshot {
  /** The patient the record is about, when this device has them. */
  patient: PatientRef | null;
  /** Duplicates: the matching patient (record B). */
  partnerPatient: PatientRef | null;
}

type ContextConflict = Pick<
  ConflictResolution,
  "id" | "conflictType" | "entityType" | "entityId" | "candidateIds"
>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function toPatientRef(p: Pick<Patient, "id" | "givenName" | "familyName" | "mergeInto"> | null | undefined): PatientRef | null {
  if (!p || !p.id) return null;
  const name = [p.givenName, p.familyName].filter(Boolean).join(" ").trim();
  return {
    id: p.id,
    name: name || "Name not recorded",
    mbhrId: formatPatientId(p.id),
    merged: !!p.mergeInto,
  };
}

async function getPatient(id: unknown): Promise<Patient | null> {
  if (typeof id !== "string" || !id) return null;
  try {
    return (await db.patients.get(id)) ?? null;
  } catch {
    return null;
  }
}

/**
 * This device's current copy of a record, or null when it is not stored here
 * (or its record type has no table on this device).
 */
export async function loadLocalRecord(
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  const table = localTableFor(entityType, availableTables());
  if (!table) return null;
  try {
    return asRecord(await localTable(table)?.get(entityId));
  } catch {
    return null;
  }
}

export async function loadLocalContext(
  conflict: ContextConflict,
): Promise<LocalConflictContext> {
  const table = localTableFor(conflict.entityType, availableTables());
  let record: Record<string, unknown> | null = null;
  if (table) {
    try {
      record = asRecord(await localTable(table)?.get(conflict.entityId));
    } catch {
      record = null;
    }
  }

  let patient: PatientRef | null = null;
  if (conflict.entityType === "patients") {
    patient = record ? toPatientRef(record as unknown as Patient) : null;
  } else if (record && typeof record.patientId === "string") {
    patient = toPatientRef(await getPatient(record.patientId));
  }

  let partner: Record<string, unknown> | null = null;
  let partnerPatient: PatientRef | null = null;
  const partnerId = conflict.candidateIds?.[0];
  if (conflict.conflictType === "duplicate" && partnerId) {
    const p = await getPatient(partnerId);
    partner = p ? (p as unknown as Record<string, unknown>) : null;
    partnerPatient = toPatientRef(p);
  }

  return { table, record, partner, patient, partnerPatient };
}

export async function loadLocalContexts(
  conflicts: ContextConflict[],
): Promise<Record<string, LocalConflictContext>> {
  const entries = await Promise.all(
    conflicts.map(async (c) => [c.id, await loadLocalContext(c)] as const),
  );
  return Object.fromEntries(entries);
}

/** Staff names this device knows, by user ID. */
export async function loadStaffNames(
  ids: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  try {
    const users = await db.users.bulkGet(unique);
    const names: Record<string, string> = {};
    users.forEach((u: { fullName?: string } | undefined, i: number) => {
      if (u?.fullName) names[unique[i]] = u.fullName;
    });
    return names;
  } catch {
    return {};
  }
}

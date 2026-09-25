// The live record behind a patient id that may have been merged away.
//
// A merged-away record keeps its name, date of birth and phone, but its
// allergies and history now live on the kept record. Screens that prescribe,
// dispense or screen allergies resolve the chosen id first.

import { db, type Patient } from "@/db";
import { canonicalIdOn } from "./patientMergeCore";

/**
 * The id a patient now lives under, following merges known to this device.
 * Returns the id itself when it was not merged, or when the kept record is
 * not on this device.
 */
export async function activePatientId(id: string): Promise<string> {
  return (await keptRecord(id))?.id ?? id;
}

/**
 * The kept record for a chosen patient. Returns the chosen record when it
 * was not merged, or when the kept record is not on this device.
 */
export async function activePatientFor(chosen: Patient): Promise<Patient> {
  return (await keptRecord(chosen.id)) ?? chosen;
}

/** The record `id` was merged into, when it is on this device. */
async function keptRecord(id: string): Promise<Patient | undefined> {
  const keptId = await canonicalIdOn(
    { get: (key) => db.patients.get(key), update: () => Promise.resolve(0) },
    id,
  );
  return keptId === id ? undefined : db.patients.get(keptId);
}

/**
 * Ids whose allergy records apply to a patient: the id itself and, when it
 * was merged away, the kept record's id.
 */
export async function allergyPatientIds(id: string): Promise<string[]> {
  const keptId = await activePatientId(id);
  return keptId === id ? [id] : [id, keptId];
}

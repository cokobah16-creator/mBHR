// Who a prescription is dispensed to. A prescription names the patient
// record it was written under; that record may since have been merged into
// another on this device (mergeInto), or may not be on this device at all.
// Dispensing needs the record the patient now lives on, and the allergy
// check must cover every record in the merge chain: a merge moves the
// merged-away record's allergies to the kept record, and one downloaded
// later may still sit under the old id.

import type { Patient } from "@/db";
import { formatPatientId, patientAge } from "@/utils/patient";

/** Longest merge chain followed; anything longer is treated as unresolved. */
const MAX_CHAIN = 20;

export interface DispensePatientLookup {
  get(id: string): Promise<Patient | undefined>;
}

export type DispensePatient =
  | {
      ok: true;
      /** The record the patient now lives on (not merged away). */
      patient: Patient;
      /** Every id from the prescription's own id to `patient.id`, in order. */
      chain: string[];
      // Present on both branches so `.reason` type-checks without
      // strictNullChecks (boolean discriminants don't narrow then).
      reason?: undefined;
    }
  | {
      ok: false;
      /**
       * not_found: the prescription's patient has no record on this device.
       * merge_unresolved: the record was merged, but the record it was
       * merged into is missing here, or the chain loops or is too long.
       */
      reason: "not_found" | "merge_unresolved";
      chain: string[];
    };

/** Follows mergeInto from `patientId` to the record the patient lives on. */
export async function resolveDispensePatient(
  lookup: DispensePatientLookup,
  patientId: string,
): Promise<DispensePatient> {
  const chain = [patientId];
  let current = patientId;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const row = await lookup.get(current);
    if (!row) {
      return { ok: false, reason: current === patientId ? "not_found" : "merge_unresolved", chain };
    }
    const next = row.mergeInto;
    if (!next) return { ok: true, patient: row, chain };
    if (chain.includes(next)) return { ok: false, reason: "merge_unresolved", chain };
    chain.push(next);
    current = next;
  }
  return { ok: false, reason: "merge_unresolved", chain };
}

/** Why dispensing is blocked for this patient, in words for the pharmacist. */
export function dispensePatientBlock(resolved: DispensePatient | undefined): string | null {
  if (!resolved) return null;
  if (resolved.ok) return null;
  return resolved.reason === "not_found"
    ? "This prescription's patient is not on this device, so they cannot be identified and their allergies cannot be checked. Dispensing is blocked. Sync this device, then try again."
    : "This patient's record was merged, but the record it was merged into is not on this device, so their allergies cannot be checked. Dispensing is blocked. Sync this device, then try again.";
}

const SEX_LABEL: Record<string, string> = { male: "Male", female: "Female", other: "Other" };

/** Sex and age for a list row, e.g. "Female · 34 years". */
export function sexAgeLabel(patient: Pick<Patient, "sex">, age: number | null): string {
  return [SEX_LABEL[patient.sex] ?? patient.sex, age !== null ? `${age} years` : null]
    .filter(Boolean)
    .join(" · ");
}

/** MBHR ID, sex and age for a list row: tells apart patients who share a name. */
export function identityLine(patient: Patient | undefined, now: Date = new Date()): string {
  if (!patient) return "Not on this device: cannot be identified";
  const parts = [formatPatientId(patient.id), sexAgeLabel(patient, patientAge(patient.dob, now))];
  if (patient.mergeInto) parts.push("merged record");
  return parts.filter(Boolean).join(" · ");
}

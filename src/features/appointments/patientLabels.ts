import { db } from "@/db";
import { loadPatientNames } from "@/services/televisits";

export interface PatientLabel {
  name: string;
  /** The record exists on this device, so /patients/:id can open it. */
  onDevice: boolean;
}

/**
 * Names for a set of patient ids: this device's records first, then the
 * online patient list for the rest. Ids with no name found are left out, so
 * callers can show a neutral placeholder.
 */
export async function loadPatientLabels(
  patientIds: string[],
): Promise<Map<string, PatientLabel>> {
  const labels = new Map<string, PatientLabel>();
  const ids = Array.from(new Set(patientIds.filter(Boolean)));
  if (ids.length === 0) return labels;

  try {
    const local = await db.patients.bulkGet(ids);
    local.forEach((patient, index) => {
      if (!patient) return;
      const name =
        `${patient.givenName ?? ""} ${patient.familyName ?? ""}`.trim();
      labels.set(ids[index], { name, onDevice: true });
    });
  } catch {
    // The local database is unavailable; fall through to the online list.
  }

  const missing = ids.filter((id) => !labels.get(id)?.name);
  if (missing.length > 0) {
    try {
      const remote = await loadPatientNames(missing);
      remote.forEach((name, id) => {
        if (!name) return;
        const onDevice = labels.get(id)?.onDevice ?? false;
        labels.set(id, { name, onDevice });
      });
    } catch {
      // Offline or not permitted: names stay unknown.
    }
  }

  return labels;
}

/** Shown when no name is known: the end of the record id, marked as such. */
export function patientPlaceholder(patientId: string): string {
  return `Patient …${patientId.slice(-6).toUpperCase()}`;
}

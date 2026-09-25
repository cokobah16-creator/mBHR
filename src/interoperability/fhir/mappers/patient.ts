// public.patients -> Patient
//
// Published id: patients.fhir_id (a random uuid added for FHIR), never the
// device-generated patients.id, which stays internal. Not published: the
// photo (photo_url), portal and sync columns, auth_uid, family links and
// every administrative flag. mBHR records no MRN or national id, so the
// only identifier is the mBHR FHIR identity itself.
//
// Unknown stays unknown:
//   - name, telecom and address carry no "use": mBHR does not record
//     whether a name is official or a phone is a mobile.
//   - sex "other" is also what registration stores when nothing was chosen
//     (portal self-registration, the staff form's fallback), so it cannot
//     be told apart from a real "other": gender is left out.
//   - the birth date is published as recorded. Whether it was estimated is
//     kept only on the recording tablet, so it cannot be flagged here
//     (docs/interoperability/resource-mapping.md, known limitations).
//
// A merged-away record (merged_into set, or merged_at set with its kept
// record gone) is published as a tombstone: id, identifier, name,
// active=false and, when the kept record is known, a replaced-by link.
// Contact details, gender, birth date and address are not repeated on it;
// the staff app shows only the name and a pointer for such a record.

import type { ContactPoint, HumanName, Patient } from "../types/fhir";
import { LOCAL } from "../terminology/codeSystems";
import { calendarDate, str, versionMeta, type Row } from "./common";

/** Columns read from public.patients (data minimisation starts at the query). */
export const PATIENT_COLUMNS = [
  "id",
  "fhir_id",
  "given_name",
  "family_name",
  "sex",
  "dob",
  "phone",
  "email",
  "address",
  "lga",
  "state",
  "merged_into",
  "merged_at",
  "created_at",
  "updated_at",
] as const;

export function mapGender(sex: string | undefined): Patient["gender"] | undefined {
  if (!sex) return undefined;
  switch (sex.trim().toLowerCase()) {
    case "m":
    case "male":
      return "male";
    case "f":
    case "female":
      return "female";
    case "other":
      // Also the default when no sex was chosen: not an assertion.
      return undefined;
    case "unknown":
      return "unknown";
    default:
      // An unrecognised local value is not guessed at.
      return "unknown";
  }
}

/** A merged-away record: merged into another, or marked merged with its kept record gone. */
export function isMergedRecord(row: Row): boolean {
  return str(row, "merged_into") !== undefined || str(row, "merged_at") !== undefined;
}

/**
 * @param survivorFhirId for a merged record, the fhir_id of the canonical
 *   record at the end of its merge chain (when the caller may see it).
 */
export function mapPatient(row: Row, survivorFhirId?: string | null): Patient {
  const fhirId = str(row, "fhir_id");
  if (!fhirId) throw new Error("patient row has no fhir_id");

  const given = str(row, "given_name");
  const family = str(row, "family_name");
  const names: HumanName[] = [];
  if (given || family) {
    names.push({
      ...(family ? { family } : {}),
      ...(given ? { given: given.split(/\s+/) } : {}),
      text: [given, family].filter(Boolean).join(" "),
    });
  }

  const merged = isMergedRecord(row);
  const patient: Patient = {
    resourceType: "Patient",
    id: fhirId,
    meta: versionMeta(row),
    identifier: [{ use: "usual", system: LOCAL.patientIdentifier, value: fhirId }],
  };
  // mBHR has no "active" flag. A merged record is no longer in use; for any
  // other record the element is left out rather than asserted.
  if (merged) patient.active = false;
  if (names.length) patient.name = names;
  if (merged) {
    if (survivorFhirId) patient.link = [{ other: { reference: `Patient/${survivorFhirId}` }, type: "replaced-by" }];
    return patient;
  }

  const telecom: ContactPoint[] = [];
  const phone = str(row, "phone");
  const email = str(row, "email");
  if (phone) telecom.push({ system: "phone", value: phone });
  if (email) telecom.push({ system: "email", value: email });

  const address = str(row, "address");
  const lga = str(row, "lga");
  const state = str(row, "state");
  if (telecom.length) patient.telecom = telecom;
  const gender = mapGender(str(row, "sex"));
  if (gender) patient.gender = gender;
  const birthDate = calendarDate(row, "dob");
  if (birthDate) patient.birthDate = birthDate;
  if (address || lga || state) {
    patient.address = [
      {
        ...(address ? { text: address } : {}),
        ...(lga ? { district: lga } : {}),
        ...(state ? { state } : {}),
      },
    ];
  }
  return patient;
}

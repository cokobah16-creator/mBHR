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
//   - the birth date is sent with less precision when it falls on the 1st
//     of a month: 1 January as the year only, any other 1st as year and
//     month (publishedBirthDate). Quick registration saves an age as such
//     a date, and whether it was estimated is kept only on the recording
//     tablet, so an estimate cannot be told from a real birthday; every
//     date on the 1st is treated alike. The stored date is not changed.
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

/**
 * Patient.birthDate from the stored date of birth (YYYY-MM-DD).
 * Quick registration saves an age as 1 January of the birth year, or the
 * 1st of the birth month for a baby, and the server cannot tell such an
 * estimate from a real birthday (the mark stays on the tablet). So a date
 * on the 1st goes out with less precision (owner decision,
 * docs/clinical/CLINICAL_LOGIC_CHANGES.md 2.7): 1 January as the year only,
 * the 1st of any other month as year and month; any other date in full.
 * A real birthday on the 1st loses its day too. Strings only (no Date, so
 * no time zone can move the day); anything else is returned unchanged.
 */
export function publishedBirthDate(dob: string): string {
  const m = /^(\d{4})-(\d{2})-01$/.exec(dob);
  if (!m) return dob;
  return m[2] === "01" ? m[1] : `${m[1]}-${m[2]}`;
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
  const dob = calendarDate(row, "dob");
  if (dob) patient.birthDate = publishedBirthDate(dob);
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

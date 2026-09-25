// public.conditions -> Condition
//
// mBHR's conditions table already stores FHIR-shaped statuses, so they are
// carried over exactly: a provisional or differential diagnosis stays
// provisional or differential, never confirmed. The one exception is a
// stored verification_status 'confirmed': it is the column's default, so it
// cannot be told apart from a row written without a verification status,
// and it is left out (see VERIFICATION below). The code is published under
// mBHR's local condition code system unless interop.terminology_map holds a
// reviewed ('verified') mapping for it, in which case that coding is added
// next to the local one. Free-text notes and the recorder are not published.
//
// Not yet published: consultations.provisional_dx (a text array on the
// consultation, with no stable per-diagnosis id). See resource-mapping.md.

import type { CodeableConcept, Condition } from "../types/fhir";
import {
  CONDITION_CATEGORY,
  CONDITION_CLINICAL,
  CONDITION_SEVERITY,
  CONDITION_VER_STATUS,
  LOCAL,
  SNOMED,
  US_CORE_CONDITION_CATEGORY,
  type VerifiedCoding,
} from "../terminology/codeSystems";
import { calendarDate, instant, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

export const CONDITION_COLUMNS = [
  "id",
  "patient_id",
  "condition_code",
  "condition_name",
  "clinical_status",
  "verification_status",
  "category",
  "severity",
  "onset_date",
  "abatement_date",
  "created_at",
  "updated_at",
] as const;

const CLINICAL = ["active", "recurrence", "relapse", "inactive", "remission", "resolved"];
/**
 * The verification codes published as stored. "confirmed" is not one of
 * them: public.conditions.verification_status has DEFAULT 'confirmed'
 * (20260125091822_add_immunizations_conditions_sdoh.sql), so a stored
 * 'confirmed' may just mean that nobody recorded a verification status;
 * the two cannot be told apart. It is left out, never published as a
 * confirmed diagnosis. Condition search offers no verification-status
 * parameter, so search cannot disagree with this.
 */
const VERIFICATION = [
  "unconfirmed",
  "provisional",
  "differential",
  "refuted",
  "entered-in-error",
];

function statusConcept(system: string, allowed: string[], value: string | undefined): CodeableConcept | undefined {
  if (!value || !allowed.includes(value)) return undefined;
  return { coding: [{ system, code: value }] };
}

function categoryConcept(value: string | undefined): CodeableConcept[] | undefined {
  switch (value) {
    case "problem-list-item":
    case "encounter-diagnosis":
      return [{ coding: [{ system: CONDITION_CATEGORY, code: value }] }];
    case "health-concern":
      return [{ coding: [{ system: US_CORE_CONDITION_CATEGORY, code: value }] }];
    default:
      return undefined;
  }
}

export function mapCondition(
  row: Row,
  ctx: MapContext,
  verified: ReadonlyMap<string, VerifiedCoding[]> = new Map(),
): Condition | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  if (!id || !subject) return null;

  const verification = str(row, "verification_status");
  const condition: Condition = {
    resourceType: "Condition",
    id,
    meta: versionMeta(row),
    subject,
  };

  // R4 invariant con-5: no clinicalStatus on an entered-in-error record.
  if (verification !== "entered-in-error") {
    const clinical = statusConcept(CONDITION_CLINICAL, CLINICAL, str(row, "clinical_status"));
    if (clinical) condition.clinicalStatus = clinical;
  }
  const ver = statusConcept(CONDITION_VER_STATUS, VERIFICATION, verification);
  if (ver) condition.verificationStatus = ver;
  const category = categoryConcept(str(row, "category"));
  if (category) condition.category = category;

  const severity = CONDITION_SEVERITY[str(row, "severity") ?? ""];
  if (severity) condition.severity = { coding: [{ system: SNOMED, ...severity }] };

  const localCode = str(row, "condition_code");
  const name = str(row, "condition_name");
  if (localCode || name) {
    const coding = [];
    if (localCode) {
      coding.push({ system: LOCAL.condition, code: localCode, ...(name ? { display: name } : {}) });
      for (const v of verified.get(localCode) ?? []) {
        coding.push({ system: v.system, code: v.code, ...(v.display ? { display: v.display } : {}) });
      }
    }
    condition.code = { ...(coding.length ? { coding } : {}), ...(name ? { text: name } : {}) };
  }

  const onset = calendarDate(row, "onset_date");
  if (onset) condition.onsetDateTime = onset;
  // R4 invariant con-4: an abated condition is not active. When the record
  // says both (active, recurrence or relapse, and an abatement date), the
  // clinical status is the recorder's primary statement: it is kept and the
  // contradicting abatement date is left out rather than guessed between.
  const abatement = calendarDate(row, "abatement_date");
  const stillActive = ["active", "recurrence", "relapse"].includes(
    condition.clinicalStatus?.coding?.[0]?.code ?? "",
  );
  if (abatement && !stillActive) condition.abatementDateTime = abatement;
  const recorded = instant(row, "created_at");
  if (recorded) condition.recordedDate = recorded;
  return condition;
}

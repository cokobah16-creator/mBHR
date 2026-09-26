// public.conditions -> Condition
//
// mBHR's conditions table already stores FHIR-shaped statuses, so they are
// carried over exactly: provisional stays provisional, differential stays
// differential, confirmed stays confirmed. The table fills in none of
// clinical_status, verification_status or category (20260125091822 has no
// DEFAULT on them), so a stored value is one someone chose, a missing one is
// left out, and nothing is filled in here. A problem-list diagnosis with no
// clinical status is published without one: R4 con-3 is a warning, and no
// status is invented. The code is published under mBHR's local condition
// code system unless interop.terminology_map holds a reviewed ('verified')
// mapping for it, in which case that coding is added next to the local one.
// Free-text notes and the recorder are not published.
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
/** The clinical statuses an abatement may stand beside (R4 con-4). */
const ENDED = ["inactive", "remission", "resolved"];
/**
 * The verification codes published as stored: every condition-ver-status
 * code. public.conditions.verification_status has no default (owner
 * decision, CLINICAL_LOGIC_CHANGES.md 2.7), so a stored value, 'confirmed'
 * included, was recorded by someone; a missing one is left out, never
 * assumed confirmed.
 */
const VERIFICATION = [
  "unconfirmed",
  "provisional",
  "differential",
  "confirmed",
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
  // R4 invariant con-4: an abatement needs a clinical status of inactive,
  // remission or resolved. When the record says otherwise (active,
  // recurrence or relapse beside an end date), the clinical status is the
  // recorder's primary statement: it is kept and the contradicting date is
  // left out rather than guessed between. Where no clinical status is
  // published (entered in error, or a missing or unknown stored value), the
  // date is left out too: an ended status is never inferred from it.
  const abatement = calendarDate(row, "abatement_date");
  const ended = ENDED.includes(condition.clinicalStatus?.coding?.[0]?.code ?? "");
  if (abatement && ended) condition.abatementDateTime = abatement;
  const recorded = instant(row, "created_at");
  if (recorded) condition.recordedDate = recorded;
  return condition;
}

// public.patient_allergies -> AllergyIntolerance
//
// One row is one allergy a staff member recorded on a tablet (the allergy
// panel on the patient page). What is published, and what is not:
//
//   - The allergen and the reaction are free text and stay free text
//     (code.text, reaction.manifestation.text), exactly as recorded. No
//     substance code is added: mBHR has no allergen code list, and a text
//     such as "Penicillin, codeine" stays one record with that text rather
//     than being split or matched to a drug class.
//   - clinicalStatus comes from is_active (ALLERGY_CLINICAL_STATUS): only
//     true is mapped (active). An allergy marked inactive is never read by
//     the gateway (NOT_MARKED_INACTIVE, owner decision 2.7) and the map
//     gives false no status, so should one reach the mapper it fails ait-1
//     and is withheld, never published as inactive or resolved. A row with
//     no usable value gets no clinical status and so fails invariant
//     ait-1: the gateway withholds it and tells the client a record was
//     left out, instead of the mapper guessing "active" or dropping it
//     silently.
//   - verificationStatus and type are never filled: mBHR records neither.
//     Nothing is ever "confirmed" by default.
//   - category, criticality and reaction.severity only from the values in
//     terminology/status/allergy.ts; anything else is left out. The form's
//     pre-selected choices (type medication, severity mild) cannot be told
//     apart from "nobody chose", so neither is published. A severe or
//     life-threatening rating gives criticality high, with or without a
//     recorded reaction (owner sign-off, CLINICAL_LOGIC_CHANGES.md 2.7
//     "Severity"); with a recorded reaction it also gives reaction.severity
//     severe (the top of that scale).
//   - "No known allergies" does not exist in mBHR: no row means no allergy
//     was recorded. The mapper never produces an NKA record, and every
//     searchset carries ALLERGY_NKA_CAVEAT saying so.
//   - Never published: notes (free-text staff notes), created_by (a staff
//     account id; the recorder is published only as the Practitioner id the
//     staff directory gives it), the device sync columns, and the internal
//     patient id (the patient is always the canonical record's fhir_id).

import type { CodeableConcept, OperationOutcomeIssue, Reference, Resource } from "../types/fhir";
import { applyStatusMap } from "../terminology/statusMaps";
import {
  ALLERGY_CATEGORY,
  ALLERGY_CLINICAL_STATUS,
  ALLERGY_CRITICALITY,
  ALLERGY_REACTION_SEVERITY,
  type AllergyCategory,
  type AllergyClinicalStatus,
  type AllergyCriticality,
  type AllergyReactionSeverity,
  type AllergyVerificationStatus,
} from "../terminology/status/allergy";
import { FHIR_ID } from "../search/params";
import { isObj, type AddIssue } from "../validation/validate";
import { calendarDate, instant, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

/** R4 code systems for AllergyIntolerance.clinicalStatus and verificationStatus. */
export const ALLERGY_CLINICAL_SYSTEM = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
export const ALLERGY_VERIFICATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
/** The code system of the criticality codes (a FHIR code element, for token searches). */
export const ALLERGY_CRITICALITY_SYSTEM = "http://hl7.org/fhir/allergy-intolerance-criticality";

export interface AllergyIntoleranceReaction {
  manifestation: CodeableConcept[];
  severity?: AllergyReactionSeverity;
}

export interface AllergyIntolerance extends Resource {
  resourceType: "AllergyIntolerance";
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  type?: "allergy" | "intolerance";
  category?: AllergyCategory[];
  criticality?: AllergyCriticality;
  code?: CodeableConcept;
  patient: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
  recorder?: Reference;
  reaction?: AllergyIntoleranceReaction[];
}

/**
 * Columns read from public.patient_allergies. Every one exists in both
 * repository definitions of the table (20251024080033 and 20251025000000).
 * notes, _dirty and _synced_at are deliberately not read.
 */
export const ALLERGY_COLUMNS = [
  "id",
  "patient_id",
  "allergen",
  "allergy_type",
  "reaction",
  "severity",
  "onset_date",
  "is_active",
  "created_by",
  "created_at",
  "updated_at",
] as const;

/**
 * The informational note every AllergyIntolerance searchset carries (owner
 * decision 9), whether or not anything matched.
 */
export const ALLERGY_NKA_CAVEAT: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "mBHR does not record 'no known allergies'; an empty result means no active allergy is recorded, not that the patient has none.",
};

export interface AllergyMapContext extends MapContext {
  /**
   * Staff account id (patient_allergies.created_by) -> the published
   * Practitioner id, from fhir_staff_directory. Absent or empty when the
   * caller cannot resolve staff: the recorder is then left out.
   */
  practitionerIds?: ReadonlyMap<string, string>;
}

/**
 * is_active as the text ALLERGY_CLINICAL_STATUS compares: a JSON boolean
 * becomes "true" or "false"; a string is passed on as it is (compared
 * lower-cased and exactly); anything else (null, a number) is not a value
 * the map knows, so it stays unknown.
 */
export function isActiveSource(raw: unknown): unknown {
  if (raw === true) return "true";
  if (raw === false) return "false";
  return raw;
}

export function mapAllergyClinicalStatus(raw: unknown): AllergyClinicalStatus | null {
  return applyStatusMap(ALLERGY_CLINICAL_STATUS, isActiveSource(raw));
}

export function mapAllergy(row: Row, ctx: AllergyMapContext): AllergyIntolerance | null {
  const id = typeof row.id === "string" && row.id !== "" ? row.id : undefined;
  const patient = patientReference(ctx, row.patient_id);
  // No id, or a patient that does not resolve to a visible canonical
  // record: nothing to publish (the reference is never guessed). The
  // module does not drop it silently: a searchset warns that a record was
  // left out, and a read fails closed.
  if (!id || !patient) return null;

  const allergy: AllergyIntolerance = {
    resourceType: "AllergyIntolerance",
    id,
    meta: versionMeta(row),
    patient,
  };

  // Left out when unknown: the gateway's validation (ait-1) then withholds
  // the record and says so.
  const clinical = mapAllergyClinicalStatus(row.is_active);
  if (clinical) allergy.clinicalStatus = { coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: clinical }] };

  const category = applyStatusMap(ALLERGY_CATEGORY, row.allergy_type);
  if (category) allergy.category = [category];
  const criticality = applyStatusMap(ALLERGY_CRITICALITY, row.severity);
  if (criticality) allergy.criticality = criticality;

  // The allergen exactly as recorded (outer spaces trimmed). A blank
  // allergen gives no code; the record is still published, because it
  // still says an allergy was recorded.
  const allergen = str(row, "allergen");
  if (allergen) allergy.code = { text: allergen };

  const onset = calendarDate(row, "onset_date");
  if (onset) allergy.onsetDateTime = onset;
  const recorded = instant(row, "created_at");
  if (recorded) allergy.recordedDate = recorded;

  const createdBy = typeof row.created_by === "string" ? row.created_by : undefined;
  const practitioner = createdBy ? ctx.practitionerIds?.get(createdBy) : undefined;
  if (practitioner && FHIR_ID.test(practitioner)) allergy.recorder = { reference: `Practitioner/${practitioner}` };

  // reaction.manifestation is required (1..*), so a reaction element exists
  // only when a reaction was written down; the severity rating is attached
  // to it and is not published without one.
  const reaction = str(row, "reaction");
  if (reaction) {
    const r: AllergyIntoleranceReaction = { manifestation: [{ text: reaction }] };
    const severity = applyStatusMap(ALLERGY_REACTION_SEVERITY, row.severity);
    if (severity) r.severity = severity;
    allergy.reaction = [r];
  }
  return allergy;
}

// ---------------------------------------------------------------------------
// Structural rules for AllergyIntolerance (run by the gateway on every
// resource before release, after validation/validate.ts)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const CLINICAL_CODES: readonly AllergyClinicalStatus[] = ALLERGY_CLINICAL_STATUS.allowed;
const VERIFICATION_CODES: readonly AllergyVerificationStatus[] = ["unconfirmed", "confirmed", "refuted", "entered-in-error"];
const CATEGORY_CODES: readonly string[] = ALLERGY_CATEGORY.allowed;
const CRITICALITY_CODES: readonly string[] = ALLERGY_CRITICALITY.allowed;
const REACTION_SEVERITY_CODES: readonly string[] = ALLERGY_REACTION_SEVERITY.allowed;
const RECORDER = /^(Practitioner|PractitionerRole|Patient|RelatedPerson)\//;

function codingsOf(concept: unknown): Json[] {
  return isObj(concept) && Array.isArray(concept.coding) ? concept.coding.filter(isObj) : [];
}

function checkStatusConcept(
  concept: unknown,
  path: string,
  system: string,
  allowed: readonly string[],
  add: AddIssue,
): void {
  if (concept === undefined) return;
  const codings = codingsOf(concept);
  if (!codings.length) {
    add(path, "needs a coding");
    return;
  }
  for (const c of codings) {
    if (c.system !== system || typeof c.code !== "string" || !allowed.includes(c.code)) {
      add(path, "not a code of its R4 value set");
    }
  }
}

export function validateAllergyIntolerance(resource: Json, add: AddIssue): void {
  if (!isObj(resource.patient) || typeof resource.patient.reference !== "string" || !resource.patient.reference.startsWith("Patient/")) {
    add("patient", "required: a Patient reference");
  }
  checkStatusConcept(resource.clinicalStatus, "clinicalStatus", ALLERGY_CLINICAL_SYSTEM, CLINICAL_CODES, add);
  // Owner decision (CLINICAL_LOGIC_CHANGES.md 2.7): only allergies staff see
  // as active are published; inactive and resolved are never released.
  if (codingsOf(resource.clinicalStatus).some((c) => c.code !== "active")) {
    add("clinicalStatus", "only active allergies are published");
  }
  checkStatusConcept(resource.verificationStatus, "verificationStatus", ALLERGY_VERIFICATION_SYSTEM, VERIFICATION_CODES, add);

  const enteredInError = codingsOf(resource.verificationStatus).some((c) => c.code === "entered-in-error");
  // ait-1: clinicalStatus SHALL be present if verificationStatus is not entered-in-error.
  if (!enteredInError && resource.clinicalStatus === undefined) {
    add("clinicalStatus", "ait-1: required unless verificationStatus is entered-in-error");
  }
  // ait-2: clinicalStatus SHALL NOT be present if verificationStatus is entered-in-error.
  if (enteredInError && resource.clinicalStatus !== undefined) {
    add("clinicalStatus", "ait-2: not allowed when verificationStatus is entered-in-error");
  }

  if (resource.type !== undefined && resource.type !== "allergy" && resource.type !== "intolerance") add("type", "invalid");
  if (resource.category !== undefined) {
    if (!Array.isArray(resource.category) || resource.category.some((c) => typeof c !== "string" || !CATEGORY_CODES.includes(c))) {
      add("category", "not an allergy-intolerance-category code");
    }
  }
  if (resource.criticality !== undefined && (typeof resource.criticality !== "string" || !CRITICALITY_CODES.includes(resource.criticality))) {
    add("criticality", "not an allergy-intolerance-criticality code");
  }
  if (resource.code !== undefined) {
    if (!isObj(resource.code) || typeof resource.code.text !== "string") add("code", "needs the allergen text");
    // mBHR has no verified allergen codes: a coding here (for example a
    // "no known allergy" code) would be invented, so it is refused.
    else if (resource.code.coding !== undefined) add("code.coding", "no allergen coding is published (free text only)");
  }
  if (resource.recorder !== undefined) {
    if (!isObj(resource.recorder) || typeof resource.recorder.reference !== "string" || !RECORDER.test(resource.recorder.reference)) {
      add("recorder", "must reference a Practitioner");
    }
  }
  if (resource.reaction !== undefined) {
    if (!Array.isArray(resource.reaction)) {
      add("reaction", "must be a list");
      return;
    }
    resource.reaction.forEach((r, i) => {
      if (!isObj(r) || !Array.isArray(r.manifestation) || r.manifestation.length === 0) {
        add(`reaction[${i}].manifestation`, "required (1..*)");
        return;
      }
      if (r.severity !== undefined && (typeof r.severity !== "string" || !REACTION_SEVERITY_CODES.includes(r.severity))) {
        add(`reaction[${i}].severity`, "not a reaction-event-severity code");
      }
    });
  }
}

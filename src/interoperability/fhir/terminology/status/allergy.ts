// Status and value maps for AllergyIntolerance <- public.patient_allergies.
//
// public.patient_allergies records very little about an allergy's status:
//
//   is_active     true: shown in every allergy warning; false: a staff
//                 member chose "Mark inactive" (no reason is stored: it may
//                 mean resolved, outgrown, wrong patient, a duplicate or an
//                 entry made in error). The only status mBHR keeps.
//   allergy_type  medication | food | environmental | other. The form
//                 pre-selects "medication".
//   severity      mild | moderate | severe | life-threatening, a staff
//                 rating of the allergy. The form pre-selects "mild", so a
//                 stored "mild" cannot be told apart from "nobody chose".
//
// There is no verification status (suspected, confirmed, refuted), no
// entered-in-error flag, no allergy/intolerance type and no "no known
// allergies" statement. Each table below says which recorded values become
// which FHIR code and why; everything else is left out, never guessed (see
// terminology/statusMaps.ts for the rules every map keeps). The category,
// criticality and reaction severity tables are value maps rather than
// statuses; they are kept here so they are printed and checked with the
// status maps.
//
// is_active is a boolean column: the mapper passes it to these maps as the
// text "true" or "false" (isActiveSource in mappers/allergy.ts), and the
// clinical-status search filters on is_active.is.<value> for the same
// values, so search and mapping agree.

import type { StatusMap } from "../statusMaps";

/** R4 allergyintolerance-clinical. */
export type AllergyClinicalStatus = "active" | "inactive" | "resolved";
/** R4 allergyintolerance-verification. */
export type AllergyVerificationStatus = "unconfirmed" | "confirmed" | "refuted" | "entered-in-error";
/** R4 allergy-intolerance-category. */
export type AllergyCategory = "food" | "medication" | "environment" | "biologic";
/** R4 allergy-intolerance-criticality. */
export type AllergyCriticality = "low" | "high" | "unable-to-assess";
/** R4 reaction-event-severity. */
export type AllergyReactionSeverity = "mild" | "moderate" | "severe";

export const ALLERGY_CLINICAL_STATUS: StatusMap<AllergyClinicalStatus> = {
  element: "AllergyIntolerance.clinicalStatus",
  source: "public.patient_allergies.is_active",
  valueSet: "http://hl7.org/fhir/ValueSet/allergyintolerance-clinical",
  allowed: ["active", "inactive", "resolved"],
  rules: [
    {
      source: ["true"],
      fhir: "active",
      reason: "The allergy is shown in every allergy warning in the app (patient header, prescribing and dispensing checks).",
    },
    {
      source: ["false"],
      fhir: "inactive",
      reason:
        "A staff member marked the allergy inactive and the app no longer warns about it. mBHR stores no reason (resolved, recorded in error, duplicate), so it is never shown as resolved or entered-in-error, and never as active.",
    },
  ],
  missing: {
    fhir: null,
    reason:
      "No value: no clinical status, never assumed active. FHIR requires a clinical status when there is no verification status (invariant ait-1) and mBHR records none, so the record is withheld and the searchset says a record was left out.",
  },
  unrecognised: {
    fhir: null,
    reason:
      "Not true or false: no clinical status, not guessed. As for a missing value, the record is withheld (invariant ait-1) and the searchset says a record was left out.",
  },
};

/**
 * mBHR has no verification column. This table records the decision so it
 * is printed with the others: the element is always left out, never
 * "confirmed" by default. (The mapper has nothing to apply it to.)
 */
export const ALLERGY_VERIFICATION_STATUS: StatusMap<AllergyVerificationStatus> = {
  element: "AllergyIntolerance.verificationStatus",
  source: "(not recorded: public.patient_allergies has no verification column)",
  valueSet: "http://hl7.org/fhir/ValueSet/allergyintolerance-verification",
  allowed: ["unconfirmed", "confirmed", "refuted", "entered-in-error"],
  rules: [],
  missing: {
    fhir: null,
    reason: "mBHR does not record whether an allergy was confirmed or only suspected: left out, never 'confirmed' by default.",
  },
  unrecognised: {
    fhir: null,
    reason: "mBHR does not record whether an allergy was confirmed or only suspected: left out, never 'confirmed' by default.",
  },
};

export const ALLERGY_CATEGORY: StatusMap<AllergyCategory> = {
  element: "AllergyIntolerance.category",
  source: "public.patient_allergies.allergy_type",
  valueSet: "http://hl7.org/fhir/ValueSet/allergy-intolerance-category",
  allowed: ["food", "medication", "environment", "biologic"],
  rules: [
    {
      source: ["medication"],
      fhir: "medication",
      reason:
        "Recorded as a medication allergy. The form pre-selects this type, so it may also mean nobody changed it; the app itself screens every active allergy against medicines whatever its type.",
    },
    { source: ["food"], fhir: "food", reason: "Recorded as a food allergy." },
    {
      source: ["environmental"],
      fhir: "environment",
      reason: "Recorded as environmental (the FHIR code is 'environment').",
    },
  ],
  missing: { fhir: null, reason: "No type recorded: no category." },
  unrecognised: {
    fhir: null,
    reason: "'other' and any value the app does not write: no category (never guessed as 'biologic' or anything else).",
  },
};

export const ALLERGY_CRITICALITY: StatusMap<AllergyCriticality> = {
  element: "AllergyIntolerance.criticality",
  source: "public.patient_allergies.severity",
  valueSet: "http://hl7.org/fhir/ValueSet/allergy-intolerance-criticality",
  allowed: ["low", "high", "unable-to-assess"],
  rules: [
    {
      source: ["life-threatening"],
      fhir: "high",
      reason:
        "Staff rated the allergy life-threatening, which is FHIR's definition of high criticality (a future exposure could be life-threatening).",
    },
  ],
  missing: { fhir: null, reason: "No rating recorded: no criticality." },
  unrecognised: {
    fhir: null,
    reason:
      "mild, moderate and severe rate how bad the allergy was, not the risk of a future reaction: no criticality. Never 'low' (mild is the form's pre-selected choice) and never 'unable-to-assess'.",
  },
};

export const ALLERGY_REACTION_SEVERITY: StatusMap<AllergyReactionSeverity> = {
  element: "AllergyIntolerance.reaction.severity",
  source: "public.patient_allergies.severity",
  valueSet: "http://hl7.org/fhir/ValueSet/reaction-event-severity",
  allowed: ["mild", "moderate", "severe"],
  rules: [
    { source: ["moderate"], fhir: "moderate", reason: "Staff chose moderate (the same word in FHIR); only with a recorded reaction." },
    { source: ["severe"], fhir: "severe", reason: "Staff chose severe (the same word in FHIR); only with a recorded reaction." },
  ],
  missing: { fhir: null, reason: "No rating recorded: no reaction severity." },
  unrecognised: {
    fhir: null,
    reason:
      "'mild' is the form's pre-selected choice and cannot be told apart from 'not chosen', so it is left out rather than stated; 'life-threatening' is not a reaction severity code (it is published as criticality high); any other value is not guessed.",
  },
};

export const ALLERGY_STATUS_MAPS: readonly StatusMap[] = [
  ALLERGY_CLINICAL_STATUS,
  ALLERGY_VERIFICATION_STATUS,
  ALLERGY_CATEGORY,
  ALLERGY_CRITICALITY,
  ALLERGY_REACTION_SEVERITY,
];

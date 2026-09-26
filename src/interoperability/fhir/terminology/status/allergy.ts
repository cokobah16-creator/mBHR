// Status and value maps for AllergyIntolerance <- public.patient_allergies.
//
// public.patient_allergies records very little about an allergy's status:
//
//   is_active     true: shown in every allergy warning; false: a staff
//                 member chose "Mark inactive" (no reason is stored: it may
//                 mean resolved, outgrown, wrong patient, a duplicate or an
//                 entry made in error). The only status mBHR keeps. false
//                 is not published at all (owner decision,
//                 CLINICAL_LOGIC_CHANGES.md 2.7): the gateway reads only
//                 allergies not marked inactive.
//   allergy_type  medication | food | environmental | other. The form
//                 pre-selects "medication", so a stored "medication" cannot
//                 be told apart from "nobody chose".
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
  ],
  missing: {
    fhir: null,
    reason:
      "No value: no clinical status, never assumed active. FHIR requires a clinical status when there is no verification status (invariant ait-1) and mBHR records none, so the record is withheld and the searchset says a record was left out.",
  },
  unrecognised: {
    fhir: null,
    reason:
      "false: a staff member chose 'Mark inactive'; mBHR stores no reason (the same action removes entries made in error, for the wrong patient, or duplicated). Owner decision (CLINICAL_LOGIC_CHANGES.md 2.7): such an allergy is not published at all, never as inactive, resolved, entered-in-error or active. The gateway does not read it (NOT_MARKED_INACTIVE in resources/allergyIntolerance.ts), so it is left out without a note, as the app hides it. Any other value: no clinical status, not guessed; the record is withheld (invariant ait-1) and the searchset says a record was left out.",
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
  // No rule for "medication": like the pre-selected "mild" severity below,
  // the form's pre-selected type is not a statement. A food allergy saved
  // without changing the type would otherwise go out as a medication
  // allergy. Only a type someone chose (food, environmental) is published.
  rules: [
    { source: ["food"], fhir: "food", reason: "Staff chose food (the form pre-selects medication)." },
    {
      source: ["environmental"],
      fhir: "environment",
      reason: "Staff chose environmental (the FHIR code is 'environment'; the form pre-selects medication).",
    },
  ],
  missing: { fhir: null, reason: "No type recorded: no category." },
  unrecognised: {
    fhir: null,
    reason:
      "'medication' is the form's pre-selected type and cannot be told apart from 'not chosen', so no category is stated for it (the app itself checks every active allergy against medicines, whatever its type). 'other' and any value the app does not write: no category (never guessed as 'biologic' or anything else).",
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
    {
      source: ["severe"],
      fhir: "high",
      reason:
        "Staff rated the allergy severe. Owner decision (CLINICAL_LOGIC_CHANGES.md 2.7, Severity: severe is high risk too): mBHR's patient header gives severe the same top red alert as life-threatening. Set whether or not a reaction was recorded.",
    },
  ],
  missing: { fhir: null, reason: "No rating recorded: no criticality." },
  unrecognised: {
    fhir: null,
    reason:
      "mild and moderate rate how bad the allergy was, not the risk of a future reaction: no criticality. Never 'low' (mild is the form's pre-selected choice) and never 'unable-to-assess'.",
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
    {
      source: ["life-threatening"],
      fhir: "severe",
      reason:
        "Staff rated the allergy life-threatening. severe is the highest reaction-event-severity code, so this is the closest code and not an upgrade; leaving it out would show a life-threatening reaction as less severe than one rated severe. criticality high is also set. Only with a recorded reaction.",
    },
  ],
  missing: { fhir: null, reason: "No rating recorded: no reaction severity." },
  unrecognised: {
    fhir: null,
    reason:
      "'mild' is the form's pre-selected choice and cannot be told apart from 'not chosen', so no reaction severity is stated for it; any other value is not guessed.",
  },
};

export const ALLERGY_STATUS_MAPS: readonly StatusMap[] = [
  ALLERGY_CLINICAL_STATUS,
  ALLERGY_VERIFICATION_STATUS,
  ALLERGY_CATEGORY,
  ALLERGY_CRITICALITY,
  ALLERGY_REACTION_SEVERITY,
];

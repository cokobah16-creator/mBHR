// Code systems and codes used by the mappers.
//
// Rule: an international code appears here only when the FHIR R4
// specification itself binds it for the concept (the vital signs profile,
// the Condition status and category code systems, the condition-severity
// value set, v3 ActCode). Everything else keeps mBHR's own local coding
// under an https://mbhr.app/codes/... system. Verified mappings from local
// codes to ICD-10, SNOMED CT or LOINC come only from interop.terminology_map
// rows a person has reviewed (review_status = 'verified'); nothing here
// guesses one from a description.

/** Namespace for mBHR's own code systems and identifier systems. */
export const MBHR_CODES = "https://mbhr.app/codes";
export const MBHR_IDENTIFIERS = "https://mbhr.app/identifiers";

export const LOCAL = {
  vitals: `${MBHR_CODES}/vitals`,
  condition: `${MBHR_CODES}/condition`,
  patientIdentifier: `${MBHR_IDENTIFIERS}/patient`,
} as const;

export const LOINC = "http://loinc.org";
export const UCUM = "http://unitsofmeasure.org";
export const SNOMED = "http://snomed.info/sct";
export const OBSERVATION_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";
export const CONDITION_CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical";
export const CONDITION_VER_STATUS = "http://terminology.hl7.org/CodeSystem/condition-ver-status";
export const CONDITION_CATEGORY = "http://terminology.hl7.org/CodeSystem/condition-category";
/** health-concern is defined by US Core, not by the R4 base code system. */
export const US_CORE_CONDITION_CATEGORY = "http://hl7.org/fhir/us/core/CodeSystem/condition-category";
export const V3_ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

export const VITAL_SIGNS_PROFILE = "http://hl7.org/fhir/StructureDefinition/vitalsigns";

/**
 * One measured column of an mBHR vitals row, and how it is published.
 *
 * LOINC codes and UCUM units are the ones the FHIR R4 vital signs profile
 * (http://hl7.org/fhir/R4/observation-vitalsigns.html) binds. The column
 * name is also published as a local coding, so the original concept is
 * never lost behind the international one.
 *
 * `kind` is the stable suffix of the Observation id (`<vitals id>-<kind>`);
 * never rename one, or published ids change.
 */
export interface VitalSignDef {
  kind: string;
  /** Column(s) on public.vitals. */
  columns: string[];
  display: string;
  loinc: { code: string; display: string }[];
  unit?: { code: string; display: string };
  profile: string;
}

export const VITAL_SIGNS: VitalSignDef[] = [
  {
    kind: "bp",
    columns: ["systolic", "diastolic"],
    display: "Blood pressure",
    loinc: [{ code: "85354-9", display: "Blood pressure panel with all children optional" }],
    profile: "http://hl7.org/fhir/StructureDefinition/bp",
  },
  {
    kind: "heart-rate",
    columns: ["pulse_bpm"],
    display: "Pulse",
    loinc: [{ code: "8867-4", display: "Heart rate" }],
    unit: { code: "/min", display: "beats/minute" },
    profile: "http://hl7.org/fhir/StructureDefinition/heartrate",
  },
  {
    kind: "temperature",
    columns: ["temp_c"],
    display: "Body temperature",
    loinc: [{ code: "8310-5", display: "Body temperature" }],
    unit: { code: "Cel", display: "C" },
    profile: "http://hl7.org/fhir/StructureDefinition/bodytemp",
  },
  {
    kind: "weight",
    columns: ["weight_kg"],
    display: "Body weight",
    loinc: [{ code: "29463-7", display: "Body weight" }],
    unit: { code: "kg", display: "kg" },
    profile: "http://hl7.org/fhir/StructureDefinition/bodyweight",
  },
  {
    kind: "height",
    columns: ["height_cm"],
    display: "Body height",
    loinc: [{ code: "8302-2", display: "Body height" }],
    unit: { code: "cm", display: "cm" },
    profile: "http://hl7.org/fhir/StructureDefinition/bodyheight",
  },
  {
    kind: "bmi",
    columns: ["bmi"],
    display: "Body mass index",
    loinc: [{ code: "39156-5", display: "Body mass index (BMI) [Ratio]" }],
    unit: { code: "kg/m2", display: "kg/m2" },
    profile: "http://hl7.org/fhir/StructureDefinition/bmi",
  },
  {
    // The R4 oxygen saturation profile requires 2708-6; 59408-5 (by pulse
    // oximetry) is added because outreach readings come from a pulse
    // oximeter. Both are the codes the specification's examples use.
    kind: "spo2",
    columns: ["spo2"],
    display: "Oxygen saturation",
    loinc: [
      { code: "2708-6", display: "Oxygen saturation in Arterial blood" },
      { code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
    ],
    unit: { code: "%", display: "%" },
    profile: "http://hl7.org/fhir/StructureDefinition/oxygensat",
  },
];

export const BP_COMPONENTS = {
  systolic: { code: "8480-6", display: "Systolic blood pressure" },
  diastolic: { code: "8462-4", display: "Diastolic blood pressure" },
  unit: { code: "mm[Hg]", display: "mmHg" },
} as const;

/**
 * R4 condition-severity value set (SNOMED CT). Displays are current SNOMED
 * CT terms: the value set's "Moderate" is an inactive description of
 * 6736007, which the HL7 validator rejects.
 */
export const CONDITION_SEVERITY: Record<string, { code: string; display: string }> = {
  mild: { code: "255604002", display: "Mild" },
  moderate: { code: "6736007", display: "Moderate (severity modifier)" },
  severe: { code: "24484000", display: "Severe" },
};

/** A verified local-to-standard mapping from interop.terminology_map. */
export interface VerifiedCoding {
  localCode: string;
  system: string;
  code: string;
  display: string | null;
}

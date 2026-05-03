// Portable US Core 7.0 validator. Single source of truth for the browser
// (imported via uscore-validator.ts re-export) and the Deno edge function
// (imported via supabase/functions/tefca-ias/validation.ts using a relative
// path with the .ts extension).
//
// Constraints for portability:
//   - Pure functions over JSON-shaped FHIR resources.
//   - No DOM types, no Dexie, no environment-specific globals.
//   - Imports only from "../types" (which is itself pure types).
//
// Phase D-1 scope:
//   - Move existing validators (Patient, Observation, BloodPressure,
//     MedicationRequest, Encounter, AllergyIntolerance, Condition,
//     DiagnosticReport).
//   - Add validators for the 7 resources introduced in Phase A:
//     Immunization, MedicationDispense, Procedure, DocumentReference,
//     CarePlan, Goal, ServiceRequest.
//   - Bump profile URLs to the US Core 7.0 versioned StructureDefinitions.
//
// The validators emit a structured ValidationResult with errors (must-have
// missing) and warnings (must-support recommended). They never throw.

import type {
  FHIRAllergyIntolerance,
  FHIRCarePlan,
  FHIRCondition,
  FHIRDiagnosticReport,
  FHIRDocumentReference,
  FHIREncounter,
  FHIRGoal,
  FHIRImmunization,
  FHIRMedicationDispense,
  FHIRMedicationRequest,
  FHIRObservation,
  FHIRPatient,
  FHIRProcedure,
  FHIRResource,
  FHIRServiceRequest,
} from "../types";

export interface ValidationError {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  profile: string;
}

const US_CORE_VERSION = "7.0.0";
const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition";

export const US_CORE_PROFILES = {
  patient: `${US_CORE}/us-core-patient|${US_CORE_VERSION}`,
  vitalSigns: `${US_CORE}/us-core-vital-signs|${US_CORE_VERSION}`,
  bloodPressure: `${US_CORE}/us-core-blood-pressure|${US_CORE_VERSION}`,
  medicationRequest: `${US_CORE}/us-core-medicationrequest|${US_CORE_VERSION}`,
  medicationDispense: `${US_CORE}/us-core-medicationdispense|${US_CORE_VERSION}`,
  encounter: `${US_CORE}/us-core-encounter|${US_CORE_VERSION}`,
  allergyIntolerance: `${US_CORE}/us-core-allergyintolerance|${US_CORE_VERSION}`,
  condition: `${US_CORE}/us-core-condition-problems-health-concerns|${US_CORE_VERSION}`,
  immunization: `${US_CORE}/us-core-immunization|${US_CORE_VERSION}`,
  diagnosticReport: `${US_CORE}/us-core-diagnosticreport-lab|${US_CORE_VERSION}`,
  procedure: `${US_CORE}/us-core-procedure|${US_CORE_VERSION}`,
  documentReference: `${US_CORE}/us-core-documentreference|${US_CORE_VERSION}`,
  carePlan: `${US_CORE}/us-core-careplan|${US_CORE_VERSION}`,
  goal: `${US_CORE}/us-core-goal|${US_CORE_VERSION}`,
  serviceRequest: `${US_CORE}/us-core-servicerequest|${US_CORE_VERSION}`,
};

function addError(
  errors: ValidationError[],
  path: string,
  message: string,
): void {
  errors.push({ path, message, severity: "error" });
}

function addWarning(
  warnings: ValidationError[],
  path: string,
  message: string,
): void {
  warnings.push({ path, message, severity: "warning" });
}

function makeResult(
  errors: ValidationError[],
  warnings: ValidationError[],
  profile: string,
): ValidationResult {
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile,
  };
}

// ---------- Patient ----------

export function validateUSCorePatient(patient: FHIRPatient): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!patient.identifier || patient.identifier.length === 0) {
    addError(
      errors,
      "Patient.identifier",
      "At least one identifier is required",
    );
  } else {
    const ok = patient.identifier.some((id) => id.system && id.value);
    if (!ok) {
      addError(
        errors,
        "Patient.identifier",
        "Identifier must have both system and value",
      );
    }
  }

  if (!patient.name || patient.name.length === 0) {
    addError(errors, "Patient.name", "At least one name is required");
  } else {
    const ok = patient.name.some(
      (n) => n.family || (n.given && n.given.length > 0),
    );
    if (!ok) {
      addError(errors, "Patient.name", "Name must have family or given name");
    }
  }

  if (!patient.gender) {
    addError(errors, "Patient.gender", "Gender is required");
  } else if (!["male", "female", "other", "unknown"].includes(patient.gender)) {
    addError(
      errors,
      "Patient.gender",
      `Invalid gender value: ${patient.gender}`,
    );
  }

  if (!patient.birthDate) {
    addWarning(
      warnings,
      "Patient.birthDate",
      "Birth date is recommended for US Core compliance",
    );
  } else if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(patient.birthDate)) {
    addError(
      errors,
      "Patient.birthDate",
      "Birth date must be in YYYY, YYYY-MM, or YYYY-MM-DD format",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.patient);
}

// ---------- Observation (vital signs) ----------

export function validateUSCoreVitalSigns(
  observation: FHIRObservation,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!observation.status) {
    addError(errors, "Observation.status", "Status is required");
  }

  if (!observation.category || observation.category.length === 0) {
    addError(errors, "Observation.category", "Category is required");
  } else {
    const ok = observation.category.some((cat) =>
      cat.coding?.some(
        (c) =>
          c.system ===
            "http://terminology.hl7.org/CodeSystem/observation-category" &&
          c.code === "vital-signs",
      ),
    );
    if (!ok) {
      addError(
        errors,
        "Observation.category",
        "Must include vital-signs category",
      );
    }
  }

  if (!observation.code) {
    addError(errors, "Observation.code", "Code is required");
  } else if (!observation.code.coding || observation.code.coding.length === 0) {
    addWarning(warnings, "Observation.code", "Code should have LOINC coding");
  }

  if (!observation.subject) {
    addError(errors, "Observation.subject", "Subject reference is required");
  } else if (!observation.subject.reference) {
    addError(errors, "Observation.subject", "Subject must have a reference");
  }

  if (!observation.effectiveDateTime) {
    addError(
      errors,
      "Observation.effectiveDateTime",
      "Effective date/time is required",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.vitalSigns);
}

// ---------- Observation (blood pressure panel) ----------

export function validateUSCoreBloodPressure(
  observation: FHIRObservation,
): ValidationResult {
  const base = validateUSCoreVitalSigns(observation);
  const errors = [...base.errors];
  const warnings = [...base.warnings];

  if (!observation.component || observation.component.length < 2) {
    addError(
      errors,
      "Observation.component",
      "Blood pressure must have systolic and diastolic components",
    );
  } else {
    const hasSystolic = observation.component.some((c) =>
      c.code?.coding?.some((coding) => coding.code === "8480-6"),
    );
    const hasDiastolic = observation.component.some((c) =>
      c.code?.coding?.some((coding) => coding.code === "8462-4"),
    );

    if (!hasSystolic) {
      addError(
        errors,
        "Observation.component",
        "Systolic component (LOINC 8480-6) is required",
      );
    }
    if (!hasDiastolic) {
      addError(
        errors,
        "Observation.component",
        "Diastolic component (LOINC 8462-4) is required",
      );
    }

    for (const c of observation.component) {
      if (!c.valueQuantity?.value) {
        addError(
          errors,
          "Observation.component.valueQuantity",
          "Component must have a numeric value",
        );
      }
    }
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.bloodPressure);
}

// ---------- MedicationRequest ----------

export function validateUSCoreMedicationRequest(
  m: FHIRMedicationRequest,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!m.status)
    addError(errors, "MedicationRequest.status", "Status is required");
  if (!m.intent)
    addError(errors, "MedicationRequest.intent", "Intent is required");

  if (!m.medicationCodeableConcept && !("medicationReference" in m)) {
    addError(
      errors,
      "MedicationRequest.medication[x]",
      "Medication is required (either codeableConcept or reference)",
    );
  } else if (m.medicationCodeableConcept) {
    if (
      !m.medicationCodeableConcept.text &&
      !m.medicationCodeableConcept.coding?.length
    ) {
      addError(
        errors,
        "MedicationRequest.medicationCodeableConcept",
        "Medication must have text or coding",
      );
    }
  }

  if (!m.subject) {
    addError(errors, "MedicationRequest.subject", "Subject is required");
  } else if (!m.subject.reference) {
    addError(
      errors,
      "MedicationRequest.subject",
      "Subject must have a reference",
    );
  }

  if (!m.authoredOn) {
    addWarning(
      warnings,
      "MedicationRequest.authoredOn",
      "AuthoredOn is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.medicationRequest);
}

// ---------- MedicationDispense ----------

export function validateUSCoreMedicationDispense(
  d: FHIRMedicationDispense,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!d.status)
    addError(errors, "MedicationDispense.status", "Status is required");

  if (!d.medicationCodeableConcept) {
    addError(
      errors,
      "MedicationDispense.medication[x]",
      "Medication is required (codeableConcept)",
    );
  } else if (
    !d.medicationCodeableConcept.text &&
    !d.medicationCodeableConcept.coding?.length
  ) {
    addError(
      errors,
      "MedicationDispense.medicationCodeableConcept",
      "Medication must have text or coding",
    );
  }

  if (!d.subject) {
    addError(errors, "MedicationDispense.subject", "Subject is required");
  } else if (!d.subject.reference) {
    addError(
      errors,
      "MedicationDispense.subject",
      "Subject must have a reference",
    );
  }

  if (!d.whenHandedOver) {
    addWarning(
      warnings,
      "MedicationDispense.whenHandedOver",
      "whenHandedOver is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.medicationDispense);
}

// ---------- Encounter ----------

export function validateUSCoreEncounter(
  encounter: FHIREncounter,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!encounter.identifier || encounter.identifier.length === 0) {
    addWarning(
      warnings,
      "Encounter.identifier",
      "At least one identifier is recommended",
    );
  }

  if (!encounter.status)
    addError(errors, "Encounter.status", "Status is required");

  if (!encounter.class) {
    addError(errors, "Encounter.class", "Class is required");
  } else if (!encounter.class.code) {
    addError(errors, "Encounter.class", "Class must have a code");
  }

  if (!encounter.type || encounter.type.length === 0) {
    addWarning(warnings, "Encounter.type", "Type is recommended");
  }

  if (!encounter.subject) {
    addError(errors, "Encounter.subject", "Subject is required");
  } else if (!encounter.subject.reference) {
    addError(errors, "Encounter.subject", "Subject must have a reference");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.encounter);
}

// ---------- AllergyIntolerance ----------

export function validateUSCoreAllergyIntolerance(
  a: FHIRAllergyIntolerance,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!a.clinicalStatus) {
    addError(
      errors,
      "AllergyIntolerance.clinicalStatus",
      "Clinical status is required",
    );
  }

  if (!a.code) {
    addError(errors, "AllergyIntolerance.code", "Code is required");
  } else if (!a.code.text && !a.code.coding?.length) {
    addError(
      errors,
      "AllergyIntolerance.code",
      "Code must have text or coding",
    );
  }

  if (!a.patient) {
    addError(errors, "AllergyIntolerance.patient", "Patient is required");
  } else if (!a.patient.reference) {
    addError(
      errors,
      "AllergyIntolerance.patient",
      "Patient must have a reference",
    );
  }

  if (!a.verificationStatus) {
    addWarning(
      warnings,
      "AllergyIntolerance.verificationStatus",
      "Verification status is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.allergyIntolerance);
}

// ---------- Condition ----------

export function validateUSCoreCondition(c: FHIRCondition): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!c.clinicalStatus) {
    addError(errors, "Condition.clinicalStatus", "Clinical status is required");
  }
  if (!c.verificationStatus) {
    addWarning(
      warnings,
      "Condition.verificationStatus",
      "Verification status is recommended",
    );
  }
  if (!c.category || c.category.length === 0) {
    addError(errors, "Condition.category", "Category is required");
  }
  if (!c.code) {
    addError(errors, "Condition.code", "Code is required");
  } else if (!c.code.text && !c.code.coding?.length) {
    addError(errors, "Condition.code", "Code must have text or coding");
  }
  if (!c.subject) {
    addError(errors, "Condition.subject", "Subject is required");
  } else if (!c.subject.reference) {
    addError(errors, "Condition.subject", "Subject must have a reference");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.condition);
}

// ---------- Immunization ----------

export function validateUSCoreImmunization(
  i: FHIRImmunization,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!i.status) addError(errors, "Immunization.status", "Status is required");
  if (!i.vaccineCode) {
    addError(errors, "Immunization.vaccineCode", "vaccineCode is required");
  } else if (!i.vaccineCode.text && !i.vaccineCode.coding?.length) {
    addError(
      errors,
      "Immunization.vaccineCode",
      "vaccineCode must have text or coding (CVX preferred)",
    );
  }
  if (!i.patient) {
    addError(errors, "Immunization.patient", "patient is required");
  } else if (!i.patient.reference) {
    addError(errors, "Immunization.patient", "patient must have a reference");
  }
  if (!i.occurrenceDateTime) {
    addWarning(
      warnings,
      "Immunization.occurrence[x]",
      "occurrence date is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.immunization);
}

// ---------- DiagnosticReport ----------

export function validateUSCoreDiagnosticReport(
  r: FHIRDiagnosticReport,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!r.status)
    addError(errors, "DiagnosticReport.status", "Status is required");
  if (!r.category || r.category.length === 0) {
    addError(errors, "DiagnosticReport.category", "Category is required");
  }
  if (!r.code) addError(errors, "DiagnosticReport.code", "Code is required");
  if (!r.subject) {
    addError(errors, "DiagnosticReport.subject", "Subject is required");
  } else if (!r.subject.reference) {
    addError(
      errors,
      "DiagnosticReport.subject",
      "Subject must have a reference",
    );
  }
  if (!r.effectiveDateTime) {
    addWarning(
      warnings,
      "DiagnosticReport.effective[x]",
      "Effective date is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.diagnosticReport);
}

// ---------- Procedure ----------

export function validateUSCoreProcedure(p: FHIRProcedure): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!p.status) addError(errors, "Procedure.status", "Status is required");
  if (!p.code) {
    addError(errors, "Procedure.code", "Code is required");
  } else if (!p.code.text && !p.code.coding?.length) {
    addError(errors, "Procedure.code", "Code must have text or coding");
  }
  if (!p.subject) {
    addError(errors, "Procedure.subject", "Subject is required");
  } else if (!p.subject.reference) {
    addError(errors, "Procedure.subject", "Subject must have a reference");
  }
  if (!p.performedDateTime && !p.performedPeriod) {
    addWarning(
      warnings,
      "Procedure.performed[x]",
      "performedDateTime or performedPeriod is recommended",
    );
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.procedure);
}

// ---------- DocumentReference ----------

export function validateUSCoreDocumentReference(
  d: FHIRDocumentReference,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!d.status) {
    addError(errors, "DocumentReference.status", "Status is required");
  }
  if (!d.subject) {
    addError(errors, "DocumentReference.subject", "Subject is required");
  } else if (!d.subject.reference) {
    addError(
      errors,
      "DocumentReference.subject",
      "Subject must have a reference",
    );
  }
  if (!d.content || d.content.length === 0) {
    addError(
      errors,
      "DocumentReference.content",
      "At least one content entry is required",
    );
  } else {
    for (const c of d.content) {
      if (!c.attachment?.url && !c.attachment?.data) {
        addError(
          errors,
          "DocumentReference.content.attachment",
          "Attachment must have url or data",
        );
      }
    }
  }
  if (!d.type) {
    addWarning(warnings, "DocumentReference.type", "type is recommended");
  }
  if (!d.date) {
    addWarning(warnings, "DocumentReference.date", "date is recommended");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.documentReference);
}

// ---------- CarePlan ----------

export function validateUSCoreCarePlan(cp: FHIRCarePlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!cp.status) addError(errors, "CarePlan.status", "Status is required");
  if (!cp.intent) addError(errors, "CarePlan.intent", "Intent is required");
  if (!cp.subject) {
    addError(errors, "CarePlan.subject", "Subject is required");
  } else if (!cp.subject.reference) {
    addError(errors, "CarePlan.subject", "Subject must have a reference");
  }
  if (!cp.category || cp.category.length === 0) {
    addWarning(warnings, "CarePlan.category", "category is recommended");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.carePlan);
}

// ---------- Goal ----------

export function validateUSCoreGoal(g: FHIRGoal): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!g.lifecycleStatus) {
    addError(errors, "Goal.lifecycleStatus", "lifecycleStatus is required");
  }
  if (!g.description) {
    addError(errors, "Goal.description", "description is required");
  } else if (!g.description.text && !g.description.coding?.length) {
    addError(
      errors,
      "Goal.description",
      "description must have text or coding",
    );
  }
  if (!g.subject) {
    addError(errors, "Goal.subject", "Subject is required");
  } else if (!g.subject.reference) {
    addError(errors, "Goal.subject", "Subject must have a reference");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.goal);
}

// ---------- ServiceRequest ----------

export function validateUSCoreServiceRequest(
  sr: FHIRServiceRequest,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!sr.status)
    addError(errors, "ServiceRequest.status", "Status is required");
  if (!sr.intent)
    addError(errors, "ServiceRequest.intent", "Intent is required");
  if (!sr.subject) {
    addError(errors, "ServiceRequest.subject", "Subject is required");
  } else if (!sr.subject.reference) {
    addError(errors, "ServiceRequest.subject", "Subject must have a reference");
  }
  if (!sr.code) {
    addWarning(warnings, "ServiceRequest.code", "code is recommended");
  } else if (!sr.code.text && !sr.code.coding?.length) {
    addError(errors, "ServiceRequest.code", "code must have text or coding");
  }

  return makeResult(errors, warnings, US_CORE_PROFILES.serviceRequest);
}

// ---------- Dispatcher ----------

export function validateResource(resource: FHIRResource): ValidationResult {
  switch (resource.resourceType) {
    case "Patient":
      return validateUSCorePatient(resource as FHIRPatient);
    case "Observation": {
      const obs = resource as FHIRObservation;
      const isBloodPressure = obs.code?.coding?.some(
        (c) => c.code === "85354-9",
      );
      return isBloodPressure
        ? validateUSCoreBloodPressure(obs)
        : validateUSCoreVitalSigns(obs);
    }
    case "MedicationRequest":
      return validateUSCoreMedicationRequest(resource as FHIRMedicationRequest);
    case "MedicationDispense":
      return validateUSCoreMedicationDispense(
        resource as FHIRMedicationDispense,
      );
    case "Encounter":
      return validateUSCoreEncounter(resource as FHIREncounter);
    case "AllergyIntolerance":
      return validateUSCoreAllergyIntolerance(
        resource as FHIRAllergyIntolerance,
      );
    case "Condition":
      return validateUSCoreCondition(resource as FHIRCondition);
    case "Immunization":
      return validateUSCoreImmunization(resource as FHIRImmunization);
    case "DiagnosticReport":
      return validateUSCoreDiagnosticReport(resource as FHIRDiagnosticReport);
    case "Procedure":
      return validateUSCoreProcedure(resource as FHIRProcedure);
    case "DocumentReference":
      return validateUSCoreDocumentReference(resource as FHIRDocumentReference);
    case "CarePlan":
      return validateUSCoreCarePlan(resource as FHIRCarePlan);
    case "Goal":
      return validateUSCoreGoal(resource as FHIRGoal);
    case "ServiceRequest":
      return validateUSCoreServiceRequest(resource as FHIRServiceRequest);
    default:
      return {
        valid: true,
        errors: [],
        warnings: [
          {
            path: resource.resourceType,
            message: "No US Core validator available for this resource type",
            severity: "warning",
          },
        ],
        profile: "unknown",
      };
  }
}

export interface BundleValidationResult {
  valid: boolean;
  totalResources: number;
  validResources: number;
  invalidResources: number;
  resourceResults: Map<string, ValidationResult>;
  summary: {
    errors: number;
    warnings: number;
    byResourceType: Record<string, { valid: number; invalid: number }>;
  };
}

export function validateBundle(
  resources: FHIRResource[],
): BundleValidationResult {
  const resourceResults = new Map<string, ValidationResult>();
  const byResourceType: Record<string, { valid: number; invalid: number }> = {};
  let validCount = 0;
  let invalidCount = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const r of resources) {
    const key = `${r.resourceType}/${r.id ?? "?"}`;
    const result = validateResource(r);
    resourceResults.set(key, result);

    byResourceType[r.resourceType] ||= { valid: 0, invalid: 0 };
    if (result.valid) {
      validCount++;
      byResourceType[r.resourceType].valid++;
    } else {
      invalidCount++;
      byResourceType[r.resourceType].invalid++;
    }
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  return {
    valid: invalidCount === 0,
    totalResources: resources.length,
    validResources: validCount,
    invalidResources: invalidCount,
    resourceResults,
    summary: {
      errors: totalErrors,
      warnings: totalWarnings,
      byResourceType,
    },
  };
}

/**
 * Compact validation issue text suitable for embedding in
 * tefca_access_logs.error_message. Stays under 200 chars.
 */
export function summarizeValidationIssues(
  result: ValidationResult,
): string | null {
  if (result.valid && result.warnings.length === 0) return null;
  const parts: string[] = [];
  for (const e of result.errors) parts.push(`E:${e.path}:${e.message}`);
  for (const w of result.warnings) parts.push(`W:${w.path}:${w.message}`);
  const joined = parts.join("; ");
  return joined.length > 240 ? joined.slice(0, 237) + "..." : joined;
}

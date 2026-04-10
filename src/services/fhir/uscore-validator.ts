import type {
  FHIRResource,
  FHIRPatient,
  FHIRObservation,
  FHIRMedicationRequest,
  FHIREncounter,
} from "./types";
import type {
  FHIRAllergyIntolerance,
  FHIRDiagnosticReport,
  FHIRCondition,
} from "./dexieAdapters";

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

const US_CORE_PROFILES = {
  patient: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient",
  vitalSigns:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs",
  bloodPressure:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure",
  medicationRequest:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest",
  encounter:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter",
  allergyIntolerance:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance",
  condition:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns",
  diagnosticReport:
    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-diagnosticreport-note",
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
    const hasValidIdentifier = patient.identifier.some(
      (id) => id.system && id.value,
    );
    if (!hasValidIdentifier) {
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
    const hasValidName = patient.name.some(
      (n) => n.family || (n.given && n.given.length > 0),
    );
    if (!hasValidName) {
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
  } else {
    const dateRegex = /^\d{4}(-\d{2}(-\d{2})?)?$/;
    if (!dateRegex.test(patient.birthDate)) {
      addError(
        errors,
        "Patient.birthDate",
        "Birth date must be in YYYY, YYYY-MM, or YYYY-MM-DD format",
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.patient,
  };
}

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
    const hasVitalSignsCategory = observation.category.some((cat) =>
      cat.coding?.some(
        (c) =>
          c.system ===
            "http://terminology.hl7.org/CodeSystem/observation-category" &&
          c.code === "vital-signs",
      ),
    );
    if (!hasVitalSignsCategory) {
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.vitalSigns,
  };
}

export function validateUSCoreBloodPressure(
  observation: FHIRObservation,
): ValidationResult {
  const baseResult = validateUSCoreVitalSigns(observation);
  const errors = [...baseResult.errors];
  const warnings = [...baseResult.warnings];

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

    for (const component of observation.component) {
      if (!component.valueQuantity?.value) {
        addError(
          errors,
          "Observation.component.valueQuantity",
          "Component must have a numeric value",
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.bloodPressure,
  };
}

export function validateUSCoreMedicationRequest(
  medRequest: FHIRMedicationRequest,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!medRequest.status) {
    addError(errors, "MedicationRequest.status", "Status is required");
  }

  if (!medRequest.intent) {
    addError(errors, "MedicationRequest.intent", "Intent is required");
  }

  if (
    !medRequest.medicationCodeableConcept &&
    !("medicationReference" in medRequest)
  ) {
    addError(
      errors,
      "MedicationRequest.medication[x]",
      "Medication is required (either codeableConcept or reference)",
    );
  } else if (medRequest.medicationCodeableConcept) {
    if (
      !medRequest.medicationCodeableConcept.text &&
      !medRequest.medicationCodeableConcept.coding?.length
    ) {
      addError(
        errors,
        "MedicationRequest.medicationCodeableConcept",
        "Medication must have text or coding",
      );
    }
  }

  if (!medRequest.subject) {
    addError(errors, "MedicationRequest.subject", "Subject is required");
  } else if (!medRequest.subject.reference) {
    addError(
      errors,
      "MedicationRequest.subject",
      "Subject must have a reference",
    );
  }

  if (!medRequest.authoredOn) {
    addWarning(
      warnings,
      "MedicationRequest.authoredOn",
      "AuthoredOn is recommended",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.medicationRequest,
  };
}

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

  if (!encounter.status) {
    addError(errors, "Encounter.status", "Status is required");
  }

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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.encounter,
  };
}

export function validateUSCoreAllergyIntolerance(
  allergy: FHIRAllergyIntolerance,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!allergy.clinicalStatus) {
    addError(
      errors,
      "AllergyIntolerance.clinicalStatus",
      "Clinical status is required",
    );
  }

  if (!allergy.code) {
    addError(errors, "AllergyIntolerance.code", "Code is required");
  } else if (!allergy.code.text && !allergy.code.coding?.length) {
    addError(
      errors,
      "AllergyIntolerance.code",
      "Code must have text or coding",
    );
  }

  if (!allergy.patient) {
    addError(errors, "AllergyIntolerance.patient", "Patient is required");
  } else if (!allergy.patient.reference) {
    addError(
      errors,
      "AllergyIntolerance.patient",
      "Patient must have a reference",
    );
  }

  if (!allergy.verificationStatus) {
    addWarning(
      warnings,
      "AllergyIntolerance.verificationStatus",
      "Verification status is recommended",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.allergyIntolerance,
  };
}

export function validateUSCoreCondition(
  condition: FHIRCondition,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!condition.clinicalStatus) {
    addError(errors, "Condition.clinicalStatus", "Clinical status is required");
  }

  if (!condition.verificationStatus) {
    addWarning(
      warnings,
      "Condition.verificationStatus",
      "Verification status is recommended",
    );
  }

  if (!condition.category || condition.category.length === 0) {
    addError(errors, "Condition.category", "Category is required");
  }

  if (!condition.code) {
    addError(errors, "Condition.code", "Code is required");
  } else if (!condition.code.text && !condition.code.coding?.length) {
    addError(errors, "Condition.code", "Code must have text or coding");
  }

  if (!condition.subject) {
    addError(errors, "Condition.subject", "Subject is required");
  } else if (!condition.subject.reference) {
    addError(errors, "Condition.subject", "Subject must have a reference");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.condition,
  };
}

export function validateUSCoreDiagnosticReport(
  report: FHIRDiagnosticReport,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!report.status) {
    addError(errors, "DiagnosticReport.status", "Status is required");
  }

  if (!report.category || report.category.length === 0) {
    addError(errors, "DiagnosticReport.category", "Category is required");
  }

  if (!report.code) {
    addError(errors, "DiagnosticReport.code", "Code is required");
  }

  if (!report.subject) {
    addError(errors, "DiagnosticReport.subject", "Subject is required");
  } else if (!report.subject.reference) {
    addError(
      errors,
      "DiagnosticReport.subject",
      "Subject must have a reference",
    );
  }

  if (!report.effectiveDateTime) {
    addWarning(
      warnings,
      "DiagnosticReport.effective[x]",
      "Effective date is recommended",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    profile: US_CORE_PROFILES.diagnosticReport,
  };
}

export function validateResource(resource: FHIRResource): ValidationResult {
  switch (resource.resourceType) {
    case "Patient":
      return validateUSCorePatient(resource as FHIRPatient);
    case "Observation": {
      const obs = resource as FHIRObservation;
      const isBloodPressure = obs.code?.coding?.some(
        (c) => c.code === "85354-9",
      );
      if (isBloodPressure) {
        return validateUSCoreBloodPressure(obs);
      }
      return validateUSCoreVitalSigns(obs);
    }
    case "MedicationRequest":
      return validateUSCoreMedicationRequest(resource as FHIRMedicationRequest);
    case "Encounter":
      return validateUSCoreEncounter(resource as FHIREncounter);
    case "AllergyIntolerance":
      return validateUSCoreAllergyIntolerance(
        resource as FHIRAllergyIntolerance,
      );
    case "Condition":
      return validateUSCoreCondition(resource as FHIRCondition);
    case "DiagnosticReport":
      return validateUSCoreDiagnosticReport(resource as FHIRDiagnosticReport);
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
  let totalErrors = 0;
  let totalWarnings = 0;
  let validCount = 0;
  let invalidCount = 0;

  for (const resource of resources) {
    const result = validateResource(resource);
    const key =
      resource.id ||
      `${resource.resourceType}-${Math.random().toString(36).substr(2, 9)}`;
    resourceResults.set(key, result);

    if (!byResourceType[resource.resourceType]) {
      byResourceType[resource.resourceType] = { valid: 0, invalid: 0 };
    }

    if (result.valid) {
      validCount++;
      byResourceType[resource.resourceType].valid++;
    } else {
      invalidCount++;
      byResourceType[resource.resourceType].invalid++;
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

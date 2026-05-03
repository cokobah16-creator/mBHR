// Re-export shim. The portable US Core 7.0 validator lives in
// ./validation/core so it can be shared between the browser bundle and the
// Deno edge function (supabase/functions/tefca-ias/validation.ts imports the
// same file via a relative .ts path).

export {
  US_CORE_PROFILES,
  validateBundle,
  validateResource,
  validateUSCoreAllergyIntolerance,
  validateUSCoreBloodPressure,
  validateUSCoreCarePlan,
  validateUSCoreCondition,
  validateUSCoreDiagnosticReport,
  validateUSCoreDocumentReference,
  validateUSCoreEncounter,
  validateUSCoreGoal,
  validateUSCoreImmunization,
  validateUSCoreMedicationDispense,
  validateUSCoreMedicationRequest,
  validateUSCorePatient,
  validateUSCoreProcedure,
  validateUSCoreServiceRequest,
  validateUSCoreVitalSigns,
  summarizeValidationIssues,
  type BundleValidationResult,
  type ValidationError,
  type ValidationResult,
} from "./validation/core";

// PHI sensitivity and priority classification for conflict records.
//
// Moved unchanged from services/conflictQueue so the rules can be unit
// tested and shown in the UI from a single source. These are privacy
// classifications (how identifying a field is), not clinical rules.

import type {
  ConflictField,
  ConflictPriority,
  ConflictType,
  PHISensitivity,
} from "@/services/conflictQueue";

export const PHI_FIELDS: Record<string, PHISensitivity> = {
  givenName: "high",
  familyName: "high",
  dob: "high",
  phone: "high",
  email: "high",
  address: "high",
  state: "medium",
  lga: "medium",
  photoUrl: "high",
  sex: "medium",
  soapSubjective: "high",
  soapObjective: "high",
  soapAssessment: "high",
  soapPlan: "high",
  provisionalDx: "high",
  heightCm: "low",
  weightKg: "low",
  tempC: "low",
  pulseBpm: "low",
  systolic: "low",
  diastolic: "low",
  spo2: "low",
  bmi: "low",
};

export function getFieldPHISensitivity(field: string): PHISensitivity {
  return PHI_FIELDS[field] || "none";
}

export function overallPHISensitivity(
  fields: Pick<ConflictField, "phiSensitivity">[],
): PHISensitivity {
  const sensitivities = fields.map((f) => f.phiSensitivity);
  if (sensitivities.includes("high")) return "high";
  if (sensitivities.includes("medium")) return "medium";
  if (sensitivities.includes("low")) return "low";
  return "none";
}

export function conflictPriority(
  conflictType: ConflictType,
  phiSensitivity: PHISensitivity,
  entityType: string,
): ConflictPriority {
  if (phiSensitivity === "high" && entityType === "patients") return "critical";
  if (phiSensitivity === "high") return "high";
  if (conflictType === "duplicate" && entityType === "patients") return "high";
  if (phiSensitivity === "medium") return "medium";
  return "low";
}

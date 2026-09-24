import { db, generateId, type PatientAllergy } from "../db";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import { isAllergyActive } from "@/utils/allergyActive";

export interface CreateAllergyInput {
  patientId: string;
  allergen: string;
  allergyType: "medication" | "food" | "environmental" | "other";
  reaction?: string;
  severity: "mild" | "moderate" | "severe" | "life-threatening";
  onsetDate?: Date;
  notes?: string;
  createdBy: string;
}

export interface UpdateAllergyInput {
  allergen?: string;
  allergyType?: "medication" | "food" | "environmental" | "other";
  reaction?: string;
  severity?: "mild" | "moderate" | "severe" | "life-threatening";
  onsetDate?: Date;
  notes?: string;
  isActive?: 0 | 1;
}

export const createAllergy = async (
  input: CreateAllergyInput,
): Promise<string> => {
  const now = new Date();

  const allergy: PatientAllergy = {
    id: generateId(),
    patientId: input.patientId,
    allergen: input.allergen,
    allergyType: input.allergyType,
    reaction: input.reaction,
    severity: input.severity,
    onsetDate: input.onsetDate,
    notes: input.notes,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    _dirty: 1,
  };

  await db.patientAllergies.add(allergy);
  return allergy.id;
};

export const updateAllergy = async (
  allergyId: string,
  updates: UpdateAllergyInput,
): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    ...updates,
    updatedAt: new Date(),
    _dirty: 1,
  });
};

export const deactivateAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    isActive: 0,
    updatedAt: new Date(),
    _dirty: 1,
  });
};

export const reactivateAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    isActive: 1,
    updatedAt: new Date(),
    _dirty: 1,
  });
};

export const deleteAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.delete(allergyId);
};

export const getPatientAllergies = async (
  patientId: string,
  activeOnly = true,
): Promise<PatientAllergy[]> => {
  const query = db.patientAllergies.where("patientId").equals(patientId);

  if (activeOnly) {
    return query.filter((a) => isAllergyActive(a)).toArray();
  }

  return query.toArray();
};

export const getActiveAllergies = async (
  patientId: string,
): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where("patientId")
    .equals(patientId)
    .filter((a) => isAllergyActive(a))
    .toArray();
};

export const getAllergyById = async (
  allergyId: string,
): Promise<PatientAllergy | undefined> => {
  return db.patientAllergies.get(allergyId);
};

export const getMedicationAllergies = async (
  patientId: string,
): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where("patientId")
    .equals(patientId)
    .filter((a) => isAllergyActive(a) && a.allergyType === "medication")
    .toArray();
};

export const getSevereAllergies = async (
  patientId: string,
): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where("patientId")
    .equals(patientId)
    .filter(
      (a) =>
        isAllergyActive(a) &&
        (a.severity === "severe" || a.severity === "life-threatening"),
    )
    .toArray();
};

export const checkMedicationAllergy = async (
  patientId: string,
  medicationName: string,
): Promise<PatientAllergy | null> => {
  const allergies = await getMedicationAllergies(patientId);

  // Direct name match or same drug class (e.g. penicillin → amoxicillin).
  const match = allergies.find(
    (a) => matchMedicationToAllergen(medicationName, a.allergen) !== null,
  );

  return match || null;
};

export const hasActiveAllergies = async (
  patientId: string,
): Promise<boolean> => {
  const count = await db.patientAllergies
    .where("patientId")
    .equals(patientId)
    .filter((a) => isAllergyActive(a))
    .count();

  return count > 0;
};

export const getAllergyStats = async (patientId: string) => {
  const allergies = await getPatientAllergies(patientId, false);

  return {
    total: allergies.length,
    active: allergies.filter((a) => isAllergyActive(a)).length,
    inactive: allergies.filter((a) => !isAllergyActive(a)).length,
    byType: {
      medication: allergies.filter(
        (a) => a.allergyType === "medication" && isAllergyActive(a),
      ).length,
      food: allergies.filter(
        (a) => a.allergyType === "food" && isAllergyActive(a),
      ).length,
      environmental: allergies.filter(
        (a) => a.allergyType === "environmental" && isAllergyActive(a),
      ).length,
      other: allergies.filter(
        (a) => a.allergyType === "other" && isAllergyActive(a),
      ).length,
    },
    bySeverity: {
      mild: allergies.filter((a) => a.severity === "mild" && isAllergyActive(a))
        .length,
      moderate: allergies.filter(
        (a) => a.severity === "moderate" && isAllergyActive(a),
      ).length,
      severe: allergies.filter(
        (a) => a.severity === "severe" && isAllergyActive(a),
      ).length,
      lifeThreatening: allergies.filter(
        (a) => a.severity === "life-threatening" && isAllergyActive(a),
      ).length,
    },
  };
};

import { db, generateId, type PatientAllergy } from '../db'

export interface CreateAllergyInput {
  patientId: string
  allergen: string
  allergyType: 'medication' | 'food' | 'environmental' | 'other'
  reaction?: string
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening'
  onsetDate?: Date
  notes?: string
  createdBy: string
}

export interface UpdateAllergyInput {
  allergen?: string
  allergyType?: 'medication' | 'food' | 'environmental' | 'other'
  reaction?: string
  severity?: 'mild' | 'moderate' | 'severe' | 'life-threatening'
  onsetDate?: Date
  notes?: string
  isActive?: 0 | 1
}

export const createAllergy = async (input: CreateAllergyInput): Promise<string> => {
  const now = new Date()

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
    _dirty: 1
  }

  await db.patientAllergies.add(allergy)
  return allergy.id
}

export const updateAllergy = async (
  allergyId: string,
  updates: UpdateAllergyInput
): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    ...updates,
    updatedAt: new Date(),
    _dirty: 1
  })
}

export const deactivateAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    isActive: 0,
    updatedAt: new Date(),
    _dirty: 1
  })
}

export const reactivateAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.update(allergyId, {
    isActive: 1,
    updatedAt: new Date(),
    _dirty: 1
  })
}

export const deleteAllergy = async (allergyId: string): Promise<void> => {
  await db.patientAllergies.delete(allergyId)
}

export const getPatientAllergies = async (
  patientId: string,
  activeOnly = true
): Promise<PatientAllergy[]> => {
  let query = db.patientAllergies.where('patientId').equals(patientId)

  if (activeOnly) {
    return query.filter(a => a.isActive === 1).toArray()
  }

  return query.toArray()
}

export const getActiveAllergies = async (patientId: string): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where('patientId')
    .equals(patientId)
    .filter(a => a.isActive === 1)
    .toArray()
}

export const getAllergyById = async (allergyId: string): Promise<PatientAllergy | undefined> => {
  return db.patientAllergies.get(allergyId)
}

export const getMedicationAllergies = async (patientId: string): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where('patientId')
    .equals(patientId)
    .filter(a => a.isActive === 1 && a.allergyType === 'medication')
    .toArray()
}

export const getSevereAllergies = async (patientId: string): Promise<PatientAllergy[]> => {
  return db.patientAllergies
    .where('patientId')
    .equals(patientId)
    .filter(a =>
      a.isActive === 1 &&
      (a.severity === 'severe' || a.severity === 'life-threatening')
    )
    .toArray()
}

export const checkMedicationAllergy = async (
  patientId: string,
  medicationName: string
): Promise<PatientAllergy | null> => {
  const allergies = await getMedicationAllergies(patientId)

  const match = allergies.find(a =>
    a.allergen.toLowerCase().includes(medicationName.toLowerCase()) ||
    medicationName.toLowerCase().includes(a.allergen.toLowerCase())
  )

  return match || null
}

export const hasActiveAllergies = async (patientId: string): Promise<boolean> => {
  const count = await db.patientAllergies
    .where('patientId')
    .equals(patientId)
    .filter(a => a.isActive === 1)
    .count()

  return count > 0
}

export const getAllergyStats = async (patientId: string) => {
  const allergies = await getPatientAllergies(patientId, false)

  return {
    total: allergies.length,
    active: allergies.filter(a => a.isActive === 1).length,
    inactive: allergies.filter(a => a.isActive === 0).length,
    byType: {
      medication: allergies.filter(a => a.allergyType === 'medication' && a.isActive === 1).length,
      food: allergies.filter(a => a.allergyType === 'food' && a.isActive === 1).length,
      environmental: allergies.filter(a => a.allergyType === 'environmental' && a.isActive === 1).length,
      other: allergies.filter(a => a.allergyType === 'other' && a.isActive === 1).length
    },
    bySeverity: {
      mild: allergies.filter(a => a.severity === 'mild' && a.isActive === 1).length,
      moderate: allergies.filter(a => a.severity === 'moderate' && a.isActive === 1).length,
      severe: allergies.filter(a => a.severity === 'severe' && a.isActive === 1).length,
      lifeThreatening: allergies.filter(a => a.severity === 'life-threatening' && a.isActive === 1).length
    }
  }
}

import { db, generateId, type PatientPreference } from '../db'

export interface CreatePreferenceInput {
  patientId: string
  preferredLanguage?: string
  communicationChannel?: 'sms' | 'whatsapp' | 'call' | 'in-person'
  bestContactTime?: string
  dietaryRestrictions?: string
  religiousCultural?: string
  appointmentReminders?: 0 | 1
  medicationReminders?: 0 | 1
  notes?: string
}

export interface UpdatePreferenceInput {
  preferredLanguage?: string
  communicationChannel?: 'sms' | 'whatsapp' | 'call' | 'in-person'
  bestContactTime?: string
  dietaryRestrictions?: string
  religiousCultural?: string
  appointmentReminders?: 0 | 1
  medicationReminders?: 0 | 1
  notes?: string
}

export const createOrUpdatePreference = async (
  input: CreatePreferenceInput
): Promise<string> => {
  const existing = await db.patientPreferences
    .where('patientId')
    .equals(input.patientId)
    .first()

  if (existing) {
    await db.patientPreferences.update(existing.id, {
      ...input,
      updatedAt: new Date(),
      _dirty: 1
    })
    return existing.id
  }

  const now = new Date()
  const preference: PatientPreference = {
    id: generateId(),
    patientId: input.patientId,
    preferredLanguage: input.preferredLanguage,
    communicationChannel: input.communicationChannel,
    bestContactTime: input.bestContactTime,
    dietaryRestrictions: input.dietaryRestrictions,
    religiousCultural: input.religiousCultural,
    appointmentReminders: input.appointmentReminders ?? 1,
    medicationReminders: input.medicationReminders ?? 1,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    _dirty: 1
  }

  await db.patientPreferences.add(preference)
  return preference.id
}

export const updatePreference = async (
  patientId: string,
  updates: UpdatePreferenceInput
): Promise<void> => {
  const existing = await db.patientPreferences
    .where('patientId')
    .equals(patientId)
    .first()

  if (!existing) {
    throw new Error('Patient preferences not found')
  }

  await db.patientPreferences.update(existing.id, {
    ...updates,
    updatedAt: new Date(),
    _dirty: 1
  })
}

export const getPatientPreference = async (
  patientId: string
): Promise<PatientPreference | undefined> => {
  return db.patientPreferences.where('patientId').equals(patientId).first()
}

export const deletePreference = async (patientId: string): Promise<void> => {
  const existing = await db.patientPreferences
    .where('patientId')
    .equals(patientId)
    .first()

  if (existing) {
    await db.patientPreferences.delete(existing.id)
  }
}

export const getPreferredLanguage = async (patientId: string): Promise<string | null> => {
  const preference = await getPatientPreference(patientId)
  return preference?.preferredLanguage || null
}

export const getCommunicationChannel = async (
  patientId: string
): Promise<'sms' | 'whatsapp' | 'call' | 'in-person' | null> => {
  const preference = await getPatientPreference(patientId)
  return preference?.communicationChannel || null
}

export const shouldSendAppointmentReminders = async (
  patientId: string
): Promise<boolean> => {
  const preference = await getPatientPreference(patientId)
  return preference?.appointmentReminders === 1
}

export const shouldSendMedicationReminders = async (
  patientId: string
): Promise<boolean> => {
  const preference = await getPatientPreference(patientId)
  return preference?.medicationReminders === 1
}

export const hasPreferences = async (patientId: string): Promise<boolean> => {
  const count = await db.patientPreferences
    .where('patientId')
    .equals(patientId)
    .count()

  return count > 0
}

export const getPreferenceSummary = async (patientId: string) => {
  const preference = await getPatientPreference(patientId)

  if (!preference) {
    return {
      hasPreferences: false,
      language: null,
      channel: null,
      reminders: {
        appointments: true,
        medications: true
      }
    }
  }

  return {
    hasPreferences: true,
    language: preference.preferredLanguage || null,
    channel: preference.communicationChannel || null,
    contactTime: preference.bestContactTime || null,
    dietary: preference.dietaryRestrictions || null,
    cultural: preference.religiousCultural || null,
    reminders: {
      appointments: preference.appointmentReminders === 1,
      medications: preference.medicationReminders === 1
    }
  }
}

export const toggleAppointmentReminders = async (patientId: string): Promise<void> => {
  const preference = await getPatientPreference(patientId)

  if (!preference) {
    await createOrUpdatePreference({
      patientId,
      appointmentReminders: 0
    })
    return
  }

  await db.patientPreferences.update(preference.id, {
    appointmentReminders: preference.appointmentReminders === 1 ? 0 : 1,
    updatedAt: new Date(),
    _dirty: 1
  })
}

export const toggleMedicationReminders = async (patientId: string): Promise<void> => {
  const preference = await getPatientPreference(patientId)

  if (!preference) {
    await createOrUpdatePreference({
      patientId,
      medicationReminders: 0
    })
    return
  }

  await db.patientPreferences.update(preference.id, {
    medicationReminders: preference.medicationReminders === 1 ? 0 : 1,
    updatedAt: new Date(),
    _dirty: 1
  })
}

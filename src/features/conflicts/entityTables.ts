// Map a conflict's record type (server table name) to this device's table.
// Mirrors the table mapping the sync adapter uses.

export const ENTITY_LOCAL_TABLE: Record<string, string> = {
  app_users: "users",
  patients: "patients",
  visits: "visits",
  vitals: "vitals",
  consultations: "consultations",
  dispenses: "dispenses",
  inventory: "inventory",
  queue: "queue",
  patient_allergies: "patientAllergies",
  patient_preferences: "patientPreferences",
};

/**
 * Local table name for a record type, or null when this device has no such
 * table. Record types already named after a local table are accepted as is.
 */
export function localTableFor(
  entityType: string,
  localTables: readonly string[],
): string | null {
  const mapped = ENTITY_LOCAL_TABLE[entityType];
  if (mapped) return localTables.includes(mapped) ? mapped : null;
  return localTables.includes(entityType) ? entityType : null;
}

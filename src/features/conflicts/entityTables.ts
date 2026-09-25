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

/** This device's table for a record type named by its server table, or null. */
export function entityLocalTable(entityType: string): string | null {
  return Object.prototype.hasOwnProperty.call(ENTITY_LOCAL_TABLE, entityType)
    ? ENTITY_LOCAL_TABLE[entityType]
    : null;
}

/**
 * Local table name for a record type, or null when this device has no such
 * table. Only the server table names above are accepted; any other name,
 * including a bare local table name, maps to nothing.
 */
export function localTableFor(
  entityType: string,
  localTables: readonly string[],
): string | null {
  const mapped = entityLocalTable(entityType);
  return mapped && localTables.includes(mapped) ? mapped : null;
}

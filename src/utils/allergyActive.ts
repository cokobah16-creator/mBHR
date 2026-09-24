/**
 * Allergies are stored locally with isActive 0/1, but Supabase's
 * patient_allergies.is_active is a boolean, so rows pulled by sync used to be
 * saved as true/false. A check of `isActive === 1` silently dropped every
 * synced allergy — at dispensing that meant no allergy warning at all.
 *
 * Always use isAllergyActive() to test the flag (devices may already hold
 * true/false rows) and toAllergyActiveFlag() when writing remote values.
 */
export function isAllergyActive(allergy: { isActive: unknown }): boolean {
  return allergy.isActive === 1 || allergy.isActive === true;
}

export function toAllergyActiveFlag(value: unknown): 0 | 1 {
  // Missing means active: the server column defaults to true.
  if (value === undefined || value === null) return 1;
  return value === true || value === 1 || value === "true" ? 1 : 0;
}

// Date of birth worked out from an age, for quick registration when the
// patient does not know the date. The result is an estimate and is saved
// as one (Patient.dobEstimated).

export type AgeUnit = "years" | "months";

/** Ages quick registration accepts, per unit. Months cover children under 2. */
export const AGE_LIMITS: Record<AgeUnit, { min: number; max: number }> = {
  years: { min: 1, max: 120 },
  months: { min: 0, max: 23 },
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Estimated date of birth (YYYY-MM-DD) for a whole number of years or
 * months, or null when the age cannot be used.
 *
 * Years keep the long-standing 1 January of the birth year. Months use the
 * first day of the birth month, so a baby's age in months is right. Both
 * are local calendar dates and never later than today, and the same age
 * entered again in the same year (or month) gives the same date, so the
 * duplicate check can still find a patient registered twice.
 */
export function estimateDobFromAge(
  amount: number,
  unit: AgeUnit,
  today: Date = new Date(),
): string | null {
  const limits = AGE_LIMITS[unit];
  if (!limits || !Number.isInteger(amount)) return null;
  if (amount < limits.min || amount > limits.max) return null;
  if (unit === "years") return `${today.getFullYear() - amount}-01-01`;
  // Day 1 of a month counted back from this one (Date handles the years).
  const birthMonth = new Date(today.getFullYear(), today.getMonth() - amount, 1);
  return `${birthMonth.getFullYear()}-${pad(birthMonth.getMonth() + 1)}-01`;
}

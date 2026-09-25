// Patient display helpers shared by headers, lists and the queue.

/** Short, stable, human-readable identifier derived from the record id. */
export function formatPatientId(id: string): string {
  return `MBHR-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads a date of birth. A plain YYYY-MM-DD date is read as that calendar
 * day on this device, not as midnight UTC, so a birthday falls on the same
 * day in every time zone. Returns null for a date that does not exist
 * (for example 2026-02-30) or cannot be read.
 */
function parseBirthDate(dob: string): Date | null {
  const match = DATE_ONLY.exec(dob);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const birth = new Date(year, month - 1, day);
    // The Date constructor rolls 2026-02-30 over to 2 March: refuse that.
    if (
      birth.getFullYear() !== year ||
      birth.getMonth() !== month - 1 ||
      birth.getDate() !== day
    ) {
      return null;
    }
    return birth;
  }
  const birth = new Date(dob);
  return Number.isNaN(birth.getTime()) ? null : birth;
}

/** Age in whole years from an ISO date of birth, or null when unknown. */
export function patientAge(dob?: string | null, now: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = parseBirthDate(dob);
  if (!birth) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/** Age from which a person counts as an adult (Child Rights Act 2003). */
export const ADULT_AGE = 18;

/**
 * Whether the person is under `threshold` (18) on `now`, by their date of
 * birth. A person is 18 from the start of their 18th birthday.
 *
 * Returns null when this cannot be told: no date of birth, a date that
 * cannot be read, or a date in the future. Treat null as "needs review",
 * never as an adult.
 */
export function isMinor(
  dob?: string | null,
  now: Date = new Date(),
  threshold: number = ADULT_AGE,
): boolean | null {
  const age = patientAge(dob, now);
  if (age === null || age < 0) return null;
  return age < threshold;
}

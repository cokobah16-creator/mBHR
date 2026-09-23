// Patient display helpers shared by headers, lists and the queue.

/** Short, stable, human-readable identifier derived from the record id. */
export function formatPatientId(id: string): string {
  return `MBHR-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
}

/** Age in whole years from an ISO date of birth, or null when unknown. */
export function patientAge(dob?: string | null, now: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

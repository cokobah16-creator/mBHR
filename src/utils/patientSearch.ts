// Patient search matching shared by the patient picker and the /patients list.

import { formatPatientId } from "./patient";

export interface SearchablePatient {
  id: string;
  givenName: string;
  familyName: string;
  phone?: string | null;
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Trimmed, lower-case text with runs of spaces collapsed to one. */
function tidy(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A query made only of digits and phone punctuation, with 3+ digits. */
export function isPhoneQuery(query: string): boolean {
  const q = query.trim();
  return /^[\d\s+().-]+$/.test(q) && digitsOf(q).length >= 3;
}

/**
 * Digits of a whole or partial number with a Nigerian trunk "0" turned into
 * "234", so "0803" and "+234803" compare alike. Unlike normalizePhone this
 * works on part of a number.
 */
function searchDigits(value: string): string {
  const digits = digitsOf(value);
  if (digits.startsWith("00")) return digits.slice(2);
  return digits.startsWith("0") ? "234" + digits.slice(1) : digits;
}

/**
 * Whether a phone query matches a stored phone. Numbers are compared both as
 * typed and with a Nigerian local "0" read as +234 (the form registration
 * stores, see normalizePhone), so a local "0803 123 4567" finds a stored
 * "+2348031234567" and the other way round. Part of a number (3+ digits)
 * matches too.
 */
export function phoneMatchesQuery(
  stored: string | null | undefined,
  query: string,
): boolean {
  if (!stored || !isPhoneQuery(query)) return false;
  const q = digitsOf(query);
  if (digitsOf(stored).includes(q)) return true;
  const storedE164 = searchDigits(stored);
  const queryE164 = searchDigits(query);
  // A query that is only "234" (or shorter) would match every number.
  return queryE164.length > 3 && storedE164.includes(queryE164);
}

/**
 * Whether a patient matches a search query: the full name in either order
 * (given family or family given), part of either name, the MBHR ID, or the
 * phone number in local or international form. Surrounding and repeated
 * spaces are ignored. An empty query matches everyone.
 */
export function patientMatchesQuery(p: SearchablePatient, query: string): boolean {
  const needle = tidy(query);
  if (!needle) return true;
  const given = tidy(p.givenName);
  const family = tidy(p.familyName);
  return (
    `${given} ${family}`.includes(needle) ||
    `${family} ${given}`.includes(needle) ||
    formatPatientId(p.id).toLowerCase().includes(needle) ||
    phoneMatchesQuery(p.phone, query)
  );
}

// Current versions of the privacy notice and the terms of use.
//
// Each version is the ISO date (YYYY-MM-DD) the text was last changed. The
// pages show it as their "Last updated" date, and portal sign-up records it
// as the version the patient accepted, so the two always match. Change the
// date in the same commit as the text.

/** Version of src/pages/legal/TermsOfUse.tsx. */
export const TERMS_VERSION = "2026-09-22";

/** Version of src/pages/legal/PrivacyPolicy.tsx. */
export const PRIVACY_VERSION = "2026-09-22";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Formats a version date for display, for example "2026-09-22" as
 * "22 September 2026". Parsed by hand so the result does not depend on the
 * device's time zone or language. Returns the input unchanged if it is not
 * a valid YYYY-MM-DD date.
 */
export function formatPolicyDate(version: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  if (!match) return version;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) return version;
  return `${day} ${month} ${match[1]}`;
}

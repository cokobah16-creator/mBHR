// Current versions of the privacy notice and the terms of use.
//
// Each version is the ISO date (YYYY-MM-DD) the text was last changed. The
// pages show it as their "Last updated" date, and portal sign-up records it
// as the version the patient accepted, so the two always match. Change the
// date in the same commit as the text.

/** Version of src/pages/legal/TermsOfUse.tsx. */
export const TERMS_VERSION = "2026-09-22";

/** Version of src/pages/legal/PrivacyPolicy.tsx. */
export const PRIVACY_VERSION = "2026-09-24";

/**
 * What a patient accepted when creating a portal account. It is recorded
 * only when all three sign-up boxes were ticked: the terms of use, the
 * privacy notice, and portal access to their health records.
 */
export interface PolicyAcceptance {
  termsVersion: string;
  privacyVersion: string;
  /** When the boxes were submitted, as an ISO timestamp. */
  acceptedAt: string;
}

/** Shown when an account would be created without all three boxes ticked. */
export const ACCEPTANCE_REQUIRED_MESSAGE =
  "Please tick all three boxes to create your account.";

/** The acceptance to record for a patient who ticks the boxes now. */
export function currentPolicyAcceptance(now: Date = new Date()): PolicyAcceptance {
  return {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: now.toISOString(),
  };
}

/** True when every part of an acceptance is filled in. */
export function isCompleteAcceptance(
  acceptance: PolicyAcceptance | null | undefined,
): acceptance is PolicyAcceptance {
  return (
    !!acceptance &&
    !!acceptance.termsVersion &&
    !!acceptance.privacyVersion &&
    !!acceptance.acceptedAt
  );
}

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

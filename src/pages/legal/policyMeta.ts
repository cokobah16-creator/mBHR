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

// Portal accounts are for adults (isMinor in src/utils/patient.ts). The
// privacy notice says so; change it in the same commit as these rules.

/** Shown when someone under 18 tries to create their own portal account. */
export const UNDER_18_SIGN_UP_MESSAGE =
  "You must be 18 or older to create your own account. Ask a parent or guardian to add you from their own account. They can find out how under People you care for.";

/**
 * Shown instead of linking a new portal account, or a sign-in, to a clinic
 * record that belongs to someone under 18.
 */
export const MINOR_RECORD_LINK_MESSAGE =
  "This email or phone number is on a clinic record for someone under 18. We cannot link a child's record to an account this way. A parent or guardian can find out how to add a child under People you care for in their own account. For help, ask clinic staff.";

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

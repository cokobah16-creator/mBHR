/**
 * Plain-language wording for the portal's "Privacy and data sharing"
 * section. Short sentences, no technical words: the test next to this file
 * fails if any of them appears here (see BANNED_WORDS).
 *
 * The portal's sharing page (DataSharingPreferences.tsx) is written in
 * English without translation keys, so this section follows it.
 */
import type { ConsentPurpose, ConsentState, ConsentTopic } from "@/services/interopConsent";

/** Words patients should never see in this section. */
export const BANNED_WORDS = [
  "fhir",
  "oauth",
  "smart",
  "api",
  "interoperability",
  "token",
  "scope",
] as const;

export const PRIVACY_COPY = {
  title: "Privacy and data sharing",
  intro: [
    "The mBHR care team uses your records to care for you.",
    "mBHR does not share your records with outside organisations or apps.",
    "If you ever gave permission to share your records, it is listed here. You can withdraw it at any time.",
    "Withdrawing stops future sharing. It does not delete your records or the history of who looked at them.",
  ],
  listTitle: "Permissions you have given",
  empty: "You have not given permission to share your records with anyone outside mBHR.",
  loading: "Loading your permissions",
  missing: "This list is not available yet.",
  offline: "You are offline. Connect to the internet to see this list.",
  signedOut: "Sign in online to see this list.",
  failed: "We could not load this list. Try again later.",
  retry: "Try again",
  withdraw: "Withdraw",
  withdrawTitle: "Withdraw this permission?",
  withdrawBody: [
    "From now on, your records will not be shared for this.",
    "Your records stay with the mBHR care team. The history of who looked at them is kept.",
  ],
  withdrawConfirm: "Withdraw permission",
  withdrawCancel: "Keep it",
  withdrawBusy: "Withdrawing…",
  reasonLabel: "Why are you withdrawing it? (optional)",
  withdrawDone: "Your permission was withdrawn.",
  withdrawOffline: "You are offline. Connect to the internet and try again.",
  withdrawMissing: "This cannot be changed here yet. Ask clinic staff to help you.",
  withdrawFailed: "Your permission was not withdrawn. Try again, or ask clinic staff for help.",
  since: "Since",
  withdrawnOn: "Withdrawn on",
  until: "Until",
} as const;

export const TOPIC_LABEL: Record<ConsentTopic, string> = {
  sharing: "Sharing your records outside mBHR",
  research: "Using your records for research",
  care: "Sharing your records for your care",
  future_care: "Your wishes for future care",
  other: "Permission about your records",
};

export const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  care: "for your care",
  emergency_care: "in an emergency",
  operations: "to run health services",
  your_request: "when you ask for it",
  research: "for research",
  public_health: "for public health",
};

export const STATE_LABEL: Record<ConsentState, string> = {
  in_place: "In place",
  not_started: "Not started yet",
  ended: "Ended",
  withdrawn: "Withdrawn",
  declined: "Not given",
  in_error: "Recorded by mistake",
};

/** Every patient-facing string in this section, for the wording test. */
export function allPrivacyStrings(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  add(PRIVACY_COPY);
  add(TOPIC_LABEL);
  add(PURPOSE_LABEL);
  add(STATE_LABEL);
  return out;
}

/** True when a string contains one of the banned words (whole word, any case). */
export function containsBannedWord(text: string): boolean {
  return BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}

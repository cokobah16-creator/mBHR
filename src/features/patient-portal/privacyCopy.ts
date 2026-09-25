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

/*
 * No sentence here claims that mBHR shares nothing: the list shows only
 * what is recorded in mBHR's consent register, which is kept apart from the
 * sharing choices lower down the page and is not yet applied on its own.
 */
export const PRIVACY_COPY = {
  title: "Privacy and data sharing",
  intro: [
    "The mBHR care team uses your records to care for you.",
    "This list shows choices about sharing your records that are recorded in mBHR's consent register.",
    "It is separate from your sharing choices further down this page.",
    "mBHR does not apply these choices automatically yet.",
    "You can withdraw a permission here. To change a refusal, ask clinic staff.",
    "Withdrawing does not delete your records or the history of who looked at them.",
  ],
  listTitle: "Your recorded choices",
  empty: "No choices are recorded here.",
  loading: "Loading your recorded choices",
  missing: "This list is not available yet.",
  offline: "You are offline. Connect to the internet to see this list.",
  signedOut: "Sign in online to see this list.",
  failed: "We could not load this list. Try again later.",
  retry: "Try again",
  withdraw: "Withdraw",
  withdrawTitle: "Withdraw this permission?",
  withdrawBody: [
    "mBHR will record that you withdrew this permission. It will no longer count as your permission.",
    "You cannot undo this here. To give permission again, ask clinic staff.",
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
  /** Under a refusal, which has no Withdraw button. */
  askStaff: "Ask clinic staff if you want to change this.",
  /** Under a refusal that also permits something. */
  alsoAllows: "This choice also allows some sharing.",
  /** Under a record that says nothing either way. */
  unclear: "It does not say what is allowed. Ask clinic staff about it.",
} as const;

/** A permission (it refuses nothing). */
export const TOPIC_LABEL: Record<ConsentTopic, string> = {
  sharing: "Sharing your records outside mBHR",
  research: "Using your records for research",
};

/** A refusal (any record with a "do not" rule). */
export const REFUSAL_LABEL: Record<ConsentTopic, string> = {
  sharing: "You asked us not to share your records outside mBHR",
  research: "You asked us not to use your records for research",
};

/** A record with no rules at all (it neither allows nor refuses). */
export const UNCLEAR_LABEL: Record<ConsentTopic, string> = {
  sharing: "A choice about sharing your records outside mBHR",
  research: "A choice about using your records for research",
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
  add(REFUSAL_LABEL);
  add(UNCLEAR_LABEL);
  add(PURPOSE_LABEL);
  add(STATE_LABEL);
  return out;
}

/** True when a string contains one of the banned words (whole word, any case). */
export function containsBannedWord(text: string): boolean {
  return BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}

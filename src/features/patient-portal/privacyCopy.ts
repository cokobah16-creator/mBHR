/**
 * Plain-language wording for the portal's "Privacy and data sharing"
 * section. Short sentences, no technical words: the test next to this file
 * fails if any of them appears here (see BANNED_WORDS).
 *
 * The portal's sharing page (DataSharingPreferences.tsx) is written in
 * English without translation keys, so this section follows it.
 */
import type {
  ConsentPurpose,
  ConsentState,
  ConsentTopic,
  PatientConsentItem,
} from "@/services/interopConsent";

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
 * the consent records mBHR holds for the patient, which are kept apart
 * from the sharing choices lower down the page and are not yet applied on
 * their own.
 */
export const PRIVACY_COPY = {
  title: "Privacy and data sharing",
  intro: [
    "The mBHR care team uses your records to care for you.",
    "This list shows the choices about sharing your records that mBHR has recorded for you.",
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
  /** Under a choice the list cannot name plainly (see OTHER_CHOICE_LABEL). */
  askStaffAbout: "Ask clinic staff about it.",
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

/** A refusal: a "do not" rule for someone outside mBHR. */
export const REFUSAL_LABEL: Record<ConsentTopic, string> = {
  sharing: "You asked us not to share your records outside mBHR",
  research: "You asked us not to use your records for research",
};

/**
 * A record with a "do not" rule that the list does not name as a refusal
 * to share outside mBHR: the rule is only for the care team or a
 * practitioner, or it is about requests the patient makes (a refusal
 * "when you ask for it" would read as its own opposite).
 */
export const OTHER_CHOICE_LABEL: Record<ConsentTopic, string> = {
  sharing: "A choice about how your records are shared",
  research: "A choice about how your records are used for research",
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
  add(OTHER_CHOICE_LABEL);
  add(UNCLEAR_LABEL);
  add(PURPOSE_LABEL);
  add(STATE_LABEL);
  return out;
}

/**
 * True when a refusal is shown as the patient's own "do not share outside
 * mBHR": one of its "do not" rules is for someone outside mBHR, and none of
 * them is about requests the patient makes.
 */
export function isNamedRefusal(item: PatientConsentItem): boolean {
  return item.kind === "refusal" && item.refusesOutside && !item.refuses.includes("your_request");
}

/** The row's title: what the record says, with the purposes it names. */
export function consentTitle(item: PatientConsentItem): string {
  if (item.kind === "unclear") return UNCLEAR_LABEL[item.topic];
  if (item.kind === "refusal" && !isNamedRefusal(item)) return OTHER_CHOICE_LABEL[item.topic];
  const label = item.kind === "refusal" ? REFUSAL_LABEL[item.topic] : TOPIC_LABEL[item.topic];
  const named = item.kind === "refusal" ? item.refuses : item.permits;
  // No suffix that repeats the topic ("for research (for research)").
  const purposes = named
    .filter((p) => !(item.topic === "research" && p === "research"))
    .map((p) => PURPOSE_LABEL[p])
    .join(", ");
  return purposes ? `${label} (${purposes})` : label;
}

/** The line under the title, or null (a permission has none). */
export function consentNote(item: PatientConsentItem): string | null {
  if (item.kind === "unclear") return PRIVACY_COPY.unclear;
  if (item.kind !== "refusal") return null;
  const ask = isNamedRefusal(item) ? PRIVACY_COPY.askStaff : PRIVACY_COPY.askStaffAbout;
  return item.alsoPermits ? `${PRIVACY_COPY.alsoAllows} ${ask}` : ask;
}

/** True when a string contains one of the banned words (whole word, any case). */
export function containsBannedWord(text: string): boolean {
  return BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}

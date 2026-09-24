/**
 * Sharing choices (patient_data_sharing_preferences) in plain language, and
 * the list of changes shown before anything is saved.
 */

export type SharingFlag =
  | "allow_ias_access"
  | "allow_treatment_access"
  | "allow_payment_access"
  | "allow_operations_access"
  | "require_notification";

export interface SharingOption {
  key: SharingFlag;
  title: string;
  description: string;
}

/** The four "who may ask for a copy" choices, in the order shown. */
export const SHARING_OPTIONS: SharingOption[] = [
  {
    key: "allow_treatment_access",
    title: "Other hospitals and clinics treating you",
    description:
      "Doctors and nurses at another hospital or clinic that is caring for you may ask for a copy of your records.",
  },
  {
    key: "allow_ias_access",
    title: "Health apps you choose",
    description:
      "You may connect a health app of your choice to download a copy of your own records.",
  },
  {
    key: "allow_payment_access",
    title: "Health insurance and payment",
    description:
      "A health insurance scheme or an organisation handling payment for your care may ask for the records it needs.",
  },
  {
    key: "allow_operations_access",
    title: "Quality checks and training",
    description:
      "Organisations checking the quality of care or training health workers may ask for records. Your name is usually removed first.",
  },
];

export const NOTIFY_OPTION: SharingOption = {
  key: "require_notification",
  title: "Tell me when my records are requested",
  description:
    "Record that you want to be told each time an organisation requests your records. Messages are not sent automatically yet; recorded requests are listed below.",
};

export type SharingFlags = Record<SharingFlag, boolean>;

export interface SharingChange {
  key: SharingFlag;
  title: string;
  from: boolean;
  to: boolean;
}

const ALL_OPTIONS = [...SHARING_OPTIONS, NOTIFY_OPTION];

export function diffSharing(
  saved: SharingFlags,
  draft: SharingFlags,
): SharingChange[] {
  return ALL_OPTIONS.filter((o) => !!saved[o.key] !== !!draft[o.key]).map(
    (o) => ({
      key: o.key,
      title: o.title,
      from: !!saved[o.key],
      to: !!draft[o.key],
    }),
  );
}

export function choiceLabel(key: SharingFlag, value: boolean): string {
  if (key === "require_notification") return value ? "On" : "Off";
  return value ? "Allowed" : "Not allowed";
}

/** Plain name for a TEFCA exchange purpose code in the access history. */
export function purposeLabel(purpose: string): string {
  switch (purpose) {
    case "individual-access":
      return "You, through a health app";
    case "treatment":
      return "Treatment";
    case "payment":
      return "Insurance or payment";
    case "operations":
      return "Quality checks or training";
    default:
      return purpose;
  }
}

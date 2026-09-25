// Consent and purpose-of-use policy.
//
// mBHR separates internal care from disclosure (docs/interoperability/consent.md):
//
//   TREAT    treatment by mBHR's own staff. Permitted without a stored
//            data-sharing consent: patients attending an outreach are cared
//            for by the team that registered them, and the clinic app already
//            gives these staff the same records. (Organisational policy to be
//            confirmed by DIOF; the model can express a stricter rule.)
//   HOPERAT  operations, PATRQT patient request, HRESCH research,
//   ETREAT   emergency (break-glass), and any external disclosure:
//            refused in this release. External disclosure is default-deny
//            until consent enforcement against interop.consent_records ships.
//
// Purpose codes are HL7 v3 PurposeOfUse (http://terminology.hl7.org/CodeSystem/v3-ActReason).

export type PurposeOfUse = "TREAT" | "HOPERAT" | "PATRQT" | "HRESCH" | "ETREAT";

export const SUPPORTED_PURPOSES: readonly PurposeOfUse[] = ["TREAT"];

const KNOWN: readonly string[] = ["TREAT", "HOPERAT", "PATRQT", "HRESCH", "ETREAT"];

/** Read the requested purpose; absent means treatment. Unknown values are refused. */
export function parsePurposeOfUse(raw: string | null): PurposeOfUse | null {
  if (raw === null || raw.trim() === "") return "TREAT";
  const v = raw.trim().toUpperCase();
  return KNOWN.includes(v) ? (v as PurposeOfUse) : null;
}

export function consentDecision(input: {
  purposeOfUse: PurposeOfUse;
  internalStaff: boolean;
  resourceType: string;
}): { permit: true } | { permit: false; reason: string } {
  if (!input.internalStaff) return { permit: false, reason: "external_disclosure_not_enabled" };
  switch (input.purposeOfUse) {
    case "TREAT":
      return { permit: true };
    case "ETREAT":
      return { permit: false, reason: "break_glass_not_enabled" };
    default:
      return { permit: false, reason: "purpose_not_supported" };
  }
}

// Purpose of use.
//
// mBHR separates internal care from disclosure (docs/interoperability/consent.md):
//
//   TREAT    treatment by mBHR's own staff. Not governed by a stored
//            data-sharing consent: patients attending an outreach are cared
//            for by the team that registered them, and the clinic app already
//            gives these staff the same records. (Organisational policy to be
//            confirmed by DIOF; the model can express a stricter rule.)
//   PATRQT   a patient reading their own record (portal self-access).
//   HOPERAT  operations, HRESCH research, PUBHLTH public health,
//   ETREAT   emergency (break-glass), and any external disclosure:
//            refused in this release. Where consent governs them, stored
//            directives are evaluated by consent/evaluateConsent.ts.
//
// Purpose codes are HL7 v3 PurposeOfUse (http://terminology.hl7.org/CodeSystem/v3-ActReason).

export type PurposeOfUse = "TREAT" | "HOPERAT" | "PATRQT" | "HRESCH" | "ETREAT" | "PUBHLTH";

/** Purposes this release serves, per kind of account. */
export const SUPPORTED_PURPOSES: { staff: readonly PurposeOfUse[]; patient: readonly PurposeOfUse[] } = {
  staff: ["TREAT"],
  patient: ["PATRQT"],
};

export const PURPOSE_OF_USE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActReason";

const KNOWN: readonly string[] = ["TREAT", "HOPERAT", "PATRQT", "HRESCH", "ETREAT", "PUBHLTH"];

/**
 * Read the requested purpose (X-Purpose-Of-Use header). Absent means the
 * account's ordinary purpose: treatment for staff, the patient's own request
 * for a patient. Unknown values are refused (null).
 */
export function parsePurposeOfUse(raw: string | null, whenAbsent: PurposeOfUse = "TREAT"): PurposeOfUse | null {
  if (raw === null || raw.trim() === "") return whenAbsent;
  const v = raw.trim().toUpperCase();
  return KNOWN.includes(v) ? (v as PurposeOfUse) : null;
}

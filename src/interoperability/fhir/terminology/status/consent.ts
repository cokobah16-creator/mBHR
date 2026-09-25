// Status maps for: Consent.status <- interop.consent_records.status.
//
// The consent register stores the FHIR R4 consent-state codes themselves:
// a CHECK on the table allows only draft, proposed, active, rejected,
// inactive and entered-in-error. Each stored value therefore becomes the
// same code, and nothing is re-interpreted:
//
//   - draft stays draft (it is never shown as proposed or active)
//   - a record's own period (effective_from / effective_until) does not
//     change its status: an active record whose period has ended is still
//     "active" as recorded, and the period is published in
//     provision.period, which is what limits when it applies
//
// Withdrawal. mBHR withdraws a consent by recording the withdrawal
// (withdrawn_at, and the status becomes inactive); the record is never
// deleted and a withdrawal cannot be undone. A withdrawn record is read
// with CONSENT_STATUS_WITHDRAWN instead: it is inactive (or stays
// entered-in-error) whatever the status column says, so a withdrawn
// consent is never shown as active, draft or proposed. The table's CHECK
// already forbids any other combination; this map is the defence if one
// ever appears.
//
// Consent.status is required (1..1) and consent-state-codes has no
// "unknown" code, so a record with no status, or a status outside the
// value set, is not published at all (the fallbacks below say so).
//
// The status is filtered after mapping (the register is read through a
// database function, not with PostgREST filters), so a search by status
// always finds exactly what the mapper shows.

import type { StatusMap } from "../statusMaps";

export type ConsentState = "draft" | "proposed" | "active" | "rejected" | "inactive" | "entered-in-error";

export const CONSENT_STATE_CODES: readonly ConsentState[] = [
  "draft",
  "proposed",
  "active",
  "rejected",
  "inactive",
  "entered-in-error",
];

export const CONSENT_STATE_VALUE_SET = "http://hl7.org/fhir/ValueSet/consent-state-codes";
/** The code system of Consent.status (for status search tokens that name a system). */
export const CONSENT_STATE_SYSTEM = "http://hl7.org/fhir/consent-state-codes";

const WITHHELD_MISSING =
  "No status was recorded. Consent.status is required and consent-state-codes has no 'unknown' code, so the record is withheld (not published), never given a guessed status.";
const WITHHELD_UNRECOGNISED =
  "Not a consent-state code (the register's CHECK allows no other value). Consent.status is required, so the record is withheld (not published) rather than guessed.";

export const CONSENT_STATUS: StatusMap<ConsentState> = {
  element: "Consent.status",
  source: "interop.consent_records.status",
  valueSet: CONSENT_STATE_VALUE_SET,
  allowed: CONSENT_STATE_CODES,
  rules: [
    {
      source: ["draft"],
      fhir: "draft",
      reason: "Being prepared and not yet in force. Never shown as proposed or active.",
    },
    {
      source: ["proposed"],
      fhir: "proposed",
      reason: "Offered but not yet agreed by everyone who must agree; not in force.",
    },
    {
      source: ["active"],
      fhir: "active",
      reason: "Recorded as in force. Its period (provision.period) still limits when it applies; an ended period does not change the recorded status.",
    },
    {
      source: ["rejected"],
      fhir: "rejected",
      reason: "Declined: it never came into force.",
    },
    {
      source: ["inactive"],
      fhir: "inactive",
      reason: "No longer in force (for example withdrawn). The record is kept, never deleted, and never shown as active.",
    },
    {
      source: ["entered-in-error"],
      fhir: "entered-in-error",
      reason: "Recorded by mistake. Kept for the record; never in force.",
    },
  ],
  missing: { fhir: null, reason: WITHHELD_MISSING },
  unrecognised: { fhir: null, reason: WITHHELD_UNRECOGNISED },
};

export const CONSENT_STATUS_WITHDRAWN: StatusMap<ConsentState> = {
  element: "Consent.status",
  source: "interop.consent_records.status of a withdrawn record (withdrawn_at is set)",
  valueSet: CONSENT_STATE_VALUE_SET,
  allowed: CONSENT_STATE_CODES,
  rules: [
    {
      source: ["inactive", "active", "draft", "proposed", "rejected"],
      fhir: "inactive",
      reason:
        "A withdrawn consent is no longer in force: inactive whatever the status column says (the withdrawal writes inactive, and a withdrawal is final). Never shown as active.",
    },
    {
      source: ["entered-in-error"],
      fhir: "entered-in-error",
      reason: "Withdrawing a record that was entered in error keeps entered-in-error.",
    },
  ],
  missing: { fhir: null, reason: WITHHELD_MISSING },
  unrecognised: { fhir: null, reason: WITHHELD_UNRECOGNISED },
};

export const CONSENT_STATUS_MAPS: readonly StatusMap[] = [CONSENT_STATUS, CONSENT_STATUS_WITHDRAWN];

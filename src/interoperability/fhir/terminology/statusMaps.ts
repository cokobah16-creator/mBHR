// Explicit status maps (Phase 2 section 39).
//
// Every mBHR status that becomes a FHIR status goes through one of these
// tables. Each rule names the mBHR source values, the FHIR value and why;
// each table says what happens when the value is missing or not one the
// table knows. The rules this module keeps (see CLINICAL_LOGIC_CHANGES.md):
//
//   - unknown stays unknown: a missing or unrecognised value becomes
//     "unknown" where the FHIR value set has it, and otherwise nothing
//     (the element is left out, or the record is withheld when FHIR
//     requires the element); it never becomes a definite status
//   - no status is promoted: ordered is never dispensed or completed,
//     pending or preliminary is never final, cancelled is never finished,
//     inactive is never active, suspected is never confirmed
//
// Source values are compared lower-cased and exactly (no trimming), the
// same comparison the search filters use (PostgREST ilike without
// wildcards), so a search by status finds exactly what the mapper shows.
//
// The maps are listed in STATUS_MAPS so tests check every one against the
// rules above and docs/interoperability/resource-mapping.md can print them.

export interface StatusRule<T extends string> {
  /** mBHR values (lower case) that map to `fhir`. */
  source: readonly string[];
  fhir: T;
  reason: string;
}

export interface StatusFallback<T extends string> {
  /** null: no FHIR value (omit the element, or withhold the record if FHIR requires it). */
  fhir: T | null;
  reason: string;
}

export interface StatusMap<T extends string = string> {
  /** The FHIR element, e.g. "Encounter.status". */
  element: string;
  /** The mBHR column, e.g. "public.visits.status". */
  source: string;
  /** The FHIR R4 value set the element is bound to. */
  valueSet: string;
  /** Codes of that value set (for tests). */
  allowed: readonly T[];
  rules: readonly StatusRule<T>[];
  /** The column is NULL or empty. */
  missing: StatusFallback<T>;
  /** A value no rule lists. */
  unrecognised: StatusFallback<T>;
}

export interface StatusResult<T extends string> {
  fhir: T | null;
  reason: string;
}

/** The FHIR value for an mBHR status, with the reason (for tests and docs). */
export function explainStatus<T extends string>(map: StatusMap<T>, raw: unknown): StatusResult<T> {
  if (typeof raw !== "string" || raw === "") return map.missing;
  const v = raw.toLowerCase();
  const rule = map.rules.find((r) => r.source.includes(v));
  return rule ? { fhir: rule.fhir, reason: rule.reason } : map.unrecognised;
}

export function applyStatusMap<T extends string>(map: StatusMap<T>, raw: unknown): T | null {
  return explainStatus(map, raw).fhir;
}

/** mBHR source values that map to `fhir` (for search filters). */
export function sourceValuesFor<T extends string>(map: StatusMap<T>, fhir: string): string[] {
  return map.rules.filter((r) => r.fhir === fhir).flatMap((r) => [...r.source]);
}

/** Every source value the map recognises. */
export function knownSourceValues(map: StatusMap): string[] {
  return map.rules.flatMap((r) => [...r.source]);
}

// ---------------------------------------------------------------------------
// Encounter.status <- public.visits.status
// ---------------------------------------------------------------------------

export type EncounterStatus =
  | "planned"
  | "arrived"
  | "triaged"
  | "in-progress"
  | "onleave"
  | "finished"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export const ENCOUNTER_STATUS: StatusMap<EncounterStatus> = {
  element: "Encounter.status",
  source: "public.visits.status",
  valueSet: "http://hl7.org/fhir/ValueSet/encounter-status",
  allowed: ["planned", "arrived", "triaged", "in-progress", "onleave", "finished", "cancelled", "entered-in-error", "unknown"],
  rules: [
    {
      source: ["open", "in_progress", "in-progress", "active"],
      fhir: "in-progress",
      reason: "The visit was opened on a tablet and not closed; mBHR records no end time.",
    },
    {
      source: ["closed", "completed", "finished"],
      fhir: "finished",
      reason: "A clinician closed the visit.",
    },
    {
      source: ["cancelled"],
      fhir: "cancelled",
      reason: "The visit was cancelled; it is never shown as finished.",
    },
  ],
  missing: { fhir: "unknown", reason: "No status was recorded." },
  unrecognised: { fhir: "unknown", reason: "A status the app does not write; not guessed." },
};

export function mapEncounterStatus(raw: unknown): EncounterStatus {
  return applyStatusMap(ENCOUNTER_STATUS, raw) ?? "unknown";
}

// ---------------------------------------------------------------------------
// Condition.clinicalStatus / verificationStatus <- public.conditions
// (the table already stores FHIR codes; anything else is left out, and so
// is a stored verification status 'confirmed', the column's default)
// ---------------------------------------------------------------------------

const CONDITION_CLINICAL_CODES = ["active", "recurrence", "relapse", "inactive", "remission", "resolved"] as const;
const CONDITION_VERIFICATION_CODES = [
  "unconfirmed",
  "provisional",
  "differential",
  "confirmed",
  "refuted",
  "entered-in-error",
] as const;

export const CONDITION_CLINICAL_STATUS: StatusMap<(typeof CONDITION_CLINICAL_CODES)[number]> = {
  element: "Condition.clinicalStatus",
  source: "public.conditions.clinical_status",
  valueSet: "http://hl7.org/fhir/ValueSet/condition-clinical",
  allowed: CONDITION_CLINICAL_CODES,
  rules: CONDITION_CLINICAL_CODES.map((code) => ({
    source: [code],
    fhir: code,
    reason: "Stored as the FHIR code by the app.",
  })),
  missing: { fhir: null, reason: "Not recorded: left out (FHIR allows no clinical status)." },
  unrecognised: { fhir: null, reason: "Not a FHIR clinical status: left out, not guessed." },
};

export const CONDITION_VERIFICATION_STATUS: StatusMap<(typeof CONDITION_VERIFICATION_CODES)[number]> = {
  element: "Condition.verificationStatus",
  source: "public.conditions.verification_status",
  valueSet: "http://hl7.org/fhir/ValueSet/condition-ver-status",
  allowed: CONDITION_VERIFICATION_CODES,
  // Every code except "confirmed", the column's default (see unrecognised
  // and mappers/condition.ts).
  rules: CONDITION_VERIFICATION_CODES.filter((code) => code !== "confirmed").map((code) => ({
    source: [code],
    fhir: code,
    reason: "Stored as the FHIR code by the app; a provisional or differential diagnosis is never shown as confirmed.",
  })),
  missing: { fhir: null, reason: "Not recorded: left out, never assumed confirmed." },
  unrecognised: {
    fhir: null,
    reason:
      "'confirmed' is the column's default (DEFAULT 'confirmed'), so it may just mean that nobody recorded a verification status; the two cannot be told apart. It is left out, never shown as confirmed. Any other value is not a FHIR verification status: left out, not guessed.",
  },
};
